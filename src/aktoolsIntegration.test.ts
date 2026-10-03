import { describe, expect, it, vi } from "vitest";
import { aktoolsRowsFromPayload, CONFIGURED_AKTOOLS_BASE, fetchAktoolsRows, testAktoolsConnection } from "../bun-api/services/aktools";

const history = [{ "\u65e5\u671f": "2024-05-06", "\u6536\u76d8": 10.2 }];
const response = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
const unsafeParameters: Array<Record<string, string>> = [
  { symbol: "000001\"" }, { symbol: "000001\\" }, { symbol: "%22" },
  { symbol: "000001&date=20260909" }, { symbol: "000001\n" }, { "symbol)": "000001" }
];

describe("AKTools integration", () => {
  it("tests the selected external URL instead of the native crawler", async () => {
    const native = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => response(history));
    const result = await testAktoolsConnection("https://8.8.8.8/api/public", native, { fetchImpl });
    expect(result).toMatchObject({ ok: true, source: "aktools", rowCount: 1 });
    expect(native).not.toHaveBeenCalled();
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/public/stock_zh_a_hist");
    expect(url.searchParams.get("symbol")).toBe("000001");
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("preserves the existing native alias without making an external request", async () => {
    const native = vi.fn(async () => history);
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await testAktoolsConnection("/aktools/api/public", native, { fetchImpl });
    expect(result).toMatchObject({ ok: true, source: "bun-native" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("permits only the exact configured loopback base without relaxing global policy", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(history));
    await fetchAktoolsRows(CONFIGURED_AKTOOLS_BASE, "stock_zh_a_hist", {}, {
      configuredBaseUrl: "http://127.0.0.1:18080/api/public/", fetchImpl
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("http://127.0.0.1:18080/api/public/stock_zh_a_hist");
    await expect(fetchAktoolsRows("http://127.0.0.1:18081/api/public", "stock_zh_a_hist", {}, {
      configuredBaseUrl: "http://127.0.0.1:18080/api/public", fetchImpl
    })).rejects.toThrow();
    await expect(fetchAktoolsRows("http://127.0.0.1:18080/admin", "stock_zh_a_hist", {}, {
      configuredBaseUrl: "http://127.0.0.1:18080/api/public", fetchImpl
    })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the configured alias has no service", async () => {
    await expect(fetchAktoolsRows(CONFIGURED_AKTOOLS_BASE, "stock_zh_a_hist", {}, { configuredBaseUrl: "" }))
      .rejects.toThrow("not configured");
  });

  it.each(["../admin", "stock_zh_a_hist?x=1", "/health", "https://example.com"])("rejects path injection: %s", async (endpoint) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(fetchAktoolsRows("https://8.8.8.8/api/public", endpoint, {}, { fetchImpl })).rejects.toThrow("function name");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(unsafeParameters)("rejects unsafe parameters before calling the expression-based upstream", async (params) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(fetchAktoolsRows(CONFIGURED_AKTOOLS_BASE, "stock_zh_a_hist", params, {
      configuredBaseUrl: "http://127.0.0.1:18080/api/public", fetchImpl
    })).rejects.toThrow("expression characters");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["http://user:pass@127.0.0.1:18080/api/public", "http://127.0.0.1:18080/api/public?x=1", "file:///api/public"])("rejects unsafe configured bases: %s", async (base) => {
    await expect(fetchAktoolsRows(CONFIGURED_AKTOOLS_BASE, "stock_zh_a_hist", {}, { configuredBaseUrl: base }))
      .rejects.toThrow("baseUrl");
  });

  it("does not report empty, error-shaped or malformed history as a working source", async () => {
    const native = vi.fn();
    for (const payload of [[], [{ error: "provider failed" }], [{ date: "2024-05-06", close: null }], [{ date: "2024-05-06", close: true }]]) {
      const result = await testAktoolsConnection("https://8.8.8.8/api/public", native, {
        fetchImpl: async () => response(payload)
      });
      expect(result.ok).toBe(false);
    }
    expect(() => aktoolsRowsFromPayload({ error: "failed" })).toThrow("object rows");
    expect(() => aktoolsRowsFromPayload([null])).toThrow("object rows");
  });

  it("propagates upstream errors instead of silently switching providers", async () => {
    const native = vi.fn();
    await expect(testAktoolsConnection("https://8.8.8.8/api/public", native, {
      fetchImpl: async () => new Response("failed", { status: 500 })
    })).rejects.toThrow("HTTP 500");
    expect(native).not.toHaveBeenCalled();
    await expect(fetchAktoolsRows("https://8.8.8.8/api/public", "stock_zh_a_hist", {}, {
      fetchImpl: async () => new Response("not json")
    })).rejects.toThrow("invalid JSON");
  });

  it("supports direct row arrays and row envelopes without coercing errors", () => {
    expect(aktoolsRowsFromPayload(history)).toEqual(history);
    expect(aktoolsRowsFromPayload({ data: history })).toEqual(history);
    expect(aktoolsRowsFromPayload({ rows: history })).toEqual(history);
  });
});
