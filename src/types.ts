export type StepKey = "screen" | "trading" | "timing" | "hedge";
export type BacktestTab = "backtest" | "daily" | "realtime" | "rank" | "factorCorrelation";
export type FilterOperator =
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "between"
  | "eq"
  | "neq"
  | "top"
  | "bottom"
  | "rankMax"
  | "rankMin"
  | "rankBetween"
  | "rankPctMax"
  | "rankPctMin"
  | "rankPctBetween";
export type RankOrder = "desc" | "asc";
export type FactorGroup =
  | "行情"
  | "技术指标"
  | "财务指标"
  | "财报条目"
  | "公司"
  | "分析师"
  | "大盘指标"
  | "自定义";

export interface Factor {
  key: string;
  name: string;
  group: FactorGroup;
  unit?: string;
  description: string;
  defaultOrder: RankOrder;
  precision?: number;
  formula?: string;
}

export interface Stock {
  code: string;
  name: string;
  exchange: "沪市" | "深市" | "北交所";
  board: "主板" | "创业板" | "科创板" | "北交所";
  industry1: string;
  industry2: string;
  website?: string;
  industryTags?: string[];
  region: string;
  property: "国企" | "民企" | "外资";
  isST: boolean;
  isSuspended: boolean;
  isSTAR: boolean;
  isMargin: boolean;
  indexes: string[];
  metrics: Record<string, number>;
}

export interface StockPool {
  id: string;
  name: string;
  type: "system" | "static" | "dynamic" | "compound";
  codes: string[];
  description?: string;
  sourcePoolId?: string;
  targetPoolId?: string;
  operator?: "and" | "or" | "sub";
  dynamicFilters?: FilterCondition[];
}

export interface FilterCondition {
  id: string;
  factorKey: string;
  operator: FilterOperator;
  min?: number;
  max?: number;
  value?: number;
  range: "全部" | "一级行业" | "二级行业";
  enabled: boolean;
}

export interface RankCondition {
  id: string;
  factorKey: string;
  order: RankOrder;
  range: "全部" | "一级行业" | "二级行业";
  weight: number;
  enabled: boolean;
}

export interface BuySellRule {
  id: string;
  name: string;
  factorKey: string;
  operator: FilterOperator;
  value: number;
  enabled: boolean;
}

export interface AssetItem {
  id: string;
  name: string;
  type: "策略" | "ETF";
  weight: number;
  startDate: string;
}

export interface StrategyConfig {
  id: string;
  name: string;
  updatedAt?: string;
  description: string;
  poolId: string;
  hotPoolId: string;
  poolLimit: number;
  screenPeriod: number;
  industryStandard: "申万 2014" | "申万 2021";
  indexMember: string;
  board: string;
  industry1: string;
  industry2: string;
  stMode: "包含ST" | "排除ST" | "仅有ST";
  exchange: string;
  region: string;
  property: string;
  marginFlag: string;
  starMode: "包含科创板" | "排除科创板" | "仅有科创板";
  filterSuspended: boolean;
  filters: FilterCondition[];
  ranks: RankCondition[];
  trading: {
    mode: "模型I" | "模型II" | "模型III";
    period: number;
    orderTime: "收盘价" | "开盘价" | "日均成交价";
    cashAsset: string;
    realtimeBacktest: boolean;
    multiPoint: boolean;
    maxHoldings: number;
    idealPosition: number;
    positionDeviation: number;
    minPosition: number;
    backupCount: number;
    maxBuyPosition: number;
    weightMethod: "平权" | "流通市值" | "总市值" | "流通市值平方根" | "总市值平方根";
    advancedOpen: boolean;
    tradeDate: string;
    sellSuspended: boolean;
    shortSelling: string;
    industryLimitRatio: number;
    positionExpression: string;
    industryNeutralBenchmark: string;
    buyRules: BuySellRule[];
    sellRules: BuySellRule[];
    holdRules: BuySellRule[];
  };
  timing: {
    mode: "不择时" | "使用择时模板" | "自定义择时公式";
    template: string;
    index: string;
    threshold: number;
    formula: string;
    cashWhenTimingOut: string;
  };
  hedge: {
    enabled: boolean;
    contract: "IF" | "IH" | "IC" | "IM";
    ratio: number;
    benchmark: string;
    rebalance: number;
    cost: number;
  };
  assets: AssetItem[];
}

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  benchmark: string;
  cost: number;
  excludeTimeRange: boolean;
}

export interface SelectionRow {
  stock: Stock;
  score: number;
  weight: number;
  passedFilters: number;
  failedReason?: string;
}

export interface CurvePoint {
  date: string;
  strategy: number;
  benchmark: number;
  hedge?: number;
}

export interface BacktestResult {
  rows: SelectionRow[];
  curve: CurvePoint[];
  metrics: {
    cumulativeReturn: number;
    annualReturn: number;
    maxDrawdown: number;
    sharpe: number;
    volatility: number;
    winRate: number;
    turnover: number;
  };
  yearly: Array<{ year: string; strategy: number; benchmark: number; excess: number }>;
  trades: Array<{ date: string; action: "买入" | "卖出" | "调仓"; code: string; name: string; weight: number; price: number }>;
}

export interface StrategyOptimizationResult {
  candidate: StrategyConfig;
  result: BacktestResult;
}

export interface RankingRow {
  stock: Stock;
  score: number;
  rank: number;
  values: Record<string, number>;
}
