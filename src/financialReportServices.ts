import type { Stock } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const BUN_ANNUAL_REPORTS_URL = "/api/finance/annual-reports";

export type AnnualFinancialReportYear = string;

export const annualFinancialReportYears: AnnualFinancialReportYear[] = [];

export interface AnnualFinancialReportMetrics {
  revenue: number;
  netProfit: number;
  operatingCashflow: number;
  totalAssets: number;
  totalLiabilities: number;
  inventory: number;
  receivables: number;
  eps: number;
  bps: number;
  employeeCount: number;
  grossMargin: number;
  netMargin: number;
  roe: number;
  roa: number;
  revenueGrowth: number;
  profitGrowth: number;
  debtRatio: number;
  currentRatio: number;
  assetTurnover: number;
  dividendYield: number;
  cashProfitRatio: number;
  receivableRevenueRatio: number;
}

export interface AnnualFinancialReport {
  code: string;
  name: string;
  year: AnnualFinancialReportYear;
  periodEnd: string;
  disclosureDate: string;
  reportType: "年度报告";
  currencyUnit: "人民币亿元";
  auditOpinion: string;
  sourceProvider: string;
  sourceFileName: string;
  sourceFileType: "CSV";
  sourceNote: string;
  metrics: AnnualFinancialReportMetrics;
  sourceCsv?: string;
}

export function buildAnnualFinancialReports(_stock: Stock): AnnualFinancialReport[] {
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

const annualReportStringFields: Array<keyof Omit<AnnualFinancialReport, "metrics" | "sourceCsv">> = [
  "code",
  "name",
  "year",
  "periodEnd",
  "disclosureDate",
  "reportType",
  "currencyUnit",
  "auditOpinion",
  "sourceProvider",
  "sourceFileName",
  "sourceFileType",
  "sourceNote"
];

const annualReportMetricFields: Array<keyof AnnualFinancialReportMetrics> = [
  "revenue",
  "netProfit",
  "operatingCashflow",
  "totalAssets",
  "totalLiabilities",
  "inventory",
  "receivables",
  "eps",
  "bps",
  "employeeCount",
  "grossMargin",
  "netMargin",
  "roe",
  "roa",
  "revenueGrowth",
  "profitGrowth",
  "debtRatio",
  "currentRatio",
  "assetTurnover",
  "dividendYield",
  "cashProfitRatio",
  "receivableRevenueRatio"
];

function annualReportFromPayloadRow(row: unknown, index: number): AnnualFinancialReport {
  if (!isRecord(row)) throw new Error(`Bun annual report API returned invalid annual report row ${index}: row must be an object`);
  for (const field of annualReportStringFields) {
    if (typeof row[field] !== "string" || !String(row[field]).trim()) {
      throw new Error(`Bun annual report API returned invalid annual report row ${index}: ${field} must be a non-empty string`);
    }
  }
  if (row.sourceCsv !== undefined && typeof row.sourceCsv !== "string") {
    throw new Error(`Bun annual report API returned invalid annual report row ${index}: sourceCsv must be a string`);
  }
  if (!isRecord(row.metrics)) {
    throw new Error(`Bun annual report API returned invalid annual report row ${index}: metrics must be an object`);
  }
  for (const field of annualReportMetricFields) {
    if (!isFiniteNumber(row.metrics[field])) {
      throw new Error(`Bun annual report API returned invalid annual report row ${index}: metrics.${field} must be a finite number`);
    }
  }
  return row as unknown as AnnualFinancialReport;
}

export async function buildAnnualFinancialReportsBunFirst(stock: Stock, fetchImpl?: FetchLike): Promise<AnnualFinancialReport[]> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun annual report API unavailable: fetch is not available");

  const response = await request(BUN_ANNUAL_REPORTS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stock })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details.trim() ? `: ${details.trim().slice(0, 300)}` : "";
    throw new Error(`Bun annual report API HTTP ${response.status}${suffix}`);
  }
  let reports: unknown;
  try {
    reports = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Bun annual report API returned invalid JSON: ${detail}`);
  }
  if (!Array.isArray(reports)) throw new Error("Bun annual report API returned invalid annual reports");
  return reports.map(annualReportFromPayloadRow);
}

export function buildFinancialReportSourceCsv(report: AnnualFinancialReport) {
  return report.sourceCsv ?? "";
}

export function buildFinancialReportSourceDataUrl(report: AnnualFinancialReport) {
  return `data:text/csv;charset=utf-8,%EF%BB%BF${encodeURIComponent(buildFinancialReportSourceCsv(report))}`;
}
