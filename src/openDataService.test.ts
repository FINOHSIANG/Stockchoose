import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { AKSHARE_AKTOOLS_PROVIDER, AKTOOLS_DEFAULT_BASE_URL, ASHAREHUB_DEFAULT_BASE_URL, ASHAREHUB_PROVIDER, ensureInfoSourceSettings } from "./integrationServices";
import { mergeAkShareFinancialRows, mergeAkShareSpotRows, mergeRustAnalystForecastRows, mergeRustFinancialMetricRows, mergeRustMarginBalanceRows, mergeRustNorthHoldingRows, mergeRustTechnicalIndicatorRows, normalizeAkShareSpotRow, syncOpenSourceFinancialReports, syncOpenSourceMarketData } from "./openDataService";

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
    振幅: 3.45,
    "60日涨跌幅": 12.34,
    listingDate: 20260609,
    netInflow: 2235612416,
    netInflowRatio: 8.34
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
    振幅: "2.60",
    "60日涨跌幅": "-6.5",
    listingDate: "20240520",
    netInflow: "-125000000",
    netInflowRatio: "-1.25"
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

const rustFinancialMetricRows = [
  {
    code: "600519",
    name: "贵州茅台",
    reportDate: "2025-12-31",
    sourceRows: 4,
    metrics: {
      revenue: 1275,
      netProfit: 747,
      operatingCashflow: 650,
      totalAssets: 2550,
      totalLiabilities: 420,
      inventory: 388,
      receivables: 12,
      eps: 59.49,
      bps: 230.5,
      roe: 31.2,
      grossMargin: 90.75,
      netMargin: 58.59,
      revenueGrowth: 15.8,
      profitGrowth: 19.2,
      debtRatio: 16.47,
      currentRatio: 6,
      assetTurnover: 0.5,
      investmentAssets: 1260,
      productionAssets: 1290,
      interestBearingDebt: 100,
      nonInterestBearingDebt: 320,
      realAnnualReportSource: 1,
      realFinancialReportDate: 20251231,
      realAnnualReportDate: 20251231,
      realAnnualReportDisclosureDate: 20260430
    }
  }
];

const rustAnalystForecastRows = [
  {
    code: "600519",
    name: "Kweichow Moutai",
    reportDate: "2026E",
    sourceRows: 1,
    metrics: {
      recommendationCount: 44,
      ratingScore: 4.84,
      actualEps: 65.85,
      forecastEps: 68.96,
      epsForecastGrowth: 4.72,
      targetPriceHigh: 2030,
      targetPriceLow: 1525,
      targetPriceMid: 1777.5,
      realAnalystForecastSource: 1
    }
  }
];

const rustMarginBalanceRows = [
  {
    code: "600519",
    name: "Kweichow Moutai",
    reportDate: "2026-06-08",
    sourceRows: 1,
    metrics: {
      marginBalance: 196.36,
      financingBalance: 194.99,
      securitiesLendingBalance: 1.38,
      financingBuyAmount: 3.5,
      financingRepayAmount: 5.89,
      financingNetBuyAmount: -2.4,
      marginBalanceGrowthRate: -1.21,
      marginTradeDate: 20260608,
      realMarginSource: 1
    }
  }
];

const rustNorthHoldingRows = [
  {
    code: "600519",
    name: "Kweichow Moutai",
    reportDate: "2024-08-16",
    sourceRows: 1,
    metrics: {
      northHold: 6.55,
      northHoldShares: 82354427,
      northHoldMarketCap: 1178.66,
      northHoldAsharesRatio: 6.56,
      northHoldAddedShares: 39399,
      northHoldMarketCapChange: 4.11,
      northHoldDate: 20240816,
      realNorthHoldSource: 1
    }
  }
];

const rustTechnicalIndicatorRows = [
  {
    code: "600519",
    name: "Kweichow Moutai",
    reportDate: "2026-06-09",
    sourceRows: 120,
    metrics: {
      ma20Distance: 3.21,
      ma60Distance: 8.76,
      momentum60: 12.45,
      volatility20: 18.34,
      macd: 1.23,
      kdj: 72.4,
      rsi: 61.8,
      bias: 3.21,
      bollWidth: 9.87,
      tradingDays: 120,
      technicalTradeDate: 20260609,
      realTechnicalSource: 1
    }
  }
];

const ashareHubRowsByEndpoint: Record<string, Record<string, unknown>[]> = {
  "reference/stocks": [
    { ts_code: "600519.SH", symbol: "600519", name: "贵州茅台", area: "贵州", industry: "白酒", market: "主板", exchange: "SSE", list_date: "20010827", website: "www.moutaichina.com", concept: "高端白酒,贵州国企" },
    { ts_code: "000858.SZ", symbol: "000858", name: "五粮液", area: "四川", industry: "白酒", market: "主板", exchange: "SZSE", list_date: "19980427" }
  ],
  "reference/industries": [
    { ts_code: "600519.SH", l1_name: "食品饮料", l2_name: "白酒", trade_date: "20260609" },
    { ts_code: "000858.SZ", l1_name: "食品饮料", l2_name: "白酒", trade_date: "20260609" }
  ],
  "market/daily": [
    { ts_code: "600519.SH", trade_date: "20260609", open: 1660, high: 1700, low: 1642, close: 1688.88, pre_close: 1650.27, pct_chg: 2.34, vol: 123456, amount: 987654.321 },
    { ts_code: "000858.SZ", trade_date: "20260609", open: 140, high: 141.2, low: 137.5, close: 138.12, pre_close: 139.79, pct_chg: -1.2, vol: 223456, amount: 345678.901 }
  ],
  "market/fundamentals": [
    { ts_code: "600519.SH", trade_date: "20260609", close: 1688.88, turnover_rate: 1.23, pe: 28.6, pe_ttm: 27.9, pb: 8.2, ps: 14.1, total_mv: 210000000, circ_mv: 209000000 },
    { ts_code: "000858.SZ", trade_date: "20260609", close: 138.12, turnover_rate: 0.95, pe: 18.3, pb: 4.1, ps: 6.2, total_mv: 52000000, circ_mv: 51000000 }
  ],
  "financials/indicators": [
    { ts_code: "600519.SH", ann_date: "20260430", end_date: "20251231", eps: 59.49, bps: 230.5, roe: 31.2, roa: 22.1, gross_margin: 90.75, netprofit_margin: 58.59, debt_to_assets: 16.47, current_ratio: 6 }
  ],
  "financials/income": [
    { ts_code: "600519.SH", ann_date: "20260430", end_date: "20251231", basic_eps: 59.49, total_revenue: 127500000000, revenue: 127500000000, total_cogs: 11800000000, n_income: 74700000000, n_income_attr_p: 74700000000 }
  ],
  "financials/balance-sheet": [
    { ts_code: "600519.SH", ann_date: "20260430", end_date: "20251231", total_assets: 255000000000, total_liab: 42000000000, inventories: 38800000000, accounts_receiv: 1200000000, total_cur_assets: 210000000000, total_cur_liab: 35000000000, money_cap: 120000000000, lt_eqt_invest: 1000000000, st_borr: 6000000000, lt_borr: 4000000000 }
  ],
  "financials/cash-flow": [
    { ts_code: "600519.SH", ann_date: "20260430", end_date: "20251231", n_cashflow_act: 65000000000, net_profit: 74700000000 }
  ],
  "market/margin": [
    { ts_code: "600519.SH", trade_date: "20260608", rzye: 19499000000, rqye: 138000000, rzmre: 350000000, rzche: 589000000, rzrqye: 19636000000 }
  ],
  "flows/northbound-holdings": [
    { ts_code: "600519.SH", trade_date: "20240816", name: "贵州茅台", vol: 82354427, ratio: 6.55, exchange: "SH" }
  ]
};

describe("openDataService", () => {
  it("normalizes AKShare spot rows with Chinese field names", () => {
    const row = normalizeAkShareSpotRow(akshareRows[0], new Date("2026-06-10T00:00:00Z"));

    expect(row).toMatchObject({
      code: "600519",
      name: "贵州茅台",
      price: 1688.88,
      pctChange: 2.34,
      turnover: 1.23,
      pe: 28.6,
      momentum60: 12.34,
      netInflowYi: 22.35612416,
      netInflowRatio: 8.34,
      listingDate: 20260609,
      listingDays: 2,
      newStockScore: 100
    });
    expect(row?.amountYi).toBeCloseTo(9.8765, 3);
    expect(row?.volumeWanShou).toBeCloseTo(12.3456, 3);
  });

  it("merges AKShare rows into the local strategy universe", () => {
    const result = mergeAkShareSpotRows(STOCKS, akshareRows, new Date("2026-06-10T00:00:00Z"));
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(2);
    expect(maotai?.name).toBe("贵州茅台");
    expect(maotai?.metrics.price).toBe(1688.88);
    expect(maotai?.metrics.pe).toBe(28.6);
    expect(maotai?.metrics.momentum60).toBe(12.34);
    expect(maotai?.metrics.netInflow).toBe(22.36);
    expect(maotai?.metrics.netInflowRatio).toBe(8.34);
    expect(maotai?.metrics.listingDate).toBe(20260609);
    expect(maotai?.metrics.listingDays).toBe(2);
    expect(maotai?.metrics.newStockScore).toBe(100);
    expect(maotai?.metrics.marketCap).toBe(21000);
    expect(maotai?.metrics.openSourceMarketSource).toBe(1);
  });

  it("adds AKShare-only spot rows to the stock universe", () => {
    const result = mergeAkShareSpotRows(STOCKS, [
      ...akshareRows,
      {
        代码: "605499",
        名称: "东鹏饮料",
        最新价: 250.5,
        涨跌幅: 1.25,
        成交量: 50000,
        成交额: 100000000,
        换手率: 0.82,
        总市值: 120000000000,
        市盈率: 32.1
      }
    ]);
    const appended = result.stocks.find((stock) => stock.code === "605499");

    expect(result.matchedRows).toBe(3);
    expect(result.sourceRows).toBe(3);
    expect(result.stocks.length).toBe(STOCKS.length + 1);
    expect(appended?.name).toBe("东鹏饮料");
    expect(appended?.exchange).toBe("沪市");
    expect(appended?.board).toBe("主板");
    expect(appended?.metrics.price).toBe(250.5);
    expect(appended?.metrics.marketCap).toBe(1200);
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

  it("merges Rust normalized financial metric rows into valuation-required metrics", () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const result = mergeRustFinancialMetricRows(quoteMerged.stocks, rustFinancialMetricRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(1);
    expect(result.sourceRows).toBe(4);
    expect(result.reportDate).toBe("2025-12-31");
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.realAnnualReportDate).toBe(20251231);
    expect(maotai?.metrics.revenue).toBe(1275);
    expect(maotai?.metrics.currentRatio).toBe(6);
    expect(maotai?.metrics.investmentAssets).toBe(1260);
  });

  it("merges Rust analyst forecast rows into stock selection factors", () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const result = mergeRustAnalystForecastRows(quoteMerged.stocks, rustAnalystForecastRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(1);
    expect(result.sourceRows).toBe(1);
    expect(maotai?.metrics.realAnalystForecastSource).toBe(1);
    expect(maotai?.metrics.recommendationCount).toBe(44);
    expect(maotai?.metrics.ratingScore).toBe(4.84);
    expect(maotai?.metrics.epsForecastGrowth).toBe(4.72);
    expect(maotai?.metrics.targetPriceMid).toBe(1777.5);
    expect(maotai?.metrics.targetUpside).toBeCloseTo(5.25, 2);
  });

  it("merges Rust margin balance rows into stock selection factors", () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const result = mergeRustMarginBalanceRows(quoteMerged.stocks, rustMarginBalanceRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(1);
    expect(result.sourceRows).toBe(1);
    expect(maotai?.isMargin).toBe(true);
    expect(maotai?.metrics.realMarginSource).toBe(1);
    expect(maotai?.metrics.marginBalance).toBe(196.36);
    expect(maotai?.metrics.financingBalance).toBe(194.99);
    expect(maotai?.metrics.securitiesLendingBalance).toBe(1.38);
    expect(maotai?.metrics.financingNetBuyAmount).toBe(-2.4);
    expect(maotai?.metrics.marginTradeDate).toBe(20260608);
  });

  it("merges Rust north holding rows into stock selection factors", () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const result = mergeRustNorthHoldingRows(quoteMerged.stocks, rustNorthHoldingRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(1);
    expect(result.sourceRows).toBe(1);
    expect(result.reportDate).toBe("2024-08-16");
    expect(maotai?.metrics.realNorthHoldSource).toBe(1);
    expect(maotai?.metrics.northHold).toBe(6.55);
    expect(maotai?.metrics.northHoldMarketCap).toBe(1178.66);
    expect(maotai?.metrics.northHoldShares).toBe(82354427);
    expect(maotai?.metrics.northHoldDate).toBe(20240816);
  });

  it("merges Rust technical indicator rows into daily selection factors", () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const result = mergeRustTechnicalIndicatorRows(quoteMerged.stocks, rustTechnicalIndicatorRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(result.matchedRows).toBe(1);
    expect(result.sourceRows).toBe(120);
    expect(result.reportDate).toBe("2026-06-09");
    expect(maotai?.metrics.realTechnicalSource).toBe(1);
    expect(maotai?.metrics.ma20Distance).toBe(3.21);
    expect(maotai?.metrics.ma60Distance).toBe(8.76);
    expect(maotai?.metrics.volatility20).toBe(18.34);
    expect(maotai?.metrics.macd).toBe(1.23);
    expect(maotai?.metrics.kdj).toBe(72.4);
    expect(maotai?.metrics.rsi).toBe(61.8);
    expect(maotai?.metrics.bias).toBe(3.21);
    expect(maotai?.metrics.bollWidth).toBe(9.87);
    expect(maotai?.metrics.technicalTradeDate).toBe(20260609);
  });

  it("derives price from market cap and real EPS when quote price is unavailable", () => {
    const stocksWithoutPrice = STOCKS.map((stock) => {
      if (stock.code !== "600519") return stock;
      const { price: _price, ...metrics } = stock.metrics;
      return { ...stock, metrics };
    });
    const quoteMerged = mergeAkShareSpotRows(stocksWithoutPrice, [{
      代码: "600519",
      名称: "贵州茅台",
      最新价: "-",
      总市值: 2100000000000,
      流通市值: 2090000000000,
      "市盈率-动态": 28.6,
      市净率: 8.2
    }]);
    const result = mergeAkShareFinancialRows(quoteMerged.stocks, akshareFinancialRows);
    const maotai = result.stocks.find((stock) => stock.code === "600519");

    expect(maotai?.metrics.price).toBeCloseTo(1672.41, 2);
    expect(result.stocks.filter((stock) => stock.metrics.price && stock.metrics.realAnnualReportSource === 1).length).toBeGreaterThanOrEqual(1);
  });

  it("syncs default local market data through the Rust native market endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/market/north-holdings")) return new Response(JSON.stringify(rustNorthHoldingRows), { status: 200 });
      if (url.includes("/api/market/technical-indicators")) return new Response(JSON.stringify(rustTechnicalIndicatorRows), { status: 200 });
      return new Response(JSON.stringify(akshareRows), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL,
      modules: { market: true, finance: false, filing: false, news: false }
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("开源数据同步完成");
    expect(result.summary.matchedRows).toBe(2);
    expect(result.summary.northHoldMatchedRows).toBe(1);
    expect(result.summary.technicalMatchedRows).toBe(1);
    expect(result.stocks.find((stock) => stock.code === "000858")?.metrics.price).toBe(138.12);
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.northHold).toBe(6.55);
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.ma20Distance).toBe(3.21);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/market/ashare/spot");
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes("/api/market/north-holdings"))).toBe(true);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes("/api/market/technical-indicators"))).toBe(true);
  });

  it("does not fall back to AKTools spot endpoints when the local Rust native market endpoint has no rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/market/ashare/spot")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("stock_zh_a_spot_em")) return new Response("upstream failed", { status: 500 });
      if (url.includes("stock_zh_a_spot")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL,
      modules: { market: true, finance: false, filing: false, news: false }
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(false);
    expect(result.summary.matchedRows).toBe(0);
    expect(result.details).toContain("Rust 原生行情接口未返回可用 A 股行情");
    expect(requestedUrls[0]).toBe("/api/market/ashare/spot");
    expect(requestedUrls.some((url) => url.includes("stock_zh_a_spot"))).toBe(false);
  });

  it("surfaces invalid Rust native market payloads instead of reporting empty market rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/market/ashare/spot")) return new Response(JSON.stringify({ unexpected: true }), { status: 200 });
      if (url.includes("stock_zh_a_spot")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL,
      modules: { market: true, finance: false, filing: false, news: false }
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid payload");
    expect(requestedUrls[0]).toBe("/api/market/ashare/spot");
    expect(requestedUrls.some((url) => url.includes("stock_zh_a_spot"))).toBe(false);
  });

  it("continues with financial data when AKShare spot endpoints are temporarily unavailable", async () => {
    const financialRowsWithNewStock = {
      ...akshareFinancialRows,
      performanceRows: [
        ...akshareFinancialRows.performanceRows,
        {
          股票代码: "605499",
          股票简称: "东鹏饮料",
          营业收入: 11200000000,
          净利润: 2040000000,
          每股收益: 3.22
        },
        {
          股票代码: "874976",
          股票简称: "澳维科技",
          营业收入: 480000000,
          净利润: 89000000
        }
      ]
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string };
      if (url === "/api/integration/aktools/rows" && (body.endpoint === "stock_zh_a_spot_em" || body.endpoint === "stock_zh_a_spot")) return new Response(JSON.stringify([]), { status: 200 });
      if (url === "/api/integration/aktools/rows" && body.endpoint === "stock_yjbb_em") return new Response(JSON.stringify(financialRowsWithNewStock.performanceRows), { status: 200 });
      if (url === "/api/integration/aktools/rows" && body.endpoint === "stock_lrb_em") return new Response(JSON.stringify(financialRowsWithNewStock.incomeRows), { status: 200 });
      if (url === "/api/integration/aktools/rows" && body.endpoint === "stock_zcfz_em") return new Response(JSON.stringify(financialRowsWithNewStock.balanceRows), { status: 200 });
      if (url === "/api/integration/aktools/rows" && body.endpoint === "stock_xjll_em") return new Response(JSON.stringify(financialRowsWithNewStock.cashFlowRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://aktools.example/api/public"
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");
    const appended = result.stocks.find((stock) => stock.code === "605499");
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    const requestedBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { baseUrl?: string; endpoint?: string });

    expect(result.ok).toBe(true);
    expect(result.summary.matchedRows).toBe(0);
    expect(result.summary.financeMatchedRows).toBe(2);
    expect(result.stocks.length).toBe(STOCKS.length + 1);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.revenue).toBe(1275);
    expect(appended?.name).toBe("东鹏饮料");
    expect(appended?.metrics.revenue).toBe(112);
    expect(result.stocks.find((stock) => stock.code === "874976")).toBeUndefined();
    expect(requestedUrls.every((url) => url === "/api/integration/aktools/rows")).toBe(true);
    expect(requestedUrls.some((url) => url.includes("stock_yjbb_em"))).toBe(false);
    expect(requestedBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ baseUrl: "http://aktools.example/api/public", endpoint: "stock_yjbb_em" })
    ]));
  });

  it("surfaces AKTools market proxy HTTP failures instead of reporting empty market rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("upstream down", { status: 503 }));
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://aktools.example/api/public",
      modules: { market: true, finance: false, filing: false, news: false }
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const requestedBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { endpoint?: string });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust AKTools rows API HTTP 503");
    expect(result.details).toContain("upstream down");
    expect(requestedBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: "stock_zh_a_spot_em" }),
      expect.objectContaining({ endpoint: "stock_zh_a_spot" })
    ]));
  });

  it("surfaces invalid AKTools market proxy payloads instead of reporting empty market rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://aktools.example/api/public",
      modules: { market: true, finance: false, filing: false, news: false }
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust AKTools rows API returned invalid payload");
  });

  it("syncs default local market and financial data through Rust native metric endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/market/ashare/spot")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      if (url.includes("/api/market/north-holdings")) return new Response(JSON.stringify(rustNorthHoldingRows), { status: 200 });
      if (url.includes("/api/market/technical-indicators")) return new Response(JSON.stringify(rustTechnicalIndicatorRows), { status: 200 });
      if (url.includes("/api/finance/metrics/")) return new Response(JSON.stringify(rustFinancialMetricRows), { status: 200 });
      if (url.includes("/api/finance/analyst-forecasts")) return new Response(JSON.stringify(rustAnalystForecastRows), { status: 200 });
      if (url.includes("/api/finance/margin-balances")) return new Response(JSON.stringify(rustMarginBalanceRows), { status: 200 });
      if (url.includes("/api/finance/statements/")) {
        return new Response(JSON.stringify({
          performanceRows: akshareFinancialRows.performanceRows,
          incomeRows: akshareFinancialRows.incomeRows,
          balanceRows: akshareFinancialRows.balanceRows,
          cashFlowRows: akshareFinancialRows.cashFlowRows,
          reportDate: "20251231"
        }), { status: 200 });
      }
      if (url.includes("stock_zh_a_spot_em")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      if (url.includes("stock_yjbb_em")) return new Response(JSON.stringify(akshareFinancialRows.performanceRows), { status: 200 });
      if (url.includes("stock_lrb_em")) return new Response(JSON.stringify(akshareFinancialRows.incomeRows), { status: 200 });
      if (url.includes("stock_zcfz_em")) return new Response(JSON.stringify(akshareFinancialRows.balanceRows), { status: 200 });
      if (url.includes("stock_xjll_em")) return new Response(JSON.stringify(akshareFinancialRows.cashFlowRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(true);
    expect(result.summary.financeMatchedRows).toBe(1);
    expect(result.summary.analystMatchedRows).toBe(1);
    expect(result.summary.marginMatchedRows).toBe(1);
    expect(result.summary.northHoldMatchedRows).toBe(1);
    expect(result.summary.technicalMatchedRows).toBe(1);
    expect(result.summary.valuationReadyRows).toBeGreaterThanOrEqual(1);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.realAnalystForecastSource).toBe(1);
    expect(maotai?.metrics.realMarginSource).toBe(1);
    expect(maotai?.metrics.realNorthHoldSource).toBe(1);
    expect(maotai?.metrics.realTechnicalSource).toBe(1);
    expect(maotai?.metrics.northHold).toBe(6.55);
    expect(maotai?.metrics.ma60Distance).toBe(8.76);
    expect(maotai?.metrics.marginBalance).toBe(196.36);
    expect(maotai?.metrics.targetUpside).toBeCloseTo(5.25, 2);
    expect(maotai?.metrics.currentRatio).toBe(6);
    expect(requestedUrls.some((url) => url === "/api/market/ashare/spot")).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/market/north-holdings"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/market/technical-indicators"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/metrics/"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/analyst-forecasts"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/margin-balances"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/statements/"))).toBe(false);
  });

  it("syncs AShareHub market and financial rows through the Rust proxy", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string };
      return new Response(JSON.stringify(ashareHubRowsByEndpoint[body.endpoint ?? ""] ?? []), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: ASHAREHUB_PROVIDER,
      baseUrl: ASHAREHUB_DEFAULT_BASE_URL,
      apiToken: "ash_test"
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    const requestedBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { endpoint?: string; baseUrl?: string; apiToken?: string; params?: Record<string, string> });

    expect(result.ok).toBe(true);
    expect(result.summary.matchedRows).toBe(2);
    expect(result.summary.financeMatchedRows).toBe(1);
    expect(result.summary.marginMatchedRows).toBe(1);
    expect(result.summary.northHoldMatchedRows).toBe(1);
    expect(result.summary.valuationReadyRows).toBeGreaterThanOrEqual(1);
    expect(maotai?.name).toBe("贵州茅台");
    expect(maotai?.industry1).toBe("食品饮料");
    expect(maotai?.website).toBe("https://www.moutaichina.com");
    expect(maotai?.industryTags).toEqual(expect.arrayContaining(["高端白酒", "贵州国企", "食品饮料", "白酒"]));
    expect(maotai?.metrics.price).toBe(1688.88);
    expect(maotai?.metrics.amount).toBeCloseTo(9.88, 2);
    expect(maotai?.metrics.marketCap).toBe(21000);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.revenue).toBe(1275);
    expect(maotai?.metrics.operatingCashflow).toBe(650);
    expect(maotai?.metrics.totalAssets).toBe(2550);
    expect(maotai?.metrics.currentRatio).toBe(6);
    expect(maotai?.metrics.marginBalance).toBe(196.36);
    expect(maotai?.metrics.northHold).toBe(6.55);
    expect(result.details).toContain("AShareHub");
    expect(requestedUrls.every((url) => url === "/api/integration/asharehub/rows")).toBe(true);
    expect(requestedBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: "market/daily", baseUrl: ASHAREHUB_DEFAULT_BASE_URL, apiToken: "ash_test" }),
      expect.objectContaining({ endpoint: "financials/balance-sheet", apiToken: "ash_test" }),
      expect.objectContaining({ endpoint: "flows/northbound-holdings", apiToken: "ash_test" })
    ]));
  });

  it("reports missing AShareHub API keys before requesting sync endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const settings = ensureInfoSourceSettings({
      provider: ASHAREHUB_PROVIDER,
      baseUrl: ASHAREHUB_DEFAULT_BASE_URL,
      apiToken: ""
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("AShareHub API Key is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("syncs financial reports through the Rust native financial metric endpoint without requesting market endpoints", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/finance/metrics/")) return new Response(JSON.stringify(rustFinancialMetricRows), { status: 200 });
      if (url.includes("/api/finance/analyst-forecasts")) return new Response(JSON.stringify(rustAnalystForecastRows), { status: 200 });
      if (url.includes("/api/finance/margin-balances")) return new Response(JSON.stringify(rustMarginBalanceRows), { status: 200 });
      if (url.includes("/api/finance/statements/")) {
        return new Response(JSON.stringify({
          performanceRows: akshareFinancialRows.performanceRows,
          incomeRows: akshareFinancialRows.incomeRows,
          balanceRows: akshareFinancialRows.balanceRows,
          cashFlowRows: akshareFinancialRows.cashFlowRows,
          reportDate: "20251231"
        }), { status: 200 });
      }
      if (url.includes("stock_yjbb_em")) return new Response(JSON.stringify(akshareFinancialRows.performanceRows), { status: 200 });
      if (url.includes("stock_lrb_em")) return new Response(JSON.stringify(akshareFinancialRows.incomeRows), { status: 200 });
      if (url.includes("stock_zcfz_em")) return new Response(JSON.stringify(akshareFinancialRows.balanceRows), { status: 200 });
      if (url.includes("stock_xjll_em")) return new Response(JSON.stringify(akshareFinancialRows.cashFlowRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(true);
    expect(result.message).toBe("真实财报同步完成");
    expect(result.summary.financeMatchedRows).toBe(1);
    expect(result.summary.analystMatchedRows).toBe(1);
    expect(result.summary.marginMatchedRows).toBe(1);
    expect(result.summary.valuationReadyRows).toBeGreaterThanOrEqual(1);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.realAnalystForecastSource).toBe(1);
    expect(maotai?.metrics.realMarginSource).toBe(1);
    expect(maotai?.metrics.marginBalance).toBe(196.36);
    expect(maotai?.metrics.operatingCashflow).toBe(650);
    expect(requestedUrls.some((url) => url.includes("stock_zh_a_spot"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("/api/finance/metrics/"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/analyst-forecasts"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/margin-balances"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/statements/"))).toBe(false);
  });

  it("syncs AShareHub financial reports without requesting market quote endpoints", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string };
      return new Response(JSON.stringify(ashareHubRowsByEndpoint[body.endpoint ?? ""] ?? []), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: ASHAREHUB_PROVIDER,
      baseUrl: ASHAREHUB_DEFAULT_BASE_URL,
      apiToken: "ash_test"
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);
    const maotai = result.stocks.find((stock) => stock.code === "600519");
    const requestedBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { endpoint?: string; apiToken?: string });

    expect(result.ok).toBe(true);
    expect(result.summary.financeMatchedRows).toBe(1);
    expect(result.summary.marginMatchedRows).toBe(1);
    expect(result.summary.valuationReadyRows).toBeGreaterThanOrEqual(1);
    expect(maotai?.metrics.realAnnualReportSource).toBe(1);
    expect(maotai?.metrics.operatingCashflow).toBe(650);
    expect(maotai?.metrics.marginBalance).toBe(196.36);
    expect(requestedBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: "financials/indicators", apiToken: "ash_test" }),
      expect.objectContaining({ endpoint: "financials/income", apiToken: "ash_test" }),
      expect.objectContaining({ endpoint: "financials/balance-sheet", apiToken: "ash_test" }),
      expect.objectContaining({ endpoint: "financials/cash-flow", apiToken: "ash_test" }),
      expect.objectContaining({ endpoint: "market/margin", apiToken: "ash_test" })
    ]));
    expect(requestedBodies.some((body) => body.endpoint === "market/daily")).toBe(false);
  });

  it("does not fall back to AKTools financial endpoints when local Rust native financial endpoints return no rows", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/finance/metrics/")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("/api/finance/statements/")) {
        return new Response(JSON.stringify({
          performanceRows: [],
          incomeRows: [],
          balanceRows: [],
          cashFlowRows: [],
          reportDate: "20251231"
        }), { status: 200 });
      }
      if (url.includes("stock_yjbb_em")) return new Response(JSON.stringify(akshareFinancialRows.performanceRows), { status: 200 });
      if (url.includes("stock_lrb_em")) return new Response(JSON.stringify(akshareFinancialRows.incomeRows), { status: 200 });
      if (url.includes("stock_zcfz_em")) return new Response(JSON.stringify(akshareFinancialRows.balanceRows), { status: 200 });
      if (url.includes("stock_xjll_em")) return new Response(JSON.stringify(akshareFinancialRows.cashFlowRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust 原生财报接口未返回可用数据");
    expect(requestedUrls.some((url) => url.includes("/api/finance/metrics/"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/statements/"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("stock_yjbb_em"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("stock_lrb_em"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("stock_zcfz_em"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("stock_xjll_em"))).toBe(false);
  });

  it("surfaces invalid Rust native financial metric payloads", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/finance/metrics/")) return new Response(JSON.stringify({ unexpected: true }), { status: 200 });
      if (url.includes("/api/finance/statements/")) {
        return new Response(JSON.stringify({
          performanceRows: [],
          incomeRows: [],
          balanceRows: [],
          cashFlowRows: [],
          reportDate: "20251231"
        }), { status: 200 });
      }
      if (url.includes("stock_yjbb_em")) return new Response(JSON.stringify(akshareFinancialRows.performanceRows), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust native financial metric API returned invalid payload");
    expect(requestedUrls.some((url) => url.includes("stock_yjbb_em"))).toBe(false);
  });

  it("falls back to Rust native financial statements when metric rows are unavailable", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/finance/metrics/")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("/api/finance/statements/")) {
        return new Response(JSON.stringify({
          performanceRows: akshareFinancialRows.performanceRows,
          incomeRows: akshareFinancialRows.incomeRows,
          balanceRows: akshareFinancialRows.balanceRows,
          cashFlowRows: akshareFinancialRows.cashFlowRows,
          reportDate: "20251231"
        }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(result.ok).toBe(true);
    expect(result.summary.financeMatchedRows).toBe(1);
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.operatingCashflow).toBe(650);
    expect(requestedUrls.some((url) => url.includes("/api/finance/metrics/"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/finance/statements/"))).toBe(true);
  });

  it("surfaces invalid Rust native financial statement payloads", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/finance/metrics/")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("/api/finance/statements/")) return new Response(JSON.stringify({ performanceRows: {} }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust native financial statement API");
    expect(result.details).toContain("invalid payload");
  });

  it("surfaces AKTools financial proxy HTTP failures instead of reporting empty financial rows", async () => {
    const quoteMerged = mergeAkShareSpotRows(STOCKS, akshareRows);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("finance upstream down", { status: 503 }));
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://aktools.example/api/public"
    });

    const result = await syncOpenSourceFinancialReports(settings, quoteMerged.stocks, fetchMock);
    const requestedBodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { endpoint?: string });

    expect(result.ok).toBe(false);
    expect(result.details).toContain("Rust AKTools rows API HTTP 503");
    expect(result.details).toContain("finance upstream down");
    expect(requestedBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: "stock_yjbb_em" }),
      expect.objectContaining({ endpoint: "stock_lrb_em" }),
      expect.objectContaining({ endpoint: "stock_zcfz_em" }),
      expect.objectContaining({ endpoint: "stock_xjll_em" })
    ]));
  });

  it("keeps market data when financial endpoints time out", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/market/ashare/spot")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      if (url.includes("stock_zh_a_spot_em")) return new Response(JSON.stringify(akshareRows), { status: 200 });
      if (url.includes("stock_zh_a_spot")) return new Response(JSON.stringify([]), { status: 200 });
      throw abortError;
    });
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });

    const result = await syncOpenSourceMarketData(settings, STOCKS, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.summary.matchedRows).toBe(2);
    expect(result.summary.financeMatchedRows).toBe(0);
    expect(result.details).toContain("财报接口未完成：请求超时");
    expect(result.stocks.find((stock) => stock.code === "600519")?.metrics.price).toBe(1688.88);
  });
});
