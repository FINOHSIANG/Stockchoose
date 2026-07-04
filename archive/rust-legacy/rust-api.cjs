const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_RUST_API_PORT = 18081;
const HEALTH_CACHE_MS = 5000;
const STARTUP_ATTEMPTS = 20;
const STARTUP_DELAY_MS = 250;

let rustApiProcess = null;
let healthCache = { checkedAt: 0, ok: false };

function rustApiPort() {
  return Number(process.env.STOCKCHOOSE_RUST_PORT || DEFAULT_RUST_API_PORT);
}

function rustApiBaseUrl() {
  return (process.env.STOCKCHOOSE_RUST_API_URL || `http://127.0.0.1:${rustApiPort()}`).replace(/\/$/, "");
}

function isRustApiDisabled() {
  return process.env.STOCKCHOOSE_RUST_API_DISABLED === "1";
}

function repoRoot() {
  return path.join(__dirname, "..");
}

function candidateRustApiExecutables() {
  const exeName = process.platform === "win32" ? "stockchoose-api.exe" : "stockchoose-api";
  return [
    path.join(process.resourcesPath || "", exeName),
    path.join(repoRoot(), "target", "release", exeName),
    path.join(repoRoot(), "target", "debug", exeName)
  ].filter(Boolean);
}

function findRustApiExecutable() {
  return candidateRustApiExecutables().find((filePath) => {
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

function requestBuffer(targetUrl, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === "https:" ? https : http;
    const requestHeaders = {
      accept: "application/json,text/plain,*/*",
      "user-agent": "StockChoose-Electron/0.1",
      ...headers
    };
    if (body && body.length) {
      requestHeaders["content-length"] = String(body.length);
    }
    const request = client.request(
      parsed,
      {
        method,
        timeout: timeoutMs,
        headers: requestHeaders
      },
      (upstreamResponse) => {
        const chunks = [];
        upstreamResponse.on("data", (chunk) => chunks.push(chunk));
        upstreamResponse.on("end", () => {
          resolve({
            statusCode: upstreamResponse.statusCode || 502,
            headers: upstreamResponse.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("rust api timeout")));
    request.on("error", reject);
    if (body && body.length) {
      request.write(body);
    }
    request.end();
  });
}

function collectRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return Promise.resolve(Buffer.alloc(0));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function forwardedHeaders(headers = {}) {
  const result = {};
  for (const key of ["accept", "content-type", "authorization"]) {
    if (headers[key]) result[key] = headers[key];
  }
  return result;
}

async function checkRustApiHealth({ force = false } = {}) {
  if (!force && Date.now() - healthCache.checkedAt < HEALTH_CACHE_MS) {
    return healthCache.ok;
  }
  try {
    const result = await requestBuffer(`${rustApiBaseUrl()}/health`, { timeoutMs: 1200 });
    healthCache = { checkedAt: Date.now(), ok: result.statusCode >= 200 && result.statusCode < 300 };
  } catch {
    healthCache = { checkedAt: Date.now(), ok: false };
  }
  return healthCache.ok;
}

async function ensureRustApiRunning() {
  if (isRustApiDisabled()) return false;
  if (await checkRustApiHealth()) return true;

  if (!rustApiProcess || rustApiProcess.exitCode !== null) {
    const executable = findRustApiExecutable();
    if (!executable) return false;
    rustApiProcess = spawn(executable, {
      cwd: repoRoot(),
      env: { ...process.env, STOCKCHOOSE_RUST_PORT: String(rustApiPort()) },
      detached: false,
      stdio: "ignore",
      windowsHide: true
    });
    rustApiProcess.unref();
  }

  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    await delay(STARTUP_DELAY_MS);
    if (await checkRustApiHealth({ force: true })) return true;
  }
  return false;
}

function rustTargetUrl(requestUrl) {
  return `${rustApiBaseUrl()}${requestUrl || "/"}`;
}

function normalizeRustPath(pathValue) {
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

async function handleRustProxyRequest(request, response, options = {}) {
  const prefix = options.prefix || "/api";
  const requestUrl = request.url || "/";
  if (!requestUrl.startsWith(prefix)) return false;
  if (!(await ensureRustApiRunning())) return false;

  try {
    const rewrittenPath = options.rewrite ? options.rewrite(requestUrl) : requestUrl;
    const body = await collectRequestBody(request);
    const result = await requestBuffer(`${rustApiBaseUrl()}${normalizeRustPath(rewrittenPath)}`, {
      method: request.method || "GET",
      headers: forwardedHeaders(request.headers),
      body,
      timeoutMs: options.timeoutMs || 180000
    });
    if (options.requireSuccess !== false && (result.statusCode < 200 || result.statusCode >= 300)) {
      return false;
    }
    response.writeHead(result.statusCode, {
      "content-type": result.headers["content-type"] || options.contentType || "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-stockchoose-data-engine": "rust"
    });
    response.end(result.body);
    return true;
  } catch {
    return false;
  }
}

async function handleRustAktoolsRequest(request, response, options = {}) {
  const prefix = options.prefix || "/aktools";
  const requestUrl = request.url || "/";
  if (!requestUrl.startsWith(prefix)) return false;
  if (!(await ensureRustApiRunning())) return false;

  try {
    const result = await requestBuffer(rustTargetUrl(requestUrl), { timeoutMs: options.timeoutMs || 180000 });
    if (result.statusCode < 200 || result.statusCode >= 300) return false;
    response.writeHead(result.statusCode, {
      "content-type": result.headers["content-type"] || "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-stockchoose-data-engine": "rust"
    });
    response.end(result.body);
    return true;
  } catch {
    return false;
  }
}

function stopRustApiSidecar() {
  if (rustApiProcess && rustApiProcess.exitCode === null) {
    rustApiProcess.kill();
  }
  rustApiProcess = null;
  healthCache = { checkedAt: 0, ok: false };
}

module.exports = {
  ensureRustApiRunning,
  handleRustAktoolsRequest,
  handleRustProxyRequest,
  stopRustApiSidecar,
  rustApiBaseUrl,
  findRustApiExecutable
};
