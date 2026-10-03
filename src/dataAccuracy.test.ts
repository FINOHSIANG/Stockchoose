import { describe, expect, it } from "vitest";
import { finiteDataNumber } from "./dataContracts";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { buildAnnualReportDetails, buildFinancialMetricRows, formatAnnualReportExport } from "../bun-api/services/finance";
import { mergeAkShareFinancialRows, mergeBunFinancialMetricRows, mergeBunTechnicalIndicatorRows, normalizeAkShareSpotRow } from "./openDataService";
import { buildAnnualFinancialReportsBunFirst, formatAnnualMetric } from "./financialReportServices";

const stock = { ...STOCKS[0], code: "600519", metrics: { price: 12, operatingCashflow: 999, realFinancialReportDate: 20251231 } };
const reports = {
  performanceRows: [], incomeRows: [], balanceRows: [], cashFlowRows: [], reportDate: "20260630"
};

describe("data accuracy", () => {
  it.each([null, undefined, "", " ", "-", "--", false, true, [], {}, Infinity, "NaN"])("does not turn missing data into zero: %s", (value) => {
    expect(finiteDataNumber(value)).toBeUndefined();
  });

  it("preserves real zero and negative values", () => {
    expect(finiteDataNumber(0)).toBe(0);
    expect(finiteDataNumber("-1,200.5")).toBe(-1200.5);
  });

  it("reads the actual AKTools cashflow field and converts signed/small yuan amounts explicitly", () => {
    const result = mergeAkShareFinancialRows([stock], {
      ...reports,
      incomeRows: [{ 股票代码: "600519", 净利润: -22640687.66, 营业总收入: 5000 }],
      cashFlowRows: [{ 股票代码: "600519", "经营性现金流-现金流量净额": -350000000, 公告日期: "2026-08-30" }]
    }, false).stocks[0];
    expect(result.metrics.netProfit).toBe(-0.23);
    expect(result.metrics.operatingCashflow).toBe(-3.5);
    expect(result.metrics.revenue).toBe(0);
    expect(result.metrics.realFinancialReportDisclosureDate).toBe(20260830);
  });

  it("honors explicit textual amount units", () => {
    const result = mergeAkShareFinancialRows([stock], {
      ...reports, incomeRows: [{ 股票代码: "600519", 净利润: "-2500万元", 营业总收入: "1.5亿元" }]
    }, false).stocks[0];
    expect(result.metrics.netProfit).toBe(-0.25);
    expect(result.metrics.revenue).toBe(1.5);
  });

  it("reads actual AKTools year-over-year fields without treating them as amounts", () => {
    const result = mergeAkShareFinancialRows([stock], {
      ...reports, performanceRows: [{
        股票代码: "600519", "营业总收入-同比增长": 12.5, "净利润-同比增长": -3.2
      }]
    }, false).stocks[0];
    expect(result.metrics.revenueGrowth).toBe(12.5);
    expect(result.metrics.profitGrowth).toBe(-3.2);
    expect(result.metrics.revenue).toBeUndefined();
    expect(result.metrics.netProfit).toBeUndefined();
  });

  it("does not confuse growth percentages with missing financial amounts", () => {
    const result = mergeAkShareFinancialRows([stock], {
      ...reports, incomeRows: [{ 股票代码: "600519", 营业总收入同比: 12, 净利润同比: -30 }]
    }, false).stocks[0];
    expect(result.metrics.revenue).toBeUndefined();
    expect(result.metrics.netProfit).toBeUndefined();
    expect(result.metrics.operatingCashflow).toBeUndefined();
    expect(result.metrics.realAnnualReportSource).toBeUndefined();
    expect(result.metrics.realFinancialReportDisclosureDate).toBeUndefined();
    expect(result.metrics.price).toBe(12);
  });

  it("does not reuse missing fields from another financial report", () => {
    const result = mergeBunFinancialMetricRows([stock], [{
      code: "600519", name: "测试", reportDate: "2026-06-30", sourceRows: 1,
      metrics: { realAnnualReportSource: 1, realFinancialReportDate: 20260630, netProfit: 1 }
    }], false).stocks[0];
    expect(result.metrics.operatingCashflow).toBeUndefined();
    expect(result.metrics.price).toBe(12);
    expect(result.metrics.netProfit).toBe(1);
  });

  it("does not let an older report overwrite newer data", () => {
    const latest = { ...stock, metrics: { ...stock.metrics, realFinancialReportDate: 20260630 } };
    const result = mergeAkShareFinancialRows([latest], {
      ...reports, reportDate: "20251231", incomeRows: [{ 股票代码: "600519", 净利润: 50000000 }]
    }, false).stocks[0];
    expect(result).toBe(latest);
  });

  it("keeps live quotes separate from historical technical prices", () => {
    const result = mergeBunTechnicalIndicatorRows([stock], [{
      code: "600519", reportDate: "2026-09-09", metrics: { price: 1, pctChange: -9, ma5: 11, realTechnicalSource: 1 }
    }], false).stocks[0];
    expect(result.metrics.price).toBe(12);
    expect(result.metrics.pctChange).toBeUndefined();
    expect(result.metrics.ma5).toBe(11);
  });

  it("distinguishes raw yuan/lots from normalized yi/wan-lots without magnitude guessing", () => {
    const raw = normalizeAkShareSpotRow({ 代码: "600519", 成交额: 5000, 成交量: 50, 总市值: 2100000000000, netInflow: -125000000 });
    expect(raw?.amountYi).toBe(0.00005);
    expect(raw?.volumeWanShou).toBe(0.005);
    expect(raw?.netInflowYi).toBe(-1.25);
    const normalized = normalizeAkShareSpotRow({ code: "600519", amount: 120000, marketCap: 220000, volume: 25000 });
    expect(normalized?.amountYi).toBe(120000);
    expect(normalized?.marketCapYi).toBe(220000);
    expect(normalized?.volumeWanShou).toBe(25000);
    expect(normalizeAkShareSpotRow({ 代码: "600519", 成交量: 1000000, volumeUnit: "shares" })?.volumeWanShou).toBe(1);
  });

  it("does not fabricate native finance fields from missing values", () => {
    const rows = buildFinancialMetricRows({
      ...reports,
      incomeRows: [{ SECURITY_CODE: "600519", OPERATE_INCOME: 100000000, NETPROFIT: -20000000, NOTICE_DATE: "2026-08-20" }],
      balanceRows: [{ SECURITY_CODE: "600519", TOTAL_ASSETS: 1000000000, TOTAL_LIABILITIES: 300000000, NOTICE_DATE: "2026-08-30" }]
    });
    expect(rows[0].metrics).toMatchObject({ revenue: 1, netProfit: -0.2, realFinancialReportDisclosureDate: 20260830 });
    expect(rows[0].metrics.operatingCashflow).toBeUndefined();
    expect(rows[0].metrics.interestBearingDebt).toBeUndefined();
    expect(buildFinancialMetricRows({ ...reports, incomeRows: [{ SECURITY_CODE: "600519" }] })).toEqual([]);
    expect(buildFinancialMetricRows({ ...reports, incomeRows: [{ OPERATE_INCOME: 5 }] })).toEqual([]);
  });

  it("does not calculate gross margin from total costs including period expenses", () => {
    const income = {
      SECURITY_CODE: "600519", OPERATE_INCOME: 100000000, OPERATE_COST: 20000000,
      TOTAL_OPERATE_COST: 60000000
    };
    const input = { ...reports, incomeRows: [income] };
    expect(buildFinancialMetricRows(input)[0].metrics.grossMargin).toBe(80);
    expect(mergeAkShareFinancialRows([stock], input, false).stocks[0].metrics.grossMargin).toBe(80);
    const withoutCost = { ...input, incomeRows: [{ ...income, OPERATE_COST: undefined }] };
    expect(buildFinancialMetricRows(withoutCost)[0].metrics.grossMargin).toBeUndefined();
    expect(mergeAkShareFinancialRows([stock], withoutCost, false).stocks[0].metrics.grossMargin).toBeUndefined();
  });

  it("excludes B shares and NEEQ disclosures from native A-share financial rows", () => {
    const performance = { PARENT_NETPROFIT: 100000000 };
    const rows = buildFinancialMetricRows({ ...reports, performanceRows: [
      { ...performance, SECURITY_CODE: "600519", SECURITY_TYPE_CODE: "058001001" },
      { ...performance, SECURITY_CODE: "689009", SECURITY_TYPE_CODE: "058001008" },
      { ...performance, SECURITY_CODE: "900901", SECURITY_TYPE_CODE: "058001002" },
      { ...performance, SECURITY_CODE: "830768", SECURITY_TYPE_CODE: "058001005" },
      { ...performance, SECURITY_CODE: "830769", SECUCODE: "830769.NQ" }
    ] });
    expect(rows.map((row) => row.code)).toEqual(["600519", "689009"]);
  });

  it("uses the real native annual report contract and displays absent fields as missing", async () => {
    const report = formatAnnualReportExport({
      code: "600519", name: "贵州茅台", reportDate: "2025-12-31",
      metrics: { revenue: 100, netProfit: -1, realFinancialReportDisclosureDate: 20260430 }
    }, "");
    const result = await buildAnnualFinancialReportsBunFirst(stock, async () => new Response(JSON.stringify([report])));
    expect(result[0]).toMatchObject({ periodEnd: "2025-12-31", disclosureDate: "2026-04-30", metrics: { revenue: 100, netProfit: -1 } });
    expect(result[0].metrics.employeeCount).toBeUndefined();
    expect(formatAnnualMetric(result[0].metrics.employeeCount, " 人")).toBe("未提供");
    expect(formatAnnualMetric(0, " 亿")).toBe("0 亿");
  });

  it("builds detailed statements from the same stock report rows without fabricating missing values", () => {
    const details = buildAnnualReportDetails({
      performance: { TOTAL_OPERATE_INCOME: 10_000_000_000, BASIC_EPS: 5.25 },
      income: { OPERATE_COST: 2_000_000_000, NETPROFIT: -500_000_000 },
      balance: { TOTAL_ASSETS: 50_000_000_000, TOTAL_LIABILITIES: 0 },
      cashFlow: { NETCASH_OPERATE: 0 }
    });

    expect(details.performance.find((item) => item.key === "revenue")?.value).toBe(100);
    expect(details.income.find((item) => item.key === "netProfit")?.value).toBe(-5);
    expect(details.balance.find((item) => item.key === "totalLiabilities")?.value).toBe(0);
    expect(details.cashFlow.find((item) => item.key === "operatingNetCash")?.value).toBe(0);
    expect(details.balance.find((item) => item.key === "inventory")).not.toHaveProperty("value");
  });
});
