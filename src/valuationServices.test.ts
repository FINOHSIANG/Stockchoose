import { describe, expect, it } from "vitest";
import { STOCKS } from "./data";
import {
  buildValuationRows,
  calculateValuation,
  defaultValuationFilters,
  hasRequiredRealValuationData,
  missingRealValuationFields,
  valuationBoardOptions
} from "./valuationServices";
import type { Stock } from "./types";

function withRequiredRealValuationData(stock: Stock): Stock {
  const price = stock.metrics.price ?? 10;
  const marketCap = stock.metrics.marketCap ?? 100;
  const totalAssets = stock.metrics.totalAssets ?? marketCap * 1.8;
  const totalLiabilities = stock.metrics.totalLiabilities ?? totalAssets * 0.45;
  return {
    ...stock,
    metrics: {
      ...stock.metrics,
      price,
      marketCap,
      eps: stock.metrics.eps ?? 0.8,
      bps: stock.metrics.bps ?? Math.max(price / Math.max(stock.metrics.pb ?? 1.2, 0.1), 0.1),
      revenue: stock.metrics.revenue ?? marketCap * 0.55,
      netProfit: stock.metrics.netProfit ?? marketCap * 0.06,
      operatingCashflow: stock.metrics.operatingCashflow ?? marketCap * 0.05,
      totalAssets,
      totalLiabilities,
      investmentAssets: stock.metrics.investmentAssets ?? totalAssets * 0.16,
      productionAssets: stock.metrics.productionAssets ?? totalAssets * 0.84,
      interestBearingDebt: stock.metrics.interestBearingDebt ?? totalLiabilities * 0.45,
      nonInterestBearingDebt: stock.metrics.nonInterestBearingDebt ?? totalLiabilities * 0.55
    }
  };
}

describe("valuationServices", () => {
  it("uses strict valuation as the default and never applies premium modifiers", () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();

    const row = calculateValuation(stock as Stock);
    const finalFormula = row.components.formulaRows[row.components.formulaRows.length - 1];

    expect(defaultValuationFilters.style).toBe("严苛核算");
    expect(row.fairValue).toBeLessThan(row.anchorValue);
    expect(row.governanceModifier).toBeLessThanOrEqual(0.88);
    expect(row.statusModifier).toBeLessThanOrEqual(0.94);
    expect(row.financialModifier).toBeLessThanOrEqual(0.88);
    expect(row.riskDiscount).toBeLessThanOrEqual(0.78);
    expect(finalFormula.formula).toContain("财务扣减");
  });

  it("does not inflate loss-making or cash-burning stocks with placeholder profits", () => {
    const base = STOCKS.find((item) => item.code === "833575");
    expect(base).toBeDefined();

    const stressed: Stock = {
      ...(base as Stock),
      metrics: {
        ...(base as Stock).metrics,
        eps: -0.8,
        netProfit: -8,
        operatingCashflow: -12,
        netMargin: -15,
        debtRatio: 82,
        currentRatio: 0.72,
        pledgeRatio: 34,
        violationScore: 58
      }
    };

    const row = calculateValuation(stressed);

    expect(row.components.earningsValue).toBe(0);
    expect(row.components.cashflowValue).toBe(0);
    expect(row.fairValue).toBeLessThan(row.currentPrice);
    expect(row.warnings).toContain("EPS为负或缺失，盈利模型按0处理");
    expect(row.warnings).toContain("经营现金流为负或缺失，现金流模型按0处理");
  });

  it("excludes production assets and separates interest-bearing debt in the asset model", () => {
    const base = STOCKS.find((item) => item.code === "600519");
    expect(base).toBeDefined();

    const assetHeavy: Stock = {
      ...(base as Stock),
      industry1: "机械设备",
      metrics: {
        ...(base as Stock).metrics,
        price: 20,
        marketCap: 200,
        bps: 80,
        totalAssets: 1200,
        totalLiabilities: 360,
        investmentAssets: 120,
        productionAssets: 1080,
        interestBearingDebt: 110,
        nonInterestBearingDebt: 250,
        operatingCashflow: 60,
        netProfit: 100
      }
    };

    const row = calculateValuation(assetHeavy);
    const assetFormula = row.components.formulaRows.find((item) => item.name === "投资资产折算");
    const cashflowFormula = row.components.formulaRows.find((item) => item.name === "现金流底线");

    expect(assetFormula?.formula).toContain("生产性资产不计入");
    expect(cashflowFormula?.formula).toContain("行业现金流门槛折扣");
    expect(row.components.balanceSheet.productionAssets).toBe(1080);
    expect(row.components.balanceSheet.interestBearingDebt).toBe(110);
    expect(row.components.assetValue).toBeLessThan(10);
    expect(row.warnings.some((warning) => warning.includes("现金流覆盖低于机械设备门槛"))).toBe(true);
  });

  it("filters valuation rows by A-share board and STAR market board", () => {
    const realReadyStocks = STOCKS.map(withRequiredRealValuationData);
    const broadRows = buildValuationRows(realReadyStocks, { ...defaultValuationFilters, board: "A股", minSafetyMargin: -999 });
    const starRows = buildValuationRows(realReadyStocks, { ...defaultValuationFilters, board: "科创板", minSafetyMargin: -999 });

    expect(valuationBoardOptions).toContain("A股");
    expect(valuationBoardOptions).toContain("科创板");
    expect(broadRows.length).toBeGreaterThan(starRows.length);
    expect(broadRows.every((row) => ["沪市", "深市", "北交所"].includes(row.stock.exchange))).toBe(true);
    expect(starRows.length).toBeGreaterThan(0);
    expect(starRows.every((row) => row.stock.board === "科创板")).toBe(true);
  });

  it("does not build valuation rows when real financial report fields are missing", () => {
    const base = STOCKS.find((item) => item.code === "600519") ?? STOCKS[0];
    const quoteOnly: Stock = {
      ...base,
      metrics: {
        realQuoteSource: 1,
        price: 1319,
        marketCap: 16576.08,
        pe: 15.21,
        pb: 6.12
      }
    };

    expect(hasRequiredRealValuationData(quoteOnly)).toBe(false);
    expect(missingRealValuationFields(quoteOnly)).toEqual(expect.arrayContaining(["营业收入", "经营现金流", "投资性资产"]));
    expect(buildValuationRows([quoteOnly], { ...defaultValuationFilters, minSafetyMargin: -999 })).toHaveLength(0);
  });
});
