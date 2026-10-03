import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { once } from "node:events";

const root = resolve("tmp/akshare-api-audit");
await mkdir(root, { recursive: true });
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const token = randomBytes(24).toString("hex");
const base = `http://127.0.0.1:${port}`;
const upstream = process.env.STOCKCHOOSE_AKTOOLS_BASE_URL || "http://127.0.0.1:18080/api/public";
const child = spawn("bun", ["bun-api/server.ts"], {
  cwd: process.cwd(), windowsHide: true,
  env: {
    ...process.env,
    STOCKCHOOSE_BUN_PORT: String(port),
    STOCKCHOOSE_BUN_API_TOKEN: token,
    STOCKCHOOSE_DATA_CACHE_DIR: resolve(root, "bun-smoke-cache"),
    STOCKCHOOSE_AKTOOLS_BASE_URL: upstream,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const closed = once(child, "close");
const out = createWriteStream(resolve(root, "bun-smoke.out.log"));
const err = createWriteStream(resolve(root, "bun-smoke.err.log"));
child.stdout.pipe(out);
child.stderr.pipe(err);
const report = { checkedAt: new Date().toISOString(), upstream, results: [] };
async function post(path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-stockchoose-instance-token": token },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
}
try {
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Bun exited: ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`, {
        headers: { "x-stockchoose-instance-token": token }, signal: AbortSignal.timeout(500)
      });
      healthy = response.ok;
      if (healthy) break;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(healthy, "isolated Bun health");
  const rowsResponse = await post("/api/integration/aktools/rows", {
    baseUrl: "/akshare-api/api/public", endpoint: "stock_zh_a_hist_tx",
    params: { symbol: "sz000001", start_date: "20260601", end_date: "20260909", adjust: "qfq" }
  });
  assert.equal(rowsResponse.status, 200, await rowsResponse.clone().text());
  const rows = await rowsResponse.json();
  assert.ok(rows.length > 0 && rows.every((row) => row.date && Number.isFinite(row.close)));
  report.results.push({ case: "configured-bridge-history", ok: true, http: rowsResponse.status, rows: rows.length });

  const selected = await post("/api/integration/source-test", {
    provider: "AKShare / AKTools", baseUrl: "/akshare-api/api/public"
  });
  const selectedBody = await selected.json();
  // A live provider may fail. The check must never claim to have tested the native fallback.
  if (selected.ok) assert.equal(selectedBody.source, "aktools");
  report.results.push({ case: "configured-source-test", http: selected.status, result: selectedBody });

  const unreachable = await post("/api/integration/source-test", {
    provider: "AKShare / AKTools", baseUrl: "http://127.0.0.1:1/api/public"
  });
  assert.ok(!unreachable.ok, "unconfigured local source must not pass via native fallback");
  report.results.push({ case: "unconfigured-local-source-rejected", ok: true, http: unreachable.status });

  const injection = await post("/api/integration/aktools/rows", {
    baseUrl: "/akshare-api/api/public", endpoint: "../version", params: {}
  });
  assert.equal(injection.status, 400);
  report.results.push({ case: "endpoint-traversal-rejected", ok: true, http: injection.status });
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  child.kill();
  await closed;
  out.end();
  err.end();
  await writeFile(resolve(root, "bun-integration.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
