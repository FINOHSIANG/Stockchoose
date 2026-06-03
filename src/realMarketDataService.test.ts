import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import {
  fetchStockKlineHistory,
  generateTencentAshareCandidates,
  syncTencentAllAshareMarketData,
  syncTencentRealMarketData
} from "./realMarketDataService";

function tencentQuoteLine(symbol: string, overrides: Record<number, string | number>) {
  const parts = Array.from({ length: 80 }, () => "");
  Object.entries(overrides).forEach(([index, value]) => {
    parts[Number(index)] = String(value);
  });
  return `v_${symbol}="${parts.join("~")}";`;
}

const maotaiQuote = tencentQuoteLine("sh600519", {
  1: "贵州茅台",
  2: "600519",
  3: 1319,
  32: -0.3,
  36: 41234,
  37: 548800,
  38: 0.33,
  39: 15.21,
  43: 2.04,
  44: 16576.08,
  45: 16576.08,
  46: 6.12,
  61: "GP-A"
});

const noslandQuote = tencentQuoteLine("bj920047", {
  1: "诺思兰德",
  2: "920047",
  3: 21.7,
  32: -10.4,
  36: 179223,
  37: 42311.3,
  38: 9.95,
  39: -125.21,
  43: 19.98,
  44: 59.52,
  45: 39.08,
  46: 22.41
});

const pinganQuote = tencentQuoteLine("sz000001", {
  1: "平安银行",
  2: "000001",
  3: 10.99,
  32: 0.55,
  36: 954596,
  37: 104230,
  38: 0.49,
  39: 4.95,
  43: 1.65,
  44: 2132.68,
  45: 2132.71,
  46: 0.46,
  61: "GP-A"
});

const delistedQuote = tencentQuoteLine("sh600001", {
  1: "邯郸钢铁",
  2: "600001",
  3: 5.29,
  40: "D",
  44: 148.99,
  45: 148.99,
  61: "GP-A"
});

const gbkNoslandQuoteBytes = new Uint8Array([
  118, 95, 98, 106, 57, 50, 48, 48, 52, 55, 61, 34, 54, 50, 126, 197, 181, 203, 188, 192, 188, 181, 194, 126, 57, 50, 48, 48, 52, 55, 126, 50, 49, 46, 55, 48, 126, 50, 52, 46, 50, 50, 126, 50, 52, 46, 56, 48, 126, 49, 55, 57, 50, 50, 51, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 48, 126, 126, 50, 48, 50, 54, 48, 54, 48, 49, 49, 53, 51, 53, 52, 54, 126, 45, 50, 46, 53, 50, 126, 45, 49, 48, 46, 52, 48, 126, 50, 54, 46, 48, 48, 126, 50, 49, 46, 49, 54, 126, 50, 49, 46, 55, 48, 47, 49, 55, 57, 50, 50, 51, 47, 52, 50, 51, 49, 49, 50, 57, 56, 52, 126, 49, 55, 57, 50, 50, 51, 126, 52, 50, 51, 49, 49, 46, 51, 48, 126, 57, 46, 57, 53, 126, 45, 49, 48, 50, 46, 56, 49, 126, 126, 50, 54, 46, 48, 48, 126, 50, 49, 46, 49, 54, 126, 49, 57, 46, 57, 56, 126, 51, 57, 46, 48, 56, 126, 53, 57, 46, 53, 50, 126, 50, 50, 46, 52, 49, 126, 126, 126, 126, 126, 126, 126, 126, 126, 126, 126, 126, 126, 126, 32, 126, 71, 80, 126, 45, 56, 46, 52, 56, 34, 59
]);

const tencentKlinePayload = {
  code: 0,
  msg: "",
  data: {
    sh600519: {
      qfqweek: [["2026-05-29", "1320.00", "1319.00", "1338.00", "1311.00", "41234"]]
    }
  }
};

describe("realMarketDataService", () => {
  it("merges Tencent quote data into valuation metrics", async () => {
    const base = STOCKS.filter((stock) => stock.code === "600519");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(maotaiQuote, { status: 200 }));

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
  });

  it("loads Tencent real kline history with the selected trading period", async () => {
    const stock = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(tencentKlinePayload), { status: 200 }));

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
    expect(requestedUrl).toContain("sh600519,week");
    expect(requestedUrl).toContain("qfq");
  });

  it("uses switched Beijing Stock Exchange market codes for Tencent quotes", async () => {
    const base = STOCKS.filter((stock) => stock.code === "430047");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(noslandQuote, { status: 200 }));

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
    const quoteBySymbol: Record<string, string> = {
      sh600519: maotaiQuote,
      sh600001: delistedQuote,
      sz000001: pinganQuote,
      bj920047: noslandQuote
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const query = url.split("q=")[1] ?? "";
      const content = query.split(",").map((symbol) => quoteBySymbol[symbol] ?? "").filter(Boolean).join("");
      return new Response(content, { status: 200 });
    });

    const result = await syncTencentAllAshareMarketData(STOCKS, fetchMock);

    expect(generateTencentAshareCandidates().length).toBeGreaterThan(10000);
    expect(result.ok).toBe(true);
    expect(result.stocks.map((stock) => stock.code)).toEqual(expect.arrayContaining(["600519", "000001", "920047"]));
    expect(result.stocks.some((stock) => stock.code === "600001")).toBe(false);
    expect(result.stocks.find((stock) => stock.code === "600519")?.industry1).toBe("未分类");
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.eps).toBeUndefined();
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.totalAssets).toBeUndefined();
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.realQuoteSource).toBe(1);
    expect(result.details).toContain("识别 3 只有效 A 股股票");
  });

  it("decodes Tencent GBK quote names without mojibake", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(gbkNoslandQuoteBytes, { status: 200 }));

    const result = await syncTencentAllAshareMarketData([], fetchMock);

    expect(result.ok).toBe(true);
    expect(result.stocks.find((stock) => stock.code === "920047")?.name).toBe("诺思兰德");
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
