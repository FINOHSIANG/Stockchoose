import type { Stock } from "./types";

export type StockCodePrefix = "SH" | "SZ" | "BJ";

export interface ParsedStockCodeQuery {
  raw: string;
  normalized: string;
  code?: string;
  prefix?: StockCodePrefix;
  isCodeLike: boolean;
}

export const BSE_MARKET_CODE_ALIASES: Record<string, string> = {
  "430047": "920047",
  "833575": "920575"
};

const normalizeInput = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

export function normalizeStockCodeInput(value: string): ParsedStockCodeQuery {
  const normalized = normalizeInput(value);
  const prefixed = normalized.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (prefixed) {
    return {
      raw: value,
      normalized,
      prefix: prefixed[1] as StockCodePrefix,
      code: prefixed[2],
      isCodeLike: true
    };
  }

  const suffixed = normalized.match(/^(\d{6})(SH|SZ|BJ)$/);
  if (suffixed) {
    return {
      raw: value,
      normalized: `${suffixed[2]}${suffixed[1]}`,
      prefix: suffixed[2] as StockCodePrefix,
      code: suffixed[1],
      isCodeLike: true
    };
  }

  if (/^\d{6}$/.test(normalized)) {
    return {
      raw: value,
      normalized,
      code: normalized,
      isCodeLike: true
    };
  }

  return {
    raw: value,
    normalized,
    isCodeLike: false
  };
}

export function normalizeStockCodeKey(value: string) {
  const parsed = normalizeStockCodeInput(value);
  return parsed.normalized || normalizeInput(value);
}

export function isCodeLikeStockQuery(value: string) {
  return normalizeStockCodeInput(value).isCodeLike;
}

function prefixFromCode(code: string): StockCodePrefix | "" {
  if (/^6/.test(code)) return "SH";
  if (/^[023]/.test(code)) return "SZ";
  if (/^[489]/.test(code) || Object.values(BSE_MARKET_CODE_ALIASES).includes(code)) return "BJ";
  return "";
}

export function prefixForStock(stock: Pick<Stock, "code" | "exchange">): StockCodePrefix | "" {
  if (stock.exchange === "沪市") return "SH";
  if (stock.exchange === "深市") return "SZ";
  if (stock.exchange === "北交所") return "BJ";
  return prefixFromCode(stock.code);
}

export function marketDataCodeForStock(stock: Pick<Stock, "code" | "exchange">) {
  const parsed = normalizeStockCodeInput(stock.code);
  const code = parsed.code ?? stock.code;
  if (stock.exchange !== "北交所" && !BSE_MARKET_CODE_ALIASES[code]) return code;
  return BSE_MARKET_CODE_ALIASES[code] ?? code;
}

export function displayStockCode(stock: (Pick<Stock, "code"> & Partial<Pick<Stock, "exchange">>) | string) {
  const rawCode = typeof stock === "string" ? stock : stock.code;
  const parsed = normalizeStockCodeInput(rawCode);
  const code = parsed.code;
  if (!code) return rawCode;

  const exchange = typeof stock === "string" ? undefined : stock.exchange;
  const marketCode = exchange === "北交所" || parsed.prefix === "BJ" || BSE_MARKET_CODE_ALIASES[code] ? BSE_MARKET_CODE_ALIASES[code] ?? code : code;
  const prefix = parsed.prefix ?? (exchange ? prefixForStock({ code, exchange }) : prefixFromCode(marketCode));
  return `${prefix}${marketCode}`;
}

export function stockCodeCandidates(stock: Pick<Stock, "code" | "exchange">) {
  const parsed = normalizeStockCodeInput(stock.code);
  const code = parsed.code ?? stock.code;
  const prefix = prefixForStock({ code, exchange: stock.exchange });
  const marketCode = marketDataCodeForStock({ code, exchange: stock.exchange });
  return unique([code, `${prefix}${code}`, marketCode, `${prefix}${marketCode}`, displayStockCode({ code, exchange: stock.exchange })]).map(normalizeStockCodeKey);
}

export function stockMatchesCodeQuery(stock: Pick<Stock, "code" | "exchange">, query: string) {
  const parsed = normalizeStockCodeInput(query);
  if (!parsed.isCodeLike) return false;
  return stockCodeCandidates(stock).includes(parsed.normalized);
}

export function resolveStockByCode<T extends Pick<Stock, "code" | "exchange">>(stocks: T[], query: string) {
  const parsed = normalizeStockCodeInput(query);
  if (!parsed.isCodeLike) return undefined;
  return stocks.find((stock) => stockMatchesCodeQuery(stock, query));
}

export function stockCodeForStorage(input: string, stocks: Stock[]) {
  const resolved = resolveStockByCode(stocks, input);
  if (resolved) return resolved.code;
  const parsed = normalizeStockCodeInput(input);
  return parsed.code ?? input.trim();
}
