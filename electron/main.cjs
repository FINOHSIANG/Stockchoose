const { app, BrowserWindow, Menu, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const distDir = path.join(__dirname, "..", "dist");

let localServer = null;

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

const proxyRules = [
  {
    prefix: "/aktools",
    target: "http://127.0.0.1:18080",
    rewrite: (url) => url.replace(/^\/aktools/, "")
  },
  {
    prefix: "/tencent-quote",
    target: "https://qt.gtimg.cn",
    rewrite: (url) => url.replace(/^\/tencent-quote/, "")
  },
  {
    prefix: "/tencent-kline",
    target: "https://web.ifzq.gtimg.cn",
    rewrite: (url) => url.replace(/^\/tencent-kline/, "")
  },
  {
    prefix: "/gdelt-news",
    target: "https://api.gdeltproject.org/api/v2",
    rewrite: (url) => url.replace(/^\/gdelt-news/, "")
  }
];

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

function proxyRequest(request, response, rule) {
  const targetUrl = new URL(rule.rewrite(request.url || "/"), rule.target);
  const client = targetUrl.protocol === "https:" ? https : http;
  const headers = { ...request.headers, host: targetUrl.host };
  delete headers.origin;
  delete headers.referer;

  const upstream = client.request(
    targetUrl,
    {
      method: request.method,
      headers,
      timeout: 15000
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        "access-control-allow-origin": "*"
      });
      upstreamResponse.pipe(response);
    }
  );

  upstream.on("timeout", () => {
    upstream.destroy(new Error("upstream timeout"));
  });

  upstream.on("error", (error) => {
    if (!response.headersSent) {
      sendText(response, 502, `Proxy request failed: ${error.message}`);
    } else {
      response.end();
    }
  });

  request.pipe(upstream);
}

function safeStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const targetPath = path.normalize(path.join(distDir, relativePath));
  if (!targetPath.startsWith(path.normalize(distDir))) return null;
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
  response.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
  });
  fs.createReadStream(filePath).pipe(response);
}

function handleLocalRequest(request, response) {
  const requestUrl = request.url || "/";
  const rule = proxyRules.find((item) => requestUrl.startsWith(item.prefix));
  if (rule) {
    proxyRequest(request, response, rule);
    return;
  }
  serveStaticFile(request, response);
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleLocalRequest);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      localServer = server;
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/`);
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
    backgroundColor: "#f0f0f0",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(entryUrl);
}

app.whenReady().then(async () => {
  const entryUrl = isDev ? process.env.VITE_DEV_SERVER_URL : await startLocalServer();
  createWindow(entryUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(entryUrl);
    }
  });
});

app.on("before-quit", () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
