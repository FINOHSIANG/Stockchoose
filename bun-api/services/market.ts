import type { Stock } from "../../src/types";
import { cacheGet, cacheSet, crawlerFetch, fetchJson } from "../crawler/engine";

const EASTMONEY_CLIST_URL = "https://push2delay.eastmoney.com/api/qt/clist/get";
const EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const SPOT_FIELDS = "f12,f14,f2,f3,f5,f6,f8,f20,f21,f9,f23,f7,f24,f26,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184";
const A_SHARE_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";

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
export const asNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const amountToYi = (value: unknown) => {
  const number = asNumber(value);
  return number === undefined ? undefined : round(number / 100000000, 2);
};
export const volumeToWanShou = (value: unknown) => {
  const number = asNumber(value);
  return number === undefined ? undefined : round(number / 10000, 2);
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

export async function fetchEastmoneySpotRows() {
  const cached = cacheGet<Record<string, unknown>[]>("eastmoney:spot");
  if (cached) return cached;
  const pageSize = 5000;
  const firstUrl = urlWithParams(EASTMONEY_CLIST_URL, {
    pn: "1",
    pz: String(pageSize),
    po: "1",
    np: "1",
    ut: EASTMONEY_UT,
    fltt: "2",
    invt: "2",
    fid: "f3",
    fs: A_SHARE_FS,
    fields: SPOT_FIELDS
  });
  const first = await fetchJsonWithRetry(firstUrl);
  const total = asNumber((first as any)?.data?.total) ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = [...(((first as any)?.data?.diff ?? []) as Record<string, unknown>[])];
  for (let page = 2; page <= pages; page += 1) {
    const url = new URL(firstUrl);
    url.searchParams.set("pn", String(page));
    const payload = await fetchJsonWithRetry(url);
    rows.push(...((((payload as any)?.data?.diff ?? []) as Record<string, unknown>[])));
  }
  if (!rows.length) throw new Error("Eastmoney spot returned no rows");
  return cacheSet("eastmoney:spot", rows.map(mapEastmoneySpotRow), 30000);
}

async function fetchJsonWithRetry(url: URL, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url, { headers: { referer: "https://quote.eastmoney.com/" } }, 30000);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 1000));
    }
  }
  throw lastError;
}

function eastmoneySecid(code: string) {
  return `${code.startsWith("6") || code.startsWith("9") ? "1" : "0"}.${code}`;
}

export async function fetchEastmoneyHistRows(query: Record<string, string>) {
  const code = String(query.symbol ?? query.code ?? "000001").replace(/\D/g, "").padStart(6, "0").slice(-6);
  const url = urlWithParams(EASTMONEY_KLINE_URL, {
    secid: eastmoneySecid(code),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57",
    klt: "101",
    fqt: query.adjust ? "1" : "0",
    beg: query.start_date ?? "20240501",
    end: query.end_date ?? "20240531"
  });
  const payload = await fetchJson(url);
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
}

function tencentSymbolFromCode(code: string) {
  const digits = code.replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (/^6|^9/.test(digits)) return `sh${digits}`;
  if (/^[48]|^92/.test(digits)) return `bj${digits}`;
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
  const url = new URL("https://qt.gtimg.cn/q=" + encodeURIComponent(symbols.join(",")));
  const response = await crawlerFetch(url, { headers: { referer: "https://gu.qq.com/" } }, 20000);
  if (!response.ok) throw new Error(`Tencent quote HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  return new TextDecoder("gb18030").decode(bytes);
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
        volumeWanShou: asNumber(fields[6]),
        amountYi: asNumber(fields[37]),
        amplitude: asNumber(fields[43]),
        turnover: asNumber(fields[38]),
        pe: asNumber(fields[39]),
        pb: asNumber(fields[46]),
        marketCapYi: asNumber(fields[45]),
        floatMarketCapYi: asNumber(fields[44]),
        industry2: fields[62] || undefined,
        statusFlag: fields[82] || undefined,
        marketType: fields[61] || undefined
      };
    })
    .filter((row) => row.code && row.name);
}

export async function fetchTencentQuoteRows(symbols: string[]) {
  return parseTencentQuoteRows(await fetchTencentQuoteText(symbols));
}

export async function fetchTencentAshareQuoteRows() {
  const spotRows = await fetchEastmoneySpotRows();
  const codes = spotRows.map((row) => String(row.code ?? row["代码"] ?? "")).filter(Boolean);
  const all: TencentQuoteRow[] = [];
  for (let index = 0; index < codes.length; index += 80) {
    all.push(...(await fetchTencentQuoteRows(codes.slice(index, index + 80).map(tencentSymbolFromCode))));
  }
  if (!all.length) throw new Error("Tencent all-A-share quote returned no rows");
  return all;
}

export async function fetchTencentKlinePoints(symbol: string, period = "day", limit = 90): Promise<KlinePoint[]> {
  const normalized = normalizeTencentSymbol(symbol);
  const code = normalized.slice(2);
  const market = normalized.startsWith("sh") ? "sh" : normalized.startsWith("bj") ? "bj" : "sz";
  const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
  url.searchParams.set("param", `${market}${code},${period},,,${Math.max(1, Math.min(limit, 300))},qfq`);
  const payload = await fetchJson(url, { headers: { referer: "https://gu.qq.com/" } }, 20000);
  const node = (payload as any)?.data?.[`${market}${code}`];
  const rawRows = node?.qfqday ?? node?.day ?? node?.qfqweek ?? node?.week ?? node?.qfqmonth ?? node?.month ?? [];
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
