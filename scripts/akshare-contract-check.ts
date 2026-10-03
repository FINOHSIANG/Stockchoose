import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeAkShareFinancialRows, mergeAkShareSpotRows, normalizeAkShareSpotRow } from "../src/openDataService";
import { hasRequiredRealValuationData } from "../src/valuationServices";

// Offline checks deliberately start with empty metrics, so old cached data cannot mask gaps.
const root = resolve(process.argv[2] ?? "tmp/akshare-api-audit");
const samples = JSON.parse(readFileSync(resolve(root, "contract-samples.json"), "utf8"));
if (!samples.completed) throw new Error("The capture run has not completed");
const load = (id: string): Record<string, unknown>[] => {
  const result = samples.cases.find((item: { id: string }) => item.id === id);
  if (result?.status !== "ok") throw new Error(`No successful capture for ${id}; do not reuse an old payload`);
  if (result.params.date && result.params.date !== "20260630") throw new Error("This contract check requires the 20260630 report period");
  return JSON.parse(readFileSync(resolve(root, "payloads", `${id}.json`), "utf8"));
};
const initial = JSON.parse(readFileSync(resolve(root, "coverage.json"), "utf8"));
const universe = load("universe");
const seeds = mergeAkShareSpotRows([], universe).stocks.map((stock) => ({ ...stock, metrics: {} }));
const known = new Set(seeds.map((stock) => stock.code));
const financial = {
  performanceRows: load("performance"), incomeRows: load("income"),
  balanceRows: load("balance"), cashFlowRows: load("cashflow"), reportDate: "20260630"
};
const merged = mergeAkShareFinancialRows(seeds, financial, false);
const fields = [
  "revenue", "netProfit", "operatingCashflow", "totalAssets", "totalLiabilities",
  "inventory", "receivables", "eps", "bps", "roe", "revenueGrowth", "profitGrowth",
  "investmentAssets", "productionAssets", "interestBearingDebt", "nonInterestBearingDebt",
  "currentRatio", "realFinancialReportDisclosureDate"
];
const fieldCoverage = Object.fromEntries(fields.map((field) => [
  field, merged.stocks.filter((stock) => Number.isFinite(stock.metrics[field])).length
]));
const matched = Object.fromEntries(Object.entries(financial)
  .filter(([, rows]) => Array.isArray(rows))
  .map(([key, value]) => {
    const rows = value as Record<string, unknown>[];
    const codes = new Set(rows.map((row) => String(row["股票代码"])));
    return [key, { rows: rows.length, inCurrentUniverse: [...codes].filter((code) => known.has(code)).length }];
  }));
const negativeIncome = financial.incomeRows.find((row) => Number(row["净利润"]) < -100000 && known.has(String(row["股票代码"])));
const stockWithNegativeIncome = merged.stocks.find((stock) => stock.code === negativeIncome?.["股票代码"]);
const sina = initial.cases.find((item: { id: string }) => item.id === "spot-sina");
const spotSample = sina?.sample?.[0];
const normalizedSpot = spotSample ? normalizeAkShareSpotRow(spotSample) : null;
const report = {
  checkedAt: new Date().toISOString(),
  universe: seeds.length,
  financialRows: matched,
  financialMatchedStocks: merged.matchedRows,
  financialFieldCoverage: fieldCoverage,
  valuationReadyWithoutOldCache: merged.stocks.filter(hasRequiredRealValuationData).length,
  spot: spotSample ? {
    firstPassRows: sina.rows,
    firstPassUniqueCodes: sina.unique_codes,
    missingProjectFields: ["总市值", "流通市值", "市盈率", "市净率", "换手率", "60日涨跌幅"].filter((key) => !sina.columns.includes(key)),
    sampleCode: normalizedSpot?.code,
    rawVolume: spotSample["成交量"],
    currentNormalizedVolumeWanShou: normalizedSpot?.volumeWanShou,
    note: "Source-specific share/lot units must be verified before merging Sina quotes.",
  } : { note: "No successful first-pass Sina sample; spot contract cannot be evaluated." },
  negativeProfitCheck: negativeIncome ? {
    code: negativeIncome["股票代码"],
    sourceYuan: negativeIncome["净利润"],
    expectedYi: Number(negativeIncome["净利润"]) / 100000000,
    currentParsedYi: stockWithNegativeIncome?.metrics.netProfit,
    note: "Current magnitude-based amount conversion does not scale negative yuan amounts.",
  } : null,
  sampleStock: merged.stocks.find((stock) => stock.code === "000001"),
};
const output = resolve(root, "project-contract.json");
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
