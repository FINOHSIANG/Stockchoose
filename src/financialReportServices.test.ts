import { describe, expect, it } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { buildAnnualFinancialReports, buildFinancialReportSourceCsv } from "./financialReportServices";

describe("financialReportServices", () => {
  it("does not build reports from local sample financial fields", () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();

    const reports = buildAnnualFinancialReports(stock!);

    expect(reports).toEqual([]);
  });

  it("builds yearly financial reports only when a real annual report source is marked", () => {
    const stock = STOCKS.find((item) => item.code === "600519");
    expect(stock).toBeDefined();

    const reports = buildAnnualFinancialReports({
      ...stock!,
      metrics: { ...stock!.metrics, realAnnualReportSource: 1 }
    });

    expect(reports.map((report) => report.year)).toEqual(["2025", "2024", "2023"]);
    expect(reports[0].sourceFileName).toContain("600519");
    expect(reports[0].metrics.revenue).toBeGreaterThan(0);
    expect(reports[1].metrics.revenue).not.toBe(reports[0].metrics.revenue);

    const csv = buildFinancialReportSourceCsv(reports[0]);
    expect(csv).toContain("股票代码,股票名称,年度,报告期,报表,字段,数值,单位");
    expect(csv).toContain("利润表");
    expect(csv).toContain("现金流量表");
  });
});
