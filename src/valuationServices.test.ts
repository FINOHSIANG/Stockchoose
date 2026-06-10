import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import type { Stock } from "./types";
import {
  buildValuationRows,
  buildValuationRowsRustFirst,
  defaultValuationFilters,
  hasRequiredRealValuationData,
  missingRealValuationFields,
  valuationBoardOptions,
  type ValuationRow
} from "./valuationServices";

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
  it("keeps valuation filters and real-data readiness checks in the browser", () => {
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

    expect(defaultValuationFilters.style).toBe("严苛核算");
    expect(defaultValuationFilters.minSafetyMargin).toBe(-999);
    expect(defaultValuationFilters.displayLimit).toBe(50);
    expect(valuationBoardOptions).toEqual(expect.arrayContaining(["A股", "科创板", "创业板", "北交所"]));
    expect(hasRequiredRealValuationData(quoteOnly)).toBe(false);
    expect(missingRealValuationFields(quoteOnly)).toEqual(expect.arrayContaining(["营业收入", "经营现金流", "投资性资产"]));
  });

  it("does not synthesize valuation rows in the browser", () => {
    const realReadyStocks = STOCKS.map(withRequiredRealValuationData);

    expect(realReadyStocks.some(hasRequiredRealValuationData)).toBe(true);
    expect(buildValuationRows(realReadyStocks, { ...defaultValuationFilters, minSafetyMargin: -999 })).toEqual([]);
  });

  it("uses the Rust valuation endpoint as the only valuation result source", async () => {
    const realReadyStocks = STOCKS.map(withRequiredRealValuationData);
    const rustRows = [
      {
        stock: realReadyStocks[0],
        fairValue: 10,
        safetyMargin: 25,
        governanceScore: 75,
        qualityScore: 70,
        profile: { industry: "食品饮料", model: "PE盈利" },
        components: { formulaRows: [] }
      }
    ] as unknown as ValuationRow[];
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(rustRows), { status: 200 }));

    const rows = await buildValuationRowsRustFirst(realReadyStocks, defaultValuationFilters, fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/valuation/rows",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      stocks: expect.any(Array),
      filters: expect.objectContaining({
        ...defaultValuationFilters,
        displayLimit: 50
      })
    });
    expect(rows).toEqual(rustRows);
  });

  it("throws a visible error when the Rust valuation API fails", async () => {
    const realReadyStocks = STOCKS.map(withRequiredRealValuationData);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));

    await expect(buildValuationRowsRustFirst(realReadyStocks, defaultValuationFilters, fetchMock as typeof fetch)).rejects.toThrow(
      "Rust valuation API HTTP 503"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/valuation/rows",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws a visible error when the Rust valuation payload has invalid rows", async () => {
    const realReadyStocks = STOCKS.map(withRequiredRealValuationData);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ stock: realReadyStocks[0], fairValue: "bad" }]), { status: 200 }));

    await expect(buildValuationRowsRustFirst(realReadyStocks, defaultValuationFilters, fetchMock as typeof fetch)).rejects.toThrow(
      "invalid valuation row"
    );
  });
});
