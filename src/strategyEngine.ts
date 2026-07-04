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
  StrategyConfig,
  StrategyOptimizationResult
} from "./types";
import { isAllIndustry, stockIndustryScopeKey, stockMatchesIndustry } from "./industryClassification";
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
  const metricKeys = Array.from(new Set([...Object.keys(stock.metrics), ...factors.map((factor) => factor.key)]));
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

function textIncludes(value: string | undefined, patterns: string[]) {
  const text = value ?? "";
  return patterns.some((pattern) => text.includes(pattern));
}

function isAll(value: string | undefined) {
  const text = (value ?? "").trim();
  return !text || text.toLowerCase() === "all" || text.includes("全") || text.includes("鍏");
}

function isAllPoolId(poolId: string | undefined) {
  return !poolId || poolId === "all" || isAll(poolId);
}

function positiveInt(value: number | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : fallback;
}

function positiveMetricValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveValuationFactor(key: string) {
  return ["pe", "pb", "ps", "pcf", "peg", "evEbitda", "dividendYield"].includes(key);
}

function factorMetricValue(stock: Stock, factor: Factor | undefined, factors: Factor[]): number | undefined {
  if (!factor) {
    return undefined;
  }
  const value = factor.formula ? evaluateFormula(factor.formula, stock, factors) : stock.metrics[factor.key];
  return positiveMetricValue(value);
}

function rankMetricValue(stock: Stock, factor: Factor | undefined, factors: Factor[]): number | undefined {
  const value = factorMetricValue(stock, factor, factors);
  if (value === undefined) {
    return undefined;
  }
  if (positiveValuationFactor(factor?.key ?? "") && value <= 0) {
    return undefined;
  }
  return value;
}

function normalizedRankScore(value: number | undefined, min: number, max: number, order: "asc" | "desc") {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 50;
  }
  return value === undefined ? 0 : normalize(value, min, max, order);
}

function allStockCodeSet(stocks: Stock[]) {
  return new Set(stocks.map((stock) => normalizeStockCodeKey(stock.code)));
}

function staticPoolCodeSet(pool: StockPool, stocks: Stock[]) {
  if (pool.id === "all" && !pool.codes.length) {
    return allStockCodeSet(stocks);
  }
  return new Set(pool.codes.map((code) => normalizeStockCodeKey(code)));
}

function poolCodeSet(poolId: string, pools: StockPool[], stocks: Stock[], factors: Factor[], visiting = new Set<string>()): Set<string> {
  if (isAllPoolId(poolId) && !pools.some((item) => item.id === "all")) {
    return allStockCodeSet(stocks);
  }
  if (visiting.has(poolId)) {
    return new Set();
  }
  const pool = pools.find((item) => item.id === poolId);
  if (!pool) {
    return new Set();
  }
  visiting.add(poolId);
  let codes: Set<string>;
  if (pool.type === "compound") {
    const source = poolCodeSet(pool.sourcePoolId ?? "all", pools, stocks, factors, visiting);
    const target = poolCodeSet(pool.targetPoolId ?? "all", pools, stocks, factors, visiting);
    if (pool.operator === "and") {
      codes = new Set(Array.from(source).filter((code) => target.has(code)));
    } else if (pool.operator === "sub") {
      codes = new Set(Array.from(source).filter((code) => !target.has(code)));
    } else {
      codes = new Set([...source, ...target]);
    }
  } else if (pool.type === "dynamic") {
    const baseCodes = staticPoolCodeSet(pool, stocks);
    const universe = stocks.filter((stock) => baseCodes.size === 0 || poolHasStock(baseCodes, stock));
    const poolStrategy = { filters: pool.dynamicFilters ?? [] } as StrategyConfig;
    codes = new Set(applyFilters(universe, poolStrategy, factors).map((row) => normalizeStockCodeKey(row.stock.code)));
  } else {
    codes = staticPoolCodeSet(pool, stocks);
  }
  visiting.delete(poolId);
  return codes;
}

function poolHasStock(codeSet: Set<string>, stock: Stock) {
  return stockCodeCandidates(stock).some((code) => codeSet.has(normalizeStockCodeKey(code)));
}

function rangeScopeKey(stock: Stock, range: FilterCondition["range"] | RankCondition["range"]) {
  const text = String(range ?? "");
  if (text.includes("industry1") || text.includes("\u4e00\u7ea7")) return stockIndustryScopeKey(stock, "industry1");
  if (text.includes("industry2") || text.includes("\u4e8c\u7ea7")) return stockIndustryScopeKey(stock, "industry2");
  return "all";
}

function applySelector(strategy: StrategyConfig, stock: Stock) {
  if (!isAll(strategy.indexMember) && !stock.indexes.includes(strategy.indexMember)) return false;
  if (!isAll(strategy.board) && stock.board !== strategy.board) return false;
  if (!isAllIndustry(strategy.industry1) && !stockMatchesIndustry(stock, "industry1", strategy.industry1)) return false;
  if (!isAllIndustry(strategy.industry2) && !stockMatchesIndustry(stock, "industry2", strategy.industry2)) return false;
  if (!isAll(strategy.exchange) && stock.exchange !== strategy.exchange) return false;
  if (!isAll(strategy.region) && stock.region !== strategy.region) return false;
  if (!isAll(strategy.property) && stock.property !== strategy.property) return false;
  if (textIncludes(strategy.marginFlag, ["融资融券", "铻嶈祫"]) && !textIncludes(strategy.marginFlag, ["非", "闈"]) && !stock.isMargin) return false;
  if (textIncludes(strategy.marginFlag, ["非融资融券", "闈炶瀺"]) && stock.isMargin) return false;
  if (textIncludes(strategy.stMode, ["排除ST", "鎺掗櫎ST"]) && stock.isST) return false;
  if (textIncludes(strategy.stMode, ["仅有ST", "浠呮湁ST"]) && !stock.isST) return false;
  if (textIncludes(strategy.starMode, ["排除科创板", "鎺掗櫎绉戝垱"]) && stock.isSTAR) return false;
  if (textIncludes(strategy.starMode, ["仅有科创板", "浠呮湁绉戝垱"]) && !stock.isSTAR) return false;
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

  const valuesByCondition = new Map<string, Map<string, number[]>>();
  enabled.forEach((condition) => {
    const factor = factorByKey(factors, condition.factorKey);
    const valuesByScope = new Map<string, number[]>();
    stocks.forEach((stock) => {
      const value = rankMetricValue(stock, factor, factors);
      if (value === undefined) {
        return;
      }
      const scopeKey = rangeScopeKey(stock, condition.range);
      valuesByScope.set(scopeKey, [...(valuesByScope.get(scopeKey) ?? []), value]);
    });
    valuesByCondition.set(condition.id, valuesByScope);
  });

  return stocks
    .map((stock) => {
      const failed = enabled.find((condition) => {
        const factor = factorByKey(factors, condition.factorKey);
        const value = rankMetricValue(stock, factor, factors);
        if (value === undefined) {
          return true;
        }
        const scopeKey = rangeScopeKey(stock, condition.range);
        const scopedValues = valuesByCondition.get(condition.id)?.get(scopeKey) ?? [];
        return !conditionPass(value, condition, scopedValues);
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

  const statsByRank = new Map<string, Map<string, { min: number; max: number }>>();
  enabled.forEach((rank) => {
    const factor = factorByKey(factors, rank.factorKey);
    const valuesByScope = new Map<string, number[]>();
    rows.forEach((row) => {
      const value = rankMetricValue(row.stock, factor, factors);
      if (value === undefined) {
        return;
      }
      const scopeKey = rangeScopeKey(row.stock, rank.range);
      valuesByScope.set(scopeKey, [...(valuesByScope.get(scopeKey) ?? []), value]);
    });
    statsByRank.set(
      rank.id,
      new Map(
        Array.from(valuesByScope.entries()).map(([scopeKey, values]) => [
          scopeKey,
          {
            min: Math.min(...values),
            max: Math.max(...values)
          }
        ])
      )
    );
  });

  const totalWeight = enabled.reduce((sum, rank) => sum + rank.weight, 0);
  return rows.map((row) => {
    let score = 0;
    enabled.forEach((rank) => {
      const factor = factorByKey(factors, rank.factorKey);
      const stats = statsByRank.get(rank.id)?.get(rangeScopeKey(row.stock, rank.range)) ?? { min: 0, max: 1 };
      const value = rankMetricValue(row.stock, factor, factors);
      score += normalizedRankScore(value, stats.min, stats.max, rank.order) * (rank.weight / totalWeight);
    });
    return {
      ...row,
      score: round(score, 3),
      weight: 0
    };
  });
}

interface ScreenStocksOptions {
  resultLimit?: number;
  weightLimit?: number;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function applyWeights(rows: SelectionRow[], strategy: StrategyConfig, weightLimit = strategy.trading.maxHoldings) {
  const selectedRows = rows.slice(0, positiveInt(weightLimit, positiveInt(strategy.trading.maxHoldings, 1)));
  if (!selectedRows.length) {
    return rows;
  }
  const weightValueOf = (row: SelectionRow) => {
    const method = strategy.trading.weightMethod ?? "";
    const useFloatMarketCap = textIncludes(method, ["流通", "娴侀€"]);
    const useTotalMarketCap = textIncludes(method, ["总市值", "鎬诲競"]);
    const useSqrt = textIncludes(method, ["平方根", "钩鏂规牴"]);
    const rawValue = useFloatMarketCap ? row.stock.metrics.floatMarketCap : useTotalMarketCap ? row.stock.metrics.marketCap : 1;
    const value = positiveMetricValue(rawValue) ?? 0;
    return useSqrt ? Math.sqrt(Math.max(0, value)) : Math.max(0, value);
  };
  const selectedTotal = selectedRows.reduce((sum, row) => sum + weightValueOf(row), 0);
  const selectedWeightByCode = new Map(
    selectedRows.map((row) => [
      row.stock.code,
      selectedTotal > 0 ? round((weightValueOf(row) / selectedTotal) * Math.min(strategy.trading.maxBuyPosition, 100), 2) : 0
    ])
  );
  return rows.map((row) => ({
    ...row,
    weight: selectedWeightByCode.get(row.stock.code) ?? 0
  }));
}

export function screenStocks(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  options: ScreenStocksOptions = {}
): SelectionRow[] {
  const primaryCodes = poolCodeSet(strategy.poolId || "all", pools, stocks, factors);
  const hotCodes = isAllPoolId(strategy.hotPoolId) ? primaryCodes : poolCodeSet(strategy.hotPoolId, pools, stocks, factors);
  const universe = stocks
    .filter((stock) => poolHasStock(primaryCodes, stock))
    .filter((stock) => isAllPoolId(strategy.hotPoolId) || poolHasStock(hotCodes, stock))
    .filter((stock) => applySelector(strategy, stock));
  const filtered = applyFilters(universe, strategy, factors);
  const scored = scoreRows(filtered, strategy.ranks, factors).sort((a, b) => b.score - a.score);
  const strategyLimit = positiveInt(strategy.poolLimit, 1);
  const resultLimit = Math.min(strategyLimit, positiveInt(options.resultLimit, strategyLimit));
  return applyWeights(scored.slice(0, resultLimit), strategy, positiveInt(options.weightLimit, positiveInt(strategy.trading.maxHoldings, 1)));
}

async function readBunJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details.trim() ? `: ${details.trim().slice(0, 300)}` : "";
    throw new Error(`${label} HTTP ${response.status}${suffix}`);
  }
  try {
    return await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${label} returned invalid JSON: ${detail}`);
  }
}

function requireBunFetch(request: FetchLike | undefined, label: string): FetchLike {
  if (!request) throw new Error(`${label} unavailable: fetch is not available`);
  return request;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function selectionRowFromPayload(row: unknown, index: number, label: string): SelectionRow {
  if (!isRecord(row)) throw new Error(`${label} returned invalid selection row ${index}: row must be an object`);
  if (!isRecord(row.stock) || typeof row.stock.code !== "string" || typeof row.stock.name !== "string") {
    throw new Error(`${label} returned invalid selection row ${index}: stock must be a stock object`);
  }
  if (typeof row.score !== "number" || !Number.isFinite(row.score)) {
    throw new Error(`${label} returned invalid selection row ${index}: score must be a finite number`);
  }
  if (typeof row.weight !== "number" || !Number.isFinite(row.weight)) {
    throw new Error(`${label} returned invalid selection row ${index}: weight must be a finite number`);
  }
  if (typeof row.passedFilters !== "number" || !Number.isFinite(row.passedFilters)) {
    throw new Error(`${label} returned invalid selection row ${index}: passedFilters must be a finite number`);
  }
  return row as unknown as SelectionRow;
}

function rankingRowFromPayload(row: unknown, index: number, label: string): RankingRow {
  if (!isRecord(row)) throw new Error(`${label} returned invalid ranking row ${index}: row must be an object`);
  if (!isRecord(row.stock) || typeof row.stock.code !== "string" || typeof row.stock.name !== "string") {
    throw new Error(`${label} returned invalid ranking row ${index}: stock must be a stock object`);
  }
  if (typeof row.score !== "number" || !Number.isFinite(row.score)) {
    throw new Error(`${label} returned invalid ranking row ${index}: score must be a finite number`);
  }
  if (typeof row.rank !== "number" || !Number.isFinite(row.rank)) {
    throw new Error(`${label} returned invalid ranking row ${index}: rank must be a finite number`);
  }
  if (!isRecord(row.values)) {
    throw new Error(`${label} returned invalid ranking row ${index}: values must be an object`);
  }
  return row as unknown as RankingRow;
}

export async function screenStocksBunFirst(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  options: ScreenStocksOptions = {},
  fetchImpl?: FetchLike
): Promise<SelectionRow[]> {
  const label = "Bun strategy screen API";
  const request = requireBunFetch(fetchImpl ?? (typeof fetch === "function" ? fetch : undefined), label);
  const response = await request("/api/strategy/screen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      strategy,
      stocks,
      pools,
      factors,
      resultLimit: options.resultLimit,
      weightLimit: options.weightLimit
    })
  });
  const rows = await readBunJson(response, label);
  if (!Array.isArray(rows)) throw new Error(`${label} returned invalid selection rows`);
  return rows.map((row, index) => selectionRowFromPayload(row, index, label));
}

function emptyBacktestResult(): BacktestResult {
  return {
    rows: [],
    curve: [],
    metrics: {
      cumulativeReturn: 0,
      annualReturn: 0,
      maxDrawdown: 0,
      sharpe: 0,
      volatility: 0,
      winRate: 0,
      turnover: 0
    },
    yearly: [],
    trades: []
  };
}

function emptyOptimizationResult(strategy: StrategyConfig): StrategyOptimizationResult {
  return {
    candidate: strategy,
    result: emptyBacktestResult()
  };
}

function benchmarkReturn(benchmark: string, date: string, index: number) {
  const robustBase = hash(`${benchmark}-${date}`) % 100;
  return (Math.sin(robustBase + index / 3) * 0.012 + 0.004 + (benchmark.includes("500") ? 0.001 : 0)) * 100;
}

function stockReturn(row: SelectionRow, date: string, index: number) {
  const metrics = row.stock.metrics;
  const robustStyle =
    (metrics.momentum60 ?? 0) * 0.002 +
    (metrics.qualityScore ?? 0) * 0.0015 +
    (metrics.revenueGrowth ?? 0) * 0.001 -
    (metrics.pe ?? 0) * 0.0009 -
    (metrics.volatility20 ?? 0) * 0.0007 +
    row.score * 0.002;
  const robustNoise = Math.sin(hash(`${row.stock.code}-${date}`) / 30 + index) * 1.8;
  return clamp(robustStyle + robustNoise, -12, 14);
}

function timingExposure(strategy: StrategyConfig, date: string, factorMean: number) {
  const mode = strategy.timing.mode ?? "";
  if (!mode || textIncludes(mode, ["不择时", "涓嶆嫨"])) {
    return 1;
  }
  const robustPulse = 50 + Math.sin(hash(`${strategy.timing.index}-${date}`) / 70) * 30 + factorMean / 5;
  if (textIncludes(mode, ["使用择时模板", "浣跨敤"])) {
    if ((strategy.timing.template ?? "").includes("MA60")) return robustPulse > 50 + strategy.timing.threshold ? 1 : 0.15;
    if (textIncludes(strategy.timing.template, ["估值", "浼板"])) return factorMean > 45 ? 1 : 0.25;
    return robustPulse > strategy.timing.threshold ? 1 : 0.25;
  }
  return robustPulse + factorMean / 3 > 70 + strategy.timing.threshold ? 1 : 0.2;
}

export function runBacktest(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  config: BacktestConfig
): BacktestResult {
  const holdingLimit = positiveInt(strategy.trading.maxHoldings, 1);
  const rows = screenStocks(strategy, stocks, pools, factors, {
    resultLimit: holdingLimit,
    weightLimit: holdingLimit
  });
  const dates = dateRange(config.startDate, config.endDate, Math.max(7, positiveInt(strategy.trading.period, 1) * 4));
  let strategyNet = 1;
  let benchmarkNet = 1;
  let hedgeNet = 1;
  let high = 1;
  let maxDrawdown = 0;
  let wins = 0;
  const returns: number[] = [];

  const curve = dates.map((date, index) => {
    const rawStockReturn = rows.reduce((sum, row) => sum + stockReturn(row, date, index) * (row.weight / 100), 0);
    const factorMean = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
    const exposure = timingExposure(strategy, date, factorMean);
    const benchmarkPeriodReturn = benchmarkReturn(config.benchmark, date, index);
    const hedgeImpact = strategy.hedge.enabled ? -benchmarkPeriodReturn * (strategy.hedge.ratio / 100) - strategy.hedge.cost / 100 : 0;
    const costDrag = (config.cost / 1000) * (index === 0 ? 1 : 0.35);
    const periodReturn = rawStockReturn * exposure + hedgeImpact - costDrag * 100;
    strategyNet *= 1 + periodReturn / 100;
    benchmarkNet *= 1 + benchmarkPeriodReturn / 100;
    hedgeNet *= 1 + (periodReturn - hedgeImpact) / 100;
    high = Math.max(high, strategyNet);
    maxDrawdown = Math.min(maxDrawdown, strategyNet / high - 1);
    if (periodReturn > benchmarkPeriodReturn) {
      wins += 1;
    }
    returns.push(periodReturn / 100);
    return {
      date,
      strategy: round(strategyNet, 4),
      benchmark: round(benchmarkNet, 4),
      hedge: round(hedgeNet, 4)
    };
  });

  const returnCount = Math.max(returns.length, 1);
  const avg = returns.reduce((sum, item) => sum + item, 0) / returnCount;
  const volatility =
    Math.sqrt(returns.reduce((sum, item) => sum + (item - avg) ** 2, 0) / returnCount) *
    Math.sqrt(252 / positiveInt(strategy.trading.period, 1));
  const start = new Date(`${config.startDate}T00:00:00`);
  const end = new Date(`${config.endDate}T00:00:00`);
  const years =
    Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
      ? 0.1
      : Math.max((end.getTime() - start.getTime()) / (365 * 24 * 60 * 60 * 1000), 0.1);
  const cumulativeReturn = strategyNet - 1;
  const yearlyMap = new Map<string, { startS: number; endS: number; startB: number; endB: number }>();
  curve.forEach((point) => {
    const year = point.date.slice(0, 4);
    const current = yearlyMap.get(year);
    if (current) {
      current.endS = point.strategy;
      current.endB = point.benchmark;
    } else {
      yearlyMap.set(year, { startS: 1, endS: point.strategy, startB: 1, endB: point.benchmark });
    }
  });
  const yearly = Array.from(yearlyMap.entries()).map(([year, item]) => ({
    year,
    strategy: round((item.endS / item.startS - 1) * 100, 2),
    benchmark: round((item.endB / item.startB - 1) * 100, 2),
    excess: round((item.endS / item.startS - item.endB / item.startB) * 100, 2)
  }));
  const firstDate = dates[0] ?? config.startDate;
  const lastIndex = Math.max(0, dates.length - 1);
  const trades = rows.flatMap((row, index) => {
    const rebalanceDate = dates[Math.min(index + 1, lastIndex)] ?? config.endDate;
    const price = positiveMetricValue(row.stock.metrics.price) ?? 0;
    return [
      {
        date: firstDate,
        action: "\u4e70\u5165" as BacktestResult["trades"][number]["action"],
        code: row.stock.code,
        name: row.stock.name,
        weight: row.weight,
        price
      },
      {
        date: rebalanceDate,
        action: "\u8c03\u4ed3" as BacktestResult["trades"][number]["action"],
        code: row.stock.code,
        name: row.stock.name,
        weight: row.weight,
        price: round(price * (1 + row.score / 8000), 2)
      }
    ];
  });

  return {
    rows,
    curve,
    metrics: {
      cumulativeReturn: round(cumulativeReturn * 100, 2),
      annualReturn: round(((1 + cumulativeReturn) ** (1 / years) - 1) * 100, 2),
      maxDrawdown: round(maxDrawdown * 100, 2),
      sharpe: round(volatility > 0 ? (avg * (252 / positiveInt(strategy.trading.period, 1))) / volatility : 0, 2),
      volatility: round(volatility * 100, 2),
      winRate: round((wins / returnCount) * 100, 2),
      turnover: round(Math.min(220, holdingLimit * 9 + strategy.trading.backupCount * 5 + config.cost * 8), 2)
    },
    yearly,
    trades
  };
}

export async function runBacktestBunFirst(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  config: BacktestConfig,
  fetchImpl?: FetchLike
): Promise<BacktestResult> {
  const label = "Bun strategy backtest API";
  const request = requireBunFetch(fetchImpl ?? (typeof fetch === "function" ? fetch : undefined), label);
  const response = await request("/api/strategy/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ strategy, stocks, pools, factors, config })
  });
  const result = await readBunJson(response, label);
  if (!result || !Array.isArray((result as BacktestResult).rows) || !Array.isArray((result as BacktestResult).curve)) {
    throw new Error(`${label} returned invalid backtest result`);
  }
  return result as BacktestResult;
}

export function rankingAnalysis(strategy: StrategyConfig, stocks: Stock[], pools: StockPool[], factors: Factor[]): RankingRow[] {
  const primaryCodes = poolCodeSet(strategy.poolId || "all", pools, stocks, factors);
  const universe = stocks.filter((stock) => poolHasStock(primaryCodes, stock)).filter((stock) => applySelector(strategy, stock));
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

export async function rankingAnalysisBunFirst(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  fetchImpl?: FetchLike
): Promise<RankingRow[]> {
  const label = "Bun strategy rank API";
  const request = requireBunFetch(fetchImpl ?? (typeof fetch === "function" ? fetch : undefined), label);
  const response = await request("/api/strategy/rank", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ strategy, stocks, pools, factors })
  });
  const rows = await readBunJson(response, label);
  if (!Array.isArray(rows)) throw new Error(`${label} returned invalid ranking rows`);
  return rows.map((row, index) => rankingRowFromPayload(row, index, label));
}

export function optimizeStrategy(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  config: BacktestConfig
): StrategyOptimizationResult {
  const candidates = Array.from(new Set([positiveInt(strategy.trading.maxHoldings, 10), 6, 8, 10, 12, 15])).map((maxHoldings) => {
    const candidate = {
      ...strategy,
      trading: {
        ...strategy.trading,
        maxHoldings
      }
    };
    return {
      candidate,
      result: runBacktest(candidate, stocks, pools, factors, config)
    };
  });
  return candidates.reduce<StrategyOptimizationResult | null>((best, current) => {
    if (!best || current.result.metrics.sharpe > best.result.metrics.sharpe) {
      return current;
    }
    return best;
  }, null) ?? {
    candidate: strategy,
    result: runBacktest(strategy, stocks, pools, factors, config)
  };
}

export async function optimizeStrategyBunFirst(
  strategy: StrategyConfig,
  stocks: Stock[],
  pools: StockPool[],
  factors: Factor[],
  config: BacktestConfig,
  fetchImpl?: FetchLike
): Promise<StrategyOptimizationResult> {
  const label = "Bun strategy optimize API";
  const request = requireBunFetch(fetchImpl ?? (typeof fetch === "function" ? fetch : undefined), label);
  const response = await request("/api/strategy/optimize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ strategy, stocks, pools, factors, config })
  });
  const result = await readBunJson(response, label);
  if (!(result as StrategyOptimizationResult)?.candidate || !(result as StrategyOptimizationResult)?.result?.metrics) {
    throw new Error(`${label} returned invalid optimization result`);
  }
  return result as StrategyOptimizationResult;
}
