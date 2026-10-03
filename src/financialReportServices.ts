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

export type AnnualFinancialReportDetailSectionKey = "performance" | "income" | "balance" | "cashFlow";

export interface AnnualFinancialReportDetailItem {
  key: string;
  label: string;
  value?: number;
  unit: "亿元" | "元" | "%" | "倍" | "人";
}

export type AnnualFinancialReportDetails = Record<AnnualFinancialReportDetailSectionKey, AnnualFinancialReportDetailItem[]>;

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
  metrics: Partial<AnnualFinancialReportMetrics>;
  details?: AnnualFinancialReportDetails;
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

const annualReportDetailSectionKeys: AnnualFinancialReportDetailSectionKey[] = ["performance", "income", "balance", "cashFlow"];

function annualReportDetailsFromPayload(value: unknown, index: number): AnnualFinancialReportDetails | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Bun annual report API returned invalid annual report row ${index}: details must be an object`);

  return Object.fromEntries(annualReportDetailSectionKeys.map((section) => {
    const items = value[section];
    if (!Array.isArray(items)) {
      throw new Error(`Bun annual report API returned invalid annual report row ${index}: details.${section} must be an array`);
    }
    return [section, items.map((item, itemIndex) => {
      if (!isRecord(item)) {
        throw new Error(`Bun annual report API returned invalid annual report row ${index}: details.${section}[${itemIndex}] must be an object`);
      }
      if (typeof item.key !== "string" || !item.key.trim() || typeof item.label !== "string" || !item.label.trim()) {
        throw new Error(`Bun annual report API returned invalid annual report row ${index}: details.${section}[${itemIndex}] needs key and label`);
      }
      if (!["亿元", "元", "%", "倍", "人"].includes(String(item.unit))) {
        throw new Error(`Bun annual report API returned invalid annual report row ${index}: details.${section}[${itemIndex}] has invalid unit`);
      }
      if (item.value !== undefined && !isFiniteNumber(item.value)) {
        throw new Error(`Bun annual report API returned invalid annual report row ${index}: details.${section}[${itemIndex}].value must be finite`);
      }
      return item as unknown as AnnualFinancialReportDetailItem;
    })];
  })) as AnnualFinancialReportDetails;
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
    if (row.metrics[field] !== undefined && row.metrics[field] !== null && !isFiniteNumber(row.metrics[field])) {
      throw new Error(`Bun annual report API returned invalid annual report row ${index}: metrics.${field} must be a finite number`);
    }
  }
  const metrics = row.metrics;
  if (!annualReportMetricFields.some((field) => isFiniteNumber(metrics[field]))) {
    throw new Error(`Bun annual report API returned invalid annual report row ${index}: no financial metrics`);
  }
  row.metrics = Object.fromEntries(Object.entries(row.metrics).filter(([, value]) => value !== null));
  row.details = annualReportDetailsFromPayload(row.details, index);
  return row as unknown as AnnualFinancialReport;
}

export function formatAnnualMetric(value: number | undefined, suffix: string, precision = 2) {
  return value === undefined || !Number.isFinite(value) ? "未提供" : `${Number(value.toFixed(precision))}${suffix}`;
}

const annualRequests = new WeakMap<FetchLike, Map<string, Promise<AnnualFinancialReport[]>>>();
export async function buildAnnualFinancialReportsBunFirst(stock: Stock, fetchImpl?: FetchLike): Promise<AnnualFinancialReport[]> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun annual report API unavailable: fetch is not available");
  let active = annualRequests.get(request);
  if (!active) {
    active = new Map();
    annualRequests.set(request, active);
  }
  const key = `${stock.exchange}:${stock.code}`;
  const existing = active.get(key);
  if (existing) return existing;
  const task = requestAnnualReports(stock, request).finally(() => {
    if (active.get(key) === task) active.delete(key);
  });
  active.set(key, task);
  return task;
}

async function requestAnnualReports(stock: Stock, request: FetchLike): Promise<AnnualFinancialReport[]> {
  const response = await request(BUN_ANNUAL_REPORTS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stock: { code: stock.code, name: stock.name, exchange: stock.exchange } }),
    signal: AbortSignal.timeout(60000)
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
