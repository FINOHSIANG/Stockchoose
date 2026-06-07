import { AKSHARE_AKTOOLS_PROVIDER, ensureInfoSourceSettings, isAkShareProvider, isLocalProvider, type InfoSourceSettings } from "./integrationServices";
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
}

interface AkShareFinancialRows {
  performanceRows: AkShareRow[];
  incomeRows: AkShareRow[];
  balanceRows: AkShareRow[];
  cashFlowRows: AkShareRow[];
  reportDate?: string;
}

interface AkShareMarketRowsFetchResult {
  rows: AkShareRow[];
  endpoint: string;
}

const AKSHARE_SPOT_ENDPOINTS = ["stock_zh_a_spot_em", "stock_zh_a_spot"] as const;
const LISTED_ASHARE_CODE_PATTERN = /^(60[0-5]|688|689|000|001|002|003|300|301|302|920)\d{3}$/;

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

const codeFromAkShareRow = (row: AkShareRow) =>
  textValue(row, ["股票代码", "证券代码", "代码", "SECURITY_CODE", "SECURITYCODE", "code", "symbol", "浠ｇ爜"]).replace(/\D/g, "").padStart(6, "0").slice(-6);

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

export function normalizeAkShareSpotRow(row: AkShareRow) {
  const code = codeFromAkShareRow(row);
  const name = textValue(row, ["名称", "股票简称", "简称", "name", "鍚嶇О"]);
  if (!code) return null;
  return {
    code,
    name,
    price: numberValue(row, ["最新价", "收盘", "close", "price", "latest", "鏈€鏂颁环", "鏀剁洏"]),
    pctChange: numberValue(row, ["涨跌幅", "pctChange", "changePercent", "娑ㄨ穼骞?"]),
    amountYi: amountValueYi(row, ["成交额", "amount", "turnoverAmount", "鎴愪氦棰?"]),
    volumeWanShou: volumeToWanShou(numberValue(row, ["成交量", "volume", "鎴愪氦閲?"])),
    turnover: numberValue(row, ["换手率", "turnover", "turnoverRate", "鎹㈡墜鐜?"]),
    marketCapYi: amountValueYi(row, ["总市值", "marketCap", "totalMarketCap", "鎬诲競鍊?"]),
    floatMarketCapYi: amountValueYi(row, ["流通市值", "floatMarketCap", "circulatingMarketCap", "娴侀€氬競鍊?"]),
    pe: numberValue(row, ["市盈率-动态", "市盈率", "pe", "peDynamic", "甯傜泩鐜?鍔ㄦ€?", "甯傜泩鐜?"]),
    pb: numberValue(row, ["市净率", "pb", "甯傚噣鐜?"]),
    amplitude: numberValue(row, ["振幅", "amplitude", "鎸箙"])
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

export function mergeAkShareSpotRows(baseStocks: Stock[], rows: AkShareRow[]) {
  const normalizedRows = rows.map(normalizeAkShareSpotRow).filter((row): row is NonNullable<ReturnType<typeof normalizeAkShareSpotRow>> => Boolean(row));
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
    metrics = withMetric(metrics, "limitFlag", row.pctChange === undefined ? undefined : row.pctChange >= 9.8 ? 1 : row.pctChange <= -9.8 ? -1 : 0, 0);
    metrics = withMetric(metrics, "min15Momentum", row.pctChange === undefined ? undefined : row.pctChange / 4);
    metrics = withMetric(metrics, "intradayStrength", row.pctChange === undefined ? undefined : Math.max(0, Math.min(100, 50 + row.pctChange * 4)));
    metrics = withMetric(metrics, "realQuoteSource", 1, 0);
    metrics = withMetric(metrics, "openSourceMarketSource", 1, 0);

    return {
      ...stock,
      name: row.name || stock.name,
      metrics
    };
  });

  return {
    stocks,
    matchedRows,
    sourceRows: normalizedRows.length
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

function mergeFinancialMetrics(stock: Stock, performance: AkShareRow | undefined, income: AkShareRow | undefined, balance: AkShareRow | undefined, cashFlow: AkShareRow | undefined) {
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
  const shareBase = stock.metrics.marketCap && stock.metrics.price ? stock.metrics.marketCap / Math.max(stock.metrics.price, 0.01) : undefined;
  const eps = firstDefined(numberValue(performance ?? {}, ["基本每股收益", "每股收益", "EPS"]), shareBase ? safeRatio(netProfit, shareBase, 1) : undefined);
  const bps = firstDefined(numberValue(performance ?? {}, ["每股净资产", "BPS"]), shareBase ? safeRatio(netAssets, shareBase, 1) : undefined);
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

  let metrics = { ...stock.metrics };
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

  return {
    ...stock,
    metrics
  };
}

export function mergeAkShareFinancialRows(stocks: Stock[], rows: AkShareFinancialRows, expandUniverse = true) {
  const sourceStocks = expandUniverse
    ? expandStocksFromAkShareRows(stocks, [
      ...rows.performanceRows,
      ...rows.incomeRows,
      ...rows.balanceRows,
      ...rows.cashFlowRows
    ].map(normalizeAkShareSpotRow).filter((row): row is NormalizedAkShareStockRow => Boolean(row)), true)
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

    const merged = mergeFinancialMetrics(stock, performance, income, balance, cashFlow);
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

function rowsFromPayload(payload: unknown): AkShareRow[] {
  if (Array.isArray(payload)) return payload.filter((row): row is AkShareRow => row && typeof row === "object" && !Array.isArray(row));
  const data = (payload as { data?: unknown })?.data;
  if (Array.isArray(data)) return data.filter((row): row is AkShareRow => row && typeof row === "object" && !Array.isArray(row));
  return [];
}

async function fetchAkShareRows(baseUrl: string, endpoint: string, params: Record<string, string>, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareRow[]> {
  const query = new URLSearchParams(params).toString();
  const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}${query ? `?${query}` : ""}`;
  const response = await fetchImpl(url, { method: "GET", signal });
  if (!response.ok) return [];
  return rowsFromPayload(await response.json());
}

async function fetchAkShareSpotRows(baseUrl: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareMarketRowsFetchResult> {
  for (const endpoint of AKSHARE_SPOT_ENDPOINTS) {
    try {
      const rows = await fetchAkShareRows(baseUrl, endpoint, {}, signal, fetchImpl);
      if (rows.length) return { rows, endpoint };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
  }
  return { rows: [], endpoint: AKSHARE_SPOT_ENDPOINTS.join(",") };
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
  for (const reportDate of financialReportDateCandidates()) {
    try {
      const rows = await fetchAkShareRows(baseUrl, endpoint, { date: reportDate }, signal, fetchImpl);
      if (rows.length) return { rows, reportDate };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
  }
  return { rows: [] };
}

async function fetchAkShareFinancialRows(baseUrl: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<AkShareFinancialRows> {
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
    reportDate: performance.reportDate ?? income.reportDate ?? balance.reportDate ?? cashFlow.reportDate
  };
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

  if (!isAkShareProvider(settings)) {
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

  const baseUrl = settings.baseUrl.replace(/\/$/, "");
  try {
    const financialRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) => fetchAkShareFinancialRows(baseUrl, signal, fetchImpl));
    const financial = mergeAkShareFinancialRows(baseStocks, financialRows, false);
    const valuationReadyRows = financial.stocks.filter(valuationReady).length;
    const reportDateDetail = financial.reportDate ? `，报告期 ${financial.reportDate}` : "";
    const details = `财报字段匹配 ${financial.matchedRows}/${financial.sourceRows} 行，估值可用 ${valuationReadyRows} 只${reportDateDetail}`;

    if (!financial.matchedRows) {
      const failureDetails = financial.sourceRows
        ? `财报接口已返回 ${financial.sourceRows} 行，但没有匹配到当前股票池代码。请先接入全市场股票或确认代码格式。`
        : "AKShare 财报接口未返回可用数据";
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

    return {
      ok: true,
      checkedAt,
      message: "真实财报同步完成",
      details,
      stocks: financial.stocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        lastSyncAt: checkedAt,
        financeMatchedRows: financial.matchedRows,
        financeSourceRows: financial.sourceRows,
        valuationReadyRows,
        stockCount: financial.stocks.length,
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

  if (!isAkShareProvider(settings)) {
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

  const baseUrl = settings.baseUrl.replace(/\/$/, "");
  try {
    const marketRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) => fetchAkShareSpotRows(baseUrl, signal, fetchImpl));
    const merged = mergeAkShareSpotRows(baseStocks, marketRows.rows);
    const marketStocks = merged.matchedRows ? merged.stocks : baseStocks;
    const shouldExpandFinancialUniverse = !merged.matchedRows;
    let financeErrorDetail = "";
    let financial = emptyFinancialMerge(marketStocks);

    if (settings.modules.finance) {
      try {
        const financialRows = await withAkShareTimeout(settings.timeoutSeconds, (signal) => fetchAkShareFinancialRows(baseUrl, signal, fetchImpl));
        financial = mergeAkShareFinancialRows(marketStocks, financialRows, shouldExpandFinancialUniverse);
      } catch (error) {
        financeErrorDetail = syncErrorDetail(error);
      }
    }

    if (!merged.matchedRows && !financial.matchedRows) {
      const failureDetails = [
        merged.sourceRows
          ? "AKShare 行情已返回，但没有匹配到当前股票池代码"
          : "AKShare 行情接口未返回可用 A 股行情",
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

    const stocks = financial.stocks;
    const valuationReadyRows = stocks.filter(valuationReady).length;
    const financeDetail = settings.modules.finance
      ? financeErrorDetail
        ? `；财报接口未完成：${financeErrorDetail}`
        : `；财报字段匹配 ${financial.matchedRows} 只，估值可用 ${valuationReadyRows} 只${financial.reportDate ? `，报告期 ${financial.reportDate}` : ""}`
      : "";
    const marketDetail = merged.matchedRows
      ? `匹配 ${merged.matchedRows}/${merged.sourceRows} 条 AKShare A 股实时行情`
      : financial.matchedRows
        ? `AKShare 行情未匹配，已使用财报接口补齐股票池（行情源行 ${merged.sourceRows} 条）`
        : `AKShare 行情未匹配，保留当前股票池（源行 ${merged.sourceRows} 条）`;
    const details = `${marketDetail}${financeDetail}；行情接口 ${marketRows.endpoint}`;

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
