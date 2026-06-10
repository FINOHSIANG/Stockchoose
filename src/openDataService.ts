import { AKSHARE_AKTOOLS_PROVIDER, AKTOOLS_DEFAULT_BASE_URL, ASHAREHUB_DEFAULT_BASE_URL, ensureInfoSourceSettings, isAkShareProvider, isAshareHubProvider, isLocalProvider, type InfoSourceSettings } from "./integrationServices";
import { marketDataCodeForStock } from "./stockIdentity";
import type { Stock } from "./types";

export interface OpenSourceDataSummary {
  provider: string;
  lastSyncAt?: string;
  matchedRows: number;
  sourceRows: number;
  stockCount: number;
  financeMatchedRows?: number;
  financeSourceRows?: number;
  analystMatchedRows?: number;
  analystSourceRows?: number;
  marginMatchedRows?: number;
  marginSourceRows?: number;
  northHoldMatchedRows?: number;
  northHoldSourceRows?: number;
  technicalMatchedRows?: number;
  technicalSourceRows?: number;
  valuationReadyRows?: number;
  details: string;
}

export interface OpenSourceSyncResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
  stocks: Stock[];
  summary: OpenSourceDataSummary;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AkShareRow = Record<string, unknown>;

interface AkShareRowsFetchResult {
  rows: AkShareRow[];
  reportDate?: string;
  errorDetail?: string;
}

interface AkShareFinancialRows {
  performanceRows: AkShareRow[];
  incomeRows: AkShareRow[];
  balanceRows: AkShareRow[];
  cashFlowRows: AkShareRow[];
  reportDate?: string;
  metricRows?: RustFinancialMetricRow[];
  errorDetail?: string;
}

interface AkShareMarketRowsFetchResult {
  rows: AkShareRow[];
  endpoint: string;
  errorDetail?: string;
}

interface RustFinancialMetricRow {
  code?: unknown;
  name?: unknown;
  reportDate?: unknown;
  sourceRows?: unknown;
  metrics?: Record<string, unknown>;
}

type RustAnalystForecastRow = RustFinancialMetricRow;
type RustMarginBalanceRow = RustFinancialMetricRow;
type RustNorthHoldingRow = RustFinancialMetricRow;
type RustTechnicalIndicatorRow = RustFinancialMetricRow;

const AKSHARE_SPOT_ENDPOINTS = ["stock_zh_a_spot_em", "stock_zh_a_spot"] as const;
const RUST_NATIVE_API_BASE_URL = "/api";
const RUST_AKTOOLS_ROWS_URL = "/api/integration/aktools/rows";
const RUST_ASHAREHUB_ROWS_URL = "/api/integration/asharehub/rows";
const LISTED_ASHARE_CODE_PATTERN = /^(60[0-5]|688|689|000|001|002|003|300|301|302|920)\d{3}$/;
const TECHNICAL_INDICATOR_CODE_LIMIT = 200;
const TECHNICAL_INDICATOR_KLINE_LIMIT = 120;
const ASHAREHUB_SYNC_LIMIT = "6000";
const ASHAREHUB_FINANCE_LIMIT = "8000";

export const defaultOpenSourceDataSummary: OpenSourceDataSummary = {
  provider: "未接入真实数据",
  matchedRows: 0,
  sourceRows: 0,
  stockCount: 0,
  details: "尚未同步真实数据"
};

const normalizeFieldName = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

const rowValue = (row: AkShareRow, keys: string[]) => {
  const exact = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  if (exact !== undefined && exact !== null) return exact;

  const normalizedKeys = keys.map(normalizeFieldName).filter(Boolean);
  const matched = Object.entries(row).find(([key, item]) => {
    if (item === undefined || item === null || String(item).trim() === "") return false;
    const normalizedKey = normalizeFieldName(key);
    return normalizedKeys.some((target) => normalizedKey === target || normalizedKey.includes(target));
  });
  return matched?.[1];
};

const textValue = (row: AkShareRow, keys: string[]) => {
  const value = rowValue(row, keys);
  return value === undefined || value === null ? "" : String(value).trim();
};

const parseNumber = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const normalized = String(value).replace(/[,，%％亿元萬万]/g, "").trim();
  if (!normalized || normalized === "-" || normalized === "--") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const numberValue = (row: AkShareRow, keys: string[]) => parseNumber(rowValue(row, keys));

const amountToYi = (value: number | undefined) => {
  if (value === undefined) return undefined;
  return value > 100000 ? value / 100000000 : value;
};

const amountValueYi = (row: AkShareRow, keys: string[]) => {
  const raw = rowValue(row, keys);
  const value = parseNumber(raw);
  if (value === undefined) return undefined;
  const text = typeof raw === "string" ? raw : "";
  if (text.includes("万") || text.includes("萬")) return value / 10000;
  if (text.includes("亿")) return value;
  return amountToYi(value);
};

const volumeToWanShou = (value: number | undefined) => {
  if (value === undefined) return undefined;
  return value > 10000 ? value / 10000 : value;
};

const round = (value: number, precision = 2) => {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const withMetric = (metrics: Record<string, number>, key: string, value: number | undefined, precision = 2) => {
  if (value === undefined || !Number.isFinite(value)) return metrics;
  return { ...metrics, [key]: round(value, precision) };
};

const firstDefined = (...values: Array<number | undefined>) => values.find((value) => value !== undefined && Number.isFinite(value));

const sumDefined = (values: Array<number | undefined>) => {
  const validValues = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (!validValues.length) return undefined;
  return validValues.reduce((sum, value) => sum + value, 0);
};

const safeRatio = (numerator: number | undefined, denominator: number | undefined, scale = 100) => {
  if (numerator === undefined || denominator === undefined || !Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 0.01) {
    return undefined;
  }
  return numerator / denominator * scale;
};

const parseDateNumber = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return undefined;
  const parsed = Number(digits.slice(0, 8));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const dateFromDateNumber = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const text = String(Math.trunc(value)).padStart(8, "0");
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
};

const listingDaysFromDateNumber = (value: number | undefined, now = new Date()) => {
  const listedAt = dateFromDateNumber(value);
  if (!listedAt) return undefined;
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const days = Math.floor((today.getTime() - listedAt.getTime()) / 86_400_000) + 1;
  return Number.isFinite(days) ? Math.max(1, days) : undefined;
};

const newStockScore = (listingDays: number | undefined, turnover: number | undefined, pctChange: number | undefined, amountYi: number | undefined) => {
  if (listingDays === undefined || !Number.isFinite(listingDays)) return undefined;
  const ageScore = clamp(100 - Math.max(0, listingDays - 1) / 3, 0, 100);
  const turnoverScore = clamp(turnover ?? 0, 0, 50) * 0.8;
  const heatScore = clamp(pctChange ?? 0, -20, 30) * 0.45;
  const amountScore = clamp(amountYi ?? 0, 0, 100) * 0.12;
  return clamp(ageScore + turnoverScore + heatScore + amountScore, 0, 100);
};

const rowDateNumber = (row: AkShareRow | undefined, keys: string[]) => parseDateNumber(rowValue(row ?? {}, keys));
const isAnnualReportDate = (value: number | undefined) => value !== undefined && value % 10000 === 1231;

const codeFromAkShareRow = (row: AkShareRow) =>
  textValue(row, ["股票代码", "证券代码", "代码", "SECURITY_CODE", "SECURITYCODE", "code", "symbol", "ts_code", "浠ｇ爜"]).replace(/\D/g, "").padStart(6, "0").slice(-6);

function rowsByCode(rows: AkShareRow[]) {
  const map = new Map<string, AkShareRow>();
  rows.forEach((row) => {
    const code = codeFromAkShareRow(row);
    if (code && !map.has(code)) map.set(code, row);
  });
  return map;
}

function valuationReady(stock: Stock) {
  return [
    "price",
    "marketCap",
    "eps",
    "bps",
    "revenue",
    "netProfit",
    "operatingCashflow",
    "totalAssets",
    "totalLiabilities",
    "investmentAssets",
    "productionAssets",
    "interestBearingDebt",
    "nonInterestBearingDebt"
  ].every((key) => Number.isFinite(stock.metrics[key]) && (["price", "marketCap", "totalAssets"].includes(key) ? stock.metrics[key] > 0 : true));
}

function stockShellFromAkShareRow(row: NonNullable<ReturnType<typeof normalizeAkShareSpotRow>>): Stock {
  const exchange = row.code.startsWith("6") ? "沪市" : row.code.startsWith("8") || row.code.startsWith("4") || row.code.startsWith("9") ? "北交所" : "深市";
  const board = row.code.startsWith("688") ? "科创板" : row.code.startsWith("300") || row.code.startsWith("301") ? "创业板" : exchange === "北交所" ? "北交所" : "主板";
  return {
    code: row.code,
    name: row.name || row.code,
    exchange,
    board,
    industry1: "未分类",
    industry2: "未分类",
    region: "未分类",
    property: "民企",
    isST: row.name.includes("ST"),
    isSuspended: false,
    isSTAR: board === "科创板",
    isMargin: false,
    indexes: [],
    metrics: {}
  };
}

export function normalizeAkShareSpotRow(row: AkShareRow, now = new Date()) {
  const code = codeFromAkShareRow(row);
  const name = textValue(row, ["名称", "股票简称", "简称", "name", "鍚嶇О"]);
  if (!code) return null;
  const pctChange = numberValue(row, ["涨跌幅", "pctChange", "changePercent", "濞戙劏绌奸獮?"]);
  const amountYi = amountValueYi(row, ["成交额", "amount", "turnoverAmount", "閹存劒姘︽０?"]);
  const turnover = numberValue(row, ["换手率", "turnover", "turnoverRate", "閹广垺澧滈悳?"]);
  const listingDate = parseDateNumber(rowValue(row, ["listingDate", "上市日期", "上市时间"]));
  const listingDays = listingDaysFromDateNumber(listingDate, now);
  return {
    code,
    name,
    price: numberValue(row, ["最新价", "收盘", "close", "price", "latest", "鏈€鏂颁环", "鏀剁洏"]),
    pctChange,
    amountYi,
    volumeWanShou: volumeToWanShou(numberValue(row, ["成交量", "volume", "鎴愪氦閲?"])),
    turnover,
    marketCapYi: amountValueYi(row, ["总市值", "marketCap", "totalMarketCap", "鎬诲競鍊?"]),
    floatMarketCapYi: amountValueYi(row, ["流通市值", "floatMarketCap", "circulatingMarketCap", "娴侀€氬競鍊?"]),
    pe: numberValue(row, ["市盈率-动态", "市盈率", "pe", "peDynamic", "甯傜泩鐜?鍔ㄦ€?", "甯傜泩鐜?"]),
    pb: numberValue(row, ["市净率", "pb", "甯傚噣鐜?"]),
    amplitude: numberValue(row, ["振幅", "amplitude", "鎸箙"]),
    momentum60: numberValue(row, ["60日涨跌幅", "60日涨幅", "momentum60", "changePct60", "changePercent60"]),
    netInflowYi: amountValueYi(row, ["netInflow", "mainNetInflow", "主力净流入"]),
    netInflowRatio: numberValue(row, ["netInflowRatio", "mainNetInflowRatio", "主力净占比"]),
    listingDate,
    listingDays,
    newStockScore: newStockScore(listingDays, turnover, pctChange, amountYi)
  };
}

type NormalizedAkShareStockRow = NonNullable<ReturnType<typeof normalizeAkShareSpotRow>>;

function addStockIdentityKeys(keys: Set<string>, stock: Pick<Stock, "code" | "exchange">) {
  keys.add(stock.code);
  keys.add(marketDataCodeForStock(stock));
}

function expandStocksFromAkShareRows(baseStocks: Stock[], rows: NormalizedAkShareStockRow[], listedAshareOnly = false) {
  const knownCodes = new Set<string>();
  baseStocks.forEach((stock) => addStockIdentityKeys(knownCodes, stock));

  const appendedStocks: Stock[] = [];
  rows.forEach((row) => {
    if (listedAshareOnly && !LISTED_ASHARE_CODE_PATTERN.test(row.code)) return;
    if (knownCodes.has(row.code)) return;
    const stock = stockShellFromAkShareRow(row);
    appendedStocks.push(stock);
    addStockIdentityKeys(knownCodes, stock);
  });

  return [...baseStocks, ...appendedStocks];
}

export function mergeAkShareSpotRows(baseStocks: Stock[], rows: AkShareRow[], now = new Date()) {
  const normalizedRows = rows.map((row) => normalizeAkShareSpotRow(row, now)).filter((row): row is NonNullable<ReturnType<typeof normalizeAkShareSpotRow>> => Boolean(row));
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const sourceStocks = expandStocksFromAkShareRows(baseStocks, normalizedRows);
  const stocks = sourceStocks.map((stock) => {
    const row = rowByCode.get(stock.code) ?? rowByCode.get(marketDataCodeForStock(stock));
    if (!row) return stock;
    matchedRows += 1;

    let metrics = { ...stock.metrics };
    metrics = withMetric(metrics, "price", row.price);
    metrics = withMetric(metrics, "pctChange", row.pctChange);
    metrics = withMetric(metrics, "relativeChange", row.pctChange === undefined ? undefined : row.pctChange - 0.25);
    metrics = withMetric(metrics, "amount", row.amountYi);
    metrics = withMetric(metrics, "volume", row.volumeWanShou);
    metrics = withMetric(metrics, "turnover", row.turnover);
    metrics = withMetric(metrics, "marketCap", row.marketCapYi);
    metrics = withMetric(metrics, "floatMarketCap", row.floatMarketCapYi);
    metrics = withMetric(metrics, "pe", row.pe);
    metrics = withMetric(metrics, "pb", row.pb);
    metrics = withMetric(metrics, "priceAmplitude", row.amplitude);
    metrics = withMetric(metrics, "momentum60", row.momentum60);
    metrics = withMetric(metrics, "netInflow", row.netInflowYi);
    metrics = withMetric(metrics, "netInflowRatio", row.netInflowRatio);
    metrics = withMetric(metrics, "listingDate", row.listingDate, 0);
    metrics = withMetric(metrics, "listingDays", row.listingDays, 0);
    metrics = withMetric(metrics, "newStockScore", row.newStockScore);
    metrics = withMetric(metrics, "limitFlag", row.pctChange === undefined ? undefined : row.pctChange >= 9.8 ? 1 : row.pctChange <= -9.8 ? -1 : 0, 0);
    metrics = withMetric(metrics, "min15Momentum", row.pctChange === undefined ? undefined : row.pctChange / 4);
    metrics = withMetric(metrics, "intradayStrength", row.pctChange === undefined ? undefined : Math.max(0, Math.min(100, 50 + row.pctChange * 4)));
    metrics = withMetric(metrics, "realQuoteSource", 1, 0);
    metrics = withMetric(metrics, "openSourceMarketSource", 1, 0);

    return {
      ...stock,
      name: row.name && row.name !== row.code ? row.name : stock.name,
      metrics
    };
  });

  return {
    stocks,
    matchedRows,
    sourceRows: normalizedRows.length
  };
}

interface NormalizedRustFinancialMetricRow {
  code: string;
  name: string;
  reportDate?: string;
  sourceRows: number;
  metrics: Record<string, number>;
}

function normalizeRustFinancialMetricRow(row: RustFinancialMetricRow): NormalizedRustFinancialMetricRow | null {
  const digits = String(row.code ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const code = digits.padStart(6, "0").slice(-6);
  const rawMetrics = row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics) ? row.metrics : {};
  const metrics = Object.entries(rawMetrics).reduce<Record<string, number>>((result, [key, value]) => {
    const parsed = parseNumber(value);
    if (parsed !== undefined) result[key] = parsed;
    return result;
  }, {});
  if (!Object.keys(metrics).length) return null;
  return {
    code,
    name: String(row.name ?? code).trim() || code,
    reportDate: row.reportDate === undefined || row.reportDate === null ? undefined : String(row.reportDate),
    sourceRows: Math.max(1, Math.round(parseNumber(row.sourceRows) ?? 1)),
    metrics
  };
}

function stockShellFromFinancialMetricRow(row: NormalizedRustFinancialMetricRow): Stock {
  const exchange = row.code.startsWith("6") ? "沪市" : row.code.startsWith("8") || row.code.startsWith("4") || row.code.startsWith("9") ? "北交所" : "深市";
  const board = row.code.startsWith("688") ? "科创板" : row.code.startsWith("300") || row.code.startsWith("301") ? "创业板" : exchange === "北交所" ? "北交所" : "主板";
  return {
    code: row.code,
    name: row.name,
    exchange,
    board,
    industry1: "未分类",
    industry2: "未分类",
    region: "未分类",
    property: "民企",
    isST: row.name.includes("ST"),
    isSuspended: false,
    isSTAR: board === "科创板",
    isMargin: false,
    indexes: [],
    metrics: {}
  };
}

function expandStocksFromRustFinancialRows(baseStocks: Stock[], rows: NormalizedRustFinancialMetricRow[], listedAshareOnly = false) {
  const knownCodes = new Set<string>();
  baseStocks.forEach((stock) => addStockIdentityKeys(knownCodes, stock));

  const appendedStocks: Stock[] = [];
  rows.forEach((row) => {
    if (listedAshareOnly && !LISTED_ASHARE_CODE_PATTERN.test(row.code)) return;
    if (knownCodes.has(row.code)) return;
    const stock = stockShellFromFinancialMetricRow(row);
    appendedStocks.push(stock);
    addStockIdentityKeys(knownCodes, stock);
  });

  return [...baseStocks, ...appendedStocks];
}

const metricPrecision = (key: string) =>
  key.startsWith("real") || key.endsWith("Date") || key.endsWith("Source") || key.endsWith("Count") || key.endsWith("Shares") ? 0 : 2;

export function mergeRustFinancialMetricRows(stocks: Stock[], rows: RustFinancialMetricRow[], expandUniverse = true, fallbackReportDate?: string) {
  const normalizedRows = rows.map(normalizeRustFinancialMetricRow).filter((row): row is NormalizedRustFinancialMetricRow => Boolean(row));
  const sourceStocks = expandUniverse ? expandStocksFromRustFinancialRows(stocks, normalizedRows, true) : stocks;
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const mergedStocks = sourceStocks.map((stock) => {
    const code = marketDataCodeForStock(stock);
    const row = rowByCode.get(stock.code) ?? rowByCode.get(code);
    if (!row) return stock;

    let metrics = { ...stock.metrics };
    Object.entries(row.metrics).forEach(([key, value]) => {
      metrics = withMetric(metrics, key, value, metricPrecision(key));
    });
    if (metrics.realAnnualReportSource === 1) matchedRows += 1;

    return {
      ...stock,
      name: row.name && row.name !== row.code ? row.name : stock.name,
      metrics
    };
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: normalizedRows.reduce((sum, row) => sum + row.sourceRows, 0),
    reportDate: normalizedRows.find((row) => row.reportDate)?.reportDate ?? fallbackReportDate
  };
}

export function mergeRustAnalystForecastRows(stocks: Stock[], rows: RustAnalystForecastRow[], expandUniverse = false) {
  const normalizedRows = rows.map(normalizeRustFinancialMetricRow).filter((row): row is NormalizedRustFinancialMetricRow => Boolean(row));
  const sourceStocks = expandUniverse ? expandStocksFromRustFinancialRows(stocks, normalizedRows, true) : stocks;
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const mergedStocks = sourceStocks.map((stock) => {
    const code = marketDataCodeForStock(stock);
    const row = rowByCode.get(stock.code) ?? rowByCode.get(code);
    if (!row) return stock;

    let metrics = { ...stock.metrics };
    Object.entries(row.metrics).forEach(([key, value]) => {
      metrics = withMetric(metrics, key, value, metricPrecision(key));
    });
    const targetPrice = firstDefined(metrics.targetPriceMid, metrics.targetPriceHigh, metrics.targetPriceLow);
    const currentPrice = firstDefined(metrics.price, stock.metrics.price);
    metrics = withMetric(
      metrics,
      "targetUpside",
      targetPrice !== undefined && currentPrice !== undefined ? (targetPrice / currentPrice - 1) * 100 : undefined
    );
    if (metrics.realAnalystForecastSource === 1) matchedRows += 1;

    return {
      ...stock,
      name: row.name && row.name !== row.code ? row.name : stock.name,
      metrics
    };
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: normalizedRows.reduce((sum, row) => sum + row.sourceRows, 0),
    reportDate: normalizedRows.find((row) => row.reportDate)?.reportDate
  };
}

const incomeRevenueKeys = ["营业总收入", "营业收入", "营收", "OPERATE_INCOME", "TOTAL_OPERATE_INCOME"];
const incomeNetProfitKeys = ["归属于母公司股东的净利润", "归母净利润", "净利润", "NETPROFIT", "PARENT_NETPROFIT"];
const incomeCostKeys = ["营业总成本", "营业成本", "OPERATE_COST", "TOTAL_OPERATE_COST"];
const cashFlowKeys = ["经营活动产生的现金流量净额", "经营现金流量净额", "经营现金流", "NETCASH_OPERATE", "NET_CASH_FLOWS_OPERATE"];
const totalAssetsKeys = ["资产总计", "总资产", "TOTAL_ASSETS"];
const totalLiabilitiesKeys = ["负债合计", "总负债", "TOTAL_LIABILITIES"];
const inventoryKeys = ["存货", "INVENTORY"];
const receivablesKeys = ["应收账款", "ACCOUNTS_RECE"];
const currentAssetsKeys = ["流动资产合计", "TOTAL_CURRENT_ASSETS"];
const currentLiabilitiesKeys = ["流动负债合计", "TOTAL_CURRENT_LIAB"];
const moneyAssetKeys = ["货币资金", "MONETARYFUNDS"];
const tradingAssetKeys = ["交易性金融资产", "TRADING_FINANCIAL_ASSETS"];
const availableSaleAssetKeys = ["可供出售金融资产", "AVAILABLE_SALE_FINASSET"];
const longEquityAssetKeys = ["长期股权投资", "LONG_EQUITY_INVEST"];
const shortDebtKeys = ["短期借款", "SHORT_LOAN"];
const longDebtKeys = ["长期借款", "LONG_LOAN"];
const bondDebtKeys = ["应付债券", "BOND_PAYABLE"];
const nonCurrentDebtDueKeys = ["一年内到期的非流动负债", "NONCURRENT_LIAB_1YEAR"];

export function mergeRustMarginBalanceRows(stocks: Stock[], rows: RustMarginBalanceRow[], expandUniverse = false) {
  const normalizedRows = rows.map(normalizeRustFinancialMetricRow).filter((row): row is NormalizedRustFinancialMetricRow => Boolean(row));
  const sourceStocks = expandUniverse ? expandStocksFromRustFinancialRows(stocks, normalizedRows, true) : stocks;
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const mergedStocks = sourceStocks.map((stock) => {
    const code = marketDataCodeForStock(stock);
    const row = rowByCode.get(stock.code) ?? rowByCode.get(code);
    if (!row) return stock;

    let metrics = { ...stock.metrics };
    Object.entries(row.metrics).forEach(([key, value]) => {
      metrics = withMetric(metrics, key, value, metricPrecision(key));
    });
    const hasMarginData = metrics.realMarginSource === 1;
    if (hasMarginData) matchedRows += 1;

    return {
      ...stock,
      name: row.name && row.name !== row.code ? row.name : stock.name,
      isMargin: hasMarginData ? true : stock.isMargin,
      metrics
    };
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: normalizedRows.reduce((sum, row) => sum + row.sourceRows, 0),
    reportDate: normalizedRows.find((row) => row.reportDate)?.reportDate
  };
}

export function mergeRustNorthHoldingRows(stocks: Stock[], rows: RustNorthHoldingRow[], expandUniverse = false) {
  const normalizedRows = rows.map(normalizeRustFinancialMetricRow).filter((row): row is NormalizedRustFinancialMetricRow => Boolean(row));
  const sourceStocks = expandUniverse ? expandStocksFromRustFinancialRows(stocks, normalizedRows, true) : stocks;
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const mergedStocks = sourceStocks.map((stock) => {
    const code = marketDataCodeForStock(stock);
    const row = rowByCode.get(stock.code) ?? rowByCode.get(code);
    if (!row) return stock;

    let metrics = { ...stock.metrics };
    Object.entries(row.metrics).forEach(([key, value]) => {
      metrics = withMetric(metrics, key, value, metricPrecision(key));
    });
    if (metrics.realNorthHoldSource === 1) matchedRows += 1;

    return {
      ...stock,
      name: row.name && row.name !== row.code ? row.name : stock.name,
      metrics
    };
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: normalizedRows.reduce((sum, row) => sum + row.sourceRows, 0),
    reportDate: normalizedRows.find((row) => row.reportDate)?.reportDate
  };
}

export function mergeRustTechnicalIndicatorRows(stocks: Stock[], rows: RustTechnicalIndicatorRow[], expandUniverse = false) {
  const normalizedRows = rows.map(normalizeRustFinancialMetricRow).filter((row): row is NormalizedRustFinancialMetricRow => Boolean(row));
  const sourceStocks = expandUniverse ? expandStocksFromRustFinancialRows(stocks, normalizedRows, true) : stocks;
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const mergedStocks = sourceStocks.map((stock) => {
    const code = marketDataCodeForStock(stock);
    const row = rowByCode.get(stock.code) ?? rowByCode.get(code);
    if (!row) return stock;

    let metrics = { ...stock.metrics };
    Object.entries(row.metrics).forEach(([key, value]) => {
      metrics = withMetric(metrics, key, value, metricPrecision(key));
    });
    if (metrics.realTechnicalSource === 1) matchedRows += 1;

    return {
      ...stock,
      name: row.name || stock.name,
      metrics
    };
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: normalizedRows.reduce((sum, row) => sum + row.sourceRows, 0),
    reportDate: normalizedRows.find((row) => row.reportDate)?.reportDate
  };
}

function mergeFinancialMetrics(
  stock: Stock,
  performance: AkShareRow | undefined,
  income: AkShareRow | undefined,
  balance: AkShareRow | undefined,
  cashFlow: AkShareRow | undefined,
  reportDate?: string
) {
  const revenue = firstDefined(amountValueYi(income ?? {}, incomeRevenueKeys), amountValueYi(performance ?? {}, incomeRevenueKeys));
  const netProfit = firstDefined(amountValueYi(income ?? {}, incomeNetProfitKeys), amountValueYi(performance ?? {}, incomeNetProfitKeys));
  const operatingCashflow = amountValueYi(cashFlow ?? {}, cashFlowKeys);
  const totalAssets = amountValueYi(balance ?? {}, totalAssetsKeys);
  const totalLiabilities = amountValueYi(balance ?? {}, totalLiabilitiesKeys);
  const inventory = amountValueYi(balance ?? {}, inventoryKeys);
  const receivables = amountValueYi(balance ?? {}, receivablesKeys);
  const currentAssets = amountValueYi(balance ?? {}, currentAssetsKeys);
  const currentLiabilities = amountValueYi(balance ?? {}, currentLiabilitiesKeys);
  const operatingCost = firstDefined(amountValueYi(income ?? {}, incomeCostKeys), amountValueYi(performance ?? {}, incomeCostKeys));
  const netAssets = totalAssets !== undefined && totalLiabilities !== undefined ? totalAssets - totalLiabilities : undefined;
  const epsFromPerformance = numberValue(performance ?? {}, ["基本每股收益", "每股收益", "EPS"]);
  const bpsFromPerformance = numberValue(performance ?? {}, ["每股净资产", "BPS"]);
  const shareBaseFromMarket = stock.metrics.marketCap && stock.metrics.price ? stock.metrics.marketCap / Math.max(stock.metrics.price, 0.01) : undefined;
  const shareBaseFromEps = netProfit !== undefined && epsFromPerformance !== undefined && Math.abs(epsFromPerformance) > 0.0001 ? netProfit / epsFromPerformance : undefined;
  const shareBase = firstDefined(shareBaseFromMarket, shareBaseFromEps);
  const derivedPrice = stock.metrics.price ?? (stock.metrics.marketCap && shareBase ? stock.metrics.marketCap / shareBase : undefined);
  const eps = firstDefined(epsFromPerformance, shareBase ? safeRatio(netProfit, shareBase, 1) : undefined);
  const bps = firstDefined(bpsFromPerformance, shareBase ? safeRatio(netAssets, shareBase, 1) : undefined);
  const roe = firstDefined(numberValue(performance ?? {}, ["净资产收益率", "ROE"]), safeRatio(netProfit, netAssets));
  const roa = firstDefined(numberValue(performance ?? {}, ["总资产收益率", "ROA"]), safeRatio(netProfit, totalAssets));
  const grossMargin = firstDefined(numberValue(performance ?? {}, ["销售毛利率", "毛利率", "GROSS_PROFIT_RATIO"]), revenue !== undefined && operatingCost !== undefined ? safeRatio(revenue - operatingCost, revenue) : undefined);
  const netMargin = firstDefined(numberValue(performance ?? {}, ["销售净利率", "净利率", "NET_PROFIT_RATIO"]), safeRatio(netProfit, revenue));
  const revenueGrowth = numberValue(performance ?? {}, ["营业总收入同比增长", "营业收入同比增长", "营收同比", "营业收入增长率", "TOTAL_OPERATE_INCOME_YOY"]);
  const profitGrowth = numberValue(performance ?? {}, ["净利润同比增长", "归母净利润同比增长", "净利润增长率", "NETPROFIT_YOY"]);
  const debtRatio = firstDefined(numberValue(performance ?? {}, ["资产负债率", "DEBT_ASSET_RATIO"]), safeRatio(totalLiabilities, totalAssets));
  const currentRatio = currentAssets !== undefined && currentLiabilities !== undefined ? safeRatio(currentAssets, currentLiabilities, 1) : undefined;
  const assetTurnover = safeRatio(revenue, totalAssets, 1);
  const investmentAssets = firstDefined(
    amountValueYi(balance ?? {}, ["投资性资产", "INVESTMENT_ASSETS"]),
    sumDefined([
      amountValueYi(balance ?? {}, moneyAssetKeys),
      amountValueYi(balance ?? {}, tradingAssetKeys),
      amountValueYi(balance ?? {}, availableSaleAssetKeys),
      amountValueYi(balance ?? {}, longEquityAssetKeys)
    ])
  );
  const productionAssets = totalAssets !== undefined && investmentAssets !== undefined ? Math.max(totalAssets - investmentAssets, 0) : undefined;
  const interestBearingDebt = firstDefined(
    amountValueYi(balance ?? {}, ["有息负债", "INTEREST_BEARING_DEBT"]),
    sumDefined([
      amountValueYi(balance ?? {}, shortDebtKeys),
      amountValueYi(balance ?? {}, longDebtKeys),
      amountValueYi(balance ?? {}, bondDebtKeys),
      amountValueYi(balance ?? {}, nonCurrentDebtDueKeys)
    ])
  );
  const nonInterestBearingDebt = totalLiabilities !== undefined && interestBearingDebt !== undefined ? Math.max(totalLiabilities - interestBearingDebt, 0) : undefined;
  const reportDateNumber = parseDateNumber(reportDate);
  const disclosureDateNumber = firstDefined(
    rowDateNumber(performance, ["披露日期", "公告日期", "NOTICE_DATE"]),
    rowDateNumber(income, ["披露日期", "公告日期", "NOTICE_DATE"]),
    rowDateNumber(balance, ["披露日期", "公告日期", "NOTICE_DATE"]),
    rowDateNumber(cashFlow, ["披露日期", "公告日期", "NOTICE_DATE"]),
    reportDateNumber
  );

  let metrics = { ...stock.metrics };
  metrics = withMetric(metrics, "price", derivedPrice);
  metrics = withMetric(metrics, "revenue", revenue);
  metrics = withMetric(metrics, "netProfit", netProfit);
  metrics = withMetric(metrics, "operatingCashflow", operatingCashflow);
  metrics = withMetric(metrics, "totalAssets", totalAssets);
  metrics = withMetric(metrics, "totalLiabilities", totalLiabilities);
  metrics = withMetric(metrics, "inventory", inventory);
  metrics = withMetric(metrics, "receivables", receivables);
  metrics = withMetric(metrics, "eps", eps);
  metrics = withMetric(metrics, "bps", bps);
  metrics = withMetric(metrics, "roe", roe);
  metrics = withMetric(metrics, "roa", roa);
  metrics = withMetric(metrics, "grossMargin", grossMargin);
  metrics = withMetric(metrics, "netMargin", netMargin);
  metrics = withMetric(metrics, "revenueGrowth", revenueGrowth);
  metrics = withMetric(metrics, "profitGrowth", profitGrowth);
  metrics = withMetric(metrics, "debtRatio", debtRatio);
  metrics = withMetric(metrics, "currentRatio", currentRatio);
  metrics = withMetric(metrics, "assetTurnover", assetTurnover);
  metrics = withMetric(metrics, "investmentAssets", investmentAssets);
  metrics = withMetric(metrics, "productionAssets", productionAssets);
  metrics = withMetric(metrics, "interestBearingDebt", interestBearingDebt);
  metrics = withMetric(metrics, "nonInterestBearingDebt", nonInterestBearingDebt);
  metrics = withMetric(metrics, "qualityScore", roe !== undefined && netMargin !== undefined && debtRatio !== undefined ? clamp(roe * 1.5 + netMargin * 0.8 - debtRatio * 0.2 + 50, 0, 100) : undefined);

  const hasReportData = [revenue, netProfit, operatingCashflow, totalAssets, totalLiabilities].some((value) => value !== undefined && Number.isFinite(value));
  metrics = withMetric(metrics, "realAnnualReportSource", hasReportData ? 1 : undefined, 0);
  metrics = withMetric(metrics, "realFinancialReportDate", hasReportData ? reportDateNumber : undefined, 0);
  metrics = withMetric(metrics, "realFinancialReportDisclosureDate", hasReportData ? disclosureDateNumber : undefined, 0);
  metrics = withMetric(metrics, "realAnnualReportDate", hasReportData && isAnnualReportDate(reportDateNumber) ? reportDateNumber : undefined, 0);
  metrics = withMetric(metrics, "realAnnualReportDisclosureDate", hasReportData && isAnnualReportDate(reportDateNumber) ? disclosureDateNumber : undefined, 0);

  return {
    ...stock,
    metrics
  };
}

export function mergeAkShareFinancialRows(stocks: Stock[], rows: AkShareFinancialRows, expandUniverse = true) {
  if (rows.metricRows?.length) {
    return mergeRustFinancialMetricRows(stocks, rows.metricRows, expandUniverse, rows.reportDate);
  }

  const sourceStocks = expandUniverse
    ? expandStocksFromAkShareRows(stocks, [
      ...rows.performanceRows,
      ...rows.incomeRows,
      ...rows.balanceRows,
      ...rows.cashFlowRows
    ].map((row) => normalizeAkShareSpotRow(row)).filter((row): row is NormalizedAkShareStockRow => Boolean(row)), true)
    : stocks;
  const performanceByCode = rowsByCode(rows.performanceRows);
  const incomeByCode = rowsByCode(rows.incomeRows);
  const balanceByCode = rowsByCode(rows.balanceRows);
  const cashFlowByCode = rowsByCode(rows.cashFlowRows);
  let matchedRows = 0;

  const mergedStocks = sourceStocks.map((stock) => {
    const code = marketDataCodeForStock(stock);
    const performance = performanceByCode.get(stock.code) ?? performanceByCode.get(code);
    const income = incomeByCode.get(stock.code) ?? incomeByCode.get(code);
    const balance = balanceByCode.get(stock.code) ?? balanceByCode.get(code);
    const cashFlow = cashFlowByCode.get(stock.code) ?? cashFlowByCode.get(code);
    if (!performance && !income && !balance && !cashFlow) return stock;

    const merged = mergeFinancialMetrics(stock, performance, income, balance, cashFlow, rows.reportDate);
    if (merged.metrics.realAnnualReportSource === 1) matchedRows += 1;
    return merged;
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: rows.performanceRows.length + rows.incomeRows.length + rows.balanceRows.length + rows.cashFlowRows.length,
    reportDate: rows.reportDate
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function responseJson(response: Response, label: string) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${errorMessage(error)}`);
  }
}

function requireObjectRows<T>(rows: unknown, label: string): T[] {
  if (!Array.isArray(rows)) throw new Error(`${label} returned invalid payload: expected row array`);
  const invalidIndex = rows.findIndex((row) => !isRecord(row));
  if (invalidIndex >= 0) throw new Error(`${label} returned invalid payload: row ${invalidIndex} must be an object`);
  return rows as T[];
}

function payloadRows(payload: unknown, label: string): unknown {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  throw new Error(`${label} returned invalid payload: expected an array or { data: [] }`);
}

function rowsFromPayload(payload: unknown, label: string): AkShareRow[] {
  return requireObjectRows<AkShareRow>(payloadRows(payload, label), label);
}

function rustFinancialMetricRowsFromPayload(payload: unknown, label: string): RustFinancialMetricRow[] {
  return requireObjectRows<RustFinancialMetricRow>(payloadRows(payload, label), label);
}

function rustAnalystForecastRowsFromPayload(payload: unknown, label: string): RustAnalystForecastRow[] {
  return requireObjectRows<RustAnalystForecastRow>(payloadRows(payload, label), label);
}

function rustMarginBalanceRowsFromPayload(payload: unknown, label: string): RustMarginBalanceRow[] {
  return requireObjectRows<RustMarginBalanceRow>(payloadRows(payload, label), label);
}

function rustNorthHoldingRowsFromPayload(payload: unknown, label: string): RustNorthHoldingRow[] {
  return requireObjectRows<RustNorthHoldingRow>(payloadRows(payload, label), label);
}

function rustTechnicalIndicatorRowsFromPayload(payload: unknown, label: string): RustTechnicalIndicatorRow[] {
  return requireObjectRows<RustTechnicalIndicatorRow>(payloadRows(payload, label), label);
}

function financialStatementRowsFromPayload(payload: unknown, reportDate: string): AkShareFinancialRows {
  if (!isRecord(payload)) throw new Error("Rust native financial statement API returned invalid payload: root must be an object");
  return {
    performanceRows: requireObjectRows<AkShareRow>(payload.performanceRows, "Rust native financial statement API performanceRows"),
    incomeRows: requireObjectRows<AkShareRow>(payload.incomeRows, "Rust native financial statement API incomeRows"),
    balanceRows: requireObjectRows<AkShareRow>(payload.balanceRows, "Rust native financial statement API balanceRows"),
    cashFlowRows: requireObjectRows<AkShareRow>(payload.cashFlowRows, "Rust native financial statement API cashFlowRows"),
    reportDate: typeof payload.reportDate === "string" && payload.reportDate.trim() ? payload.reportDate : reportDate
  };
}

function shouldUseRustNativeDataApi(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized === AKTOOLS_DEFAULT_BASE_URL || normalized.startsWith("/aktools/");
}

function stringifyParams(params: Record<string, string | number | undefined>) {
  return Object.entries(params).reduce<Record<string, string>>((result, [key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") result[key] = String(value);
    return result;
  }, {});
}

function rowDateNumberValue(row: AkShareRow, keys: string[]) {
  return parseDateNumber(rowValue(row, keys));
}

function rowDateScore(row: AkShareRow, keys: string[]) {
  return rowDateNumberValue(row, keys) ?? 0;
}

function latestRowsByCode(rows: AkShareRow[], dateKeys: string[]) {
  const keyed = new Map<string, { row: AkShareRow; score: number }>();
  rows.forEach((row) => {
    const code = codeFromAkShareRow(row);
    if (!code) return;
    const score = rowDateScore(row, dateKeys);
    const existing = keyed.get(code);
    if (!existing || score > existing.score) keyed.set(code, { row, score });
  });
  return new Map(Array.from(keyed, ([code, item]) => [code, item.row]));
}

function ashareHubAmountYuanToYi(row: AkShareRow | undefined, keys: string[]) {
  return amountToYi(numberValue(row ?? {}, keys));
}

function ashareHubAmountWanYuanToYi(row: AkShareRow | undefined, keys: string[]) {
  const value = numberValue(row ?? {}, keys);
  return value === undefined ? undefined : value / 10000;
}

function ashareHubAmountQianYuanToYi(row: AkShareRow | undefined, keys: string[]) {
  const value = numberValue(row ?? {}, keys);
  return value === undefined ? undefined : value / 100000;
}

function setMetricValue(metrics: Record<string, number>, key: string, value: number | undefined) {
  if (value !== undefined && Number.isFinite(value)) metrics[key] = value;
}

function ashareHubReportDate(row: AkShareRow | undefined) {
  return rowDateScore(row ?? {}, ["end_date", "ann_date", "trade_date", "report_date", "reportDate"]) || undefined;
}

function ashareHubReportDateText(row: AkShareRow | undefined) {
  const value = ashareHubReportDate(row);
  return value === undefined ? undefined : String(value);
}

function buildAshareHubMarketRows(referenceRows: AkShareRow[], dailyRows: AkShareRow[], fundamentalRows: AkShareRow[], industryRows: AkShareRow[]) {
  const referenceByCode = latestRowsByCode(referenceRows, ["list_date"]);
  const dailyByCode = latestRowsByCode(dailyRows, ["trade_date"]);
  const fundamentalByCode = latestRowsByCode(fundamentalRows, ["trade_date"]);
  const industryByCode = latestRowsByCode(industryRows, ["trade_date", "end_date"]);
  const codes = new Set<string>();
  [referenceByCode, dailyByCode, fundamentalByCode, industryByCode].forEach((map) => {
    map.forEach((_, code) => codes.add(code));
  });

  return Array.from(codes).flatMap((code) => {
    const reference = referenceByCode.get(code);
    const daily = dailyByCode.get(code);
    const fundamental = fundamentalByCode.get(code);
    const industry = industryByCode.get(code);
    const high = numberValue(daily ?? {}, ["high"]);
    const low = numberValue(daily ?? {}, ["low"]);
    const preClose = numberValue(daily ?? {}, ["pre_close", "preClose"]);
    const price = firstDefined(numberValue(daily ?? {}, ["close", "price"]), numberValue(fundamental ?? {}, ["close", "price"]));
    const pctChange = numberValue(daily ?? {}, ["pct_chg", "pctChange", "changePercent"]);
    const turnover = firstDefined(numberValue(fundamental ?? {}, ["turnover_rate", "turnoverRate"]), numberValue(daily ?? {}, ["turnover_rate", "turnoverRate"]));
    const marketCap = ashareHubAmountWanYuanToYi(fundamental, ["total_mv", "totalMarketValue", "marketCap"]);
    const floatMarketCap = ashareHubAmountWanYuanToYi(fundamental, ["circ_mv", "circMarketValue", "floatMarketCap"]);
    const hasMarketData = [price, pctChange, turnover, marketCap, floatMarketCap, numberValue(fundamental ?? {}, ["pe", "pb"])].some((value) => value !== undefined && Number.isFinite(value));
    if (!hasMarketData) return [];

    const row: AkShareRow = { code };
    const name = textValue(reference ?? {}, ["name", "stock_name"]) || textValue(daily ?? {}, ["name"]) || textValue(fundamental ?? {}, ["name"]);
    const area = textValue(reference ?? {}, ["area", "region"]);
    const industry1 = textValue(industry ?? {}, ["industry1", "l1_name", "level1_name"]) || textValue(reference ?? {}, ["industry"]);
    const industry2 = textValue(industry ?? {}, ["industry2", "l2_name", "level2_name"]);
    row.name = name || code;
    row.price = price;
    row.pctChange = pctChange;
    row.amount = ashareHubAmountQianYuanToYi(daily, ["amount"]);
    row.volume = numberValue(daily ?? {}, ["vol", "volume"]);
    row.turnover = turnover;
    row.marketCap = marketCap;
    row.floatMarketCap = floatMarketCap;
    row.pe = numberValue(fundamental ?? {}, ["pe", "pe_ttm", "peTtm"]);
    row.pb = numberValue(fundamental ?? {}, ["pb"]);
    row.ps = numberValue(fundamental ?? {}, ["ps"]);
    row.amplitude = high !== undefined && low !== undefined && preClose !== undefined && Math.abs(preClose) > 0.0001 ? (high - low) / preClose * 100 : undefined;
    row.listingDate = parseDateNumber(rowValue(reference ?? {}, ["list_date", "listDate"]));
    row.region = area;
    row.industry1 = industry1;
    row.industry2 = industry2;
    row.tradeDate = rowDateScore(daily ?? fundamental ?? {}, ["trade_date"]);
    return [row];
  });
}

function enrichStocksFromAshareHubRows(stocks: Stock[], rows: AkShareRow[]) {
  const rowByCode = rowsByCode(rows);
  return stocks.map((stock) => {
    const row = rowByCode.get(stock.code) ?? rowByCode.get(marketDataCodeForStock(stock));
    if (!row) return stock;
    const name = textValue(row, ["name"]);
    const region = textValue(row, ["region", "area"]);
    const industry1 = textValue(row, ["industry1", "industry"]);
    const industry2 = textValue(row, ["industry2"]);
    return {
      ...stock,
      name: name || stock.name,
      region: region || stock.region,
      industry1: industry1 || stock.industry1,
      industry2: industry2 || industry1 || stock.industry2,
      isST: name ? name.includes("ST") : stock.isST
    };
  });
}

function mergeAshareHubSpotRows(baseStocks: Stock[], rows: AkShareRow[]) {
  const merged = mergeAkShareSpotRows(baseStocks, rows);
  return {
    ...merged,
    stocks: enrichStocksFromAshareHubRows(merged.stocks, rows)
  };
}

function buildAshareHubFinancialMetricRows(indicatorRows: AkShareRow[], incomeRows: AkShareRow[], balanceRows: AkShareRow[], cashFlowRows: AkShareRow[]): RustFinancialMetricRow[] {
  const indicatorsByCode = latestRowsByCode(indicatorRows, ["end_date", "ann_date"]);
  const incomeByCode = latestRowsByCode(incomeRows, ["end_date", "ann_date"]);
  const balanceByCode = latestRowsByCode(balanceRows, ["end_date", "ann_date"]);
  const cashFlowByCode = latestRowsByCode(cashFlowRows, ["end_date", "ann_date"]);
  const codes = new Set<string>();
  [indicatorsByCode, incomeByCode, balanceByCode, cashFlowByCode].forEach((map) => {
    map.forEach((_, code) => codes.add(code));
  });

  return Array.from(codes).flatMap((code) => {
    const indicator = indicatorsByCode.get(code);
    const income = incomeByCode.get(code);
    const balance = balanceByCode.get(code);
    const cashFlow = cashFlowByCode.get(code);
    const totalAssets = ashareHubAmountYuanToYi(balance, ["total_assets"]);
    const totalLiabilities = ashareHubAmountYuanToYi(balance, ["total_liab", "total_liabilities"]);
    const currentAssets = ashareHubAmountYuanToYi(balance, ["total_cur_assets", "total_current_assets"]);
    const currentLiabilities = ashareHubAmountYuanToYi(balance, ["total_cur_liab", "total_current_liab"]);
    const revenue = ashareHubAmountYuanToYi(income, ["total_revenue", "revenue"]);
    const netProfit = firstDefined(ashareHubAmountYuanToYi(income, ["n_income_attr_p", "n_income", "net_profit"]), ashareHubAmountYuanToYi(cashFlow, ["net_profit"]));
    const operatingCost = ashareHubAmountYuanToYi(income, ["total_cogs", "oper_cost", "total_operate_cost"]);
    const investmentAssets = firstDefined(
      ashareHubAmountYuanToYi(balance, ["invest_assets", "investment_assets"]),
      sumDefined([
        ashareHubAmountYuanToYi(balance, ["money_cap"]),
        ashareHubAmountYuanToYi(balance, ["lt_eqt_invest"]),
        ashareHubAmountYuanToYi(balance, ["trad_asset"]),
        ashareHubAmountYuanToYi(balance, ["fin_assets_avail_for_sale"])
      ])
    );
    const interestBearingDebt = sumDefined([
      ashareHubAmountYuanToYi(balance, ["st_borr", "short_loan"]),
      ashareHubAmountYuanToYi(balance, ["lt_borr", "long_loan"]),
      ashareHubAmountYuanToYi(balance, ["bond_payable"]),
      ashareHubAmountYuanToYi(balance, ["non_cur_liab_due_1y"])
    ]);
    const reportDateNumber = firstDefined(ashareHubReportDate(indicator), ashareHubReportDate(income), ashareHubReportDate(balance), ashareHubReportDate(cashFlow));
    const disclosureDateNumber = firstDefined(
      rowDateNumberValue(indicator ?? {}, ["ann_date"]),
      rowDateNumberValue(income ?? {}, ["ann_date"]),
      rowDateNumberValue(balance ?? {}, ["ann_date"]),
      rowDateNumberValue(cashFlow ?? {}, ["ann_date"]),
      reportDateNumber
    );
    const metrics: Record<string, number> = {};
    setMetricValue(metrics, "revenue", revenue);
    setMetricValue(metrics, "netProfit", netProfit);
    setMetricValue(metrics, "operatingCashflow", ashareHubAmountYuanToYi(cashFlow, ["n_cashflow_act", "net_cashflow_act"]));
    setMetricValue(metrics, "totalAssets", totalAssets);
    setMetricValue(metrics, "totalLiabilities", totalLiabilities);
    setMetricValue(metrics, "inventory", ashareHubAmountYuanToYi(balance, ["inventories", "inventory"]));
    setMetricValue(metrics, "receivables", ashareHubAmountYuanToYi(balance, ["accounts_receiv", "acct_receiv", "accounts_receivable"]));
    setMetricValue(metrics, "eps", firstDefined(numberValue(indicator ?? {}, ["eps"]), numberValue(income ?? {}, ["basic_eps"])));
    setMetricValue(metrics, "bps", numberValue(indicator ?? {}, ["bps"]));
    setMetricValue(metrics, "roe", numberValue(indicator ?? {}, ["roe"]));
    setMetricValue(metrics, "roa", numberValue(indicator ?? {}, ["roa"]));
    setMetricValue(metrics, "grossMargin", firstDefined(numberValue(indicator ?? {}, ["gross_margin"]), revenue !== undefined && operatingCost !== undefined ? safeRatio(revenue - operatingCost, revenue) : undefined));
    setMetricValue(metrics, "netMargin", firstDefined(numberValue(indicator ?? {}, ["netprofit_margin", "net_margin"]), safeRatio(netProfit, revenue)));
    setMetricValue(metrics, "revenueGrowth", numberValue(indicator ?? {}, ["revenue_yoy", "or_yoy", "tr_yoy"]));
    setMetricValue(metrics, "profitGrowth", numberValue(indicator ?? {}, ["netprofit_yoy", "q_netprofit_yoy"]));
    setMetricValue(metrics, "debtRatio", firstDefined(numberValue(indicator ?? {}, ["debt_to_assets"]), safeRatio(totalLiabilities, totalAssets)));
    setMetricValue(metrics, "currentRatio", firstDefined(numberValue(indicator ?? {}, ["current_ratio"]), currentAssets !== undefined && currentLiabilities !== undefined ? safeRatio(currentAssets, currentLiabilities, 1) : undefined));
    setMetricValue(metrics, "assetTurnover", safeRatio(revenue, totalAssets, 1));
    setMetricValue(metrics, "investmentAssets", investmentAssets);
    setMetricValue(metrics, "productionAssets", totalAssets !== undefined && investmentAssets !== undefined ? Math.max(totalAssets - investmentAssets, 0) : ashareHubAmountYuanToYi(balance, ["fix_assets"]));
    setMetricValue(metrics, "interestBearingDebt", interestBearingDebt);
    setMetricValue(metrics, "nonInterestBearingDebt", totalLiabilities !== undefined && interestBearingDebt !== undefined ? Math.max(totalLiabilities - interestBearingDebt, 0) : undefined);
    const hasReportData = [revenue, netProfit, metrics.operatingCashflow, totalAssets, totalLiabilities].some((value) => value !== undefined && Number.isFinite(value));
    setMetricValue(metrics, "realAnnualReportSource", hasReportData ? 1 : undefined);
    setMetricValue(metrics, "realFinancialReportDate", hasReportData ? reportDateNumber : undefined);
    setMetricValue(metrics, "realFinancialReportDisclosureDate", hasReportData ? disclosureDateNumber : undefined);
    setMetricValue(metrics, "realAnnualReportDate", hasReportData && isAnnualReportDate(reportDateNumber) ? reportDateNumber : undefined);
    setMetricValue(metrics, "realAnnualReportDisclosureDate", hasReportData && isAnnualReportDate(reportDateNumber) ? disclosureDateNumber : undefined);
    if (!Object.keys(metrics).length) return [];
    return [{
      code,
      name: textValue(indicator ?? income ?? balance ?? cashFlow ?? {}, ["name"]) || code,
      reportDate: ashareHubReportDateText(indicator) ?? ashareHubReportDateText(income) ?? ashareHubReportDateText(balance) ?? ashareHubReportDateText(cashFlow),
      sourceRows: [indicator, income, balance, cashFlow].filter(Boolean).length,
      metrics
    }];
  });
}

function buildAshareHubMarginRows(rows: AkShareRow[]): RustMarginBalanceRow[] {
  return Array.from(latestRowsByCode(rows, ["trade_date"]), ([code, row]) => {
    const financingBuyAmount = ashareHubAmountYuanToYi(row, ["rzmre"]);
    const financingRepayAmount = ashareHubAmountYuanToYi(row, ["rzche"]);
    return {
      code,
      name: textValue(row, ["name"]) || code,
      reportDate: ashareHubReportDateText(row),
      sourceRows: 1,
      metrics: {
        marginBalance: ashareHubAmountYuanToYi(row, ["rzrqye"]),
        financingBalance: ashareHubAmountYuanToYi(row, ["rzye"]),
        securitiesLendingBalance: ashareHubAmountYuanToYi(row, ["rqye"]),
        financingBuyAmount,
        financingRepayAmount,
        financingNetBuyAmount: financingBuyAmount !== undefined && financingRepayAmount !== undefined ? financingBuyAmount - financingRepayAmount : undefined,
        marginTradeDate: rowDateNumberValue(row, ["trade_date"]),
        realMarginSource: 1
      }
    };
  });
}

function buildAshareHubNorthHoldingRows(rows: AkShareRow[]): RustNorthHoldingRow[] {
  return Array.from(latestRowsByCode(rows, ["trade_date"]), ([code, row]) => {
    const ratio = numberValue(row, ["ratio"]);
    return {
      code,
      name: textValue(row, ["name"]) || code,
      reportDate: ashareHubReportDateText(row),
      sourceRows: 1,
      metrics: {
        northHold: ratio,
        northHoldShares: numberValue(row, ["vol"]),
        northHoldAsharesRatio: ratio,
        northHoldDate: rowDateNumberValue(row, ["trade_date"]),
        realNorthHoldSource: 1
      }
    };
  });
}

async function fetchRustNativeRows(path: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareRow[]> {
  const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}${path}`, { method: "GET", signal });
  if (!response.ok) throw new Error(`Rust native data API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rowsFromPayload(await responseJson(response, "Rust native data API"), "Rust native data API");
}

async function fetchRustAnalystForecastRows(signal: AbortSignal, fetchImpl: FetchLike): Promise<RustAnalystForecastRow[]> {
  const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}/finance/analyst-forecasts`, { method: "GET", signal });
  if (!response.ok) throw new Error(`Rust native analyst forecast API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rustAnalystForecastRowsFromPayload(await responseJson(response, "Rust native analyst forecast API"), "Rust native analyst forecast API");
}

async function fetchRustMarginBalanceRows(signal: AbortSignal, fetchImpl: FetchLike): Promise<RustMarginBalanceRow[]> {
  const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}/finance/margin-balances`, { method: "GET", signal });
  if (!response.ok) throw new Error(`Rust native margin balance API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rustMarginBalanceRowsFromPayload(await responseJson(response, "Rust native margin balance API"), "Rust native margin balance API");
}

async function fetchRustNorthHoldingRows(signal: AbortSignal, fetchImpl: FetchLike): Promise<RustNorthHoldingRow[]> {
  const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}/market/north-holdings`, { method: "GET", signal });
  if (!response.ok) throw new Error(`Rust native north holdings API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rustNorthHoldingRowsFromPayload(await responseJson(response, "Rust native north holdings API"), "Rust native north holdings API");
}

async function fetchRustTechnicalIndicatorRows(codes: string[], signal: AbortSignal, fetchImpl: FetchLike): Promise<RustTechnicalIndicatorRow[]> {
  if (!codes.length) return [];
  const params = new URLSearchParams({
    codes: codes.slice(0, TECHNICAL_INDICATOR_CODE_LIMIT).join(","),
    limit: String(TECHNICAL_INDICATOR_KLINE_LIMIT)
  });
  const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}/market/technical-indicators?${params}`, { method: "GET", signal });
  if (!response.ok) throw new Error(`Rust native technical indicator API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rustTechnicalIndicatorRowsFromPayload(await responseJson(response, "Rust native technical indicator API"), "Rust native technical indicator API");
}

async function responseErrorSuffix(response: Response) {
  const details = await response.text().catch(() => "");
  const trimmed = details.trim();
  return trimmed ? `: ${trimmed.slice(0, 300)}` : "";
}

async function fetchAkShareRows(baseUrl: string, endpoint: string, params: Record<string, string>, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareRow[]> {
  const response = await fetchImpl(RUST_AKTOOLS_ROWS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl,
      endpoint,
      params
    })
  });
  if (!response.ok) throw new Error(`Rust AKTools rows API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rowsFromPayload(await responseJson(response, "Rust AKTools rows API"), "Rust AKTools rows API");
}

async function fetchAshareHubRows(
  baseUrl: string,
  endpoint: string,
  params: Record<string, string | number | undefined>,
  apiToken: string,
  timeoutSeconds: number,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<AkShareRow[]> {
  const token = apiToken.trim();
  if (!token) throw new Error("AShareHub API Key is required");
  const response = await fetchImpl(RUST_ASHAREHUB_ROWS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl: baseUrl.trim() || ASHAREHUB_DEFAULT_BASE_URL,
      endpoint,
      params: stringifyParams(params),
      apiToken: token,
      timeoutSeconds
    })
  });
  if (!response.ok) throw new Error(`Rust AShareHub rows API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return rowsFromPayload(await responseJson(response, "Rust AShareHub rows API"), "Rust AShareHub rows API");
}

async function fetchAshareHubEndpointRows(
  baseUrl: string,
  endpoint: string,
  params: Record<string, string | number | undefined>,
  apiToken: string,
  timeoutSeconds: number,
  signal: AbortSignal,
  fetchImpl: FetchLike
): Promise<AkShareRowsFetchResult> {
  try {
    return {
      rows: await fetchAshareHubRows(baseUrl, endpoint, params, apiToken, timeoutSeconds, signal, fetchImpl)
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { rows: [], errorDetail: `${endpoint}: ${syncErrorDetail(error)}` };
  }
}

async function fetchAkShareSpotRows(baseUrl: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareMarketRowsFetchResult> {
  if (shouldUseRustNativeDataApi(baseUrl)) {
    const rows = await fetchRustNativeRows("/market/ashare/spot", signal, fetchImpl);
    return { rows, endpoint: "rust:/api/market/ashare/spot" };
  }

  const errors: string[] = [];
  for (const endpoint of AKSHARE_SPOT_ENDPOINTS) {
    try {
      const rows = await fetchAkShareRows(baseUrl, endpoint, {}, signal, fetchImpl);
      if (rows.length) return { rows, endpoint };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      errors.push(`${endpoint}: ${syncErrorDetail(error)}`);
    }
  }
  return { rows: [], endpoint: AKSHARE_SPOT_ENDPOINTS.join(","), errorDetail: errors.join("；") };
}

async function fetchAshareHubMarketRows(baseUrl: string, apiToken: string, timeoutSeconds: number, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareMarketRowsFetchResult> {
  const [reference, daily, fundamentals, industries] = await Promise.all([
    fetchAshareHubEndpointRows(baseUrl, "reference/stocks", { limit: ASHAREHUB_SYNC_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl),
    fetchAshareHubEndpointRows(baseUrl, "market/daily", { limit: ASHAREHUB_SYNC_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl),
    fetchAshareHubEndpointRows(baseUrl, "market/fundamentals", { limit: ASHAREHUB_SYNC_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl),
    fetchAshareHubEndpointRows(baseUrl, "reference/industries", { limit: ASHAREHUB_SYNC_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl)
  ]);
  const rows = buildAshareHubMarketRows(reference.rows, daily.rows, fundamentals.rows, industries.rows);
  const errors = [reference.errorDetail, daily.errorDetail, fundamentals.errorDetail, industries.errorDetail].filter(Boolean).join("；");
  return {
    rows,
    endpoint: "asharehub:reference/stocks,market/daily,market/fundamentals,reference/industries",
    errorDetail: errors || (!rows.length ? "AShareHub market endpoints returned no usable rows" : undefined)
  };
}

function financialReportDateCandidates(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const latestAnnualYear = month >= 5 ? year - 1 : year - 2;
  return Array.from(
    new Set([
      `${latestAnnualYear}1231`,
      month >= 5 ? `${year}0331` : "",
      `${year - 1}0930`,
      `${year - 1}0630`,
      `${latestAnnualYear - 1}1231`
    ].filter(Boolean))
  );
}

async function fetchFirstFinancialRows(baseUrl: string, endpoint: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareRowsFetchResult> {
  const errors: string[] = [];
  for (const reportDate of financialReportDateCandidates()) {
    try {
      const rows = await fetchAkShareRows(baseUrl, endpoint, { date: reportDate }, signal, fetchImpl);
      if (rows.length) return { rows, reportDate };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      errors.push(`${reportDate}: ${syncErrorDetail(error)}`);
    }
  }
  return { rows: [], errorDetail: errors.length ? `${endpoint}: ${errors.join("；")}` : "" };
}

async function fetchAkShareFinancialRows(baseUrl: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareFinancialRows> {
  if (shouldUseRustNativeDataApi(baseUrl)) {
    const errors: string[] = [];
    for (const reportDate of financialReportDateCandidates()) {
      try {
        const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}/finance/metrics/${reportDate}`, { method: "GET", signal });
        if (!response.ok) {
          errors.push(`/finance/metrics/${reportDate}: Rust native financial metric API HTTP ${response.status}${await responseErrorSuffix(response)}`);
          continue;
        }
        const metricRows = rustFinancialMetricRowsFromPayload(await responseJson(response, "Rust native financial metric API"), "Rust native financial metric API");
        if (metricRows.length) {
          return {
            performanceRows: [],
            incomeRows: [],
            balanceRows: [],
            cashFlowRows: [],
            metricRows,
            reportDate: String(metricRows.find((row) => row.reportDate)?.reportDate ?? reportDate)
          };
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        errors.push(`/finance/metrics/${reportDate}: ${syncErrorDetail(error)}`);
      }
    }

    for (const reportDate of financialReportDateCandidates()) {
      try {
        const response = await fetchImpl(`${RUST_NATIVE_API_BASE_URL}/finance/statements/${reportDate}`, { method: "GET", signal });
        if (!response.ok) {
          errors.push(`/finance/statements/${reportDate}: Rust native financial statement API HTTP ${response.status}${await responseErrorSuffix(response)}`);
          continue;
        }
        const rows = financialStatementRowsFromPayload(await responseJson(response, "Rust native financial statement API"), reportDate);
        if (rows.performanceRows.length || rows.incomeRows.length || rows.balanceRows.length || rows.cashFlowRows.length) {
          return rows;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        errors.push(`/finance/statements/${reportDate}: ${syncErrorDetail(error)}`);
      }
    }

    return {
      performanceRows: [],
      incomeRows: [],
      balanceRows: [],
      cashFlowRows: [],
      errorDetail: errors.join("；")
    };
  }

  const [performance, income, balance, cashFlow] = await Promise.all([
    fetchFirstFinancialRows(baseUrl, "stock_yjbb_em", signal, fetchImpl),
    fetchFirstFinancialRows(baseUrl, "stock_lrb_em", signal, fetchImpl),
    fetchFirstFinancialRows(baseUrl, "stock_zcfz_em", signal, fetchImpl),
    fetchFirstFinancialRows(baseUrl, "stock_xjll_em", signal, fetchImpl)
  ]);

  return {
    performanceRows: performance.rows,
    incomeRows: income.rows,
    balanceRows: balance.rows,
    cashFlowRows: cashFlow.rows,
    reportDate: performance.reportDate ?? income.reportDate ?? balance.reportDate ?? cashFlow.reportDate,
    errorDetail: [performance.errorDetail, income.errorDetail, balance.errorDetail, cashFlow.errorDetail].filter(Boolean).join("；")
  };
}

async function fetchAshareHubFinancialRows(baseUrl: string, apiToken: string, timeoutSeconds: number, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareFinancialRows> {
  const [indicators, income, balance, cashFlow] = await Promise.all([
    fetchAshareHubEndpointRows(baseUrl, "financials/indicators", { limit: ASHAREHUB_FINANCE_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl),
    fetchAshareHubEndpointRows(baseUrl, "financials/income", { limit: ASHAREHUB_FINANCE_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl),
    fetchAshareHubEndpointRows(baseUrl, "financials/balance-sheet", { limit: ASHAREHUB_FINANCE_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl),
    fetchAshareHubEndpointRows(baseUrl, "financials/cash-flow", { limit: ASHAREHUB_FINANCE_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl)
  ]);
  const metricRows = buildAshareHubFinancialMetricRows(indicators.rows, income.rows, balance.rows, cashFlow.rows);
  const reportDate = metricRows.find((row) => row.reportDate)?.reportDate;
  const errors = [indicators.errorDetail, income.errorDetail, balance.errorDetail, cashFlow.errorDetail].filter(Boolean).join("；");
  return {
    performanceRows: [],
    incomeRows: [],
    balanceRows: [],
    cashFlowRows: [],
    metricRows,
    reportDate: reportDate === undefined || reportDate === null ? undefined : String(reportDate),
    errorDetail: errors || (!metricRows.length ? "AShareHub financial endpoints returned no usable rows" : undefined)
  };
}

async function fetchAshareHubMarginBalanceRows(baseUrl: string, apiToken: string, timeoutSeconds: number, signal: AbortSignal, fetchImpl: FetchLike): Promise<RustMarginBalanceRow[]> {
  const rows = await fetchAshareHubRows(baseUrl, "market/margin", { limit: ASHAREHUB_SYNC_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl);
  return buildAshareHubMarginRows(rows);
}

async function fetchAshareHubNorthHoldingRows(baseUrl: string, apiToken: string, timeoutSeconds: number, signal: AbortSignal, fetchImpl: FetchLike): Promise<RustNorthHoldingRow[]> {
  const rows = await fetchAshareHubRows(baseUrl, "flows/northbound-holdings", { limit: ASHAREHUB_SYNC_LIMIT }, apiToken, timeoutSeconds, signal, fetchImpl);
  return buildAshareHubNorthHoldingRows(rows);
}

async function withAkShareTimeout<T>(timeoutSeconds: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(timeoutSeconds, 3) * 1000);
  try {
    return await task(controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const syncErrorDetail = (error: unknown) =>
  error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";

const emptyFinancialMerge = (stocks: Stock[]) => ({
  stocks,
  matchedRows: 0,
  sourceRows: 0,
  reportDate: undefined as string | undefined
});

const emptyAnalystMerge = (stocks: Stock[]) => ({
  stocks,
  matchedRows: 0,
  sourceRows: 0,
  reportDate: undefined as string | undefined
});

const emptyMarginMerge = (stocks: Stock[]) => ({
  stocks,
  matchedRows: 0,
  sourceRows: 0,
  reportDate: undefined as string | undefined
});

const emptyNorthHoldMerge = (stocks: Stock[]) => ({
  stocks,
  matchedRows: 0,
  sourceRows: 0,
  reportDate: undefined as string | undefined
});

const emptyTechnicalMerge = (stocks: Stock[]) => ({
  stocks,
  matchedRows: 0,
  sourceRows: 0,
  reportDate: undefined as string | undefined
});

function listedAshareCodeFromStock(stock: Stock) {
  const digits = marketDataCodeForStock(stock).replace(/\D/g, "").padStart(6, "0").slice(-6);
  return LISTED_ASHARE_CODE_PATTERN.test(digits) ? digits : undefined;
}

function uniqueListedAshareCodes(stocks: Stock[]) {
  const seen = new Set<string>();
  const codes: string[] = [];
  stocks.forEach((stock) => {
    const code = listedAshareCodeFromStock(stock);
    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  });
  return codes;
}

function technicalIndicatorSortScore(stock: Stock) {
  const amount = Number.isFinite(stock.metrics.amount) ? stock.metrics.amount : 0;
  const marketCap = Number.isFinite(stock.metrics.floatMarketCap)
    ? stock.metrics.floatMarketCap
    : Number.isFinite(stock.metrics.marketCap)
      ? stock.metrics.marketCap
      : 0;
  const turnover = Number.isFinite(stock.metrics.turnover) ? stock.metrics.turnover : 0;
  return amount * 1_000_000 + marketCap + turnover;
}

function technicalIndicatorCodesForSync(stocks: Stock[], preferredStocks: Stock[]) {
  if (preferredStocks.length && preferredStocks.length <= TECHNICAL_INDICATOR_CODE_LIMIT) {
    return uniqueListedAshareCodes(preferredStocks).slice(0, TECHNICAL_INDICATOR_CODE_LIMIT);
  }

  const sortedStocks = [...stocks].sort((left, right) => technicalIndicatorSortScore(right) - technicalIndicatorSortScore(left));
  return uniqueListedAshareCodes(sortedStocks).slice(0, TECHNICAL_INDICATOR_CODE_LIMIT);
}

export async function syncOpenSourceFinancialReports(
  rawSettings: InfoSourceSettings,
  baseStocks: Stock[],
  fetchImpl: FetchLike = fetch
): Promise<OpenSourceSyncResult> {
  const settings = ensureInfoSourceSettings(rawSettings);
  const checkedAt = new Date().toISOString();

  if (isLocalProvider(settings)) {
    const details = "本地模拟数据已停用，请配置 AKShare / AKTools 真实财报接口";
    return {
      ok: false,
      checkedAt,
      message: "真实财报同步失败",
      details,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details
      }
    };
  }

  const ashareHub = isAshareHubProvider(settings);

  if (!isAkShareProvider(settings) && !ashareHub) {
    const details = `当前来源不是 ${AKSHARE_AKTOOLS_PROVIDER}`;
    return {
      ok: false,
      checkedAt,
      message: "真实财报同步失败",
      details,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details
      }
    };
  }

  if (!settings.modules.finance) {
    const details = "请先在信息来源接口中启用财务指标接口";
    return {
      ok: false,
      checkedAt,
      message: "真实财报同步失败",
      details,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details
      }
    };
  }

  if (ashareHub && !settings.apiToken.trim()) {
    const details = "AShareHub API Key is required";
    return {
      ok: false,
      checkedAt,
      message: "真实财报同步失败",
      details,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details
      }
    };
  }

  const baseUrl = (ashareHub ? settings.baseUrl.trim() || ASHAREHUB_DEFAULT_BASE_URL : settings.baseUrl).replace(/\/$/, "");
  const rustNative = !ashareHub && shouldUseRustNativeDataApi(baseUrl);
  try {
    const financialRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) =>
      ashareHub
        ? fetchAshareHubFinancialRows(baseUrl, settings.apiToken, settings.timeoutSeconds, signal, fetchImpl)
        : fetchAkShareFinancialRows(baseUrl, signal, fetchImpl)
    );
    const financial = mergeAkShareFinancialRows(baseStocks, financialRows, false);
    const financialErrorDetail = financialRows.errorDetail ?? "";
    const valuationReadyRows = financial.stocks.filter(valuationReady).length;

    if (!financial.matchedRows) {
      const failureDetails = financial.sourceRows
        ? `${ashareHub ? "AShareHub 财报接口" : rustNative ? "Rust 原生财报接口" : "财报接口"}已返回 ${financial.sourceRows} 行，但没有匹配到当前股票池代码。请先接入全市场股票或确认代码格式。`
        : financialErrorDetail
          ? `${ashareHub ? "AShareHub 财报接口" : rustNative ? "Rust 原生财报接口" : "AKShare 财报接口"}未完成：${financialErrorDetail}`
          : ashareHub ? "AShareHub 财报接口未返回可用数据" : rustNative ? "Rust 原生财报接口未返回可用数据" : "AKShare 财报接口未返回可用数据";
      return {
        ok: false,
        checkedAt,
        message: "真实财报同步失败",
        details: failureDetails,
        stocks: baseStocks,
        summary: {
          ...defaultOpenSourceDataSummary,
          provider: settings.provider,
          financeMatchedRows: financial.matchedRows,
          financeSourceRows: financial.sourceRows,
          valuationReadyRows,
          stockCount: baseStocks.length,
          details: failureDetails
        }
      };
    }

    let analystErrorDetail = "";
    let analyst = emptyAnalystMerge(financial.stocks);
    if (rustNative) {
      try {
        const analystRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) => fetchRustAnalystForecastRows(signal, fetchImpl));
        analyst = mergeRustAnalystForecastRows(financial.stocks, analystRows, false);
        if (!analyst.matchedRows) {
          analystErrorDetail = analystRows.length
            ? `Rust native analyst forecast API returned ${analystRows.length} rows but none matched the current stock pool`
            : "Rust native analyst forecast API returned no rows";
        }
      } catch (error) {
        analystErrorDetail = syncErrorDetail(error);
      }
    }

    let marginErrorDetail = "";
    let margin = emptyMarginMerge(analyst.stocks);
    if (rustNative || ashareHub) {
      try {
        const marginRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) =>
          ashareHub
            ? fetchAshareHubMarginBalanceRows(baseUrl, settings.apiToken, settings.timeoutSeconds, signal, fetchImpl)
            : fetchRustMarginBalanceRows(signal, fetchImpl)
        );
        margin = mergeRustMarginBalanceRows(analyst.stocks, marginRows, false);
        if (!margin.matchedRows) {
          marginErrorDetail = marginRows.length
            ? `${ashareHub ? "AShareHub margin API" : "Rust native margin balance API"} returned ${marginRows.length} rows but none matched the current stock pool`
            : `${ashareHub ? "AShareHub margin API" : "Rust native margin balance API"} returned no rows`;
        }
      } catch (error) {
        marginErrorDetail = syncErrorDetail(error);
      }
    }

    const stocks = margin.stocks;
    const finalValuationReadyRows = stocks.filter(valuationReady).length;
    const analystDetail = rustNative
      ? analystErrorDetail
        ? `; analyst forecast unfinished: ${analystErrorDetail}`
        : `; analyst forecast matched ${analyst.matchedRows}/${analyst.sourceRows} rows`
      : "";
    const marginDetail = rustNative || ashareHub
      ? marginErrorDetail
        ? `; margin balance unfinished: ${marginErrorDetail}`
        : `; margin balance matched ${margin.matchedRows}/${margin.sourceRows} rows`
      : "";
    const reportDateDetail = financial.reportDate ? `，报告期 ${financial.reportDate}` : "";
    const details = `财报字段匹配 ${financial.matchedRows}/${financial.sourceRows} 行，估值可用 ${finalValuationReadyRows} 只${reportDateDetail}${analystDetail}${marginDetail}`;

    return {
      ok: true,
      checkedAt,
      message: "真实财报同步完成",
      details,
      stocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        lastSyncAt: checkedAt,
        financeMatchedRows: financial.matchedRows,
        financeSourceRows: financial.sourceRows,
        analystMatchedRows: analyst.matchedRows,
        analystSourceRows: analyst.sourceRows,
        marginMatchedRows: margin.matchedRows,
        marginSourceRows: margin.sourceRows,
        valuationReadyRows: finalValuationReadyRows,
        stockCount: stocks.length,
        details
      }
    };
  } catch (error) {
    const detail = syncErrorDetail(error);
    return {
      ok: false,
      checkedAt,
      message: "真实财报同步失败",
      details: detail,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details: "同步失败"
      }
    };
  }
}

export async function syncOpenSourceMarketData(
  rawSettings: InfoSourceSettings,
  baseStocks: Stock[],
  fetchImpl: FetchLike = fetch
): Promise<OpenSourceSyncResult> {
  const settings = ensureInfoSourceSettings(rawSettings);
  const checkedAt = new Date().toISOString();

  if (isLocalProvider(settings)) {
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details: "本地模拟数据已停用，请配置真实行情接口",
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details: "本地模拟数据已停用"
      }
    };
  }

  const ashareHub = isAshareHubProvider(settings);

  if (!isAkShareProvider(settings) && !ashareHub) {
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details: `当前来源不是 ${AKSHARE_AKTOOLS_PROVIDER}`,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details: "未同步"
      }
    };
  }

  if (ashareHub && !settings.apiToken.trim()) {
    const details = "AShareHub API Key is required";
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details,
      stocks: baseStocks,
      summary: { ...defaultOpenSourceDataSummary, provider: settings.provider, stockCount: baseStocks.length, details }
    };
  }

  const baseUrl = (ashareHub ? settings.baseUrl.trim() || ASHAREHUB_DEFAULT_BASE_URL : settings.baseUrl).replace(/\/$/, "");
  const rustNative = !ashareHub && shouldUseRustNativeDataApi(baseUrl);
  try {
    const marketRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) =>
      ashareHub
        ? fetchAshareHubMarketRows(baseUrl, settings.apiToken, settings.timeoutSeconds, signal, fetchImpl)
        : fetchAkShareSpotRows(baseUrl, signal, fetchImpl)
    );
    const merged = ashareHub ? mergeAshareHubSpotRows(baseStocks, marketRows.rows) : mergeAkShareSpotRows(baseStocks, marketRows.rows);
    const quoteStocks = merged.matchedRows ? merged.stocks : baseStocks;
    let northHoldErrorDetail = "";
    let northHold = emptyNorthHoldMerge(quoteStocks);
    if ((rustNative || ashareHub) && settings.modules.market) {
      try {
        const northHoldRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) =>
          ashareHub
            ? fetchAshareHubNorthHoldingRows(baseUrl, settings.apiToken, settings.timeoutSeconds, signal, fetchImpl)
            : fetchRustNorthHoldingRows(signal, fetchImpl)
        );
        northHold = mergeRustNorthHoldingRows(quoteStocks, northHoldRows, false);
        if (!northHold.matchedRows) {
          northHoldErrorDetail = northHoldRows.length
            ? `${ashareHub ? "AShareHub north holdings API" : "Rust native north holdings API"} returned ${northHoldRows.length} rows but none matched the current stock pool`
            : `${ashareHub ? "AShareHub north holdings API" : "Rust native north holdings API"} returned no rows`;
        }
      } catch (error) {
        northHoldErrorDetail = syncErrorDetail(error);
      }
    }
    let technicalErrorDetail = "";
    let technical = emptyTechnicalMerge(northHold.stocks);
    if (rustNative && settings.modules.market) {
      const technicalCodes = technicalIndicatorCodesForSync(northHold.stocks, baseStocks);
      if (technicalCodes.length) {
        try {
          const technicalRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) => fetchRustTechnicalIndicatorRows(technicalCodes, signal, fetchImpl));
          technical = mergeRustTechnicalIndicatorRows(northHold.stocks, technicalRows, false);
          if (!technical.matchedRows) {
            technicalErrorDetail = technicalRows.length
              ? `Rust native technical indicator API returned ${technicalRows.length} rows but none matched the current stock pool`
              : "Rust native technical indicator API returned no rows";
          }
        } catch (error) {
          technicalErrorDetail = syncErrorDetail(error);
        }
      } else {
        technicalErrorDetail = "No listed A-share codes are available for technical indicators";
      }
    }
    const marketStocks = technical.stocks;
    const shouldExpandFinancialUniverse = !merged.matchedRows && !northHold.matchedRows && !technical.matchedRows;
    let financeErrorDetail = "";
    let financial = emptyFinancialMerge(marketStocks);

    if (settings.modules.finance) {
      try {
        const financialRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) =>
          ashareHub
            ? fetchAshareHubFinancialRows(baseUrl, settings.apiToken, settings.timeoutSeconds, signal, fetchImpl)
            : fetchAkShareFinancialRows(baseUrl, signal, fetchImpl)
        );
        financial = mergeAkShareFinancialRows(marketStocks, financialRows, shouldExpandFinancialUniverse);
        if (!financial.matchedRows && financialRows.errorDetail) financeErrorDetail = financialRows.errorDetail;
      } catch (error) {
        financeErrorDetail = syncErrorDetail(error);
      }
    }

    if (!merged.matchedRows && !northHold.matchedRows && !technical.matchedRows && !financial.matchedRows) {
      const failureDetails = [
        merged.sourceRows
          ? `${ashareHub ? "AShareHub 行情" : rustNative ? "Rust 原生行情接口" : "AKShare 行情"}已返回，但没有匹配到当前股票池代码`
          : marketRows.errorDetail
            ? `${ashareHub ? "AShareHub 行情接口" : rustNative ? "Rust 原生行情接口" : "AKShare 行情接口"}未完成：${marketRows.errorDetail}`
            : ashareHub ? "AShareHub 行情接口未返回可用 A 股行情" : rustNative ? "Rust 原生行情接口未返回可用 A 股行情" : "AKShare 行情接口未返回可用 A 股行情",
        northHoldErrorDetail ? `北向持股接口未完成：${northHoldErrorDetail}` : "",
        technicalErrorDetail ? `technical indicators unfinished: ${technicalErrorDetail}` : "",
        financeErrorDetail ? `财报接口未完成：${financeErrorDetail}` : ""
      ].filter(Boolean).join("；");
      return {
        ok: false,
        checkedAt,
        message: "开源数据同步失败",
        details: failureDetails,
        stocks: baseStocks,
        summary: { ...defaultOpenSourceDataSummary, provider: settings.provider, sourceRows: merged.sourceRows, stockCount: baseStocks.length, details: failureDetails }
      };
    }

    let analystErrorDetail = "";
    let analyst = emptyAnalystMerge(financial.stocks);
    if (settings.modules.finance && rustNative) {
      try {
        const analystRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) => fetchRustAnalystForecastRows(signal, fetchImpl));
        analyst = mergeRustAnalystForecastRows(financial.stocks, analystRows, false);
        if (!analyst.matchedRows) {
          analystErrorDetail = analystRows.length
            ? `Rust native analyst forecast API returned ${analystRows.length} rows but none matched the current stock pool`
            : "Rust native analyst forecast API returned no rows";
        }
      } catch (error) {
        analystErrorDetail = syncErrorDetail(error);
      }
    }

    let marginErrorDetail = "";
    let margin = emptyMarginMerge(analyst.stocks);
    if (settings.modules.finance && (rustNative || ashareHub)) {
      try {
        const marginRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) =>
          ashareHub
            ? fetchAshareHubMarginBalanceRows(baseUrl, settings.apiToken, settings.timeoutSeconds, signal, fetchImpl)
            : fetchRustMarginBalanceRows(signal, fetchImpl)
        );
        margin = mergeRustMarginBalanceRows(analyst.stocks, marginRows, false);
        if (!margin.matchedRows) {
          marginErrorDetail = marginRows.length
            ? `${ashareHub ? "AShareHub margin API" : "Rust native margin balance API"} returned ${marginRows.length} rows but none matched the current stock pool`
            : `${ashareHub ? "AShareHub margin API" : "Rust native margin balance API"} returned no rows`;
        }
      } catch (error) {
        marginErrorDetail = syncErrorDetail(error);
      }
    }

    const stocks = margin.stocks;
    const valuationReadyRows = stocks.filter(valuationReady).length;
    const marketProviderName = ashareHub ? "AShareHub" : rustNative ? "Rust 原生" : "AKShare";
    const financeDetail = settings.modules.finance
      ? financeErrorDetail
        ? `；财报接口未完成：${financeErrorDetail}`
        : `；财报字段匹配 ${financial.matchedRows} 只，估值可用 ${valuationReadyRows} 只${financial.reportDate ? `，报告期 ${financial.reportDate}` : ""}`
      : "";
    const marketDetail = merged.matchedRows
      ? `匹配 ${merged.matchedRows}/${merged.sourceRows} 条 ${marketProviderName} A 股实时行情`
      : financial.matchedRows
        ? `${marketProviderName} 行情未匹配，已使用财报接口补齐股票池（行情源行 ${merged.sourceRows} 条）`
        : `${marketProviderName} 行情未匹配，保留当前股票池（源行 ${merged.sourceRows} 条）`;
    const northHoldDetail = rustNative || ashareHub
      ? northHoldErrorDetail
        ? `; north holdings unfinished: ${northHoldErrorDetail}`
        : `; north holdings matched ${northHold.matchedRows}/${northHold.sourceRows} rows${northHold.reportDate ? ` (${northHold.reportDate})` : ""}`
      : "";
    const technicalDetail = rustNative
      ? technicalErrorDetail
        ? `; technical indicators unfinished: ${technicalErrorDetail}`
        : `; technical indicators matched ${technical.matchedRows}/${technical.sourceRows} rows${technical.reportDate ? ` (${technical.reportDate})` : ""}`
      : "";
    const analystDetail = settings.modules.finance
      ? rustNative
        ? analystErrorDetail
          ? `; analyst forecast unfinished: ${analystErrorDetail}`
          : `; analyst forecast matched ${analyst.matchedRows}/${analyst.sourceRows} rows`
        : ""
      : "";
    const marginDetail = settings.modules.finance
      ? rustNative || ashareHub
        ? marginErrorDetail
          ? `; margin balance unfinished: ${marginErrorDetail}`
          : `; margin balance matched ${margin.matchedRows}/${margin.sourceRows} rows`
        : ""
      : "";
    const details = `${marketDetail}${financeDetail}${northHoldDetail}${technicalDetail}${analystDetail}${marginDetail}；行情接口 ${marketRows.endpoint}`;

    return {
      ok: true,
      checkedAt,
      message: "开源数据同步完成",
      details,
      stocks,
      summary: {
        provider: settings.provider,
        lastSyncAt: checkedAt,
        matchedRows: merged.matchedRows,
        sourceRows: merged.sourceRows,
        financeMatchedRows: financial.matchedRows,
        financeSourceRows: financial.sourceRows,
        analystMatchedRows: analyst.matchedRows,
        analystSourceRows: analyst.sourceRows,
        marginMatchedRows: margin.matchedRows,
        marginSourceRows: margin.sourceRows,
        northHoldMatchedRows: northHold.matchedRows,
        northHoldSourceRows: northHold.sourceRows,
        technicalMatchedRows: technical.matchedRows,
        technicalSourceRows: technical.sourceRows,
        valuationReadyRows,
        stockCount: stocks.length,
        details
      }
    };
  } catch (error) {
    const detail = syncErrorDetail(error);
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details: detail,
      stocks: baseStocks,
      summary: { ...defaultOpenSourceDataSummary, provider: settings.provider, stockCount: baseStocks.length, details: "同步失败" }
    };
  }
}
