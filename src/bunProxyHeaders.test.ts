import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { bunProxyResponseHeaders } = require("../electron/bun-api.cjs") as {
  bunProxyResponseHeaders: (headers?: Record<string, string>, options?: { contentType?: string }) => Record<string, string>;
};

describe("Bun proxy response headers", () => {
  it("preserves the actual market fallback source", () => {
    const headers = bunProxyResponseHeaders({
      "content-type": "application/json; charset=utf-8",
      "x-stockchoose-market-source": "eastmoney-fallback"
    });

    expect(headers["x-stockchoose-data-engine"]).toBe("bun");
    expect(headers["x-stockchoose-market-source"]).toBe("eastmoney-fallback");
  });

  it("does not invent a fallback source when the upstream omits it", () => {
    const headers = bunProxyResponseHeaders({}, { contentType: "text/plain; charset=utf-8" });

    expect(headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(headers).not.toHaveProperty("x-stockchoose-market-source");
  });
});
