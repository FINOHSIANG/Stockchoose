import { afterEach, describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import {
  fetchStockProfileAutoMatch,
  fetchStockKlineHistory,
  generateTencentAshareCandidates,
  syncTencentAllAshareMarketData,
  syncTencentRealMarketData
} from "./realMarketDataService";

const rustMaotaiQuoteRow = {
  symbol: "sh600519",
  prefix: "sh",
  code: "600519",
  queryCode: "600519",
  name: "贵州茅台",
  price: 1319,
  pctChange: -0.3,
  volumeWanShou: 4.1234,
  amountYi: 54.88,
  turnover: 0.33,
  pe: 15.21,
  marketCapYi: 16576.08,
  floatMarketCapYi: 16576.08,
  pb: 6.12,
  amplitude: 2.04,
  statusFlag: "",
  marketType: "GP-A"
};

const rustNoslandQuoteRow = {
  symbol: "bj920047",
  prefix: "bj",
  code: "920047",
  queryCode: "920047",
  name: "诺思兰德",
  price: 21.7,
  pctChange: -10.4,
  volumeWanShou: 17.9223,
  amountYi: 4.23113,
  turnover: 9.95,
  pe: -125.21,
  marketCapYi: 59.52,
  floatMarketCapYi: 39.08,
  pb: 22.41,
  amplitude: 19.98,
  statusFlag: "",
  marketType: "GP"
};

const rustPinganQuoteRow = {
  symbol: "sz000001",
  prefix: "sz",
  code: "000001",
  queryCode: "000001",
  name: "平安银行",
  price: 10.99,
  pctChange: 0.55,
  volumeWanShou: 95.4596,
  amountYi: 10.423,
  turnover: 0.49,
  pe: 4.95,
  marketCapYi: 2132.68,
  floatMarketCapYi: 2132.71,
  pb: 0.46,
  amplitude: 1.65,
  statusFlag: "",
  marketType: "GP-A"
};

const rustDelistedQuoteRow = {
  symbol: "sh600001",
  prefix: "sh",
  code: "600001",
  queryCode: "600001",
  name: "邯郸钢铁",
  price: 5.29,
  marketCapYi: 148.99,
  floatMarketCapYi: 148.99,
  statusFlag: "D",
  marketType: "GP-A"
};

const rustTechnicalIndicatorRows = [
  {
    code: "600519",
    name: "Kweichow Moutai",
    reportDate: "2026-06-09",
    sourceRows: 120,
    metrics: {
      ma20Distance: 3.21,
      ma60Distance: 8.76,
      volatility20: 18.34,
      macd: 1.23,
      kdj: 72.4,
      rsi: 61.8,
      bias: 3.21,
      bollWidth: 9.87,
      technicalTradeDate: 20260609,
      realTechnicalSource: 1
    }
  }
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("realMarketDataService", () => {
  it("auto matches official website and industry tags through the Rust profile API", async () => {
    const baseStock = {
      ...(STOCKS.find((stock) => stock.code === "600519") ?? STOCKS[0]),
      website: undefined,
      industryTags: ["白酒"]
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          code: "600519",
          name: "贵州茅台",
          website: "www.moutaichina.com",
          industry1: "食品饮料",
          industry2: "白酒",
          industryTags: ["高端白酒", "贵州国企"],
          source: "eastmoney-f10"
        }),
        { status: 200 }
      )
    );

    const result = await fetchStockProfileAutoMatch(baseStock, fetchMock);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]), "http://stockchoose.test");

    expect(result.ok).toBe(true);
    expect(requestedUrl.pathname).toBe("/api/market/stock/600519/profile");
    expect(requestedUrl.searchParams.get("name")).toBe(baseStock.name);
    expect(requestedUrl.searchParams.get("industry1")).toBe(baseStock.industry1);
    expect(requestedUrl.searchParams.get("industry2")).toBe(baseStock.industry2);
    expect(result.stock.website).toBe("https://www.moutaichina.com");
    expect(result.stock.industry1).toBe("食品饮料");
    expect(result.stock.industry2).toBe("白酒");
    expect(result.stock.industryTags).toEqual(expect.arrayContaining(["白酒", "食品饮料", "高端白酒", "贵州国企"]));
  });

  it("keeps the original stock when the Rust profile API fails", async () => {
    const baseStock = STOCKS.find((stock) => stock.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("upstream blocked", { status: 502 }));

    const result = await fetchStockProfileAutoMatch(baseStock, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust Eastmoney F10 profile API HTTP 502");
    expect(result.stock).toBe(baseStock);
  });

  it("merges Tencent quote data into valuation metrics", async () => {
    const base = STOCKS.filter((stock) => stock.code === "600519");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([rustMaotaiQuoteRow]), { status: 200 }));

    const result = await syncTencentRealMarketData(base, fetchMock);
    const maotai = result.stocks[0];

    expect(result.ok).toBe(true);
    expect(result.matchedRows).toBe(1);
    expect(maotai.name).toBe("贵州茅台");
    expect(maotai.metrics.price).toBe(1319);
    expect(maotai.metrics.pe).toBe(15.21);
    expect(maotai.metrics.pb).toBe(6.12);
    expect(maotai.metrics.marketCap).toBeCloseTo(16576.08, 2);
    expect(maotai.metrics.amount).toBeCloseTo(54.88, 2);
    expect(maotai.metrics.volume).toBeCloseTo(4.12, 2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/market/tencent/quote-rows");
  });

  it("uses Rust structured Tencent quote rows without localhost gating", async () => {
    vi.stubGlobal("window", { location: { hostname: "stockchoose.example" } });
    const base = STOCKS.filter((stock) => stock.code === "600519");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/market/tencent/quote-rows")) {
        return new Response(JSON.stringify([rustMaotaiQuoteRow]), { status: 200 });
      }
      return new Response("", { status: 500 });
    });

    const result = await syncTencentRealMarketData(base, fetchMock);
    const maotai = result.stocks[0];

    expect(result.ok).toBe(true);
    expect(result.matchedRows).toBe(1);
    expect(maotai.name).toBe("贵州茅台");
    expect(maotai.metrics.realQuoteSource).toBe(1);
    expect(maotai.metrics.price).toBe(1319);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/market/tencent/quote-rows");
  });

  it("does not fall back to browser-side Tencent quote parsing when the Rust quote API fails", async () => {
    const base = STOCKS.filter((stock) => stock.code === "600519");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith("/api/market/tencent/quote-rows")) {
        return new Response("{}", { status: 502 });
      }
      return new Response(JSON.stringify([rustMaotaiQuoteRow]), { status: 200 });
    });

    const result = await syncTencentRealMarketData(base, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust Tencent quote API HTTP 502");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/market/tencent/quote-rows");
  });

  it("reports invalid Rust Tencent quote payloads instead of treating them as unmatched stocks", async () => {
    const base = STOCKS.filter((stock) => stock.code === "600519");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [rustMaotaiQuoteRow] }), { status: 200 }));

    const result = await syncTencentRealMarketData(base, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust Tencent quote API returned invalid quote rows payload");
    expect(result.sourceRows).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports invalid Rust Tencent quote JSON explicitly", async () => {
    const base = STOCKS.filter((stock) => stock.code === "600519");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));

    const result = await syncTencentRealMarketData(base, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid JSON");
  });

  it("loads Tencent real kline history with the selected trading period", async () => {
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([
      { date: "2026-05-29", open: 1320, close: 1319, high: 1338, low: 1311, volume: 4.12 }
    ]), { status: 200 }));

    const result = await fetchStockKlineHistory(stock, "week", fetchMock);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");

    expect(result.ok).toBe(true);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      date: "2026-05-29",
      open: 1320,
      close: 1319,
      high: 1338,
      low: 1311,
      volume: 4.12
    });
    expect(requestedUrl).toContain("/api/market/tencent/kline-points");
    expect(requestedUrl).toContain("symbol=sh600519");
    expect(requestedUrl).toContain("period=week");
  });

  it("uses Rust structured Tencent kline points on the local app proxy", async () => {
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/market/tencent/kline-points")) {
        return new Response(JSON.stringify([
          { date: "2026-05-29", open: 1320, close: 1319, high: 1338, low: 1311, volume: 4.12 }
        ]), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    });

    const result = await fetchStockKlineHistory(stock, "week", fetchMock);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");

    expect(result.ok).toBe(true);
    expect(result.points).toEqual([
      { date: "2026-05-29", open: 1320, close: 1319, high: 1338, low: 1311, volume: 4.12 }
    ]);
    expect(requestedUrl).toContain("/api/market/tencent/kline-points");
    expect(requestedUrl).toContain("period=week");
  });

  it("does not fall back to browser-side Tencent kline parsing when the Rust kline API fails", async () => {
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith("/api/market/tencent/kline-points")) {
        return new Response("{}", { status: 503 });
      }
      return new Response(JSON.stringify([{ date: "2026-05-29", open: 1320, close: 1319, high: 1338, low: 1311, volume: 4.12 }]), { status: 200 });
    });

    const result = await fetchStockKlineHistory(stock, "week", fetchMock);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Rust Tencent K线接口 HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/market/tencent/kline-points");
  });

  it("reports invalid Rust Tencent kline payloads instead of treating them as empty history", async () => {
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const result = await fetchStockKlineHistory(stock, "day", fetchMock);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Rust Tencent K线接口返回结构无效");
    expect(result.sourceRows).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports invalid Rust Tencent kline JSON explicitly", async () => {
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));

    const result = await fetchStockKlineHistory(stock, "day", fetchMock);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("invalid JSON");
  });

  it("uses switched Beijing Stock Exchange market codes for Tencent quotes", async () => {
    const base = STOCKS.filter((stock) => stock.code === "430047");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([rustNoslandQuoteRow]), { status: 200 }));

    const result = await syncTencentRealMarketData(base, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    const nosland = result.stocks[0];

    expect(result.ok).toBe(true);
    expect(result.matchedRows).toBe(1);
    expect(nosland.code).toBe("430047");
    expect(nosland.metrics.price).toBe(21.7);
    expect(nosland.metrics.marketCap).toBeCloseTo(59.52, 2);
    expect(requestedUrls.some((url) => url.includes("bj920047"))).toBe(true);
  });

  it("scans Tencent candidate codes and builds an all-market stock universe", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/market/tencent/ashare/quotes") {
        return new Response(JSON.stringify([rustMaotaiQuoteRow, rustDelistedQuoteRow, rustPinganQuoteRow, rustNoslandQuoteRow]), { status: 200 });
      }
      if (url.startsWith("/api/market/technical-indicators")) {
        return new Response(JSON.stringify(rustTechnicalIndicatorRows), { status: 200 });
      }
      return new Response("", { status: 500 });
    });

    const result = await syncTencentAllAshareMarketData(STOCKS, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(generateTencentAshareCandidates().length).toBeGreaterThan(10000);
    expect(result.ok).toBe(true);
    expect(result.stocks.map((stock) => stock.code)).toEqual(expect.arrayContaining(["600519", "000001", "920047"]));
    expect(result.stocks.some((stock) => stock.code === "600001")).toBe(false);
    expect(result.stocks.find((stock) => stock.code === "600519")?.industry1).toBe("未分类");
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.eps).toBeUndefined();
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.totalAssets).toBeUndefined();
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.realQuoteSource).toBe(1);
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.realTechnicalSource).toBe(1);
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.ma20Distance).toBe(3.21);
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.rsi).toBe(61.8);
    expect(result.technicalMatchedRows).toBe(1);
    expect(result.technicalSourceRows).toBe(120);
    expect(result.details).toContain("识别 3 只有效 A 股股票");
    expect(result.details).toContain("Rust 技术指标匹配 1/1 只");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls[0]).toBe("/api/market/tencent/ashare/quotes");
    expect(requestedUrls[1]).toContain("/api/market/technical-indicators");
    expect(requestedUrls[1]).toContain("codes=600519%2C000001%2C920047");
  });

  it("preserves real financial fields when refreshing the all-market quote universe", async () => {
    const existing = STOCKS.find((stock) => stock.code === "600519") ?? STOCKS[0];
    const seedStocks = [
      {
        ...existing,
        metrics: {
          price: 1300,
          marketCap: 16000,
          eps: 59.49,
          bps: 230.5,
          revenue: 1275,
          netProfit: 747,
          operatingCashflow: 650,
          totalAssets: 2550,
          totalLiabilities: 420,
          investmentAssets: 1260,
          productionAssets: 1290,
          interestBearingDebt: 180,
          nonInterestBearingDebt: 240,
          realAnnualReportSource: 1,
          realFinancialReportDate: 20251231
        }
      }
    ];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/market/tencent/ashare/quotes") {
        return new Response(JSON.stringify([rustMaotaiQuoteRow]), { status: 200 });
      }
      if (url.startsWith("/api/market/technical-indicators")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("", { status: 500 });
    });

    const result = await syncTencentAllAshareMarketData(seedStocks, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.ok).toBe(true);
    expect(maotai?.metrics.price).toBe(1319);
    expect(maotai?.metrics.marketCap).toBe(16576.08);
    expect(maotai?.metrics.eps).toBe(59.49);
    expect(maotai?.metrics.bps).toBe(230.5);
    expect(maotai?.metrics.revenue).toBe(1275);
    expect(maotai?.metrics.operatingCashflow).toBe(650);
    expect(maotai?.metrics.totalAssets).toBe(2550);
    expect(maotai?.metrics.totalLiabilities).toBe(420);
    expect(maotai?.metrics.investmentAssets).toBe(1260);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.industry1).toBe("食品饮料");
  });

  it("uses Rust structured all-A-share quote rows on the local app proxy", async () => {
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/market/tencent/ashare/quotes") {
        return new Response(JSON.stringify([rustMaotaiQuoteRow]), { status: 200 });
      }
      if (url.startsWith("/api/market/technical-indicators")) {
        return new Response(JSON.stringify(rustTechnicalIndicatorRows), { status: 200 });
      }
      return new Response("", { status: 500 });
    });

    const result = await syncTencentAllAshareMarketData([], fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(true);
    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0]).toMatchObject({ code: "600519", name: "贵州茅台" });
    expect(result.stocks[0].metrics.marketCap).toBeCloseTo(16576.08, 2);
    expect(result.stocks[0].metrics.realTechnicalSource).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls[1]).toContain("/api/market/technical-indicators");
  });

  it("keeps all-market quotes visible when Rust technical indicators fail", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/market/tencent/ashare/quotes") {
        return new Response(JSON.stringify([rustMaotaiQuoteRow]), { status: 200 });
      }
      if (url.startsWith("/api/market/technical-indicators")) {
        return new Response("upstream unavailable", { status: 503 });
      }
      return new Response("", { status: 500 });
    });

    const result = await syncTencentAllAshareMarketData([], fetchMock);

    expect(result.ok).toBe(true);
    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].metrics.realQuoteSource).toBe(1);
    expect(result.stocks[0].metrics.realTechnicalSource).toBeUndefined();
    expect(result.technicalMatchedRows).toBe(0);
    expect(result.details).toContain("Rust technical indicator API HTTP 503");
    expect(result.details).toContain("upstream unavailable");
  });

  it("reports invalid Rust all-A-share quote payloads instead of treating them as no active stocks", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ foo: "bar" }]), { status: 200 }));

    const result = await syncTencentAllAshareMarketData([], fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust Tencent quote API returned invalid quote rows payload");
    expect(result.sourceRows).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports invalid Rust all-A-share quote JSON explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));

    const result = await syncTencentAllAshareMarketData([], fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid JSON");
  });

  it("returns a failure state when real kline history is unavailable", async () => {
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));

    const result = await fetchStockKlineHistory(stock, "day", fetchMock);

    expect(result.ok).toBe(false);
    expect(result.points).toEqual([]);
    expect(result.message).toContain("K线获取失败");
  });
});
