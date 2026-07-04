import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import {
  buildAnnualFinancialReports,
  buildAnnualFinancialReportsBunFirst,
  buildFinancialReportSourceCsv,
  buildFinancialReportSourceDataUrl
} from "./financialReportServices";
import type { AnnualFinancialReport } from "./financialReportServices";

function bunAnnualReport(sourceCsv?: string): AnnualFinancialReport {
  return {
    code: "600519",
    name: "贵州茅台",
    year: "2025",
    periodEnd: "2025-12-31",
    disclosureDate: "2026-04-30",
    reportType: "年度报告",
    currencyUnit: "人民币亿元",
    auditOpinion: "以真实财报接口返回字段为准",
    sourceProvider: "真实财报接口",
    sourceFileName: "600519-贵州茅台-2025-real-annual-report-source.csv",
    sourceFileType: "CSV",
    sourceNote: "由 Bun 财报接口生成，不倒推历史年度。",
    sourceCsv,
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
      employeeCount: 0,
      grossMargin: 90,
      netMargin: 58.59,
      roe: 31.2,
      roa: 29.29,
      revenueGrowth: 15.8,
      profitGrowth: 19.2,
      debtRatio: 16.47,
      currentRatio: 6,
      assetTurnover: 0.5,
      dividendYield: 0,
      cashProfitRatio: 87.01,
      receivableRevenueRatio: 0.94
    }
  };
}

describe("financialReportServices", () => {
  it("does not synthesize annual reports in the browser", () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();

    const reports = buildAnnualFinancialReports({
      ...stock!,
      metrics: {
        ...stock!.metrics,
        realAnnualReportSource: 1,
        realAnnualReportDate: 20251231,
        realAnnualReportDisclosureDate: 20260430,
        revenue: 1275,
        netProfit: 747
      }
    });

    expect(reports).toEqual([]);
  });

  it("uses the Bun annual report endpoint and Bun-built CSV", async () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();
    const bunReports = [bunAnnualReport("股票代码,股票名称\r\n600519,贵州茅台")];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(bunReports), { status: 200 }));

    const reports = await buildAnnualFinancialReportsBunFirst(stock!, fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/finance/annual-reports",
      expect.objectContaining({ method: "POST" })
    );
    expect(reports).toEqual(bunReports);
    expect(buildFinancialReportSourceCsv(reports[0])).toBe(bunReports[0].sourceCsv);
    expect(decodeURIComponent(buildFinancialReportSourceDataUrl(reports[0]))).toContain("股票代码,股票名称");
  });

  it("does not build a source CSV when Bun did not return one", () => {
    expect(buildFinancialReportSourceCsv(bunAnnualReport())).toBe("");
  });

  it("throws a visible error when the Bun annual report API fails", async () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }));

    await expect(buildAnnualFinancialReportsBunFirst(stock!, fetchMock as typeof fetch)).rejects.toThrow(
      "Bun annual report API HTTP 503"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/finance/annual-reports",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws a visible error when the Bun annual report payload has invalid rows", async () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ code: "600519", metrics: {} }]), { status: 200 }));

    await expect(buildAnnualFinancialReportsBunFirst(stock!, fetchMock as typeof fetch)).rejects.toThrow(
      "invalid annual report row"
    );
  });
});
