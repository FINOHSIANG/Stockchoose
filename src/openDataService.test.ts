import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "./data";
import { AKSHARE_AKTOOLS_PROVIDER, ensureInfoSourceSettings } from "./integrationServices";
import { mergeAkShareSpotRows, normalizeAkShareSpotRow, syncOpenSourceMarketData } from "./openDataService";

const akshareRows = [
  {
    代码: "600519",
    名称: "贵州茅台",
    最新价: 1688.88,
    涨跌幅: 2.34,
    成交量: 123456,
    成交额: 987654321,
    换手率: 1.23,
    总市值: 2100000000000,
    流通市值: 2090000000000,
    "市盈率-动态": 28.6,
    市净率: 8.2,
    振幅: 3.45
  },
  {
    代码: "000858",
    名称: "五粮液",
    最新价: "138.12",
    涨跌幅: "-1.20",
    成交量: "223456",
    成交额: "345678901",
    换手率: "0.95",
    总市值: "520000000000",
    流通市值: "510000000000",
    "市盈率-动态": "18.3",
    市净率: "4.1",
    振幅: "2.60"
  }
];

describe("openDataService", () => {
  it("normalizes AKShare spot rows with Chinese field names", () => {
    const row = normalizeAkShareSpotRow(akshareRows[0]);

    expect(row).toMatchObject({
      code: "600519",
      name: "贵州茅台",
      price: 1688.88,
      pctChange: 2.34,
      turnover: 1.23,
      pe: 28.6
    });
    expect(row?.amountYi).toBeCloseTo(9.8765, 3);
    expect(row?.volumeWanShou).toBeCloseTo(12.3456, 3);
  });

  it("merges AKShare rows into the local strategy universe", () => {
    const result = mergeAkShareSpotRows(STOCKS, akshareRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(2);
    expect(maotai?.name).toBe("贵州茅台");
    expect(maotai?.metrics.price).toBe(1688.88);
    expect(maotai?.metrics.pe).toBe(28.6);
    expect(maotai?.metrics.marketCap).toBe(21000);
  });

  it("syncs AKShare spot data through the configured AKTools endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(akshareRows), { status: 200 }));
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://127.0.0.1:8080/api/public"
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("开源数据同步完成");
    expect(result.summary.matchedRows).toBe(2);
    expect(result.stocks.find((stock) => stock.code === "000858")?.metrics.price).toBe(138.12);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8080/api/public/stock_zh_a_spot_em");
  });
});
