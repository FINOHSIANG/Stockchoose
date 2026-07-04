import type { BacktestConfig, Factor, Stock, StockPool, StrategyConfig } from "../../src/types";
import { optimizeStrategy, rankingAnalysis, runBacktest, screenStocks } from "../../src/strategyEngine";

export interface StrategyRequest {
  strategy: StrategyConfig;
  stocks: Stock[];
  pools: StockPool[];
  factors: Factor[];
  resultLimit?: number;
  weightLimit?: number;
  config?: BacktestConfig;
}

export function runStrategyScreen(request: StrategyRequest) {
  return screenStocks(request.strategy, request.stocks, request.pools, request.factors, {
    resultLimit: request.resultLimit,
    weightLimit: request.weightLimit
  });
}

export function runStrategyRank(request: StrategyRequest) {
  return rankingAnalysis(request.strategy, request.stocks, request.pools, request.factors);
}

export function runStrategyBacktest(request: StrategyRequest) {
  if (!request.config) throw new Error("backtest config is required");
  return runBacktest(request.strategy, request.stocks, request.pools, request.factors, request.config);
}

export function runStrategyOptimize(request: StrategyRequest) {
  if (!request.config) throw new Error("optimize config is required");
  return optimizeStrategy(request.strategy, request.stocks, request.pools, request.factors, request.config);
}

