import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handleRustAktoolsRequest, handleRustProxyRequest } = require("./electron/rust-api.cjs");

const rewriteTencentQuoteUrl = (requestUrl: string) => {
  const symbols = decodeURIComponent(requestUrl.replace(/^\/tencent-quote\/q=/, ""));
  return `/api/market/tencent/quote?q=${encodeURIComponent(symbols)}`;
};

const rewriteTencentKlineUrl = (requestUrl: string) => {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  return `/api/market/tencent/kline${parsed.search}`;
};

const rewriteGdeltNewsUrl = (requestUrl: string) => {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  return `/api/news/gdelt${parsed.search}`;
};

const rustProxyRules = [
  { prefix: "/api", requireSuccess: false },
  { prefix: "/tencent-quote", rewrite: rewriteTencentQuoteUrl },
  { prefix: "/tencent-kline", rewrite: rewriteTencentKlineUrl },
  { prefix: "/gdelt-news", rewrite: rewriteGdeltNewsUrl }
];

export default defineConfig({
  plugins: [
    {
      name: "stockchoose-rust-data-proxy",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/aktools")) {
            next();
            return;
          }
          const handledByRust = await handleRustAktoolsRequest(request, response, { prefix: "/aktools" });
          if (handledByRust) return;
          response.writeHead(502, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*"
          });
          response.end("Rust AKTools data API is unavailable");
        });
        server.middlewares.use(async (request, response, next) => {
          const rule = rustProxyRules.find((item) => request.url?.startsWith(item.prefix));
          if (!rule) {
            next();
            return;
          }
          const handledByRust = await handleRustProxyRequest(request, response, rule);
          if (handledByRust) return;
          if (request.url?.startsWith("/api")) {
            response.writeHead(502, {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store",
              "access-control-allow-origin": "*"
            });
            response.end("Rust API is unavailable");
            return;
          }
          next();
        });
      }
    },
    react()
  ],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
