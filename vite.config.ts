import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handleBunAktoolsRequest, handleBunProxyRequest } = require("./electron/bun-api.cjs");

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

const bunProxyRules = [
  { prefix: "/api", requireSuccess: false },
  { prefix: "/tencent-quote", rewrite: rewriteTencentQuoteUrl },
  { prefix: "/tencent-kline", rewrite: rewriteTencentKlineUrl },
  { prefix: "/gdelt-news", rewrite: rewriteGdeltNewsUrl }
];

export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: "stockchoose-bun-data-proxy",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/aktools")) {
            next();
            return;
          }
          const handledByBun = await handleBunAktoolsRequest(request, response, { prefix: "/aktools" });
          if (handledByBun) return;
          response.writeHead(502, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store"
          });
          response.end("Bun AKTools data API is unavailable");
        });
        server.middlewares.use(async (request, response, next) => {
          const rule = bunProxyRules.find((item) => request.url?.startsWith(item.prefix));
          if (!rule) {
            next();
            return;
          }
          const handledByBun = await handleBunProxyRequest(request, response, rule);
          if (handledByBun) return;
          if (request.url?.startsWith("/api")) {
            response.writeHead(502, {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-store"
            });
            response.end("Bun API is unavailable");
            return;
          }
          next();
        });
      }
    },
    ...(mode === "test" ? [] : [react()])
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
}));
