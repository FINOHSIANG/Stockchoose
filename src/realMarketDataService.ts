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

const TENCENT_QUOTE_BASE = "https://qt.gtimg.cn/q=";
const TENCENT_KLINE_BASE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const LOCAL_TENCENT_QUOTE_BASE = "/tencent-quote/q=";
const LOCAL_TENCENT_KLINE_BASE = "/tencent-kline/appstock/app/fqkline/get";

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

const keepCommaQuery = (params: URLSearchParams) => params.toString().replace(/%2C/g, ",");

const shouldUseLocalProxy = () =>
  typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname);

const quoteBaseUrl = () => (shouldUseLocalProxy() ? LOCAL_TENCENT_QUOTE_BASE : TENCENT_QUOTE_BASE);
const tencentKlineBaseUrl = () => (shouldUseLocalProxy() ? LOCAL_TENCENT_KLINE_BASE : TENCENT_KLINE_BASE);

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

function parseTencentKlineHistory(payload: unknown, symbol: string, period: StockKlinePeriod): StockKlinePoint[] {
  const periodKey = `qfq${TENCENT_KLINE_PERIOD_CODE[period]}`;
  const rows = (payload as { data?: Record<string, Record<string, unknown>> })?.data?.[symbol]?.[periodKey];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const parts = Array.isArray(row) ? row : String(row).split(",");
      if (parts.length < 6) return null;
      const open = toNumber(parts[1]);
      const close = toNumber(parts[2]);
      const high = toNumber(parts[3]);
      const low = toNumber(parts[4]);
      const volume = toNumber(parts[5]);
      if ([open, close, high, low, volume].some((value) => value === undefined)) return null;
      return {
        date: String(parts[0]),
        open: round(open ?? 0, 2),
        close: round(close ?? 0, 2),
        high: round(high ?? 0, 2),
        low: round(low ?? 0, 2),
        volume: round((volume ?? 0) / 10000, 2)
      } satisfies StockKlinePoint;
    })
    .filter((point): point is StockKlinePoint => Boolean(point));
}

function parseTencentQuoteLine(line: string): NormalizedQuote | null {
  const matched = line.match(/v_(sh|sz|bj)(\d{6})="([^"]*)"/);
  if (!matched) return null;
  const prefix = matched[1] as NormalizedQuote["prefix"];
  const queryCode = matched[2];
  const parts = matched[3].split("~");
  const code = String(parts[2] || queryCode);
  const name = String(parts[1] || "").trim();
  return {
    symbol: `${prefix}${queryCode}`,
    prefix,
    code,
    queryCode,
    name,
    price: toNumber(parts[3]),
    pctChange: toNumber(parts[32]),
    volumeWanShou: toNumber(parts[36]) === undefined ? undefined : (toNumber(parts[36]) ?? 0) / 10000,
    amountYi: toNumber(parts[37]) === undefined ? undefined : (toNumber(parts[37]) ?? 0) / 10000,
    turnover: toNumber(parts[38]),
    pe: toNumber(parts[39]),
    marketCapYi: toNumber(parts[44]),
    floatMarketCapYi: toNumber(parts[45]),
    pb: toNumber(parts[46]),
    amplitude: toNumber(parts[43]),
    statusFlag: String(parts[40] || "").trim(),
    marketType: String(parts[61] || "").trim()
  };
}

async function readTencentQuoteText(response: Response) {
  const buffer = await response.arrayBuffer();
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  if (!utf8Text.includes("\uFFFD")) return utf8Text;

  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return new TextDecoder("gbk").decode(buffer);
  }
}

async function fetchTencentQuoteRows(stocks: Stock[], fetchImpl: FetchLike) {
  const rows: NormalizedQuote[] = [];
  for (const group of chunk(stocks, 80)) {
    try {
      const response = await fetchImpl(`${quoteBaseUrl()}${group.map(tencentSymbolForStock).join(",")}`);
      if (!response.ok) continue;
      const text = await readTencentQuoteText(response);
      rows.push(...text.split(";").map(parseTencentQuoteLine).filter((row): row is NormalizedQuote => Boolean(row)));
    } catch {
      continue;
    }
  }
  return rows;
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

async function fetchTencentQuoteRowsBySymbols(symbols: string[], fetchImpl: FetchLike) {
  const rows: NormalizedQuote[] = [];
  for (const group of chunk(symbols, 80)) {
    try {
      const response = await fetchImpl(`${quoteBaseUrl()}${group.join(",")}`);
      if (!response.ok) continue;
      const text = await readTencentQuoteText(response);
      rows.push(...text.split(";").map(parseTencentQuoteLine).filter((row): row is NormalizedQuote => Boolean(row)));
    } catch {
      continue;
    }
  }
  return rows;
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

function buildStockFromTencentQuote(row: NormalizedQuote): Stock {
  const exchange = exchangeForQuotePrefix(row.prefix);
  const board = boardForQuote(row.prefix, row.code);
  return {
    code: row.code,
    name: row.name,
    exchange,
    board,
    industry1: "未分类",
    industry2: row.industry2 ?? "腾讯行情",
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

async function fetchTencentKlinePoints(stock: Stock, period: StockKlinePeriod, fetchImpl: FetchLike) {
  const params = new URLSearchParams({
    param: `${tencentSymbolForStock(stock)},${TENCENT_KLINE_PERIOD_CODE[period]},,,${KLINE_PERIOD_LIMIT[period]},qfq`
  });
  const response = await fetchImpl(`${tencentKlineBaseUrl()}?${keepCommaQuery(params)}`);
  if (!response.ok) throw new Error(`腾讯HTTP ${response.status}`);
  const points = parseTencentKlineHistory(await response.json(), tencentSymbolForStock(stock), period);
  if (!points.length) throw new Error(`腾讯${KLINE_PERIOD_LABEL[period]}接口未返回有效历史行情`);
  return points;
}

const klineErrorText = (error: unknown) => (error instanceof Error ? error.message : "未知网络错误");

export async function fetchStockKlineHistory(
  stock: Stock,
  period: StockKlinePeriod = "day",
  fetchImpl: FetchLike = fetch
): Promise<StockKlineHistoryResult> {
  const checkedAt = new Date().toISOString();

  try {
    const points = await fetchTencentKlinePoints(stock, period, fetchImpl);
    const visiblePoints = points.slice(-KLINE_PERIOD_LIMIT[period]);
    return {
      ok: true,
      checkedAt,
      message: `已加载腾讯真实${KLINE_PERIOD_LABEL[period]}历史行情`,
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

export async function syncTencentAllAshareMarketData(
  seedStocks: Stock[],
  fetchImpl: FetchLike = fetch
): Promise<RealMarketDataResult> {
  const checkedAt = new Date().toISOString();
  try {
    const candidates = generateTencentAshareCandidates();
    const rows = await fetchTencentQuoteRowsBySymbols(candidates.map((candidate) => candidate.symbol), fetchImpl);
    const stockByKey = new Map<string, Stock>();

    rows.filter(isActiveAshareQuote).forEach((row) => {
      stockByKey.set(quoteStorageKey(row.prefix, row.code), buildStockFromTencentQuote(row));
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
        details: "腾讯行情接口有响应，但未识别到有效 A 股股票",
        stocks: seedStocks,
        matchedRows: 0,
        sourceRows: rows.length
      };
    }

    return {
      ok: true,
      checkedAt,
      message: "全市场接入完成",
      details: `腾讯行情扫描 ${candidates.length} 个候选代码，识别 ${stocks.length} 只有效 A 股股票，已更新价格、市值、PE、PB、成交等真实行情字段；未接入真实财报、现金流、资产负债字段前不生成价值核算结果`,
      stocks,
      matchedRows: stocks.length,
      sourceRows: rows.length
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
        details: "腾讯行情接口有响应，但没有匹配到当前股票池代码",
        stocks: baseStocks,
        matchedRows: 0,
        sourceRows: tencentRows.length
      };
    }

    return {
      ok: true,
      checkedAt,
      message: "真实数据接入完成",
      details: `腾讯真实行情匹配 ${matchedRows}/${baseStocks.length} 只股票，已更新价格、市值、PE、PB、成交等字段`,
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
