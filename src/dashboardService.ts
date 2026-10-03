import type { Stock, SelectionRow } from "./types";
import type { PaperTradeState } from "./tradingServices";

// === Dashboard data types ===

export interface MarketTemperature {
  score: number;
  label: string;
  advancers: number;
  decliners: number;
  flatCount: number;
  limitUp: number;
  limitDown: number;
  avgChange: number;
  totalAmount: number;
  checkedAt: string;
}

export interface IndustryMomentum {
  industry: string;
  avgChange: number;
  stockCount: number;
  topStock: string;
  topStockChange: number;
  bottomStock: string;
  bottomStockChange: number;
  totalMarketCap: number;
}

export interface IndexSnapshot {
  name: string;
  memberCount: number;
  avgChange: number;
  advancers: number;
  decliners: number;
  totalAmount: number;
}

export interface HoldingSummary {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  pnlPercent: number;
  positionCount: number;
  industryBreakdown: { industry: string; count: number; value: number }[];
  topGainer?: { name: string; code: string; pnl: number; pnlPercent: number };
  topLoser?: { name: string; code: string; pnl: number; pnlPercent: number };
}

export interface StrategyDailyChangeSummary {
  changePercent: number | null;
  holdingCount: number;
  validCount: number;
  targetWeight: number;
  validWeight: number;
  coveragePercent: number;
}

export interface DashboardSentimentAlert {
  title: string;
  direction: string;
  severity: string;
  source: string;
  industries: string[];
}

// === Computation functions ===

const TEMPERATURE_WEIGHTS = {
  breadth: 0.4,
  momentum: 0.35,
  strength: 0.25,
};

export function computeMarketTemperature(stocks: Stock[]): MarketTemperature {
  const now = new Date().toISOString();
  if (!stocks.length) {
    return { score: 50, label: "无数据", advancers: 0, decliners: 0, flatCount: 0, limitUp: 0, limitDown: 0, avgChange: 0, totalAmount: 0, checkedAt: now };
  }

  let advancers = 0;
  let decliners = 0;
  let flatCount = 0;
  let limitUp = 0;
  let limitDown = 0;
  let changeSum = 0;
  let amountSum = 0;
  let validCount = 0;

  for (const stock of stocks) {
    const pct = stock.metrics.pctChange;
    const amount = stock.metrics.amount ?? 0;
    if (pct === undefined || Number.isNaN(pct)) continue;
    validCount += 1;
    changeSum += pct;
    amountSum += amount;
    if (pct > 0.01) advancers += 1;
    else if (pct < -0.01) decliners += 1;
    else flatCount += 1;
    if (pct >= 9.8) limitUp += 1;
    if (pct <= -9.8) limitDown += 1;
  }

  const count = validCount || 1;
  const breadthRatio = advancers / count;
  const avgChange = changeSum / count;

  const breadthScore = Math.min(100, Math.max(0, breadthRatio * 100));
  const momentumScore = Math.min(100, Math.max(0, 50 + avgChange * 10));
  const strengthScore = Math.min(100, Math.max(0, 50 + (limitUp - limitDown) / count * 500));

  const score = Math.round(
    breadthScore * TEMPERATURE_WEIGHTS.breadth +
    momentumScore * TEMPERATURE_WEIGHTS.momentum +
    strengthScore * TEMPERATURE_WEIGHTS.strength
  );

  let label: string;
  if (score >= 80) label = "过热";
  else if (score >= 65) label = "强势";
  else if (score >= 45) label = "中性";
  else if (score >= 30) label = "偏弱";
  else label = "低迷";

  return {
    score: Math.min(100, Math.max(0, score)),
    label,
    advancers,
    decliners,
    flatCount,
    limitUp,
    limitDown,
    avgChange,
    totalAmount: amountSum,
    checkedAt: now,
  };
}

export function computeIndustryMomentum(stocks: Stock[], limit = 10): IndustryMomentum[] {
  const map = new Map<string, { changes: number[]; totalMarketCap: number; stocks: { name: string; code: string; change: number }[] }>();

  for (const stock of stocks) {
    const industry = stock.industry1 || "未分类";
    const pct = stock.metrics.pctChange;
    if (pct === undefined || Number.isNaN(pct)) continue;
    if (!map.has(industry)) {
      map.set(industry, { changes: [], totalMarketCap: 0, stocks: [] });
    }
    const entry = map.get(industry)!;
    entry.changes.push(pct);
    entry.totalMarketCap += stock.metrics.marketCap ?? 0;
    entry.stocks.push({ name: stock.name, code: stock.code, change: pct });
  }

  const result: IndustryMomentum[] = [];
  for (const [industry, entry] of map) {
    if (entry.changes.length < 3) continue;
    const avgChange = entry.changes.reduce((a, b) => a + b, 0) / entry.changes.length;
    const sorted = entry.stocks.sort((a, b) => b.change - a.change);
    result.push({
      industry,
      avgChange,
      stockCount: entry.changes.length,
      topStock: sorted[0]?.name ?? "--",
      topStockChange: sorted[0]?.change ?? 0,
      bottomStock: sorted.at(-1)?.name ?? "--",
      bottomStockChange: sorted.at(-1)?.change ?? 0,
      totalMarketCap: entry.totalMarketCap,
    });
  }

  return result.sort((a, b) => b.avgChange - a.avgChange).slice(0, limit);
}

export function computeStrategyDailyChange(rows: SelectionRow[]): StrategyDailyChangeSummary {
  const holdings = rows.filter((row) => Number.isFinite(row.weight) && row.weight > 0);
  const targetWeight = holdings.reduce((sum, row) => sum + row.weight, 0);
  const validHoldings = holdings.filter((row) => Number.isFinite(row.stock.metrics.pctChange));
  const validWeight = validHoldings.reduce((sum, row) => sum + row.weight, 0);
  const coveragePercent = targetWeight > 0 ? Math.min(100, Math.max(0, validWeight / targetWeight * 100)) : 0;
  const complete = holdings.length > 0 && validHoldings.length === holdings.length;
  const changePercent = complete
    ? validHoldings.reduce((sum, row) => sum + (row.stock.metrics.pctChange ?? 0) * row.weight / 100, 0)
    : null;

  return {
    changePercent,
    holdingCount: holdings.length,
    validCount: validHoldings.length,
    targetWeight,
    validWeight,
    coveragePercent,
  };
}

export function computeIndexSnapshots(stocks: Stock[]): IndexSnapshot[] {
  const indexNames = ["沪深300", "上证50", "中证500", "中证1000"];
  const result: IndexSnapshot[] = [];

  for (const indexName of indexNames) {
    const members = stocks.filter((s) => s.indexes.includes(indexName));
    if (!members.length) continue;
    let advancers = 0;
    let decliners = 0;
    let changeSum = 0;
    let totalAmount = 0;
    let valid = 0;

    for (const m of members) {
      const pct = m.metrics.pctChange;
      if (pct === undefined || Number.isNaN(pct)) continue;
      valid += 1;
      changeSum += pct;
      totalAmount += m.metrics.amount ?? 0;
      if (pct > 0.01) advancers += 1;
      else if (pct < -0.01) decliners += 1;
    }

    result.push({
      name: indexName,
      memberCount: members.length,
      avgChange: valid ? changeSum / valid : 0,
      advancers,
      decliners,
      totalAmount,
    });
  }

  return result;
}

export function summarizeHoldings(state: PaperTradeState, stocks: Stock[]): HoldingSummary {
  const fills = state.fills;
  if (!fills.length) {
    return { totalValue: 0, totalCost: 0, totalPnl: 0, pnlPercent: 0, positionCount: 0, industryBreakdown: [] };
  }

  const positions = new Map<string, { shares: number; cost: number; name: string }>();
  for (const fill of fills) {
    const existing = positions.get(fill.code) ?? { shares: 0, cost: 0, name: fill.name };
    if (fill.side === "买入") {
      const totalCost = existing.cost * existing.shares + fill.price * fill.shares;
      existing.shares += fill.shares;
      existing.cost = existing.shares > 0 ? totalCost / existing.shares : 0;
    } else {
      existing.shares -= fill.shares;
    }
    existing.name = fill.name;
    positions.set(fill.code, existing);
  }

  const stockMap = new Map(stocks.map((s) => [s.code, s]));
  let totalValue = 0;
  let totalCost = 0;
  const industryMap = new Map<string, { count: number; value: number }>();
  const gainers: { name: string; code: string; pnl: number; pnlPercent: number }[] = [];
  const losers: { name: string; code: string; pnl: number; pnlPercent: number }[] = [];

  for (const [code, pos] of positions) {
    if (pos.shares <= 0) continue;
    const stock = stockMap.get(code);
    const price = stock?.metrics.price ?? pos.cost;
    const value = price * pos.shares;
    const cost = pos.cost * pos.shares;
    const pnl = value - cost;
    const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
    totalValue += value;
    totalCost += cost;

    const industry = stock?.industry1 ?? "未分类";
    const ind = industryMap.get(industry) ?? { count: 0, value: 0 };
    ind.count += 1;
    ind.value += value;
    industryMap.set(industry, ind);

    if (pnl >= 0) gainers.push({ name: pos.name, code, pnl, pnlPercent });
    else losers.push({ name: pos.name, code, pnl, pnlPercent });
  }

  gainers.sort((a, b) => b.pnl - a.pnl);
  losers.sort((a, b) => a.pnl - b.pnl);

  const totalPnl = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return {
    totalValue,
    totalCost,
    totalPnl,
    pnlPercent,
    positionCount: Array.from(positions.values()).filter((p) => p.shares > 0).length,
    industryBreakdown: Array.from(industryMap.entries())
      .map(([industry, v]) => ({ industry, ...v }))
      .sort((a, b) => b.value - a.value),
    topGainer: gainers[0],
    topLoser: losers[0],
  };
}
