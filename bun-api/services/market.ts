import type { Stock } from "../../src/types";
import { cacheGetOrCreate, crawlerFetch, fetchJson, mapConcurrent } from "../crawler/engine";
import { persistentCacheGetOrCreate } from "../lib/persistentCache";
import { finiteDataNumber, latestAnnualReportDate } from "../../src/dataContracts";
import { fetchDatacenterRows } from "./datacenter";

const EASTMONEY_CLIST_URL = "https://push2delay.eastmoney.com/api/qt/clist/get";
const EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const EASTMONEY_DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const SPOT_FIELDS = "f12,f14,f2,f3,f5,f6,f8,f20,f21,f9,f23,f7,f24,f26,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184";
const A_SHARE_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
const ASHARE_FINANCE_FILTER = '(SECURITY_TYPE_CODE in ("058001001","058001008"))';
const EASTMONEY_SPOT_PAGE_SIZE = 100;
const EASTMONEY_MINIMUM_COVERAGE = 0.98;
const EASTMONEY_REQUEST_GAP_MS = 70;
const TENCENT_REQUEST_GAP_MS = 70;
const MARKET_FETCH_CONCURRENCY = 8;
const ASHARE_UNIVERSE_MEMORY_TTL_MS = 4 * 60 * 60 * 1000;
const ASHARE_UNIVERSE_PERSISTENT_TTL_MS = 24 * 60 * 60 * 1000;
const TENCENT_KLINE_CIRCUIT_MS = 5 * 60 * 1000;
const CLOSED_HISTORY_PERSISTENT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_HISTORY_PERSISTENT_CACHE_TTL_MS = 15 * 60 * 1000;
const KLINE_PERSISTENT_CACHE_TTL_MS = 5 * 60 * 1000;
let tencentKlineBlockedUntil = 0;

type EastmoneySpotRow = Record<string, unknown>;

export interface TencentQuoteRow {
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

export interface KlinePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const round = (value: number, precision = 2) => Math.round(value * 10 ** precision) / 10 ** precision;
export const asNumber = finiteDataNumber;
export const amountToYi = (value: unknown) => {
  const number = asNumber(value);
  return number === undefined ? undefined : round(number / 100000000, 2);
};
export const volumeToWanShou = (value: unknown) => {
  const number = asNumber(value);
  return number === undefined ? undefined : round(number / 10000, 2);
};

const tencentVolumeToWanShou = (value: unknown) => {
  const number = asNumber(value);
  return number === undefined ? undefined : number / 10000;
};

const tencentAmountWanYuanToYi = (value: unknown) => {
  const number = asNumber(value);
  return number === undefined ? undefined : number / 10000;
};

export function urlWithParams(base: string, params: Record<string, string>) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export function compactRow(entries: Array<[string, unknown]>) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function mapEastmoneySpotRow(row: Record<string, unknown>) {
  return compactRow([
    ["代码", row.f12],
    ["名称", row.f14],
    ["最新价", asNumber(row.f2)],
    ["涨跌幅", asNumber(row.f3)],
    ["成交量", asNumber(row.f5)],
    ["成交额", asNumber(row.f6)],
    ["换手率", asNumber(row.f8)],
    ["总市值", asNumber(row.f20)],
    ["流通市值", asNumber(row.f21)],
    ["市盈率-动态", asNumber(row.f9)],
    ["市净率", asNumber(row.f23)],
    ["振幅", asNumber(row.f7)],
    ["60日涨跌幅", asNumber(row.f24)],
    ["listingDate", asNumber(row.f26)],
    ["netInflow", asNumber(row.f62)],
    ["netInflowRatio", asNumber(row.f184)],
    ["code", row.f12],
    ["name", row.f14],
    ["price", asNumber(row.f2)],
    ["pctChange", asNumber(row.f3)],
    ["amount", amountToYi(row.f6)],
    ["volume", volumeToWanShou(row.f5)],
    ["turnover", asNumber(row.f8)],
    ["marketCap", amountToYi(row.f20)],
    ["floatMarketCap", amountToYi(row.f21)],
    ["pe", asNumber(row.f9)],
    ["pb", asNumber(row.f23)],
    ["momentum60", asNumber(row.f24)]
  ]);
}

export type KlineAdjustment = "qfq" | "none";

export function isSelectableEastmoneySpotRow(row: Record<string, unknown>) {
  const code = String(row.code ?? row["代码"] ?? "").trim();
  const price = asNumber(row.price ?? row["最新价"]);
  const marketCap = asNumber(row.marketCap ?? row["总市值"]);
  const floatMarketCap = asNumber(row.floatMarketCap ?? row["流通市值"]);
  return /^\d{6}$/.test(code)
    && price !== undefined
    && price > 0
    && marketCap !== undefined
    && marketCap > 0
    && floatMarketCap !== undefined
    && floatMarketCap > 0;
}

export function planEastmoneySpotPages(total: number, firstPageRowCount: number) {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Eastmoney spot did not provide a valid upstream total");
  }
  if (!Number.isFinite(firstPageRowCount) || firstPageRowCount <= 0) {
    throw new Error("Eastmoney spot first page returned no rows; cannot plan pagination");
  }
  return Math.ceil(total / firstPageRowCount);
}

function eastmoneySpotCode(row: EastmoneySpotRow) {
  const code = String(row.f12 ?? row.code ?? row["代码"] ?? "").trim();
  return /^\d{6}$/.test(code) ? code : "";
}

export function dedupeEastmoneySpotRows(rows: EastmoneySpotRow[]) {
  const uniqueRows = new Map<string, EastmoneySpotRow>();
  for (const row of rows) {
    const code = eastmoneySpotCode(row);
    if (code && !uniqueRows.has(code)) uniqueRows.set(code, row);
  }
  return [...uniqueRows.values()];
}

export function assertEastmoneySpotCompleteness(rows: EastmoneySpotRow[], upstreamTotal: number) {
  if (!Number.isFinite(upstreamTotal) || upstreamTotal <= 0) {
    throw new Error("Eastmoney spot completeness cannot be verified without a valid upstream total");
  }
  const coverage = rows.length / upstreamTotal;
  if (coverage < EASTMONEY_MINIMUM_COVERAGE) {
    throw new Error(
      `Eastmoney spot incomplete: ${rows.length}/${upstreamTotal} unique codes (${(coverage * 100).toFixed(2)}%) is below the required 98.00% coverage`
    );
  }
}

export function createEastmoneySpotPageUrl(page: number) {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("Eastmoney spot page must be a positive integer");
  }
  return urlWithParams(EASTMONEY_CLIST_URL, {
    pn: String(page),
    pz: String(EASTMONEY_SPOT_PAGE_SIZE),
    po: "0",
    np: "1",
    ut: EASTMONEY_UT,
    fltt: "2",
    invt: "2",
    fid: "f12",
    fs: A_SHARE_FS,
    fields: SPOT_FIELDS
  });
}

async function fetchPrimaryEastmoneySpotRows() {
  return cacheGetOrCreate<Record<string, unknown>[]>("eastmoney:spot:primary", 30000, async () => {
    const firstUrl = createEastmoneySpotPageUrl(1);
    const first = await fetchJsonWithRetry(firstUrl);
    const total = asNumber((first as any)?.data?.total) ?? 0;
    const firstRows = [...(((first as any)?.data?.diff ?? []) as EastmoneySpotRow[])];
    const pages = planEastmoneySpotPages(total, firstRows.length);
    const pageNumbers = Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2);
    const laterPages = await mapConcurrent(pageNumbers, MARKET_FETCH_CONCURRENCY, async (page) => {
      const payload = await fetchJsonWithRetry(createEastmoneySpotPageUrl(page));
      return (((payload as any)?.data?.diff ?? []) as EastmoneySpotRow[]);
    });
    const uniqueRows = dedupeEastmoneySpotRows([...firstRows, ...laterPages.flat()]);
    assertEastmoneySpotCompleteness(uniqueRows, total);
    return uniqueRows.map(mapEastmoneySpotRow).filter(isSelectableEastmoneySpotRow);
  });
}

function createAshareUniversePageUrl(reportDate: string, page: number) {
  return urlWithParams(EASTMONEY_DATACENTER_URL, {
    sortColumns: "SECURITY_CODE",
    sortTypes: "1",
    pageSize: "500",
    pageNumber: String(page),
    reportName: "RPT_LICO_FN_CPD",
    columns: "SECURITY_CODE,SECURITY_NAME_ABBR,SECUCODE,SECURITY_TYPE_CODE",
    source: "WEB",
    client: "WEB",
    filter: `${ASHARE_FINANCE_FILTER}(REPORTDATE='${reportDate}')`
  });
}

export function ashareUniverseCodesFromRows(rows: Record<string, unknown>[]) {
  const codes = rows.flatMap((row) => {
    if (row.SECURITY_TYPE_CODE && !["058001001", "058001008"].includes(String(row.SECURITY_TYPE_CODE))) return [];
    if (String(row.SECUCODE ?? "").endsWith(".NQ")) return [];
    const raw = String(row.SECURITY_CODE ?? row.SECUCODE ?? "").trim();
    const match = raw.match(/^(?:(?:SH|SZ|BJ))?(\d{6})(?:\.(?:SH|SZ|BJ))?$/iu);
    return match?.[1] && match[1] !== "000000" ? [match[1]] : [];
  });
  return Array.from(new Set(codes)).sort();
}

async function fetchAshareUniverseCodes() {
  const compactReportDate = latestAnnualReportDate();
  const reportDate = `${compactReportDate.slice(0, 4)}-${compactReportDate.slice(4, 6)}-${compactReportDate.slice(6, 8)}`;
  return cacheGetOrCreate(`eastmoney:ashare-universe:${compactReportDate}`, ASHARE_UNIVERSE_MEMORY_TTL_MS, () =>
    persistentCacheGetOrCreate("ashare-universe-v1", compactReportDate, ASHARE_UNIVERSE_PERSISTENT_TTL_MS, async () => {
      const rows = await fetchDatacenterRows((page) => createAshareUniversePageUrl(reportDate, page), { maxPages: 30 });
      const codes = ashareUniverseCodesFromRows(rows);
      if (codes.length < 4000) throw new Error(`A-share universe coverage is unexpectedly low: ${codes.length}`);
      return codes;
    })
  );
}

export async function fetchEastmoneySpotRows() {
  return cacheGetOrCreate<Record<string, unknown>[]>("eastmoney:spot", 30000, async () => {
    try {
      return await fetchPrimaryEastmoneySpotRows();
    } catch {
      const rows = (await fetchTencentAshareQuoteRows()).map(mapTencentQuoteToMarketRow).filter(isSelectableEastmoneySpotRow);
      if (!rows.length) throw new Error("Full-market spot fallback returned no selectable rows");
      return rows;
    }
  });
}

async function fetchJsonWithRetry(url: URL, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url, { headers: { referer: "https://quote.eastmoney.com/" } }, 30000, EASTMONEY_REQUEST_GAP_MS);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 1000));
    }
  }
  throw lastError;
}

async function fetchTencentJsonWithRetry(url: URL, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url, { headers: { referer: "https://gu.qq.com/" } }, 20000, TENCENT_REQUEST_GAP_MS);
    } catch (error) {
      lastError = error;
      if (/upstream HTTP (403|501)/.test(String(error))) break;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 + attempt * 500));
    }
  }
  throw lastError;
}

function eastmoneySecid(code: string) {
  return `${code.startsWith("6") || code.startsWith("9") ? "1" : "0"}.${code}`;
}

export async function fetchEastmoneyHistRows(query: Record<string, string>) {
  const code = String(query.symbol ?? query.code ?? "000001").replace(/\D/g, "").padStart(6, "0").slice(-6);
  const startDate = query.start_date ?? "20240501";
  const endDate = query.end_date ?? "20240531";
  const adjusted = query.adjust ? "1" : "0";
  const url = urlWithParams(EASTMONEY_KLINE_URL, {
    secid: eastmoneySecid(code),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57",
    klt: "101",
    fqt: adjusted,
    beg: startDate,
    end: endDate
  });
  const cacheKey = `eastmoney:hist:${code}:${startDate}:${endDate}:${adjusted}`;
  const endTimestamp = Date.UTC(Number(endDate.slice(0, 4)), Number(endDate.slice(4, 6)) - 1, Number(endDate.slice(6, 8)));
  const closedRange = Number.isFinite(endTimestamp) && endTimestamp < Date.now() - 7 * 24 * 60 * 60 * 1000;
  const persistentTtlMs = closedRange ? CLOSED_HISTORY_PERSISTENT_CACHE_TTL_MS : RECENT_HISTORY_PERSISTENT_CACHE_TTL_MS;
  return cacheGetOrCreate<Record<string, unknown>[]>(cacheKey, 60000, () =>
    persistentCacheGetOrCreate("eastmoney-history", `${code}:${startDate}:${endDate}:${adjusted}`, persistentTtlMs, async () => {
      const payload = await fetchJson(url, {}, 20000, EASTMONEY_REQUEST_GAP_MS);
      const rows = (((payload as any)?.data?.klines ?? []) as string[]).map((line) => {
        const parts = line.split(",");
        return compactRow([
          ["日期", parts[0]],
          ["开盘", asNumber(parts[1])],
          ["收盘", asNumber(parts[2])],
          ["最高", asNumber(parts[3])],
          ["最低", asNumber(parts[4])],
          ["成交量", asNumber(parts[5])],
          ["成交额", asNumber(parts[6])],
          ["date", parts[0]],
          ["open", asNumber(parts[1])],
          ["close", asNumber(parts[2])],
          ["high", asNumber(parts[3])],
          ["low", asNumber(parts[4])],
          ["volume", asNumber(parts[5])]
        ]);
      });
      if (!rows.length) throw new Error("Eastmoney hist returned no rows");
      return rows;
    })
  );
}

function tencentSymbolFromCode(code: string) {
  const digits = code.replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (/^[48]|^92/.test(digits)) return `bj${digits}`;
  if (/^[69]/.test(digits)) return `sh${digits}`;
  return `sz${digits}`;
}

function normalizeTencentSymbol(value: string) {
  const raw = value.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw;
  return tencentSymbolFromCode(raw);
}

export function tencentSymbolsFromQuery(raw: string | null | undefined) {
  const symbols = String(raw ?? "sh600519")
    .split(/[,;\s]+/)
    .map(normalizeTencentSymbol)
    .filter(Boolean);
  return Array.from(new Set(symbols)).slice(0, 120);
}

export async function fetchTencentQuoteText(symbols: string[]) {
  const cacheKey = `tencent:quote:${symbols.join(",")}`;
  return cacheGetOrCreate<string>(cacheKey, 1000, async () => {
    const url = new URL("https://qt.gtimg.cn/q=" + encodeURIComponent(symbols.join(",")));
    const response = await crawlerFetch(url, { headers: { referer: "https://gu.qq.com/" } }, 20000, TENCENT_REQUEST_GAP_MS);
    if (!response.ok) throw new Error(`Tencent quote HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    return new TextDecoder("gb18030").decode(bytes);
  });
}

export function parseTencentQuoteRows(text: string): TencentQuoteRow[] {
  return text
    .split(/;\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const symbol = line.match(/^v_([^=]+)=/)?.[1] ?? "";
      const payload = line.match(/="(.*)"$/)?.[1] ?? "";
      const fields = payload.split("~");
      const prefix = symbol.slice(0, 2) as "sh" | "sz" | "bj";
      const code = symbol.slice(2);
      return {
        symbol,
        prefix,
        code,
        queryCode: symbol,
        name: fields[1] || code,
        price: asNumber(fields[3]),
        pctChange: asNumber(fields[32]),
        volumeWanShou: tencentVolumeToWanShou(fields[6]),
        amountYi: tencentAmountWanYuanToYi(fields[37]),
        amplitude: asNumber(fields[43]),
        turnover: asNumber(fields[38]),
        pe: asNumber(fields[39]),
        pb: asNumber(fields[46]),
        marketCapYi: asNumber(fields[45]),
        floatMarketCapYi: asNumber(fields[44]),
        industry2: undefined,
        statusFlag: fields[40] || undefined,
        marketType: fields[61] || undefined
      };
    })
    .filter((row) => row.code && row.name);
}

export async function fetchTencentQuoteRows(symbols: string[]) {
  return parseTencentQuoteRows(await fetchTencentQuoteText(symbols));
}

export function mapTencentQuoteToMarketRow(row: TencentQuoteRow) {
  return compactRow([
    ["代码", row.code],
    ["名称", row.name],
    ["最新价", row.price],
    ["涨跌幅", row.pctChange],
    ["成交量", row.volumeWanShou === undefined ? undefined : row.volumeWanShou * 10000],
    ["成交额", row.amountYi === undefined ? undefined : row.amountYi * 100000000],
    ["换手率", row.turnover],
    ["总市值", row.marketCapYi === undefined ? undefined : row.marketCapYi * 100000000],
    ["流通市值", row.floatMarketCapYi === undefined ? undefined : row.floatMarketCapYi * 100000000],
    ["市盈率-动态", row.pe],
    ["市净率", row.pb],
    ["振幅", row.amplitude],
    ["code", row.code],
    ["name", row.name],
    ["price", row.price],
    ["pctChange", row.pctChange],
    ["amount", row.amountYi],
    ["volume", row.volumeWanShou],
    ["turnover", row.turnover],
    ["marketCap", row.marketCapYi],
    ["floatMarketCap", row.floatMarketCapYi],
    ["pe", row.pe],
    ["pb", row.pb]
  ]);
}

export async function fetchTencentAshareQuoteRows() {
  return cacheGetOrCreate<TencentQuoteRow[]>("tencent:ashare:quotes", 10000, async () => {
    const codes = await fetchAshareUniverseCodes();
    const batches = Array.from({ length: Math.ceil(codes.length / 80) }, (_, index) => codes.slice(index * 80, index * 80 + 80));
    const rows = await mapConcurrent(batches, MARKET_FETCH_CONCURRENCY, (batch) => fetchTencentQuoteRows(batch.map(tencentSymbolFromCode)));
    const all = Array.from(new Map(rows.flat().map((row) => [row.code, row])).values());
    if (!all.length) throw new Error("Tencent all-A-share quote returned no rows");
    if (all.length / codes.length < 0.9) throw new Error(`Tencent all-A-share quote coverage is too low: ${all.length}/${codes.length}`);
    return all;
  });
}

function compactDate(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function normalizeKlineAdjustment(value: unknown): KlineAdjustment {
  return value === "none" ? "none" : "qfq";
}

async function fetchEastmoneyKlinePointsUncached(symbol: string, period = "day", limit = 90, adjustment: KlineAdjustment = "qfq"): Promise<KlinePoint[]> {
  const normalized = normalizeTencentSymbol(symbol);
  const code = normalized.slice(2);
  const normalizedLimit = Math.max(1, Math.min(limit, 300));
  const periodCode = period.includes("month") ? "103" : period.includes("week") ? "102" : "101";
  const calendarDays = periodCode === "103" ? normalizedLimit * 40 : periodCode === "102" ? normalizedLimit * 10 : normalizedLimit * 2 + 30;
  const start = new Date();
  start.setDate(start.getDate() - calendarDays);
  const url = urlWithParams(EASTMONEY_KLINE_URL, {
    secid: eastmoneySecid(code),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57",
    klt: periodCode,
    fqt: adjustment === "qfq" ? "1" : "0",
    beg: compactDate(start),
    end: compactDate(new Date())
  });
  const payload = await fetchJsonWithRetry(url);
  const rows = (((payload as any)?.data?.klines ?? []) as string[]).map((line) => {
    const fields = line.split(",");
    return {
      date: String(fields[0]),
      open: round(Number(fields[1]), 2),
      close: round(Number(fields[2]), 2),
      high: round(Number(fields[3]), 2),
      low: round(Number(fields[4]), 2),
      volume: round(Number(fields[5]), 2)
    };
  }).filter((row) => row.date && [row.open, row.close, row.high, row.low, row.volume].every(Number.isFinite)).slice(-normalizedLimit);
  if (!rows.length) throw new Error("Eastmoney kline fallback returned no rows");
  return rows;
}

export async function fetchEastmoneyKlinePoints(symbol: string, period = "day", limit = 90, adjustment: KlineAdjustment = "qfq"): Promise<KlinePoint[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 300));
  const normalizedSymbol = normalizeTencentSymbol(symbol);
  const normalizedAdjustment = normalizeKlineAdjustment(adjustment);
  const cacheKey = `eastmoney:kline:${normalizedSymbol}:${period}:${normalizedAdjustment}:${normalizedLimit}`;
  return cacheGetOrCreate(cacheKey, 30000, () =>
    persistentCacheGetOrCreate("eastmoney-kline", `${normalizedSymbol}:${period}:${normalizedAdjustment}:${normalizedLimit}`, KLINE_PERSISTENT_CACHE_TTL_MS, () =>
      fetchEastmoneyKlinePointsUncached(symbol, period, normalizedLimit, normalizedAdjustment)
    )
  );
}

export async function fetchTencentKlinePoints(symbol: string, period = "day", limit = 90, adjustment: KlineAdjustment = "qfq"): Promise<KlinePoint[]> {
  const normalized = normalizeTencentSymbol(symbol);
  const code = normalized.slice(2);
  const market = normalized.startsWith("sh") ? "sh" : normalized.startsWith("bj") ? "bj" : "sz";
  const normalizedLimit = Math.max(1, Math.min(limit, 300));
  const normalizedAdjustment = normalizeKlineAdjustment(adjustment);
  const cacheKey = `tencent:kline:${market}${code}:${period}:${normalizedAdjustment}:${normalizedLimit}`;
  return cacheGetOrCreate<KlinePoint[]>(cacheKey, 30000, () =>
    persistentCacheGetOrCreate("tencent-kline", `${market}${code}:${period}:${normalizedAdjustment}:${normalizedLimit}`, KLINE_PERSISTENT_CACHE_TTL_MS, async () => {
      const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
      url.searchParams.set("param", `${market}${code},${period},,,${normalizedLimit}${normalizedAdjustment === "qfq" ? ",qfq" : ""}`);
      const payload = await fetchTencentJsonWithRetry(url);
      const node = (payload as any)?.data?.[`${market}${code}`];
      const rawRows = (normalizedAdjustment === "qfq"
        ? period === "day" ? node?.qfqday : period === "week" ? node?.qfqweek : node?.qfqmonth
        : period === "day" ? node?.day : period === "week" ? node?.week : node?.month) ?? [];
      const rows = (rawRows as unknown[][]).map((row) => ({
        date: String(row[0]),
        open: round(Number(row[1]), 2),
        close: round(Number(row[2]), 2),
        high: round(Number(row[3]), 2),
        low: round(Number(row[4]), 2),
        volume: round(Number(row[5]), 2)
      })).filter((row) => row.date && [row.open, row.close, row.high, row.low, row.volume].every(Number.isFinite));
      if (!rows.length) throw new Error("Tencent kline returned no rows");
      return rows;
    })
  );
}

export async function fetchKlinePointsWithFallback(symbol: string, period = "day", limit = 90, adjustment: unknown = "qfq"): Promise<{ points: KlinePoint[]; source: "tencent" | "eastmoney-fallback" }> {
  const normalizedAdjustment = normalizeKlineAdjustment(adjustment);
  if (Date.now() < tencentKlineBlockedUntil) {
    return { points: await fetchEastmoneyKlinePoints(symbol, period, limit, normalizedAdjustment), source: "eastmoney-fallback" };
  }
  try {
    return { points: await fetchTencentKlinePoints(symbol, period, limit, normalizedAdjustment), source: "tencent" };
  } catch (error) {
    if (/upstream HTTP (403|501)/.test(String(error))) tencentKlineBlockedUntil = Date.now() + TENCENT_KLINE_CIRCUIT_MS;
    return { points: await fetchEastmoneyKlinePoints(symbol, period, limit, normalizedAdjustment), source: "eastmoney-fallback" };
  }
}

export function stockFromMarketRow(row: Record<string, unknown>): Stock {
  const code = String(row.code ?? row["代码"] ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6);
  const exchange = code.startsWith("6") ? "沪市" : code.startsWith("9") || code.startsWith("4") ? "北交所" : "深市";
  const board = code.startsWith("688") ? "科创板" : code.startsWith("300") || code.startsWith("301") ? "创业板" : exchange === "北交所" ? "北交所" : "主板";
  return {
    code,
    name: String(row.name ?? row["名称"] ?? code),
    exchange: exchange as Stock["exchange"],
    board: board as Stock["board"],
    industry1: "未分类",
    industry2: "未分类",
    industryTags: [],
    region: "未披露",
    property: "民企" as Stock["property"],
    isST: String(row.name ?? row["名称"] ?? "").includes("ST"),
    isSuspended: false,
    isSTAR: code.startsWith("688"),
    isMargin: true,
    indexes: [],
    metrics: {
      realQuoteSource: 1,
      ...(asNumber(row.price) !== undefined ? { price: asNumber(row.price)! } : {}),
      ...(asNumber(row.pctChange) !== undefined ? { pctChange: asNumber(row.pctChange)! } : {}),
      ...(asNumber(row.amount) !== undefined ? { amount: asNumber(row.amount)! } : {}),
      ...(asNumber(row.marketCap) !== undefined ? { marketCap: asNumber(row.marketCap)! } : {}),
      ...(asNumber(row.floatMarketCap) !== undefined ? { floatMarketCap: asNumber(row.floatMarketCap)! } : {}),
      ...(asNumber(row.pe) !== undefined ? { pe: asNumber(row.pe)! } : {}),
      ...(asNumber(row.pb) !== undefined ? { pb: asNumber(row.pb)! } : {})
    }
  };
}
