const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_BUN_API_PORT = 18082;
const HEALTH_CACHE_MS = 5000;
const STARTUP_ATTEMPTS = 30;
const STARTUP_DELAY_MS = 250;

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

function bunApiBaseUrl() {
  return (process.env.STOCKCHOOSE_BUN_API_URL || `http://127.0.0.1:${bunApiPort()}`).replace(/\/$/, "");
}

function bunApiProcessEnv() {
  return {
    ...process.env,
    STOCKCHOOSE_BUN_PORT: String(bunApiPort()),
    STOCKCHOOSE_DATA_CACHE_DIR: dataCacheDir()
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

function requestBuffer(targetUrl, { method = "GET", headers = {}, body, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const requestHeaders = {
      accept: "application/json,text/plain,*/*",
      "user-agent": "StockChoose-Electron-Bun/0.1",
      ...headers
    };
    if (body && body.length) requestHeaders["content-length"] = String(body.length);
    const request = http.request(parsed, { method, timeout: timeoutMs, headers: requestHeaders }, (upstreamResponse) => {
      const chunks = [];
      upstreamResponse.on("data", (chunk) => chunks.push(chunk));
      upstreamResponse.on("end", () => {
        resolve({
          statusCode: upstreamResponse.statusCode || 502,
          headers: upstreamResponse.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("bun api timeout")));
    request.on("error", reject);
    if (body && body.length) request.write(body);
    request.end();
  });
}

function collectRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return Promise.resolve(Buffer.alloc(0));
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

async function checkBunApiHealth({ force = false } = {}) {
  if (!force && Date.now() - healthCache.checkedAt < HEALTH_CACHE_MS) return healthCache.ok;
  try {
    const result = await requestBuffer(`${bunApiBaseUrl()}/health`, { timeoutMs: 1200 });
    healthCache = { checkedAt: Date.now(), ok: result.statusCode >= 200 && result.statusCode < 300 };
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
    "access-control-allow-origin": "*",
    "x-stockchoose-data-engine": "bun"
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
      headers: forwardedHeaders(request.headers),
      body,
      timeoutMs: options.timeoutMs || 180000
    });
    if (options.requireSuccess !== false && (result.statusCode < 200 || result.statusCode >= 300)) return false;
    response.writeHead(result.statusCode, bunProxyResponseHeaders(result.headers, options));
    response.end(result.body);
    return true;
  } catch {
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
}

module.exports = {
  ensureBunApiRunning,
  handleBunAktoolsRequest,
  handleBunProxyRequest,
  bunProxyResponseHeaders,
  stopBunApiSidecar,
  bunApiBaseUrl,
  bunApiProcessEnv,
  dataCacheDir,
  findBunExecutable
};
