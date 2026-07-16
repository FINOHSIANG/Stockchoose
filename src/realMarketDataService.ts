import type { Stock } from "./types";
import { marketDataCodeForStock } from "./stockIdentity";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RealMarketDataResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
  stocks: Stock[];
  matchedRows: number;
  sourceRows: number;
  technicalMatchedRows?: number;
  technicalSourceRows?: number;
}

export interface StockKlinePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockKlineHistoryResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  points: StockKlinePoint[];
  sourceRows: number;
}

export interface StockProfileResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
  stock: Stock;
  source: string;
}

export type StockKlinePeriod = "day" | "week" | "month";

interface NormalizedQuote {
  symbol: string;
  prefix: "sh" | "sz" | "bj";
  code: string;
  queryCode: string;
  name: string;
  price?: number;
  pctChange?: number;
  volumeWanShou?: number;
  amountYi?: number;
  amplitude?: number;
  turnover?: number;
  pe?: number;
  pb?: number;
  marketCapYi?: number;
  floatMarketCapYi?: number;
  industry2?: string;
  statusFlag?: string;
  marketType?: string;
}

const BUN_TENCENT_QUOTE_ROWS_BASE = "/api/market/tencent/quote-rows";
const BUN_TENCENT_ASHARE_QUOTE_ROWS_URL = "/api/market/tencent/ashare/quotes";
const BUN_TENCENT_KLINE_POINTS_BASE = "/api/market/tencent/kline-points";
const BUN_TECHNICAL_INDICATORS_BASE = "/api/market/technical-indicators";
const BUN_STOCK_PROFILE_BASE = "/api/market/stock";
const TECHNICAL_INDICATOR_CODE_LIMIT = 200;
const TECHNICAL_INDICATOR_KLINE_LIMIT = 120;
const LISTED_ASHARE_CODE_PATTERN = /^(60[0-5]|688|689|000|001|002|003|300|301|302|920)\d{3}$/;
const EMPTY_PROFILE_VALUES = new Set(["", "-", "--", "暂无", "未披露", "未分类", "腾讯行情", "东方财富行情"]);

interface BunTechnicalIndicatorRow {
  code?: unknown;
  name?: unknown;
  reportDate?: unknown;
  sourceRows?: unknown;
  metrics?: Record<string, unknown>;
}

interface NormalizedTechnicalIndicatorRow {
  code: string;
  sourceRows: number;
  reportDate?: string;
  metrics: Record<string, number>;
}

interface BunStockProfilePayload {
  code?: unknown;
  name?: unknown;
  website?: unknown;
  industry1?: unknown;
  industry2?: unknown;
  industryTags?: unknown;
  source?: unknown;
}

interface NormalizedStockProfile {
  code: string;
  name: string;
  website?: string;
  industry1?: string;
  industry2?: string;
  industryTags: string[];
  source: string;
}

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === undefined || value === null) return undefined;
  const raw = String(value).replace(/,/g, "").trim();
  if (!raw || raw === "-" || raw === "--") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const round = (value: number, precision = 2) => {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
};

const tencentSymbolForStock = (stock: Stock) => {
  const marketDataCode = marketDataCodeForStock(stock);
  if (stock.exchange === "沪市") return `sh${stock.code}`;
  if (stock.exchange === "北交所") return `bj${marketDataCode}`;
  return `sz${stock.code}`;
};

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const withMetric = (metrics: Record<string, number>, key: string, value: number | undefined, precision = 2) => {
  if (value === undefined || !Number.isFinite(value)) return metrics;
  return { ...metrics, [key]: round(value, precision) };
};

const TENCENT_KLINE_PERIOD_CODE: Record<StockKlinePeriod, string> = {
  day: "day",
  week: "week",
  month: "month"
};

const KLINE_PERIOD_LABEL: Record<StockKlinePeriod, string> = {
  day: "日K",
  week: "周K",
  month: "月K"
};

const KLINE_PERIOD_LIMIT: Record<StockKlinePeriod, number> = {
  day: 80,
  week: 120,
  month: 120
};

function stockKlinePointsFromPayload(payload: unknown): StockKlinePoint[] {
  if (!Array.isArray(payload)) throw new Error("Bun Tencent K线接口返回结构无效：根节点不是数组");
  const points = payload
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const point = row as Partial<StockKlinePoint>;
      const open = toNumber(point.open);
      const close = toNumber(point.close);
      const high = toNumber(point.high);
      const low = toNumber(point.low);
      const volume = toNumber(point.volume);
      if (!point.date || [open, close, high, low, volume].some((value) => value === undefined)) return null;
      return {
        date: String(point.date),
        open: round(open ?? 0, 2),
        close: round(close ?? 0, 2),
        high: round(high ?? 0, 2),
        low: round(low ?? 0, 2),
        volume: round(volume ?? 0, 2)
      } satisfies StockKlinePoint;
    })
    .filter((point): point is StockKlinePoint => Boolean(point));
  if (payload.length && !points.length) throw new Error("Bun Tencent K线接口返回结构无效：未识别到有效K线点");
  return points;
}

function normalizedQuoteRowsFromPayload(payload: unknown): NormalizedQuote[] {
  if (!Array.isArray(payload)) throw new Error("Bun Tencent quote API returned invalid quote rows payload");
  const rows = payload.filter((row): row is NormalizedQuote => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const quote = row as Partial<NormalizedQuote>;
    return Boolean(
      typeof quote.symbol === "string" &&
        (quote.prefix === "sh" || quote.prefix === "sz" || quote.prefix === "bj") &&
        typeof quote.code === "string" &&
        /^\d{6}$/.test(quote.code) &&
        typeof quote.name === "string" &&
        quote.name.trim()
    );
  });
  if (payload.length && !rows.length) throw new Error("Bun Tencent quote API returned invalid quote rows payload");
  return rows;
}

function normalizeTechnicalIndicatorRow(row: BunTechnicalIndicatorRow): NormalizedTechnicalIndicatorRow | null {
  const digits = String(row.code ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const code = digits.padStart(6, "0").slice(-6);
  const rawMetrics = row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics) ? row.metrics : {};
  const metrics = Object.entries(rawMetrics).reduce<Record<string, number>>((result, [key, value]) => {
    const parsed = toNumber(value);
    if (parsed !== undefined) result[key] = parsed;
    return result;
  }, {});
  if (!Object.keys(metrics).length) return null;
  return {
    code,
    sourceRows: Math.max(1, Math.round(toNumber(row.sourceRows) ?? 1)),
    reportDate: row.reportDate === undefined || row.reportDate === null ? undefined : String(row.reportDate),
    metrics
  };
}

function technicalIndicatorRowsFromPayload(payload: unknown): NormalizedTechnicalIndicatorRow[] {
  if (!Array.isArray(payload)) throw new Error("Bun technical indicator API returned invalid payload");
  const rows = payload
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      return normalizeTechnicalIndicatorRow(row as BunTechnicalIndicatorRow);
    })
    .filter((row): row is NormalizedTechnicalIndicatorRow => Boolean(row));
  if (payload.length && !rows.length) throw new Error("Bun technical indicator API returned invalid payload");
  return rows;
}

const usefulProfileText = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return !EMPTY_PROFILE_VALUES.has(text) ? text : undefined;
};

const normalizeProfileWebsite = (value: unknown) => {
  const text = usefulProfileText(value);
  if (!text) return undefined;
  const token =
    text
      .split(/[\s,，;；|]+/)
      .find((item) => item.includes(".")) ?? text;
  const trimmed = token.trim().replace(/[。；;，,]+$/g, "");
  if (!trimmed || EMPTY_PROFILE_VALUES.has(trimmed)) return undefined;
  if (/^https?:\/\//i.test(trimmed) && trimmed.includes(".")) return trimmed;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return undefined;
};

const profileTextList = (value: unknown) => {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，;；、|]+/) : [];
  return values.map(usefulProfileText).filter((item): item is string => Boolean(item));
};

const compactProfileTags = (values: Array<string | undefined>) => {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const text = usefulProfileText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result;
};

function stockProfileFromPayload(payload: unknown): NormalizedStockProfile {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Bun Eastmoney F10 profile API returned invalid payload");
  }
  const row = payload as BunStockProfilePayload;
  return {
    code: usefulProfileText(row.code) ?? "",
    name: usefulProfileText(row.name) ?? "",
    website: normalizeProfileWebsite(row.website),
    industry1: usefulProfileText(row.industry1),
    industry2: usefulProfileText(row.industry2),
    industryTags: compactProfileTags(profileTextList(row.industryTags)),
    source: usefulProfileText(row.source) ?? "eastmoney-f10"
  };
}

function mergeStockProfile(stock: Stock, profile: NormalizedStockProfile): Stock {
  const industry1 = profile.industry1 ?? stock.industry1;
  const industry2 = profile.industry2 ?? stock.industry2;
  const industryTags = compactProfileTags([
    ...(stock.industryTags ?? []),
    industry1,
    industry2,
    ...profile.industryTags
  ]);
  return {
    ...stock,
    website: profile.website ?? stock.website,
    industry1,
    industry2,
    industryTags: industryTags.length ? industryTags : stock.industryTags
  };
}

async function responseErrorSuffix(response: Response) {
  const detail = await response.text().catch(() => "");
  const trimmed = detail.trim();
  return trimmed ? `: ${trimmed.slice(0, 300)}` : "";
}

async function jsonFromResponse(response: Response, label: string) {
  try {
    return await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${label} returned invalid JSON: ${detail}`);
  }
}

async function fetchBunTencentQuoteRowsBySymbols(symbols: string[], fetchImpl: FetchLike) {
  const rows: NormalizedQuote[] = [];
  for (const group of chunk(symbols, 80)) {
    const response = await fetchImpl(`${BUN_TENCENT_QUOTE_ROWS_BASE}?q=${encodeURIComponent(group.join(","))}`);
    if (!response.ok) throw new Error(`Bun Tencent quote API HTTP ${response.status}${await responseErrorSuffix(response)}`);
    rows.push(...normalizedQuoteRowsFromPayload(await jsonFromResponse(response, "Bun Tencent quote API")));
  }
  return rows;
}

async function fetchBunTencentAshareQuoteRows(fetchImpl: FetchLike) {
  const response = await fetchImpl(BUN_TENCENT_ASHARE_QUOTE_ROWS_URL);
  if (!response.ok) throw new Error(`Bun Tencent all-A-share quote API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return normalizedQuoteRowsFromPayload(await jsonFromResponse(response, "Bun Tencent all-A-share quote API"));
}

function stockListedAshareCode(stock: Stock) {
  const digits = marketDataCodeForStock(stock).replace(/\D/g, "").padStart(6, "0").slice(-6);
  return LISTED_ASHARE_CODE_PATTERN.test(digits) ? digits : undefined;
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

function technicalIndicatorCodesForStocks(stocks: Stock[]) {
  const seen = new Set<string>();
  const codes: string[] = [];
  [...stocks]
    .sort((left, right) => technicalIndicatorSortScore(right) - technicalIndicatorSortScore(left))
    .forEach((stock) => {
      const code = stockListedAshareCode(stock);
      if (code && !seen.has(code)) {
        seen.add(code);
        codes.push(code);
      }
    });
  return codes.slice(0, TECHNICAL_INDICATOR_CODE_LIMIT);
}

async function fetchBunTechnicalIndicatorRows(stocks: Stock[], fetchImpl: FetchLike) {
  const codes = technicalIndicatorCodesForStocks(stocks);
  if (!codes.length) return [];
  const params = new URLSearchParams({
    codes: codes.join(","),
    limit: String(TECHNICAL_INDICATOR_KLINE_LIMIT)
  });
  const response = await fetchImpl(`${BUN_TECHNICAL_INDICATORS_BASE}?${params.toString()}`);
  if (!response.ok) throw new Error(`Bun technical indicator API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  return technicalIndicatorRowsFromPayload(await jsonFromResponse(response, "Bun technical indicator API"));
}

async function fetchTencentQuoteRows(stocks: Stock[], fetchImpl: FetchLike) {
  return fetchBunTencentQuoteRowsBySymbols(stocks.map(tencentSymbolForStock), fetchImpl);
}

interface TencentStockCandidate {
  symbol: string;
  prefix: NormalizedQuote["prefix"];
  code: string;
}

const pad6 = (value: number) => String(value).padStart(6, "0");

function rangeCandidates(prefix: NormalizedQuote["prefix"], start: number, end: number): TencentStockCandidate[] {
  const result: TencentStockCandidate[] = [];
  for (let code = start; code <= end; code += 1) {
    const padded = pad6(code);
    result.push({ symbol: `${prefix}${padded}`, prefix, code: padded });
  }
  return result;
}

export function generateTencentAshareCandidates() {
  return [
    ...rangeCandidates("sh", 600000, 605999),
    ...rangeCandidates("sh", 688000, 689999),
    ...rangeCandidates("sz", 1, 3999),
    ...rangeCandidates("sz", 300000, 302999),
    ...rangeCandidates("bj", 920000, 920999)
  ];
}

function exchangeForQuotePrefix(prefix: NormalizedQuote["prefix"]): Stock["exchange"] {
  if (prefix === "sh") return "沪市";
  if (prefix === "bj") return "北交所";
  return "深市";
}

function boardForQuote(prefix: NormalizedQuote["prefix"], code: string): Stock["board"] {
  if (prefix === "bj") return "北交所";
  if (prefix === "sh" && /^(688|689)/.test(code)) return "科创板";
  if (prefix === "sz" && /^(300|301|302)/.test(code)) return "创业板";
  return "主板";
}

function quoteStorageKey(prefix: NormalizedQuote["prefix"], code: string) {
  return `${exchangeForQuotePrefix(prefix)}:${code}`;
}

function isActiveAshareQuote(row: NormalizedQuote) {
  if (!row.name || !row.code || !row.price || row.price <= 0) return false;
  if (row.statusFlag === "D" || row.statusFlag === "C") return false;
  if (!row.marketCapYi || row.marketCapYi <= 0) return false;
  const marketType = row.marketType ?? "";
  return row.prefix === "bj" || marketType.includes("GP-A") || marketType.includes("GP");
}

function quoteDerivedMetric(row: NormalizedQuote): Record<string, number> {
  let metrics: Record<string, number> = { realQuoteSource: 1 };
  metrics = withMetric(metrics, "price", row.price);
  metrics = withMetric(metrics, "pctChange", row.pctChange);
  metrics = withMetric(metrics, "relativeChange", row.pctChange === undefined ? undefined : row.pctChange - 0.25);
  metrics = withMetric(metrics, "amount", row.amountYi);
  metrics = withMetric(metrics, "volume", row.volumeWanShou);
  metrics = withMetric(metrics, "priceAmplitude", row.amplitude);
  metrics = withMetric(metrics, "turnover", row.turnover);
  metrics = withMetric(metrics, "pe", row.pe);
  metrics = withMetric(metrics, "pb", row.pb);
  metrics = withMetric(metrics, "marketCap", row.marketCapYi);
  metrics = withMetric(metrics, "floatMarketCap", row.floatMarketCapYi);
  metrics = withMetric(metrics, "limitFlag", row.pctChange === undefined ? undefined : row.pctChange >= 9.8 ? 1 : row.pctChange <= -9.8 ? -1 : 0, 0);
  metrics = withMetric(metrics, "intradayStrength", row.pctChange === undefined ? undefined : Math.max(0, Math.min(100, 50 + row.pctChange * 4)));
  metrics = withMetric(metrics, "min15Momentum", row.pctChange === undefined ? undefined : row.pctChange / 4);
  return metrics;
}

const technicalMetricPrecision = (key: string) =>
  key.startsWith("real") || key.endsWith("Date") || key.endsWith("Source") || key.endsWith("Count") || key.endsWith("Shares") || key.endsWith("Days")
    ? 0
    : 2;

function mergeTechnicalIndicatorRows(stocks: Stock[], rows: NormalizedTechnicalIndicatorRow[]) {
  const rowByCode = new Map(rows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const mergedStocks = stocks.map((stock) => {
    const code = stockListedAshareCode(stock);
    const row = code ? rowByCode.get(code) : undefined;
    if (!row) return stock;

    let metrics = { ...stock.metrics };
    Object.entries(row.metrics).forEach(([key, value]) => {
      metrics = withMetric(metrics, key, value, technicalMetricPrecision(key));
    });
    if (metrics.realTechnicalSource === 1) matchedRows += 1;

    return { ...stock, metrics };
  });

  return {
    stocks: mergedStocks,
    matchedRows,
    sourceRows: rows.reduce((sum, row) => sum + row.sourceRows, 0),
    reportDate: rows.find((row) => row.reportDate)?.reportDate
  };
}

function buildStockFromTencentQuote(row: NormalizedQuote): Stock {
  const exchange = exchangeForQuotePrefix(row.prefix);
  const board = boardForQuote(row.prefix, row.code);
  const quoteIndustry = row.industry2?.trim();
  return {
    code: row.code,
    name: row.name,
    exchange,
    board,
    industry1: "未分类",
    industry2: quoteIndustry || "\u817e\u8baf\u884c\u60c5",
    industryTags: quoteIndustry ? [quoteIndustry] : [],
    region: "未披露",
    property: "民企",
    isST: row.name.includes("ST"),
    isSuspended: (row.volumeWanShou ?? 0) === 0 && (row.amountYi ?? 0) === 0,
    isSTAR: board === "科创板",
    isMargin: false,
    indexes: [],
    metrics: quoteDerivedMetric(row)
  };
}

const realFinancialMetricKeys = [
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
  "nonInterestBearingDebt",
  "inventory",
  "receivables",
  "roe",
  "roa",
  "grossMargin",
  "netMargin",
  "revenueGrowth",
  "profitGrowth",
  "debtRatio",
  "currentRatio",
  "assetTurnover",
  "cashProfitRatio",
  "qualityScore",
  "realAnnualReportSource",
  "realFinancialReportDate",
  "realFinancialReportDisclosureDate",
  "realAnnualReportDate",
  "realAnnualReportDisclosureDate",
  "realAnalystForecastSource",
  "targetPriceLow",
  "targetPriceMid",
  "targetPriceHigh",
  "targetUpside",
  "epsForecastGrowth",
  "realMarginSource",
  "marginBalance",
  "financingBalance",
  "securitiesLendingBalance",
  "financingBuyAmount",
  "financingRepayAmount",
  "financingNetBuyAmount",
  "marginTradeDate"
];

function stockQuoteKeys(stock: Stock) {
  const marketCode = marketDataCodeForStock(stock);
  const prefix: NormalizedQuote["prefix"] = stock.exchange === "沪市" ? "sh" : stock.exchange === "北交所" ? "bj" : "sz";
  return Array.from(new Set([stock.code, marketCode, quoteStorageKey(prefix, stock.code), quoteStorageKey(prefix, marketCode)]));
}

function stocksByQuoteKey(stocks: Stock[]) {
  const map = new Map<string, Stock>();
  stocks.forEach((stock) => {
    stockQuoteKeys(stock).forEach((key) => {
      if (!map.has(key)) map.set(key, stock);
    });
  });
  return map;
}

function realFinancialMetrics(metrics: Record<string, number>) {
  if (metrics.realAnnualReportSource !== 1 && metrics.realAnalystForecastSource !== 1 && metrics.realMarginSource !== 1) {
    return {};
  }
  return realFinancialMetricKeys.reduce<Record<string, number>>((result, key) => {
    const value = metrics[key];
    if (Number.isFinite(value)) result[key] = value;
    return result;
  }, {});
}

function usefulExistingText(value: string, defaults: string[]) {
  return value && !defaults.includes(value) ? value : "";
}

function mergeExistingStockWithTencentQuote(existing: Stock | undefined, quoteStock: Stock): Stock {
  if (!existing) return quoteStock;
  const preservedMetrics = realFinancialMetrics(existing.metrics);
  const hasRealFinancialData = Object.keys(preservedMetrics).length > 0;
  return {
    ...quoteStock,
    industry1: hasRealFinancialData ? usefulExistingText(existing.industry1, ["未分类"]) || quoteStock.industry1 : quoteStock.industry1,
    industry2: hasRealFinancialData ? usefulExistingText(existing.industry2, ["未分类", "腾讯行情"]) || quoteStock.industry2 : quoteStock.industry2,
    website: existing.website,
    industryTags: existing.industryTags,
    region: hasRealFinancialData ? usefulExistingText(existing.region, ["未分类", "未披露"]) || quoteStock.region : quoteStock.region,
    property: hasRealFinancialData ? existing.property || quoteStock.property : quoteStock.property,
    isMargin: hasRealFinancialData ? existing.isMargin || quoteStock.isMargin : quoteStock.isMargin,
    indexes: hasRealFinancialData && existing.indexes.length ? existing.indexes : quoteStock.indexes,
    metrics: {
      ...preservedMetrics,
      ...quoteStock.metrics
    }
  };
}

async function fetchTencentKlinePoints(stock: Stock, period: StockKlinePeriod, fetchImpl: FetchLike) {
  const symbol = tencentSymbolForStock(stock);
  const bunParams = new URLSearchParams({
    symbol,
    period: TENCENT_KLINE_PERIOD_CODE[period],
    limit: String(KLINE_PERIOD_LIMIT[period])
  });
  const response = await fetchImpl(`${BUN_TENCENT_KLINE_POINTS_BASE}?${bunParams.toString()}`);
  if (!response.ok) throw new Error(`Bun Tencent K线接口 HTTP ${response.status}`);
  const points = stockKlinePointsFromPayload(await jsonFromResponse(response, "Bun Tencent kline API"));
  if (!points.length) throw new Error("Bun Tencent K线接口未返回有效历史行情");
  return {
    points,
    source: response.headers.get("x-stockchoose-market-source") === "eastmoney-fallback" ? "eastmoney-fallback" as const : "tencent" as const
  };
}

const klineErrorText = (error: unknown) => (error instanceof Error ? error.message : "未知网络错误");

export async function fetchStockKlineHistory(
  stock: Stock,
  period: StockKlinePeriod = "day",
  fetchImpl: FetchLike = fetch
): Promise<StockKlineHistoryResult> {
  const checkedAt = new Date().toISOString();

  try {
    const { points, source } = await fetchTencentKlinePoints(stock, period, fetchImpl);
    const visiblePoints = points.slice(-KLINE_PERIOD_LIMIT[period]);
    return {
      ok: true,
      checkedAt,
      message: source === "eastmoney-fallback"
        ? `腾讯 K 线暂不可用，已加载东方财富备用${KLINE_PERIOD_LABEL[period]}历史行情`
        : `已加载腾讯真实${KLINE_PERIOD_LABEL[period]}历史行情`,
      points: visiblePoints,
      sourceRows: points.length
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      message: `K线获取失败：${klineErrorText(error)}`,
      points: [],
      sourceRows: 0
    };
  }
}

export async function fetchStockProfileAutoMatch(
  stock: Stock,
  fetchImpl: FetchLike = fetch,
  forceRefresh = false
): Promise<StockProfileResult> {
  const checkedAt = new Date().toISOString();
  try {
    const params = new URLSearchParams();
    const queryFields = [
      ["name", stock.name],
      ["industry1", stock.industry1],
      ["industry2", stock.industry2]
    ] as const;
    queryFields.forEach(([key, value]) => {
      const text = usefulProfileText(value);
      if (text) params.set(key, text);
    });
    if (forceRefresh) params.set("force", "1");

    const code = encodeURIComponent(marketDataCodeForStock(stock));
    const query = params.toString();
    const response = await fetchImpl(`${BUN_STOCK_PROFILE_BASE}/${code}/profile${query ? `?${query}` : ""}`);
    if (!response.ok) {
      throw new Error(`Bun Eastmoney F10 profile API HTTP ${response.status}${await responseErrorSuffix(response)}`);
    }

    const profile = stockProfileFromPayload(await jsonFromResponse(response, "Bun Eastmoney F10 profile API"));
    const nextStock = mergeStockProfile(stock, profile);
    const matched = Boolean(profile.website || profile.industry1 || profile.industry2 || profile.industryTags.length);
    if (!matched) {
      return {
        ok: false,
        checkedAt,
        message: "官网/行业标签自动匹配未返回新增字段",
        details: `Bun ${profile.source} 已请求 ${stock.name}(${stock.code})，但未返回官网或行业标签`,
        stock,
        source: profile.source
      };
    }

    return {
      ok: true,
      checkedAt,
      message: "官网/行业标签自动匹配完成",
      details: `Bun ${profile.source} 匹配 ${profile.name || stock.name}，${profile.website ? "官网已更新" : "官网未返回"}，行业标签 ${nextStock.industryTags?.length ?? 0} 个`,
      stock: nextStock,
      source: profile.source
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      message: "官网/行业标签自动匹配失败",
      details: error instanceof Error ? error.message : "未知网络错误",
      stock,
      source: "eastmoney-f10"
    };
  }
}

export async function syncTencentAllAshareMarketData(
  seedStocks: Stock[],
  fetchImpl: FetchLike = fetch
): Promise<RealMarketDataResult> {
  const checkedAt = new Date().toISOString();
  try {
    const candidates = generateTencentAshareCandidates();
    const rows = await fetchBunTencentAshareQuoteRows(fetchImpl);
    const existingByKey = stocksByQuoteKey(seedStocks);
    const stockByKey = new Map<string, Stock>();

    rows.filter(isActiveAshareQuote).forEach((row) => {
      const key = quoteStorageKey(row.prefix, row.code);
      const quoteStock = buildStockFromTencentQuote(row);
      stockByKey.set(key, mergeExistingStockWithTencentQuote(existingByKey.get(key) ?? existingByKey.get(row.code), quoteStock));
    });

    const stocks = Array.from(stockByKey.values()).sort((a, b) => {
      const exchangeOrder = a.exchange.localeCompare(b.exchange);
      return exchangeOrder || a.code.localeCompare(b.code);
    });

    if (!stocks.length) {
      return {
        ok: false,
        checkedAt,
        message: "全市场接入失败",
        details: "Bun Tencent 全市场行情接口未识别到有效 A 股股票",
        stocks: seedStocks,
        matchedRows: 0,
        sourceRows: rows.length
      };
    }

    let technicalStocks = stocks;
    let technicalMatchedRows = 0;
    let technicalSourceRows = 0;
    let technicalDetail = "";
    try {
      const technicalRows = await fetchBunTechnicalIndicatorRows(stocks, fetchImpl);
      const technical = mergeTechnicalIndicatorRows(stocks, technicalRows);
      technicalStocks = technical.stocks;
      technicalMatchedRows = technical.matchedRows;
      technicalSourceRows = technical.sourceRows;
      technicalDetail = `；Bun 技术指标匹配 ${technicalMatchedRows}/${technicalRows.length} 只${technical.reportDate ? `，交易日 ${technical.reportDate}` : ""}`;
    } catch (error) {
      technicalDetail = `；Bun 技术指标未完成：${error instanceof Error ? error.message : "未知网络错误"}`;
    }

    return {
      ok: true,
      checkedAt,
      message: "全市场接入完成",
      details: `Bun Tencent 行情采集候选 ${candidates.length} 个代码，返回 ${rows.length} 行结果，识别 ${stocks.length} 只有效 A 股股票，已更新价格、市值、PE、PB、成交等真实行情字段${technicalDetail}`,
      stocks: technicalStocks,
      matchedRows: stocks.length,
      sourceRows: rows.length,
      technicalMatchedRows,
      technicalSourceRows
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      message: "全市场接入失败",
      details: error instanceof Error ? error.message : "未知网络错误",
      stocks: seedStocks,
      matchedRows: 0,
      sourceRows: 0
    };
  }
}

export async function syncTencentRealMarketData(
  baseStocks: Stock[],
  fetchImpl: FetchLike = fetch
): Promise<RealMarketDataResult> {
  const checkedAt = new Date().toISOString();
  try {
    const tencentRows = await fetchTencentQuoteRows(baseStocks, fetchImpl);
    const quoteByCode = new Map(tencentRows.map((row) => [row.code, row]));
    let matchedRows = 0;

    const stocks = baseStocks.map((stock) => {
      const quote = quoteByCode.get(stock.code) ?? quoteByCode.get(marketDataCodeForStock(stock));
      if (!quote) return stock;
      matchedRows += 1;

      const realPrice = quote.price;
      const realPctChange = quote.pctChange;
      const amountYi = quote.amountYi;
      const volumeWanShou = quote.volumeWanShou;
      const marketCapYi = quote.marketCapYi;
      const floatMarketCapYi = quote.floatMarketCapYi;

      let metrics = { ...stock.metrics };
      metrics = withMetric(metrics, "price", realPrice);
      metrics = withMetric(metrics, "pctChange", realPctChange);
      metrics = withMetric(metrics, "relativeChange", realPctChange === undefined ? undefined : realPctChange - 0.25);
      metrics = withMetric(metrics, "amount", amountYi);
      metrics = withMetric(metrics, "volume", volumeWanShou);
      metrics = withMetric(metrics, "priceAmplitude", quote.amplitude);
      metrics = withMetric(metrics, "turnover", quote.turnover);
      metrics = withMetric(metrics, "pe", quote.pe);
      metrics = withMetric(metrics, "pb", quote.pb);
      metrics = withMetric(metrics, "marketCap", marketCapYi);
      metrics = withMetric(metrics, "floatMarketCap", floatMarketCapYi);
      metrics = withMetric(metrics, "realQuoteSource", quote.price === undefined ? undefined : 1, 0);
      metrics = withMetric(metrics, "limitFlag", realPctChange === undefined ? undefined : realPctChange >= 9.8 ? 1 : realPctChange <= -9.8 ? -1 : 0, 0);
      metrics = withMetric(metrics, "intradayStrength", realPctChange === undefined ? undefined : Math.max(0, Math.min(100, 50 + realPctChange * 4)));
      metrics = withMetric(metrics, "min15Momentum", realPctChange === undefined ? undefined : realPctChange / 4);

      return {
        ...stock,
        industry2: quote.industry2 ?? stock.industry2,
        metrics
      };
    });

    if (!matchedRows) {
      return {
        ok: false,
        checkedAt,
        message: "真实数据接入失败",
        details: "Bun Tencent 行情接口未匹配到当前股票池代码",
        stocks: baseStocks,
        matchedRows: 0,
        sourceRows: tencentRows.length
      };
    }

    return {
      ok: true,
      checkedAt,
      message: "真实数据接入完成",
      details: `Bun Tencent 真实行情匹配 ${matchedRows}/${baseStocks.length} 只股票，已更新价格、市值、PE、PB、成交等字段`,
      stocks,
      matchedRows,
      sourceRows: tencentRows.length
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      message: "真实数据接入失败",
      details: error instanceof Error ? error.message : "未知网络错误",
      stocks: baseStocks,
      matchedRows: 0,
      sourceRows: 0
    };
  }
}
