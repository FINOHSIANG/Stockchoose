const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { handleBunAktoolsRequest, handleBunProxyRequest, stopBunApiSidecar } = require("./bun-api.cjs");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const distDir = path.join(__dirname, "..", "dist");
const DEFAULT_UI_PORT = 18081;
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join("; ");

let localServer = null;
let localServerOrigin = "";
let storageIpcRegistered = false;

const MAX_STORED_VALUE_BYTES = 64 * 1024 * 1024;
const SECURE_STORAGE_KEYS = new Set([
  "infoSourceSettings",
  "newsSourceSettings",
  "newsAnalysisModelSettings",
  "tradeConnectionSettings"
]);

function normalizeStorageKey(value) {
  const name = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error("Invalid storage key");
  return name;
}

function storageDirectory() {
  return path.join(app.getPath("userData"), "storage");
}

function storageFilePath(name) {
  const extension = SECURE_STORAGE_KEYS.has(name) ? ".secure.json" : ".json";
  return path.join(storageDirectory(), name + extension);
}

function atomicWriteStorageFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + "." + process.pid + ".tmp";
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readStoredValue(name) {
  const filePath = storageFilePath(name);
  if (!fs.existsSync(filePath)) return { ok: true, found: false };
  const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (SECURE_STORAGE_KEYS.has(name)) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
    const encrypted = Buffer.from(String(envelope.encrypted || ""), "base64");
    return { ok: true, found: true, value: JSON.parse(safeStorage.decryptString(encrypted)) };
  }
  return { ok: true, found: true, value: envelope.value };
}

function writeStoredValue(name, value) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_VALUE_BYTES) {
    throw new Error("Stored value exceeds the 64 MiB limit");
  }
  const filePath = storageFilePath(name);
  if (SECURE_STORAGE_KEYS.has(name)) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS secure storage is unavailable");
    const encrypted = safeStorage.encryptString(serialized).toString("base64");
    atomicWriteStorageFile(filePath, JSON.stringify({ version: 1, encrypted }));
  } else {
    atomicWriteStorageFile(filePath, JSON.stringify({ version: 1, value }));
  }
  return { ok: true };
}

function removeStoredValue(name) {
  const filePath = storageFilePath(name);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  return { ok: true };
}

function registerStorageIpc() {
  if (storageIpcRegistered) return;
  storageIpcRegistered = true;
  ipcMain.on("stockchoose:storage:load", (event, rawName) => {
    try {
      event.returnValue = readStoredValue(normalizeStorageKey(rawName));
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.on("stockchoose:storage:save", (event, rawName, value) => {
    try {
      event.returnValue = writeStoredValue(normalizeStorageKey(rawName), value);
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.on("stockchoose:storage:remove", (event, rawName) => {
    try {
      event.returnValue = removeStoredValue(normalizeStorageKey(rawName));
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function uiPort() {
  const value = Number(process.env.STOCKCHOOSE_UI_PORT || DEFAULT_UI_PORT);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid STOCKCHOOSE_UI_PORT: ${process.env.STOCKCHOOSE_UI_PORT || "empty"}`);
  }
  return value;
}

function mainSecurityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy-report-only": CSP_REPORT_ONLY,
    ...extra
  };
}

function validateLocalRequest(request) {
  if (!localServerOrigin) return { status: 503, message: "Local UI server is not ready" };
  const expected = new URL(localServerOrigin);
  const host = String(request.headers.host || "").trim().toLowerCase();
  if (host !== expected.host.toLowerCase()) return { status: 400, message: "Invalid Host header" };

  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(String(origin)).origin !== expected.origin) return { status: 403, message: "Cross-origin request denied" };
    } catch {
      return { status: 403, message: "Invalid Origin header" };
    }
  }
  if (String(request.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    return { status: 403, message: "Cross-site request denied" };
  }
  return null;
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function openExternalUrl(value) {
  if (!isAllowedExternalUrl(value)) return;
  shell.openExternal(value).catch(() => {
    console.warn("Failed to open an allowed external URL");
  });
}

function rewriteTencentQuoteUrl(requestUrl) {
  const symbols = decodeURIComponent(requestUrl.replace(/^\/tencent-quote\/q=/, ""));
  return `/api/market/tencent/quote?q=${encodeURIComponent(symbols)}`;
}

function rewriteTencentKlineUrl(requestUrl) {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  return `/api/market/tencent/kline${parsed.search}`;
}

function rewriteGdeltNewsUrl(requestUrl) {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  return `/api/news/gdelt${parsed.search}`;
}

const bunProxyRules = [
  { prefix: "/api", requireSuccess: false },
  { prefix: "/tencent-quote", rewrite: rewriteTencentQuoteUrl },
  { prefix: "/tencent-kline", rewrite: rewriteTencentKlineUrl },
  { prefix: "/gdelt-news", rewrite: rewriteGdeltNewsUrl }
];

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, mainSecurityHeaders({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  }));
  response.end(text);
}

function safeStaticPath(urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0")) return null;
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const targetPath = path.resolve(distDir, relativePath);
  const relativeTarget = path.relative(distDir, targetPath);
  if (relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) return null;
  return targetPath;
}

function serveStaticFile(request, response) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  const targetPath = safeStaticPath(requestUrl.pathname);
  if (!targetPath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const fallbackPath = path.join(distDir, "index.html");
  const filePath = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile() ? targetPath : fallbackPath;
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, mainSecurityHeaders({
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
  }));
  fs.createReadStream(filePath).pipe(response);
}

function handleLocalRequest(request, response) {
  handleLocalRequestAsync(request, response).catch((error) => {
    if (!response.headersSent) {
      sendText(response, 502, `Local request failed: ${error.message}`);
    } else {
      response.end();
    }
  });
}

async function handleLocalRequestAsync(request, response) {
  const requestError = validateLocalRequest(request);
  if (requestError) {
    sendText(response, requestError.status, requestError.message);
    return;
  }
  const requestUrl = request.url || "/";
  if (requestUrl.startsWith("/aktools")) {
    await handleAktoolsRequest(request, response);
    return;
  }
  const bunRule = bunProxyRules.find((item) => requestUrl.startsWith(item.prefix));
  if (bunRule) {
    if (await handleBunProxyRequest(request, response, { ...bunRule, responseHeaders: mainSecurityHeaders() })) return;
    if (requestUrl.startsWith("/api")) {
      sendText(response, 502, "Bun API is unavailable");
      return;
    }
  }
  serveStaticFile(request, response);
}

async function handleAktoolsRequest(request, response) {
  if (await handleBunAktoolsRequest(request, response, { prefix: "/aktools", responseHeaders: mainSecurityHeaders() })) return;

  if (!response.headersSent) {
    sendText(response, 502, "Bun AKTools data API is unavailable");
  }
}

function startLocalServer() {
  const port = uiPort();
  localServerOrigin = `http://127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleLocalRequest);
    const onStartupError = (error) => {
      localServerOrigin = "";
      if (error?.code === "EADDRINUSE") {
        reject(new Error(`StockChoose UI port ${port} is already in use. Close the conflicting process or set STOCKCHOOSE_UI_PORT to a stable free port.`));
        return;
      }
      reject(error);
    };
    server.once("error", onStartupError);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.removeListener("error", onStartupError);
      server.on("error", (error) => {
        console.error(`StockChoose UI server failed on port ${port}: ${error.message}`);
        app.quit();
      });
      localServer = server;
      resolve(`${localServerOrigin}/`);
    });
  });
}

function createWindow(entryUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "股票策略 Beta",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  const entryOrigin = new URL(entryUrl).origin;
  win.webContents.on("will-navigate", (event, legacyUrl) => {
    const navigationUrl = event.url || legacyUrl;
    try {
      if (new URL(navigationUrl).origin === entryOrigin) return;
    } catch {
      // Invalid or non-standard URLs are denied below.
    }
    event.preventDefault();
    openExternalUrl(navigationUrl);
  });

  win.loadURL(entryUrl);
}

app.whenReady().then(async () => {
  registerStorageIpc();
  const entryUrl = isDev ? process.env.VITE_DEV_SERVER_URL : await startLocalServer();
  createWindow(entryUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(entryUrl);
    }
  });
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`StockChoose startup failed: ${message}`);
  dialog.showErrorBox("StockChoose 启动失败", message);
  app.quit();
});

app.on("before-quit", () => {
  stopBunApiSidecar();
  if (localServer) {
    localServer.close();
    localServer = null;
    localServerOrigin = "";
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
