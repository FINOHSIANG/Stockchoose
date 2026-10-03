export function finiteDataNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[,，]/g, "").trim();
  if (!text || text === "-" || text === "--") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function financialReportDateCandidates(now = new Date()): string[] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // 选择已进入披露窗口的报告期；各张报表必须按同一候选期一起回退。
  const current = month >= 10 ? `${year}0930` : month >= 7 ? `${year}0630` : month >= 4 ? `${year}0331` : `${year - 1}0930`;
  return [...new Set([
    current, `${year}0630`, `${year}0331`, `${year - 1}1231`,
    `${year - 1}0930`, `${year - 1}0630`, `${year - 1}0331`, `${year - 2}1231`
  ])].filter((date) => date <= current).sort().reverse();
}

export function latestAnnualReportDate(now = new Date()): string {
  return `${now.getFullYear() - (now.getMonth() >= 4 ? 1 : 2)}1231`;
}

export const FINANCIAL_METRIC_KEYS = [
  "revenue", "netProfit", "operatingCashflow", "totalAssets", "totalLiabilities",
  "inventory", "receivables", "eps", "bps", "roe", "roa", "grossMargin", "netMargin",
  "revenueGrowth", "netProfitGrowth", "profitGrowth", "debtRatio", "currentRatio",
  "assetTurnover", "dividendYield", "investmentAssets", "productionAssets",
  "interestBearingDebt", "nonInterestBearingDebt", "qualityScore", "employeeCount",
  "cashProfitRatio", "receivableRevenueRatio", "realFinancialSource", "realAnnualReportSource",
  "realFinancialReportDate", "realFinancialReportDisclosureDate", "realAnnualReportDate",
  "realAnnualReportDisclosureDate"
] as const;

export function financialMetricsForReplacement(metrics: Record<string, number>) {
  const next = { ...metrics };
  for (const key of FINANCIAL_METRIC_KEYS) delete next[key];
  return next;
}
