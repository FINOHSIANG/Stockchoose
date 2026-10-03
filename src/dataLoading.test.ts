import { afterEach, describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { defaultInfoSourceSettings } from "./integrationServices";
import { syncOpenSourceMarketData, syncOpenSourceFinancialReports } from "./openDataService";
import { cacheGetOrCreate, fetchJson, fetchText } from "../bun-api/crawler/engine";
import { buildAnnualFinancialReportsBunFirst } from "./financialReportServices";
import { financialReportDateCandidates } from "./dataContracts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const json = (value: unknown) => new Response(JSON.stringify(value));
const base = { ...STOCKS[0], code: "600519", metrics: {} };
const settings = { ...defaultInfoSourceSettings, modules: { market: true, finance: true, filing: false, news: false } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("data loading scheduling", () => {
  it("expires empty cached results sooner and shares concurrent loads", async () => {
    vi.useFakeTimers();
    const loader = vi.fn<() => Promise<number[]>>().mockResolvedValueOnce([]).mockResolvedValue([1]);
    const key = "empty-result-recovery";
    const get = () => cacheGetOrCreate(key, (rows) => rows.length ? 3600000 : 60000, loader);
    expect(await Promise.all([get(), get()])).toEqual([[], []]);
    expect(loader).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60001);
    expect(await get()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(60001);
    expect(await get()).toEqual([1]);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("starts independent data requests together and publishes financial progress before slow north holdings", async () => {
    const market = deferred<Response>();
    const finance = deferred<Response>();
    const north = deferred<Response>();
    const progress: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/market/ashare/spot") return market.promise;
      if (url.includes("/finance/metrics/")) return finance.promise;
      if (url === "/api/market/north-holdings") return north.promise;
      return json([]);
    });
    const task = syncOpenSourceMarketData(settings, [base], fetchImpl, (value) => progress.push(value.message));
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/finance/metrics/"))).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/analyst-forecasts"))).toBe(true);
    market.resolve(json([{ 代码: "600519", 名称: "贵州茅台", 最新价: 100, 总市值: 10000000000 }]));
    await vi.waitFor(() => expect(progress).toContain("实时行情已到达"));
    finance.resolve(json([{
      code: "600519", name: "贵州茅台", reportDate: "2026-06-30", sourceRows: 1,
      metrics: { revenue: 100, realAnnualReportSource: 1, realFinancialReportDate: 20260630 }
    }]));
    await vi.waitFor(() => expect(progress).toContain("财报数据已到达"));
    let completed = false;
    void task.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    north.resolve(json([]));
    const result = await task;
    expect(result.ok).toBe(true);
    expect(result.stocks[0].metrics.revenue).toBe(100);
  });

  it("never fills a missing current-quarter statement with an older quarter", async () => {
    const periods = new Set<string>();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      periods.add(body.params.date);
      return json(body.endpoint === "stock_yjbb_em"
        ? [{ 股票代码: "600519", 净利润: 100000000, 最新公告日期: "2026-08-30" }]
        : []);
    });
    const result = await syncOpenSourceFinancialReports({
      ...settings, baseUrl: "https://data.example/api/public"
    }, [base], fetchImpl);
    expect(result.ok).toBe(true);
    expect(periods.size).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.stocks[0].metrics.operatingCashflow).toBeUndefined();
  });

  it("uses half-year and third-quarter reports instead of always requesting the previous annual report", () => {
    expect(financialReportDateCandidates(new Date(2026, 8, 10))[0]).toBe("20260630");
    expect(financialReportDateCandidates(new Date(2026, 10, 10))[0]).toBe("20260930");
    expect(financialReportDateCandidates(new Date(2026, 10, 10)).slice(0, 4)).toEqual([
      "20260930", "20260630", "20260331", "20251231"
    ]);
    const january = financialReportDateCandidates(new Date(2026, 0, 10));
    expect(january.slice(0, 3)).toEqual(["20250930", "20250630", "20250331"]);
  });

  it("deduplicates simultaneous annual-report requests without caching failed responses", async () => {
    const gate = deferred<Response>();
    const fetchImpl = vi.fn(async () => gate.promise);
    const first = buildAnnualFinancialReportsBunFirst(base, fetchImpl);
    const second = buildAnnualFinancialReportsBunFirst(base, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    gate.resolve(json([]));
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    fetchImpl.mockImplementation(async () => json([]));
    await buildAnnualFinancialReportsBunFirst(base, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("complete response deadlines", () => {
  it("aborts a body that hangs after successful response headers", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
      cancel() { cancelled = true; }
    }))));
    const request = fetchJson(`https://deadline-${Date.now()}.example/data`, {}, 100, 0);
    const rejected = expect(request).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(cancelled).toBe(true);
  });

  it("returns parsed text and JSON for a complete response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ rows: 3 })));
    expect(await fetchJson("https://complete.example/data", {}, 1000, 0)).toEqual({ rows: 3 });
    expect(await fetchText("https://complete.example/data", {}, 1000, 0)).toBe('{"rows":3}');
  });
});
