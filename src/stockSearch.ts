import { displayStockCode, stockCodeCandidates } from "./stockIdentity";
import type { Stock } from "./types";

export interface StockSuggestionResult {
  items: Stock[];
  total: number;
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function isSearchableStock(stock: Stock) {
  const price = stock.metrics.price;
  const marketCap = stock.metrics.marketCap;
  const hasInvalidPrice = Object.prototype.hasOwnProperty.call(stock.metrics, "price") && (!Number.isFinite(price) || price <= 0);
  const hasInvalidMarketCap = Object.prototype.hasOwnProperty.call(stock.metrics, "marketCap") && (!Number.isFinite(marketCap) || marketCap <= 0);
  const hasUsableMarketMetric = (Number.isFinite(price) && price > 0) || (Number.isFinite(marketCap) && marketCap > 0);
  return !hasInvalidPrice && !hasInvalidMarketCap && hasUsableMarketMetric;
}

function stockMatchRank(stock: Stock, query: string) {
  const name = normalizeSearchText(stock.name);
  const codeTokens = [stock.code, displayStockCode(stock), ...stockCodeCandidates(stock)].map(normalizeSearchText);
  if (name === query || codeTokens.some((code) => code === query)) return 0;
  if (codeTokens.some((code) => code.startsWith(query))) return 1;
  if (name.startsWith(query)) return 2;
  if (codeTokens.some((code) => code.includes(query))) return 3;
  if (name.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

export function findStockSuggestions(stocks: Stock[], rawQuery: string, limit = 8): StockSuggestionResult {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { items: [], total: 0 };

  const matches = stocks
    .filter(isSearchableStock)
    .map((stock) => ({ stock, rank: stockMatchRank(stock, query) }))
    .filter((item) => Number.isFinite(item.rank))
    .sort((left, right) => left.rank - right.rank || left.stock.code.localeCompare(right.stock.code));

  return {
    items: matches.slice(0, Math.max(1, limit)).map((item) => item.stock),
    total: matches.length
  };
}
