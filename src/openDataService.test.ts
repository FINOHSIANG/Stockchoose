import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { AKSHARE_AKTOOLS_PROVIDER, ensureInfoSourceSettings } from "./integrationServices";
import { mergeAkShareFinancialRows, mergeAkShareSpotRows, normalizeAkShareSpotRow, syncOpenSourceMarketData } from "./openDataService";

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

const akshareFinancialRows = {
  performanceRows: [
    {
      股票代码: "600519",
      股票简称: "贵州茅台",
      营业收入: 127500000000,
      净利润: 74700000000,
      基本每股收益: 59.49,
      每股净资产: 230.5,
      净资产收益率: 31.2,
      营业收入同比增长: 15.8,
      净利润同比增长: 19.2
    }
  ],
  incomeRows: [
    {
      股票代码: "600519",
      营业总收入: 127500000000,
      营业成本: 11800000000,
      净利润: 74700000000
    }
  ],
  balanceRows: [
    {
      股票代码: "600519",
      资产总计: 255000000000,
      负债合计: 42000000000,
      存货: 38800000000,
      应收账款: 1200000000,
      流动资产合计: 210000000000,
      流动负债合计: 35000000000,
      货币资金: 120000000000,
      交易性金融资产: 5000000000,
      长期股权投资: 1000000000,
      短期借款: 6000000000,
      长期借款: 4000000000
    }
  ],
  cashFlowRows: [
    {
      股票代码: "600519",
      经营活动产生的现金流量净额: 65000000000
    }
  ],
  reportDate: "20251231"
};

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
    expect(maotai?.metrics.openSourceMarketSource).toBe(1);
  });

  it("merges AKShare financial report rows into valuation-required metrics", () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const result = mergeAkShareFinancialRows(quoteMerged.stocks, akshareFinancialRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(1);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.revenue).toBe(1275);
    expect(maotai?.metrics.netProfit).toBe(747);
    expect(maotai?.metrics.operatingCashflow).toBe(650);
    expect(maotai?.metrics.totalAssets).toBe(2550);
    expect(maotai?.metrics.totalLiabilities).toBe(420);
    expect(maotai?.metrics.investmentAssets).toBe(1260);
    expect(maotai?.metrics.productionAssets).toBe(1290);
    expect(maotai?.metrics.interestBearingDebt).toBe(100);
    expect(maotai?.metrics.nonInterestBearingDebt).toBe(320);
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

  it("syncs AKShare market and financial bulk endpoints through AKTools", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("stock_zh_a_spot_em")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      if (url.includes("stock_yjbb_em")) return new Response(JSON.stringify(akshareFinancialRows.performanceRows), { status: 200 });
      if (url.includes("stock_lrb_em")) return new Response(JSON.stringify(akshareFinancialRows.incomeRows), { status: 200 });
      if (url.includes("stock_zcfz_em")) return new Response(JSON.stringify(akshareFinancialRows.balanceRows), { status: 200 });
      if (url.includes("stock_xjll_em")) return new Response(JSON.stringify(akshareFinancialRows.cashFlowRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://127.0.0.1:8080/api/public"
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(true);
    expect(result.summary.financeMatchedRows).toBe(1);
    expect(result.summary.valuationReadyRows).toBeGreaterThanOrEqual(1);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.currentRatio).toBe(6);
    expect(requestedUrls.some((url) => url.includes("stock_yjbb_em?date="))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("stock_zcfz_em?date="))).toBe(true);
  });
});
