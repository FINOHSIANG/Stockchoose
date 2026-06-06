import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/aktools": {
        target: "http://127.0.0.1:18080",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/aktools/, "")
      },
      "/tencent-quote": {
        target: "https://qt.gtimg.cn",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tencent-quote/, "")
      },
      "/tencent-kline": {
        target: "https://web.ifzq.gtimg.cn",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tencent-kline/, "")
      },
      "/gdelt-news": {
        target: "https://api.gdeltproject.org/api/v2",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/gdelt-news/, "")
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
