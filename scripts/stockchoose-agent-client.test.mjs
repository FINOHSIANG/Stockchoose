import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStockChooseAgentClient, stockChooseAgentClientTesting, validateStockChooseApiBaseUrl } from "./stockchoose-agent-client.mjs";

test("accepts only loopback HTTP STOCKCHOOSE API URLs", () => {
  assert.equal(validateStockChooseApiBaseUrl("http://127.0.0.1:18082").origin, "http://127.0.0.1:18082");
  assert.throws(() => validateStockChooseApiBaseUrl("https://127.0.0.1:18082"));
  assert.throws(() => validateStockChooseApiBaseUrl("http://example.com:18082"));
  assert.throws(() => validateStockChooseApiBaseUrl("http://user:pass@127.0.0.1:18082"));
});

test("sends the private sidecar token and bounded announcement request", async () => {
  const calls = [];
  const client = createStockChooseAgentClient({
    baseUrl: "http://127.0.0.1:18082",
    token: "t".repeat(64),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await client.announcements(["600519", "000001"], 500);
  assert.equal(new Headers(calls[0].init.headers).get("x-stockchoose-instance-token"), "t".repeat(64));
  assert.deepEqual(JSON.parse(calls[0].init.body), { codes: ["600519", "000001"], maxItems: 50 });
});

test("reads the sidecar token from the DSH-safe auth file path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stockchoose-agent-auth-"));
  const authFile = path.join(root, "sidecar-auth");
  await writeFile(authFile, "f".repeat(64), "utf8");
  const receivedTokens = [];
  try {
    const client = createStockChooseAgentClient({
      baseUrl: "http://127.0.0.1:18082",
      token: "",
      authFile,
      fetchImpl: async (_url, init) => {
        receivedTokens.push(new Headers(init.headers).get("x-stockchoose-instance-token"));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    await client.status();
    await writeFile(authFile, "g".repeat(64), "utf8");
    await client.status();
    assert.deepEqual(receivedTokens, ["f".repeat(64), "g".repeat(64)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("redacts secret-like details from upstream errors", () => {
  assert.equal(stockChooseAgentClientTesting.redactText("token=abc password: xyz"), "token=[redacted] password=[redacted]");
});

test("submits a bounded workspace action and waits for UI confirmation", async () => {
  let received;
  const client = createStockChooseAgentClient({
    baseUrl: "http://127.0.0.1:18082",
    token: "w".repeat(64),
    fetchImpl: async (url, init) => {
      received = { url: String(url), init };
      return new Response(JSON.stringify({ completed: true, action: { status: "completed" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  await client.workspaceAction("create-strategy", { name: "Agent Strategy" }, 50_000);
  assert.equal(new URL(received.url).pathname, "/api/agent/workspace/actions");
  assert.deepEqual(JSON.parse(received.init.body), {
    type: "create-strategy",
    payload: { name: "Agent Strategy" },
    waitMs: 25_000
  });
});
