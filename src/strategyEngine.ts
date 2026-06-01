import type {
  BacktestConfig,
  BacktestResult,
  Factor,
  FilterCondition,
  RankingRow,
  RankCondition,
  SelectionRow,
  Stock,
  StockPool,
  StrategyConfig
} from "./types";
import { normalizeStockCodeKey, stockCodeCandidates } from "./stockIdentity";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function hash(input: string) {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) % 100000;
  }
  return value;
}

function dateRange(startDate: string, endDate: string, stepDays: number) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates: string[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return dates;
  }
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + stepDays);
  }
  if (dates[dates.length - 1] !== endDate) {
    dates.push(endDate);
  }
  return dates;
}

export function factorByKey(factors: Factor[], key: string) {
  return factors.find((factor) => factor.key === key);
}

export function metricValue(stock: Stock, factor: Factor | undefined, factors: Factor[]): number {
  if (!factor) {
    return 0;
  }
  if (factor.formula) {
    return evaluateFormula(factor.formula, stock, factors);
  }
  return stock.metrics[factor.key] ?? 0;
}

export function formatMetric(value: number, factor?: Factor) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const precision = factor?.precision ?? 2;
  return `${round(value, precision)}${factor?.unit ? factor.unit : ""}`;
}

export function evaluateFormula(formula: string, stock: Stock, factors: Factor[]): number {
  const allowed = /^[\w\s+\-*/%().,<>=!&|?:]+$/;
  if (!allowed.test(formula)) {
    return 0;
  }
  const metricKeys = Array.from(new Set(factors.map((factor) => factor.key)));
  const args = metricKeys;
  const values = metricKeys.map((key) => stock.metrics[key] ?? 0);
  const helpers = {
    abs: Math.abs,
    sqrt: Math.sqrt,
    log: Math.log,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    avg: (...numbers: number[]) => numbers.reduce((sum, item) => sum + item, 0) / Math.max(numbers.length, 1),
    zscore: (value: number) => value
  };
  try {
    const fn = new Function(...args, "abs", "sqrt", "log", "min", "max", "pow", "avg", "zscore", `"use strict"; return (${formula});`);
    const result = fn(...values, helpers.abs, helpers.sqrt, helpers.log, helpers.min, helpers.max, helpers.pow, helpers.avg, helpers.zscore);
    return Number.isFinite(Number(result)) ? Number(result) : 0;
  } catch {
    return 0;
  }
}

function normalize(value: number, min: number, max: number, order: "asc" | "desc") {
  if (max === min) {
    return 50;
  }
  const normalized = (value - min) / (max - min);
  return (order === "desc" ? normalized : 1 - normalized) * 100;
}

function poolCodes(poolId: string, pools: StockPool[]): string[] {
  const pool = pools.find((item) => item.id === poolId);
  if (!pool) {
    return [];
  }
  if (pool.type !== "compound") {
    return pool.codes;
  }
  const source = new Set(poolCodes(pool.sourcePoolId ?? "all", pools));
  const target = new Set(poolCodes(pool.targetPoolId ?? "all", pools));
  if (pool.operator === "and") {
    return Array.from(source).filter((code) => target.has(code));
  }
  if (pool.operator === "sub") {
    return Array.from(source).filter((code) => !target.has(code));
  }
  return Array.from(new Set([...source, ...target]));
}

function poolHasStock(codeSet: Set<string>, stock: Stock) {
  return stockCodeCandidates(stock).some((code) => codeSet.has(normalizeStockCodeKey(code)));
}

function applySelector(strategy: StrategyConfig, stock: Stock) {
  if (strategy.indexMember !== "全部" && !stock.indexes.includes(strategy.indexMember)) return false;
  if (strategy.board !== "全部" && stock.board !== strategy.board) return false;
  if (strategy.industry1 !== "全部" && stock.industry1 !== strategy.industry1) return false;
  if (strategy.industry2 !== "全部" && stock.industry2 !== strategy.industry2) return false;
  if (strategy.exchange !== "全部" && stock.exchange !== strategy.exchange) return false;
  if (strategy.region !== "全部" && stock.region !== strategy.region) return false;
  if (strategy.property !== "全部" && stock.property !== strategy.property) return false;
  if (strategy.marginFlag === "融资融券" && !stock.isMargin) return false;
  if (strategy.marginFlag === "非融资融券" && stock.isMargin) return false;
  if (strategy.stMode === "排除ST" && stock.isST) return false;
  if (strategy.stMode === "仅有ST" && !stock.isST) return false;
  if (strategy.starMode === "排除科创板" && stock.isSTAR) return false;
  if (strategy.starMode === "仅有科创板" && !stock.isSTAR) return false;
  if (strategy.filterSuspended && stock.isSuspended) return false;
  return true;
}

function conditionPass(value: number, condition: FilterCondition, allValues: number[]) {
  const size = Math.max(allValues.length, 1);
  const rankMax = 1 + allValues.filter((item) => item > value).length;
  const rankMin = 1 + allValues.filter((item) => item < value).length;
  const rankPctMax = (rankMax / size) * 100;
  const rankPctMin = (rankMin / size) * 100;
  switch (condition.operator) {
    case "gt":
      return value > (condition.value ?? condition.min ?? 0);
    case "lt":
      return value < (condition.value ?? condition.max ?? 0);
    case "gte":
      return value >= (condition.value ?? condition.min ?? 0);
    case "lte":
      return value <= (condition.value ?? condition.max ?? 0);
    case "between":
      return value >= (condition.min ?? Number.NEGATIVE_INFINITY) && value <= (condition.max ?? Number.POSITIVE_INFINITY);
    case "eq":
      return value === (condition.value ?? 0);
    case "neq":
      return value !== (condition.value ?? 0);
    case "top":
      return rankPctMax <= (condition.value ?? 20);
    case "bottom":
      return rankPctMin <= (condition.value ?? 20);
    case "rankMax":
      return rankMax <= (condition.value ?? 10);
    case "rankMin":
      return rankMin <= (condition.value ?? 10);
    case "rankBetween":
      return rankMax >= (condition.min ?? 1) && rankMax <= (condition.max ?? size);
    case "rankPctMax":
      return rankPctMax <= (condition.value ?? 10);
    case "rankPctMin":
      return rankPctMin <= (condition.value ?? 10);
    case "rankPctBetween":
      return rankPctMax >= (condition.min ?? 0) && rankPctMax <= (condition.max ?? 100);
    default:
      return true;
  }
}

function applyFilters(stocks: Stock[], strategy: StrategyConfig, factors: Factor[]) {
  const enabled = strategy.filters.filter((condition) => condition.enabled);
  if (!enabled.length) {
    return stocks.map((stock) => ({ stock, passedFilters: 0 }));
  }

  const valuesByFactor = new Map<string, number[]>();
  enabled.forEach((condition) => {
    const factor = factorByKey(factors, condition.factorKey);
    valuesByFactor.set(condition.factorKey, stocks.map((stock) => metricValue(stock, factor, factors)));
  });

  return stocks
    .map((stock) => {
      const failed = enabled.find((condition) => {
        const factor = factorByKey(factors, condition.factorKey);
        const value = metricValue(stock, factor, factors);
        return !conditionPass(value, condition, valuesByFactor.get(condition.factorKey) ?? []);
      });
      return {
        stock,
        passedFilters: failed ? enabled.indexOf(failed) : enabled.length,
        failedReason: failed ? factorByKey(factors, failed.factorKey)?.name ?? "条件" : undefined
      };
    })
    .filter((row) => !row.failedReason);
}

function scoreRows(rows: Array<{ stock: Stock; passedFilters: number }>, ranks: RankCondition[], factors: Factor[]): SelectionRow[] {
  const enabled = ranks.filter((rank) => rank.enabled && rank.weight > 0);
  if (!enabled.length) {
    return rows.map((row) => ({
      ...row,
      score: row.stock.metrics.amount ?? 0,
      weight: 0
    }));
  }

  const factorStats = new Map<string, { min: number; max: number }>();
  enabled.forEach((rank) => {
    const factor = factorByKey(factors, rank.factorKey);
    const values = rows.map((row) => metricValue(row.stock, factor, factors));
    factorStats.set(rank.factorKey, {
      min: Math.min(...values),
      max: Math.max(...values)
    });
  });

  const totalWeight = enabled.reduce((sum, rank) => sum + rank.weight, 0);
  return rows.map((row) => {
    let score = 0;
    enabled.forEach((rank) => {
      const factor = factorByKey(factors, rank.factorKey);
      const stats = factorStats.get(rank.factorKey) ?? { min: 0, max: 1 };
      const value = metricValue(row.stock, factor, factors);
      score += normalize(value, stats.min, stats.max, rank.order) * (rank.weight / totalWeight);
    });
    return {
      ...row,
      score: round(score, 3),
      weight: 0
    };
  });
}

function applyWeights(rows: SelectionRow[], strategy: StrategyConfig) {
  const selected = rows.slice(0, strategy.trading.maxHoldings);
  if (!selected.length) {
    return selected;
  }
  const valueOf = (row: SelectionRow) => {
    if (strategy.trading.weightMethod === "流通市值") return row.stock.metrics.floatMarketCap;
    if (strategy.trading.weightMethod === "总市值") return row.stock.metrics.marketCap;
    if (strategy.trading.weightMethod === "流通市值平方根") return Math.sqrt(row.stock.metrics.floatMarketCap);
    if (strategy.trading.weightMethod === "总市值平方根") return Math.sqrt(row.stock.metrics.marketCap);
    return 1;
  };
  const total = selected.reduce((sum, row) => sum + valueOf(row), 0);
  return selected.map((row) => ({
    ...row,
    weight: round((valueOf(row) / total) * Math.min(strategy.trading.maxBuyPosition, 100), 2)
  }));
}

export function screenStocks(strategy: StrategyConfig, stocks: Stock[], pools: StockPool[], factors: Factor[]): SelectionRow[] {
  const primaryCodes = new Set(poolCodes(strategy.poolId, pools).map(normalizeStockCodeKey));
  const hotCodes = strategy.hotPoolId === "all" ? primaryCodes : new Set(poolCodes(strategy.hotPoolId, pools).map(normalizeStockCodeKey));
  const universe = stocks
    .filter((stock) => poolHasStock(primaryCodes, stock))
    .filter((stock) => poolHasStock(hotCodes, stock) || strategy.hotPoolId === "all")
    .filter((stock) => applySelector(strategy, stock));
  const filtered = applyFilters(universe, strategy, factors);
  const scored = scoreRows(filtered, strategy.ranks, factors).sort((a, b) => b.score - a.score);
  return applyWeights(scored.slice(0, strategy.poolLimit), strategy);
}

function benchmarkReturn(benchmark: string, date: string, index: number) {
  const base = hash(`${benchmark}-${date}`) % 100;
  return (Math.sin(base + index / 3) * 0.012 + 0.004 + (benchmark === "中证500" ? 0.001 : 0)) * 100;
}

function stockReturn(row: SelectionRow, date: string, index: number) {
  const m = row.stock.metrics;
  const style =
    m.momentum60 * 0.002 +
    m.qualityScore * 0.0015 +
    m.revenueGrowth * 0.001 -
    m.pe * 0.0009 -
    m.volatility20 * 0.0007 +
    row.score * 0.002;
  const noise = Math.sin(hash(`${row.stock.code}-${date}`) / 30 + index) * 1.8;
  return clamp(style + noise, -12, 14);
}

function timingExposure(strategy: StrategyConfig, date: string, factorMean: number) {
  if (strategy.timing.mode === "不择时") {
    return 1;
  }
  const pulse = 50 + Math.sin(hash(`${strategy.timing.index}-${date}`) / 70) * 30 + factorMean / 5;
  if (strategy.timing.mode === "使用择时模板") {
    if (strategy.timing.template.includes("MA60")) return pulse > 50 + strategy.timing.threshold ? 1 : 0.15;
    if (strategy.timing.template.includes("估值")) return factorMean > 45 ? 1 : 0.25;
    return pulse > strategy.timing.threshold ? 1 : 0.25;
  }
  return pulse + factorMean / 3 > 70 + strategy.timing.threshold ? 1 : 0.2;
}

export function runBacktest(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  config: BacktestConfig
): BacktestResult {
  const rows = screenStocks(strategy, stocks, pools, factors);
  const dates = dateRange(config.startDate, config.endDate, Math.max(7, strategy.trading.period * 4));
  let strategyNet = 1;
  let benchmarkNet = 1;
  let hedgeNet = 1;
  let high = 1;
  let maxDrawdown = 0;
  let wins = 0;
  const returns: number[] = [];
  const curve = dates.map((date, index) => {
    const rawStockReturn = rows.length
      ? rows.reduce((sum, row) => sum + stockReturn(row, date, index) * (row.weight / 100), 0)
      : 0;
    const factorMean = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
    const exposure = timingExposure(strategy, date, factorMean);
    const benchRet = benchmarkReturn(config.benchmark, date, index);
    const hedgeImpact = strategy.hedge.enabled ? -benchRet * (strategy.hedge.ratio / 100) - strategy.hedge.cost / 100 : 0;
    const costDrag = (config.cost / 1000) * (index === 0 ? 1 : 0.35);
    const periodReturn = rawStockReturn * exposure + hedgeImpact - costDrag * 100;
    strategyNet *= 1 + periodReturn / 100;
    benchmarkNet *= 1 + benchRet / 100;
    hedgeNet *= 1 + (periodReturn - hedgeImpact) / 100;
    high = Math.max(high, strategyNet);
    maxDrawdown = Math.min(maxDrawdown, strategyNet / high - 1);
    wins += periodReturn > benchRet ? 1 : 0;
    returns.push(periodReturn / 100);
    return {
      date,
      strategy: round(strategyNet, 4),
      benchmark: round(benchmarkNet, 4),
      hedge: round(hedgeNet, 4)
    };
  });

  const cumulativeReturn = strategyNet - 1;
  const years = Math.max((new Date(config.endDate).getTime() - new Date(config.startDate).getTime()) / (365 * 86400000), 0.1);
  const avg = returns.reduce((sum, item) => sum + item, 0) / Math.max(returns.length, 1);
  const volatility = Math.sqrt(returns.reduce((sum, item) => sum + (item - avg) ** 2, 0) / Math.max(returns.length, 1)) * Math.sqrt(252 / Math.max(strategy.trading.period, 1));
  const yearlyMap = new Map<string, { startS: number; endS: number; startB: number; endB: number }>();
  curve.forEach((point) => {
    const year = point.date.slice(0, 4);
    const existing = yearlyMap.get(year);
    if (!existing) {
      yearlyMap.set(year, { startS: 1, endS: point.strategy, startB: 1, endB: point.benchmark });
    } else {
      existing.endS = point.strategy;
      existing.endB = point.benchmark;
    }
  });

  const trades = rows.flatMap((row, index) => {
    const firstDate = dates[0] ?? config.startDate;
    const rebalanceDate = dates[Math.min(index + 1, Math.max(dates.length - 1, 0))] ?? config.endDate;
    return [
      { date: firstDate, action: "买入" as const, code: row.stock.code, name: row.stock.name, weight: row.weight, price: row.stock.metrics.price },
      { date: rebalanceDate, action: "调仓" as const, code: row.stock.code, name: row.stock.name, weight: row.weight, price: round(row.stock.metrics.price * (1 + row.score / 8000), 2) }
    ];
  });

  return {
    rows,
    curve,
    metrics: {
      cumulativeReturn: round(cumulativeReturn * 100, 2),
      annualReturn: round(((1 + cumulativeReturn) ** (1 / years) - 1) * 100, 2),
      maxDrawdown: round(maxDrawdown * 100, 2),
      sharpe: round(volatility ? (avg * (252 / Math.max(strategy.trading.period, 1))) / volatility : 0, 2),
      volatility: round(volatility * 100, 2),
      winRate: round((wins / Math.max(returns.length, 1)) * 100, 2),
      turnover: round(Math.min(220, strategy.trading.maxHoldings * 9 + strategy.trading.backupCount * 5 + config.cost * 8), 2)
    },
    yearly: Array.from(yearlyMap.entries()).map(([year, item]) => ({
      year,
      strategy: round((item.endS / item.startS - 1) * 100, 2),
      benchmark: round((item.endB / item.startB - 1) * 100, 2),
      excess: round((item.endS / item.startS - item.endB / item.startB) * 100, 2)
    })),
    trades
  };
}

export function rankingAnalysis(strategy: StrategyConfig, stocks: Stock[], pools: StockPool[], factors: Factor[]): RankingRow[] {
  const codes = new Set(poolCodes(strategy.poolId, pools).map(normalizeStockCodeKey));
  const universe = stocks.filter((stock) => poolHasStock(codes, stock)).filter((stock) => applySelector(strategy, stock));
  const rows = scoreRows(
    universe.map((stock) => ({ stock, passedFilters: 0 })),
    strategy.ranks,
    factors
  ).sort((a, b) => b.score - a.score);
  return rows.map((row, index) => ({
    stock: row.stock,
    score: row.score,
    rank: index + 1,
    values: Object.fromEntries(strategy.ranks.map((rank) => [rank.factorKey, metricValue(row.stock, factorByKey(factors, rank.factorKey), factors)]))
  }));
}

export function optimizeStrategy(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  config: BacktestConfig
) {
  const candidates = [6, 8, 10, 12, 15].map((maxHoldings) => ({
    ...strategy,
    trading: { ...strategy.trading, maxHoldings }
  }));
  const scored = candidates
    .map((candidate) => ({
      candidate,
      result: runBacktest(candidate, stocks, pools, factors, config)
    }))
    .sort((a, b) => b.result.metrics.sharpe - a.result.metrics.sharpe);
  return scored[0];
}
