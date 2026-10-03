const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { after, before, test } = require("node:test");

process.env.STOCKCHOOSE_BUN_API_TOKEN = "stockchoose-node-test-token";
process.env.STOCKCHOOSE_AGENT_AUTH_FILE = path.join(os.tmpdir(), `stockchoose-agent-auth-${process.pid}`);
process.env.STOCKCHOOSE_BUN_MAX_REQUEST_BODY_BYTES = "8";
process.env.STOCKCHOOSE_BUN_MAX_RESPONSE_BODY_BYTES = "8";

const {
  bunApiProcessEnv,
  bunApiRequestHeaders,
  bunProxyResponseHeaders,
  collectRequestBody,
  maxRequestBodyBytes,
  maxResponseBodyBytes,
  requestBuffer
} = require("./bun-api.cjs");

function bodyRequest(chunks, headers = {}) {
  const request = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  request.method = "POST";
  request.headers = headers;
  return request;
}

test("keeps the sidecar token private to the spawned process and proxy header", () => {
  const env = bunApiProcessEnv();
  assert.equal(env.STOCKCHOOSE_BUN_API_TOKEN, "stockchoose-node-test-token");
  assert.equal(env.STOCKCHOOSE_AGENT_AUTH_FILE, process.env.STOCKCHOOSE_AGENT_AUTH_FILE);
  assert.equal(fs.readFileSync(env.STOCKCHOOSE_AGENT_AUTH_FILE, "utf8"), "stockchoose-node-test-token");
  assert.equal(bunApiRequestHeaders({ "x-stockchoose-instance-token": "renderer-value" })["x-stockchoose-instance-token"], "stockchoose-node-test-token");
});

test("removes wildcard CORS while retaining explicitly supplied security headers", () => {
  const headers = bunProxyResponseHeaders({}, { responseHeaders: { "x-frame-options": "DENY" } });
  assert.equal(headers["access-control-allow-origin"], undefined);
  assert.equal(headers["x-frame-options"], "DENY");
});

test("collectRequestBody enforces declared and streamed body limits", async () => {
  assert.equal(maxRequestBodyBytes(), 8);
  await assert.rejects(
    collectRequestBody(bodyRequest(["123456789"])),
    (error) => error?.code === "REQUEST_BODY_TOO_LARGE"
  );
  await assert.rejects(
    collectRequestBody(bodyRequest([], { "content-length": "9" })),
    (error) => error?.code === "REQUEST_BODY_TOO_LARGE"
  );
  await assert.doesNotReject(async () => {
    assert.equal((await collectRequestBody(bodyRequest(["1234", "5678"]))).toString(), "12345678");
  });
});

let responseServer;
let responseServerUrl;
let receivedToken;

before(async () => {
  responseServer = http.createServer((request, response) => {
    receivedToken = request.headers["x-stockchoose-instance-token"];
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("12345");
    response.end("67890");
  });
  await new Promise((resolve, reject) => {
    responseServer.once("error", reject);
    responseServer.listen(0, "127.0.0.1", resolve);
  });
  responseServerUrl = `http://127.0.0.1:${responseServer.address().port}`;
});

after(async () => {
  if (!responseServer) return;
  await new Promise((resolve) => responseServer.close(resolve));
  fs.rmSync(process.env.STOCKCHOOSE_AGENT_AUTH_FILE, { force: true });
});

test("requestBuffer authenticates requests and rejects oversized streamed responses", async () => {
  assert.equal(maxResponseBodyBytes(), 8);
  await assert.rejects(
    requestBuffer(responseServerUrl, { headers: bunApiRequestHeaders() }),
    (error) => error?.code === "RESPONSE_BODY_TOO_LARGE"
  );
  assert.equal(receivedToken, "stockchoose-node-test-token");
});
