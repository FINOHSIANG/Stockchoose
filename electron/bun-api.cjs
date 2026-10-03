const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const DEFAULT_BUN_API_PORT = 18082;
const HEALTH_CACHE_MS = 5000;
const STARTUP_ATTEMPTS = 30;
const STARTUP_DELAY_MS = 250;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 64 * 1024 * 1024;

// The renderer never sees this token. It authenticates the private Bun sidecar
// even when another process has managed to bind the configured loopback port.
const configuredInstanceToken = String(process.env.STOCKCHOOSE_BUN_API_TOKEN || "").trim();
const BUN_API_INSTANCE_TOKEN = configuredInstanceToken || crypto.randomBytes(32).toString("hex");
process.env.STOCKCHOOSE_BUN_API_TOKEN = BUN_API_INSTANCE_TOKEN;

function byteLimitFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const MAX_REQUEST_BODY_BYTES = byteLimitFromEnv("STOCKCHOOSE_BUN_MAX_REQUEST_BODY_BYTES", DEFAULT_MAX_REQUEST_BODY_BYTES);
const MAX_RESPONSE_BODY_BYTES = byteLimitFromEnv("STOCKCHOOSE_BUN_MAX_RESPONSE_BODY_BYTES", DEFAULT_MAX_RESPONSE_BODY_BYTES);

class ProxyPayloadTooLargeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ProxyPayloadTooLargeError";
    this.code = code;
  }
}

let bunApiProcess = null;
let healthCache = { checkedAt: 0, ok: false };
let lastStartupError = "";

function bunApiPort() {
  return Number(process.env.STOCKCHOOSE_BUN_PORT || DEFAULT_BUN_API_PORT);
}

function dataCacheDir() {
  const { app } = process.versions.electron ? require("electron") : {};
  const base = app ? app.getPath("userData") : repoRoot();
  return path.resolve(process.env.STOCKCHOOSE_DATA_CACHE_DIR || path.join(base, "data-cache"));
}

function agentAuthFilePath() {
  return path.resolve(process.env.STOCKCHOOSE_AGENT_AUTH_FILE || path.join(dataCacheDir(), "agent-runtime", "sidecar-auth"));
}

function writeAgentAuthFile() {
  const filePath = agentAuthFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, BUN_API_INSTANCE_TOKEN, { encoding: "utf8", mode: 0o600 });
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  process.env.STOCKCHOOSE_AGENT_AUTH_FILE = filePath;
  return filePath;
}

function bunApiBaseUrl() {
  return (process.env.STOCKCHOOSE_BUN_API_URL || `http://127.0.0.1:${bunApiPort()}`).replace(/\/$/, "");
}

function bunApiProcessEnv() {
  const authFile = writeAgentAuthFile();
  return {
    ...process.env,
    STOCKCHOOSE_BUN_PORT: String(bunApiPort()),
    STOCKCHOOSE_DATA_CACHE_DIR: dataCacheDir(),
    STOCKCHOOSE_BUN_API_TOKEN: BUN_API_INSTANCE_TOKEN,
    STOCKCHOOSE_AGENT_AUTH_FILE: authFile
  };
}

function isBunApiDisabled() {
  return process.env.STOCKCHOOSE_BUN_API_DISABLED === "1";
}

function repoRoot() {
  return path.join(__dirname, "..");
}

function candidateBunExecutables() {
  const exeName = process.platform === "win32" ? "bun.exe" : "bun";
  const sidecarName = process.platform === "win32" ? "stockchoose-bun-api.exe" : "stockchoose-bun-api";
  const resourcesPath = process.resourcesPath || "";
  const executableDir = process.execPath ? path.dirname(process.execPath) : "";
  const fromPath = (process.env.PATH || "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, exeName));
  return [
    process.env.STOCKCHOOSE_BUN_API_EXE,
    path.join(resourcesPath, sidecarName),
    path.join(resourcesPath, "resources", sidecarName),
    path.join(executableDir, "resources", sidecarName),
    path.join(executableDir, sidecarName),
    process.env.BUN_EXE,
    path.join(resourcesPath, exeName),
    path.join(resourcesPath, "resources", exeName),
    path.join(repoRoot(), "bun", exeName),
    ...fromPath,
    path.join(repoRoot(), "tmp", "sidecars", sidecarName),
    exeName
  ].filter(Boolean);
}

function findBunExecutable() {
  return candidateBunExecutables().find((filePath) => {
    if (filePath === "bun" || filePath === "bun.exe") return true;
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestBuffer(targetUrl, { method = "GET", headers = {}, body, timeoutMs = 180000, maxResponseBytes = MAX_RESPONSE_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const requestBody = body && !Buffer.isBuffer(body) ? Buffer.from(body) : body;
    if (requestBody && requestBody.length > MAX_REQUEST_BODY_BYTES) {
      reject(new ProxyPayloadTooLargeError(`request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`, "REQUEST_BODY_TOO_LARGE"));
      return;
    }
    const requestHeaders = {
      accept: "application/json,text/plain,*/*",
      "user-agent": "StockChoose-Electron-Bun/0.1",
      ...headers
    };
    if (requestBody && requestBody.length) requestHeaders["content-length"] = String(requestBody.length);
    const request = http.request(parsed, { method, timeout: timeoutMs, headers: requestHeaders }, (upstreamResponse) => {
      const chunks = [];
      let totalBytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const declaredLength = Number(upstreamResponse.headers["content-length"]);
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        fail(new ProxyPayloadTooLargeError(`upstream response exceeds ${maxResponseBytes} bytes`, "RESPONSE_BODY_TOO_LARGE"));
        upstreamResponse.destroy();
        return;
      }
      upstreamResponse.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxResponseBytes) {
          fail(new ProxyPayloadTooLargeError(`upstream response exceeds ${maxResponseBytes} bytes`, "RESPONSE_BODY_TOO_LARGE"));
          upstreamResponse.destroy();
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: upstreamResponse.statusCode || 502,
          headers: upstreamResponse.headers,
          body: Buffer.concat(chunks)
        });
      });
      upstreamResponse.on("aborted", () => fail(new Error("bun api response aborted")));
      upstreamResponse.on("error", fail);
    });
    request.on("timeout", () => request.destroy(new Error("bun api timeout")));
    request.on("error", reject);
    if (requestBody && requestBody.length) request.write(requestBody);
    request.end();
  });
}

function collectRequestBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  if (request.method === "GET" || request.method === "HEAD") return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers?.["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      request.resume();
      reject(new ProxyPayloadTooLargeError(`request body exceeds ${maxBytes} bytes`, "REQUEST_BODY_TOO_LARGE"));
      return;
    }
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        fail(new ProxyPayloadTooLargeError(`request body exceeds ${maxBytes} bytes`, "REQUEST_BODY_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error) => fail(error);
    const onAborted = () => fail(new Error("client request aborted"));
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

function forwardedHeaders(headers = {}) {
  const result = {};
  for (const key of ["accept", "content-type", "authorization"]) {
    if (headers[key]) result[key] = headers[key];
  }
  return result;
}

function bunApiRequestHeaders(headers = {}) {
  return {
    ...headers,
    // Always overwrite a renderer-supplied value; only the Electron main
    // process may authenticate requests to the Bun sidecar.
    "x-stockchoose-instance-token": BUN_API_INSTANCE_TOKEN
  };
}

async function checkBunApiHealth({ force = false } = {}) {
  if (!force && Date.now() - healthCache.checkedAt < HEALTH_CACHE_MS) return healthCache.ok;
  try {
    const result = await requestBuffer(`${bunApiBaseUrl()}/health`, {
      headers: bunApiRequestHeaders(),
      timeoutMs: 1200,
      maxResponseBytes: 1024 * 1024
    });
    let payload;
    try {
      payload = JSON.parse(result.body.toString("utf8"));
    } catch {
      payload = undefined;
    }
    healthCache = {
      checkedAt: Date.now(),
      ok: result.statusCode >= 200 && result.statusCode < 300 && payload?.service === "stockchoose-bun-api"
    };
  } catch {
    healthCache = { checkedAt: Date.now(), ok: false };
  }
  return healthCache.ok;
}

async function ensureBunApiRunning() {
  if (isBunApiDisabled()) return false;
  if (await checkBunApiHealth()) return true;
  if (!bunApiProcess || bunApiProcess.exitCode !== null) {
    const executable = findBunExecutable();
    if (!executable) {
      lastStartupError = `Bun executable not found. Checked: ${candidateBunExecutables().join("; ")}`;
      return false;
    }
    const isCompiledSidecar = path.basename(executable).toLowerCase().startsWith("stockchoose-bun-api");
    const cwd = isCompiledSidecar ? path.dirname(executable) : repoRoot();
    try {
      bunApiProcess = spawn(executable, isCompiledSidecar ? [] : ["run", path.join(repoRoot(), "bun-api", "server.ts")], {
        cwd,
        env: bunApiProcessEnv(),
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      bunApiProcess.once("error", (error) => {
        lastStartupError = `Failed to spawn Bun sidecar at ${executable}: ${error.message}`;
        bunApiProcess = null;
      });
      bunApiProcess.unref();
    } catch (error) {
      lastStartupError = `Failed to spawn Bun sidecar at ${executable}: ${error.message}`;
      bunApiProcess = null;
      return false;
    }
  }
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    await delay(STARTUP_DELAY_MS);
    if (await checkBunApiHealth({ force: true })) return true;
  }
  return false;
}

function normalizeBunPath(pathValue) {
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

function bunProxyResponseHeaders(upstreamHeaders = {}, options = {}) {
  const headers = {
    "content-type": upstreamHeaders["content-type"] || options.contentType || "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-stockchoose-data-engine": "bun",
    ...(options.responseHeaders || {})
  };
  if (upstreamHeaders["x-stockchoose-market-source"]) {
    headers["x-stockchoose-market-source"] = upstreamHeaders["x-stockchoose-market-source"];
  }
  return headers;
}

async function handleBunProxyRequest(request, response, options = {}) {
  const prefix = options.prefix || "/api";
  const requestUrl = request.url || "/";
  if (!requestUrl.startsWith(prefix)) return false;
  if (!(await ensureBunApiRunning())) return false;
  try {
    const rewrittenPath = options.rewrite ? options.rewrite(requestUrl) : requestUrl;
    const body = await collectRequestBody(request);
    const result = await requestBuffer(`${bunApiBaseUrl()}${normalizeBunPath(rewrittenPath)}`, {
      method: request.method || "GET",
      headers: bunApiRequestHeaders(forwardedHeaders(request.headers)),
      body,
      timeoutMs: options.timeoutMs || 180000
    });
    if (options.requireSuccess !== false && (result.statusCode < 200 || result.statusCode >= 300)) return false;
    response.writeHead(result.statusCode, bunProxyResponseHeaders(result.headers, options));
    response.end(result.body);
    return true;
  } catch (error) {
    if (error?.code === "REQUEST_BODY_TOO_LARGE") {
      response.writeHead(413, bunProxyResponseHeaders({}, { ...options, contentType: "text/plain; charset=utf-8" }));
      response.end("Request body too large");
      return true;
    }
    if (error?.code === "RESPONSE_BODY_TOO_LARGE") {
      response.writeHead(502, bunProxyResponseHeaders({}, { ...options, contentType: "text/plain; charset=utf-8" }));
      response.end("Upstream response too large");
      return true;
    }
    return false;
  }
}

async function handleBunAktoolsRequest(request, response, options = {}) {
  return handleBunProxyRequest(request, response, { ...options, prefix: options.prefix || "/aktools" });
}

function stopBunApiSidecar() {
  if (bunApiProcess && bunApiProcess.exitCode === null) bunApiProcess.kill();
  bunApiProcess = null;
  healthCache = { checkedAt: 0, ok: false };
  fs.rmSync(agentAuthFilePath(), { force: true });
}

module.exports = {
  ensureBunApiRunning,
  handleBunAktoolsRequest,
  handleBunProxyRequest,
  bunProxyResponseHeaders,
  bunApiRequestHeaders,
  bunApiInstanceToken: () => BUN_API_INSTANCE_TOKEN,
  collectRequestBody,
  requestBuffer,
  maxRequestBodyBytes: () => MAX_REQUEST_BODY_BYTES,
  maxResponseBodyBytes: () => MAX_RESPONSE_BODY_BYTES,
  stopBunApiSidecar,
  bunApiBaseUrl,
  bunApiProcessEnv,
  dataCacheDir,
  agentAuthFilePath,
  writeAgentAuthFile,
  findBunExecutable
};
