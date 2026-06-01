import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  FileText,
  Filter,
  HelpCircle,
  Info,
  Layers,
  LineChart,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import {
  BOARD_OPTIONS,
  EXCHANGE_OPTIONS,
  FACTORS,
  INDEX_OPTIONS,
  INDUSTRY_OPTIONS,
  PROPERTY_OPTIONS,
  REGION_OPTIONS,
  SAMPLE_ASSETS,
  STOCKS
} from "./data";
import {
  createCustomFactor,
  createDefaultBacktestConfig,
  createDefaultStrategy,
  createStaticPool,
  loadLocal,
  removeLocal,
  saveLocal,
  uid
} from "./storage";
import {
  factorByKey,
  formatMetric,
  metricValue,
  optimizeStrategy,
  rankingAnalysis,
  runBacktest,
  screenStocks
} from "./strategyEngine";
import {
  defaultBaseUrlForProvider,
  defaultInfoSourceSettings,
  ensureInfoSourceSettings,
  enabledSourceModules,
  infoSourceProviderOptions,
  sourceModuleLabels,
  testInfoSourceConnection,
  type InfoSourceSettings,
  type SourceModuleKey
} from "./integrationServices";
import {
  defaultOpenSourceDataSummary,
  syncOpenSourceMarketData,
  type OpenSourceDataSummary
} from "./openDataService";
import {
  createDefaultNewsSourceEndpoint,
  defaultBaseUrlForNewsProvider,
  defaultNewsSourceSettings,
  enabledNewsSources,
  ensureNewsSourceSettings,
  newsLanguageOptions,
  newsSourceProviderOptions,
  testNewsSourceConnection,
  type NewsSourceEndpoint,
  type NewsSourceProvider,
  type NewsSourceSettings
} from "./newsSourceServices";
import {
  defaultBaseUrlForNewsAnalysisProvider,
  defaultModelForNewsAnalysisProvider,
  defaultNewsAnalysisModelSettings,
  enabledNewsAnalysisTasks,
  ensureNewsAnalysisModelSettings,
  newsAnalysisDepthOptions,
  newsAnalysisModelProviderOptions,
  newsAnalysisTaskLabels,
  testNewsAnalysisModelConnection,
  type NewsAnalysisModelProvider,
  type NewsAnalysisModelSettings,
  type NewsAnalysisTaskKey
} from "./newsAnalysisModelServices";
import {
  bindTradeConnection,
  createTradePlan,
  defaultPaperTradeState,
  defaultTradeConnectionSettings,
  ensurePaperTradeState,
  ensureTradeConnectionSettings,
  submitPaperTradePlan as submitPaperTradePlanToState,
  tradePlanToCsv,
  type ExecutionMode,
  type PaperTradeState,
  type TradeConnectionSettings,
  type TradePlan
} from "./tradingServices";
import {
  buildSentimentInsightReport,
  buildSentimentEventsFromNewsArticles,
  buildSentimentLinkedStocks,
  filterSentimentEvents,
  scoreSentimentEvent,
  sentimentCategories,
  sentimentDirections,
  sentimentSeverityLevels,
  type SentimentEvent,
  type SentimentFilters
} from "./sentimentServices";
import {
  defaultNewsFetchStats,
  defaultNewsFilters,
  fetchNewsArticlesFromSources,
  filterNewsArticles,
  formatNewsDate,
  getNewsSourceList,
  getNewsStats,
  newsCategoryOptions,
  newsDateRangeOptions,
  newsFetchModeOptions,
  newsImportanceOptions,
  newsSentimentOptions,
  type NewsArticle,
  type NewsFetchMode,
  type NewsFetchStats,
  type NewsFilters
} from "./newsPageServices";
import {
  buildAnnualFinancialReports,
  buildFinancialReportSourceDataUrl,
  type AnnualFinancialReport,
  type AnnualFinancialReportYear
} from "./financialReportServices";
import {
  buildValuationRows,
  calculateValuation,
  defaultValuationFilters,
  enterpriseStateOptions,
  hasRequiredRealValuationData,
  missingRealValuationFields,
  summarizeValuationRows,
  valuationBoardOptions,
  valuationStyleOptions,
  type ValuationFilters,
  type ValuationRow
} from "./valuationServices";
import {
  fetchStockKlineHistory,
  syncTencentAllAshareMarketData,
  syncTencentRealMarketData,
  type StockKlineHistoryResult,
  type StockKlinePeriod,
  type StockKlinePoint
} from "./realMarketDataService";
import {
  displayStockCode,
  isCodeLikeStockQuery,
  normalizeStockCodeInput,
  resolveStockByCode,
  stockCodeForStorage,
  stockMatchesCodeQuery
} from "./stockIdentity";
import type {
  AssetItem,
  BacktestConfig,
  BacktestResult,
  BacktestTab,
  Factor,
  FactorGroup,
  FilterCondition,
  FilterOperator,
  RankingRow,
  RankCondition,
  SelectionRow,
  StepKey,
  Stock,
  StockPool,
  StrategyConfig
} from "./types";

const factorGroups: FactorGroup[] = ["行情", "技术指标", "财务指标", "财报条目", "公司", "分析师", "大盘指标", "自定义"];
const factorTabs: FactorGroup[] = ["行情", "技术指标", "财务指标", "财报条目", "公司", "分析师", "大盘指标"];
const guornFactorKeysByGroup: Partial<Record<FactorGroup, string[]>> = {
  行情: [
    "price",
    "amount",
    "volume",
    "pctChange",
    "relativeChange",
    "turnover",
    "limitFlag",
    "marketCap",
    "netInflow",
    "marginBalance",
    "northHold",
    "intradayStrength",
    "min15Momentum",
    "newStockScore",
    "ahPremium",
    "priceAmplitude",
    "listingDays",
    "tradingDays"
  ]
};
const fallbackResultFactorKeys = ["qualityScore", "pe", "momentum60"];
const priceDetailNames = [
  "开盘价",
  "收盘价",
  "最高价",
  "最低价",
  "前日收盘价",
  "日均成交价",
  "后复权收盘价",
  "后复权最高价",
  "后复权最低价",
  "后复权开盘价",
  "后复权日均成交价",
  "后复权因子",
  "5日复权均价",
  "20日复权均价",
  "60日复权均价",
  "120日复权均价",
  "250日复权均价",
  "N日复权均价"
];
const defaultDetailNames = ["当前值", "5日均值", "20日均值", "60日均值", "120日均值", "250日均值", "行业排名", "行业分位", "全市场排名", "全市场分位"];
const factorDetailNamesByKey: Record<string, string[]> = {
  price: priceDetailNames,
  amount: ["成交额", "5日平均成交额", "20日平均成交额", "60日平均成交额", "120日平均成交额", "250日平均成交额", "行业成交额排名", "全市场成交额排名"],
  volume: ["成交量", "5日平均成交量", "20日平均成交量", "60日平均成交量", "120日平均成交量", "250日平均成交量", "量比", "成交量行业排名"],
  pctChange: ["日涨幅", "5日涨幅", "20日涨幅", "60日涨幅", "120日涨幅", "250日涨幅", "行业涨幅排名", "全市场涨幅排名"],
  relativeChange: ["相对沪深300涨幅", "相对中证500涨幅", "相对行业涨幅", "5日相对涨幅", "20日相对涨幅", "60日相对涨幅"],
  turnover: ["换手率", "5日平均换手率", "20日平均换手率", "60日平均换手率", "120日平均换手率", "换手率分位"],
  limitFlag: ["涨停标记", "跌停标记", "近5日涨停次数", "近20日涨停次数", "近60日涨停次数", "一字涨停标记"],
  marketCap: ["总市值", "流通市值", "自由流通市值", "总股本", "流通股本", "市值行业排名"],
  netInflow: ["主力净流入", "超大单净流入", "大单净流入", "中单净流入", "小单净流入", "5日资金净流入"],
  marginBalance: ["融资余额", "融券余额", "融资买入额", "融资偿还额", "融券卖出量", "两融余额变化"],
  northHold: ["港资持股比例", "港资持股数量", "港资持股市值", "5日港资增持", "20日港资增持", "港资持股分位"],
  intradayStrength: ["日内强弱", "开盘涨幅", "午盘涨幅", "尾盘涨幅", "日内振幅", "收盘位置"],
  min15Momentum: ["15分钟涨幅", "15分钟成交额", "15分钟换手率", "15分钟波动率", "15分钟量比", "15分钟强弱"],
  newStockScore: ["上市天数", "开板天数", "新股涨幅", "新股换手率", "新股成交额", "新股活跃度"],
  ahPremium: ["AH股溢价率", "A股价格", "H股折算价", "溢价率5日均值", "溢价率20日均值", "溢价率分位"],
  priceAmplitude: ["股价振幅", "5日平均振幅", "20日平均振幅", "60日平均振幅", "120日平均振幅", "振幅分位"],
  listingDays: ["上市天数", "上市月数", "上市年数", "次新股标记", "老股标记", "上市天数分位"],
  tradingDays: ["交易天数", "近20日交易天数", "近60日交易天数", "近120日交易天数", "近250日交易天数", "停牌天数"]
};
const detailFormulaMultipliers = [0.98, 1, 1.03, 0.97, 0.99, 1.005, 1.01, 1.04, 0.96, 0.995, 1.008, 0.1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.02];

const padTimePart = (value: number) => String(value).padStart(2, "0");

function formatStrategyUpdatedAt(updatedAt?: string) {
  if (!updatedAt) return "最新更新时间 --";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "最新更新时间 --";
  return `最新更新时间 ${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())} ${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

function formatDateTime(updatedAt?: string) {
  if (!updatedAt) return "--";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "--";
  return `${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())} ${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

const refreshIntervalOptions = [
  { label: "关闭自动刷新", value: 0 },
  { label: "1 分钟", value: 1 },
  { label: "5 分钟", value: 5 },
  { label: "15 分钟", value: 15 },
  { label: "30 分钟", value: 30 },
  { label: "60 分钟", value: 60 }
];

function loadManualFirstRefreshInterval(name: string) {
  const migrationKey = `${name}:manualFirstDefaultV1`;
  const migrated = loadLocal(migrationKey, false);
  const stored = loadLocal<number | null>(name, null);
  if (!migrated && (stored === null || stored === 15)) {
    saveLocal(name, 0);
    saveLocal(migrationKey, true);
    return 0;
  }
  const value = typeof stored === "number" ? stored : Number(stored ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "export";
}

function downloadTextFile(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const mojibakeTextPattern = /[\uFFFD]|锟|Ã|Â|ŵ|˼/;

function hasRealRuntimeStockData(stock: Stock) {
  return stock.metrics.realQuoteSource === 1 || stock.metrics.openSourceMarketSource === 1;
}

function ensureStockData(value: Stock[]) {
  if (!Array.isArray(value) || !value.length) return [];
  return value.filter((stock) => !mojibakeTextPattern.test(stock.name) && hasRealRuntimeStockData(stock));
}

function purgeLegacyLocalFakeData() {
  const marker = "localFakeDataClearedV1";
  if (loadLocal(marker, false)) return;
  [
    "openSourceStocks",
    "openSourceDataSummary",
    "valuationDataSource",
    "paperTradeState",
    "newsSourceSettings",
    "infoSourceSettings"
  ].forEach(removeLocal);
  saveLocal(marker, true);
}

function createRuntimeSystemPools(stocks: Stock[]): StockPool[] {
  const byBoard = (board: Stock["board"]) => stocks.filter((stock) => stock.board === board).map((stock) => stock.code);
  return [
    { id: "all", name: "全部股票", type: "system", codes: stocks.map((stock) => stock.code), description: "真实数据接入后的股票全集。" },
    { id: "main-board", name: "主板", type: "system", codes: byBoard("主板"), description: "真实数据接入后的主板股票。" },
    { id: "cyb", name: "创业板", type: "system", codes: byBoard("创业板"), description: "真实数据接入后的创业板股票。" },
    { id: "kcb50", name: "科创板", type: "system", codes: byBoard("科创板"), description: "真实数据接入后的科创板股票。" },
    { id: "bse50", name: "北交所", type: "system", codes: byBoard("北交所"), description: "真实数据接入后的北交所股票。" }
  ];
}

function touchStrategyUpdatedAt(item: StrategyConfig): StrategyConfig {
  return { ...item, updatedAt: new Date().toISOString() };
}

function ensureStrategyUpdatedAt(item: StrategyConfig): StrategyConfig {
  return item.updatedAt ? item : touchStrategyUpdatedAt(item);
}

const operators: Array<{ value: FilterOperator; label: string }> = [
  { value: "gt", label: "大于" },
  { value: "lt", label: "小于" },
  { value: "eq", label: "等于" },
  { value: "between", label: "区间" },
  { value: "rankMax", label: "排名最大" },
  { value: "rankMin", label: "排名最小" },
  { value: "rankBetween", label: "排名区间" },
  { value: "rankPctMax", label: "排名%最大" },
  { value: "rankPctMin", label: "排名%最小" },
  { value: "rankPctBetween", label: "排名%区间" }
];

type ModalKey = null | "pool" | "summary" | "asset" | "customFactor" | "optimization" | "compare";
type MainSection = "strategy" | "sentiment" | "valuation" | "trade" | "settings";
type StockReference = Pick<Stock, "code" | "name">;
type StockInfoTarget = StockReference & { stock?: Stock };
type SortDirection = "asc" | "desc";
type ValuationDataSource = "none" | "tencentQuote";
type ValuationSortKey = "currentPrice" | "fairValue" | "marketCap" | "fairMarketCap" | "safetyMargin" | "governanceScore" | "action";

const stockKlinePeriodOptions: Array<{ value: StockKlinePeriod; label: string }> = [
  { value: "day", label: "日K" },
  { value: "week", label: "周K" },
  { value: "month", label: "月K" }
];

const valuationSortLabels: Record<ValuationSortKey, string> = {
  currentPrice: "现价",
  fairValue: "核算价值",
  marketCap: "市值",
  fairMarketCap: "核算市值",
  safetyMargin: "安全边际",
  governanceScore: "治理",
  action: "动作"
};

const defaultSentimentFilters: SentimentFilters = {
  category: "全部",
  direction: "全部",
  industry: "全部",
  severity: "全部",
  minScore: 60,
  query: ""
};

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function resolveStockInfoTarget(stock: StockReference, stocks: Stock[]): StockInfoTarget {
  const fullStock = resolveStockByCode(stocks, stock.code);
  return {
    code: fullStock?.code ?? stock.code,
    name: fullStock?.name ?? stock.name,
    stock: fullStock
  };
}

function formatStockMetric(stock: Stock, key: string, suffix = "", precision = 2) {
  const value = stock.metrics[key];
  if (!Number.isFinite(value)) return "--";
  return `${round(value, precision)}${suffix}`;
}

function stockMetricValue(stock: Stock, key: string) {
  const value = stock.metrics[key];
  return Number.isFinite(value) ? value : undefined;
}

function formatOptionalMetric(value: number | undefined, suffix = "", precision = 2) {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return `${round(value, precision)}${suffix}`;
}

function formatStockRatio(stock: Stock, numeratorKey: string, denominatorKey: string, suffix = "%") {
  const numerator = stockMetricValue(stock, numeratorKey);
  const denominator = stockMetricValue(stock, denominatorKey);
  if (numerator === undefined || denominator === undefined || Math.abs(denominator) < 0.01) return "--";
  return `${round((numerator / denominator) * 100, 2)}${suffix}`;
}

function stockReportSignals(stock: Stock) {
  const signals: string[] = [];
  if (stock.metrics.realAnnualReportSource !== 1) {
    return ["尚未接入真实财报、治理或监管处罚源，不展示本地样本推导提示"];
  }
  const cashflow = stockMetricValue(stock, "operatingCashflow") ?? 0;
  const netProfit = stockMetricValue(stock, "netProfit") ?? 0;
  const debtRatio = stockMetricValue(stock, "debtRatio") ?? 0;
  const currentRatio = stockMetricValue(stock, "currentRatio") ?? 0;
  const receivableRatio = (() => {
    const receivables = stockMetricValue(stock, "receivables");
    const revenue = stockMetricValue(stock, "revenue");
    return receivables !== undefined && revenue ? receivables / revenue : undefined;
  })();
  const pledgeRatio = stockMetricValue(stock, "pledgeRatio") ?? 0;
  const violationScore = stockMetricValue(stock, "violationScore") ?? 0;

  if (netProfit > 0 && cashflow / netProfit >= 0.8) signals.push("经营现金流覆盖净利润，利润含金量较好");
  if (netProfit > 0 && cashflow / netProfit < 0.5) signals.push("经营现金流覆盖不足，需要核查应收、存货和收入确认");
  if (debtRatio > 65 && stock.industry1 !== "银行") signals.push("资产负债率偏高，估值应提高财务折价");
  if (currentRatio > 0 && currentRatio < 1) signals.push("流动比率低于 1，短期偿债压力偏高");
  if (receivableRatio !== undefined && receivableRatio > 0.2) signals.push("应收账款占收入比例偏高，需关注回款质量");
  if (pledgeRatio > 20) signals.push("股权质押比例较高，治理风险上升");
  if (violationScore > 35) signals.push("违规风险分偏高，需核查公告与监管记录");
  if (!signals.length) signals.push("当前真实字段未触发显著财务或治理预警");
  return signals;
}

function StockNameAction({
  stock,
  onOpen,
  className = "stock-inline-link",
  children
}: {
  stock: StockReference;
  onOpen?: (stock: StockReference) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!onOpen) return <>{children ?? stock.name}</>;
  return (
    <button className={className} type="button" onClick={() => onOpen(stock)}>
      {children ?? stock.name}
    </button>
  );
}

function valuationActionRank(row: ValuationRow) {
  if (row.governanceScore < 45) return 0;
  if (row.safetyMargin >= 60) return 5;
  if (row.safetyMargin >= 35) return 4;
  if (row.safetyMargin >= 10) return 3;
  if (row.safetyMargin >= 0) return 2;
  return 1;
}

function valuationFairMarketCap(row: ValuationRow) {
  if (!Number.isFinite(row.marketCap) || !Number.isFinite(row.currentPrice) || row.currentPrice <= 0) return 0;
  return round((row.marketCap / row.currentPrice) * row.fairValue, 2);
}

function valuationSortValue(row: ValuationRow, key: ValuationSortKey) {
  if (key === "action") return valuationActionRank(row);
  if (key === "fairMarketCap") return valuationFairMarketCap(row);
  return row[key];
}

function movingAverage(points: StockKlinePoint[], windowSize: number) {
  return points.map((_, index) => {
    if (index + 1 < windowSize) return null;
    const slice = points.slice(index + 1 - windowSize, index + 1);
    return slice.reduce((sum, point) => sum + point.close, 0) / windowSize;
  });
}

function getFactorName(factors: Factor[], key: string) {
  return factorByKey(factors, key)?.name ?? key;
}

function orderFactors(factors: Factor[]) {
  const initialIndex = new Map(factors.map((factor, index) => [factor.key, index]));
  const groupIndex = new Map(factorGroups.map((group, index) => [group, index]));
  return [...factors].sort((a, b) => {
    const groupDelta = (groupIndex.get(a.group) ?? 999) - (groupIndex.get(b.group) ?? 999);
    if (groupDelta !== 0) return groupDelta;
    return (initialIndex.get(a.key) ?? 9999) - (initialIndex.get(b.key) ?? 9999);
  });
}

function factorOptionLabel(factor: Factor) {
  return factor.name;
}

function normalizeFilterOperator(operator: FilterOperator): FilterOperator {
  if (operator === "gte") return "gt";
  if (operator === "lte") return "lt";
  if (operator === "top") return "rankPctMax";
  if (operator === "bottom") return "rankPctMin";
  if (operator === "neq") return "eq";
  return operator;
}

function isRangeOperator(operator: FilterOperator) {
  return ["between", "rankBetween", "rankPctBetween"].includes(normalizeFilterOperator(operator));
}

function operatorPatch(condition: FilterCondition, operator: FilterOperator): Partial<FilterCondition> {
  const normalized = normalizeFilterOperator(operator);
  if (isRangeOperator(normalized)) {
    return {
      operator: normalized,
      min: condition.min ?? 0,
      max: condition.max ?? 100,
      value: undefined
    };
  }
  return {
    operator: normalized,
    value: condition.value ?? condition.min ?? condition.max ?? 10,
    min: undefined,
    max: undefined
  };
}

function getOperatorLabel(operator: FilterOperator) {
  const normalized = normalizeFilterOperator(operator);
  return operators.find((item) => item.value === normalized)?.label ?? normalized;
}

function detailFactorKey(parentKey: string, index: number) {
  return `detail_${parentKey}_${index}`;
}

function isDetailFactor(factor: Factor) {
  return factor.key.startsWith("detail_");
}

function getFactorDetailNames(factor: Factor) {
  return factorDetailNamesByKey[factor.key] ?? defaultDetailNames;
}

function getDetailFactors(parent: Factor, factors: Factor[]) {
  return getFactorDetailNames(parent)
    .map((_, index) => factorByKey(factors, detailFactorKey(parent.key, index)))
    .filter((factor): factor is Factor => Boolean(factor));
}

function createDetailFactors(baseFactors: Factor[]) {
  return baseFactors.flatMap((parent) => {
    const names = getFactorDetailNames(parent);
    return names.map((name, index) => {
      const multiplier = detailFormulaMultipliers[index % detailFormulaMultipliers.length];
      const formula = multiplier === 1 ? parent.key : `${parent.key} * ${multiplier}`;
      return {
        key: detailFactorKey(parent.key, index),
        name,
        group: parent.group,
        description: `${parent.name} - ${name}`,
        defaultOrder: parent.defaultOrder,
        unit: parent.unit,
        precision: parent.precision,
        formula
      } satisfies Factor;
    });
  });
}

function getResultFactorKeys(strategy: StrategyConfig) {
  const selected = strategy.ranks
    .filter((rank) => rank.enabled)
    .map((rank) => rank.factorKey)
    .filter((key, index, keys) => keys.indexOf(key) === index);
  const merged = [...selected, ...fallbackResultFactorKeys].filter((key, index, keys) => keys.indexOf(key) === index);
  return merged.slice(0, 3);
}

function getRankFactorKeys(strategy: StrategyConfig) {
  return strategy.ranks
    .filter((rank) => rank.enabled && rank.weight > 0)
    .map((rank) => rank.factorKey)
    .filter((key, index, keys) => keys.indexOf(key) === index);
}

function correlation(valuesA: number[], valuesB: number[]) {
  const pairs = valuesA.map((value, index) => [value, valuesB[index]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 2) return 0;
  const meanA = pairs.reduce((sum, [value]) => sum + value, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, value]) => sum + value, 0) / pairs.length;
  const numerator = pairs.reduce((sum, [a, b]) => sum + (a - meanA) * (b - meanB), 0);
  const varianceA = pairs.reduce((sum, [a]) => sum + (a - meanA) ** 2, 0);
  const varianceB = pairs.reduce((sum, [, b]) => sum + (b - meanB) ** 2, 0);
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator ? round(numerator / denominator, 3) : 0;
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="setting-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FactorSelect({ value, factors, onChange }: { value: string; factors: Factor[]; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {factorGroups.map((group) => {
        const items = factors.filter((factor) => factor.group === group);
        if (!items.length) return null;
        return (
          <optgroup key={group} label={group}>
            {items.map((factor) => (
              <option key={factor.key} value={factor.key}>
                {factorOptionLabel(factor)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  min,
  max
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="setting-field compact">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {suffix ? <em>{suffix}</em> : null}
    </label>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="desc-line">{children}</p>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-mask" role="dialog" aria-modal="true">
      <div className={`modal-panel ${wide ? "wide" : ""}`}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function formatKlineAxisDate(date: string) {
  const parts = date.split("-");
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return date;
}

function StockKlineChart({ points }: { points: StockKlinePoint[] }) {
  const width = 780;
  const height = 320;
  const left = 46;
  const right = 18;
  const top = 18;
  const priceHeight = 210;
  const volumeTop = 244;
  const volumeHeight = 48;
  const plotWidth = width - left - right;
  const priceMax = Math.max(...points.map((point) => point.high));
  const priceMin = Math.min(...points.map((point) => point.low));
  const priceRange = Math.max(priceMax - priceMin, 0.01);
  const volumeMax = Math.max(...points.map((point) => point.volume), 1);
  const step = plotWidth / points.length;
  const candleWidth = Math.max(4, step * 0.56);
  const ma5 = movingAverage(points, 5);
  const ma20 = movingAverage(points, 20);
  const yPrice = (value: number) => top + ((priceMax - value) / priceRange) * priceHeight;
  const xPoint = (index: number) => left + index * step + step / 2;
  const firstAverageIndex = (values: Array<number | null>) => values.findIndex((item) => item !== null);
  const maPath = (values: Array<number | null>) => {
    const firstIndex = firstAverageIndex(values);
    return values
      .map((value, index) => (value === null ? "" : `${index === firstIndex ? "M" : "L"} ${xPoint(index).toFixed(2)} ${yPrice(value).toFixed(2)}`))
      .filter(Boolean)
      .join(" ");
  };

  return (
    <>
      <div className="stock-kline-chart-wrap">
        <svg className="stock-kline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="股票真实K线图">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + ratio * priceHeight;
            const price = priceMax - ratio * priceRange;
            return (
              <g key={ratio}>
                <line x1={left} y1={y} x2={width - right} y2={y} className="kline-grid" />
                <text x={8} y={y + 4} className="kline-axis">{price.toFixed(2)}</text>
              </g>
            );
          })}
          <path d={maPath(ma5)} className="kline-ma ma5" />
          <path d={maPath(ma20)} className="kline-ma ma20" />
          {points.map((point, index) => {
            const rising = point.close >= point.open;
            const x = xPoint(index);
            const yOpen = yPrice(point.open);
            const yClose = yPrice(point.close);
            const yHigh = yPrice(point.high);
            const yLow = yPrice(point.low);
            const bodyY = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
            const volumeHeightValue = (point.volume / volumeMax) * volumeHeight;
            return (
              <g key={`${point.date}-${index}`} className={rising ? "kline-up" : "kline-down"}>
                <line x1={x} y1={yHigh} x2={x} y2={yLow} className="kline-wick" />
                <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} rx={1} className="kline-body" />
                <rect x={x - candleWidth / 2} y={volumeTop + volumeHeight - volumeHeightValue} width={candleWidth} height={volumeHeightValue} className="kline-volume" />
              </g>
            );
          })}
          <line x1={left} y1={volumeTop} x2={width - right} y2={volumeTop} className="kline-grid strong" />
          {[0, Math.floor(points.length / 2), points.length - 1].map((index) => (
            <text key={index} x={xPoint(index)} y={height - 8} textAnchor="middle" className="kline-axis">{formatKlineAxisDate(points[index].date)}</text>
          ))}
        </svg>
      </div>
      <div className="stock-kline-legend">
        <span className="ma5">MA5</span>
        <span className="ma20">MA20</span>
        <span>最高 {points[points.length - 1].high.toFixed(2)}</span>
        <span>最低 {points[points.length - 1].low.toFixed(2)}</span>
        <span>成交量 {points[points.length - 1].volume.toFixed(2)} 万手</span>
      </div>
    </>
  );
}

function StockKlinePanel({
  result,
  loading,
  period,
  onPeriodChange
}: {
  result: StockKlineHistoryResult | null;
  loading: boolean;
  period: StockKlinePeriod;
  onPeriodChange: (period: StockKlinePeriod) => void;
}) {
  const points = result?.points ?? [];
  const latest = points[points.length - 1];
  const previous = points[points.length - 2] ?? latest;
  const latestChange = latest && previous?.close ? ((latest.close - previous.close) / previous.close) * 100 : 0;

  return (
    <div className="stock-kline-panel">
      <div className="stock-kline-head">
        <div>
          <h4>K线走势</h4>
          <span>真实历史行情，按股票交易口径切换日K、周K、月K；不使用模拟走势。</span>
        </div>
        <div className="stock-kline-actions">
          <div className="stock-kline-periods" role="tablist" aria-label="K线周期">
            {stockKlinePeriodOptions.map((option) => (
              <button
                key={option.value}
                className={period === option.value ? "active" : ""}
                onClick={() => onPeriodChange(option.value)}
                role="tab"
                aria-selected={period === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          {latest ? (
            <div className="stock-kline-latest">
              <strong>{latest.close.toFixed(2)}</strong>
              <em className={latestChange >= 0 ? "positive" : "negative"}>{pct(latestChange)}</em>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? <div className="stock-kline-state">正在加载真实K线...</div> : null}
      {!loading && result && !result.ok ? <div className="stock-kline-state error">{result.message}</div> : null}
      {!loading && result?.ok && points.length ? <StockKlineChart points={points} /> : null}
      {!loading && result?.ok && !points.length ? <div className="stock-kline-state error">K线获取失败：接口未返回有效历史行情</div> : null}
    </div>
  );
}

function StockInfoDetailGrid({
  title,
  description,
  items,
  columns = 4
}: {
  title: string;
  description?: string;
  items: Array<{ label: string; value: string; note?: string }>;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div className="stock-info-section">
      <div className="stock-info-section-title">
        <div>
          <h4>{title}</h4>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className={`stock-info-detail-grid columns-${columns}`}>
        {items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note ? <em>{item.note}</em> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildAnnualReportStatementItems(report: AnnualFinancialReport) {
  return [
    { label: "营业收入", value: `${round(report.metrics.revenue, 2)} 亿` },
    { label: "归母净利润", value: `${round(report.metrics.netProfit, 2)} 亿` },
    { label: "经营现金流", value: `${round(report.metrics.operatingCashflow, 2)} 亿` },
    { label: "总资产", value: `${round(report.metrics.totalAssets, 2)} 亿` },
    { label: "总负债", value: `${round(report.metrics.totalLiabilities, 2)} 亿` },
    { label: "存货", value: `${round(report.metrics.inventory, 2)} 亿` },
    { label: "应收账款", value: `${round(report.metrics.receivables, 2)} 亿` },
    { label: "每股收益 EPS", value: `${round(report.metrics.eps, 2)} 元` },
    { label: "每股净资产 BPS", value: `${round(report.metrics.bps, 2)} 元` },
    { label: "员工人数", value: `${round(report.metrics.employeeCount, 0)} 人` },
    { label: "报告期", value: report.periodEnd },
    { label: "审计意见", value: report.auditOpinion }
  ];
}

function buildAnnualReportRatioItems(report: AnnualFinancialReport) {
  return [
    { label: "毛利率", value: `${round(report.metrics.grossMargin, 2)}%` },
    { label: "净利率", value: `${round(report.metrics.netMargin, 2)}%` },
    { label: "ROE", value: `${round(report.metrics.roe, 2)}%` },
    { label: "ROA", value: `${round(report.metrics.roa, 2)}%` },
    { label: "营收增长", value: `${round(report.metrics.revenueGrowth, 2)}%` },
    { label: "净利增长", value: `${round(report.metrics.profitGrowth, 2)}%` },
    { label: "资产负债率", value: `${round(report.metrics.debtRatio, 2)}%` },
    { label: "流动比率", value: `${round(report.metrics.currentRatio, 2)}x` },
    { label: "总资产周转率", value: `${round(report.metrics.assetTurnover, 2)}x` },
    { label: "股息率", value: `${round(report.metrics.dividendYield, 2)}%` },
    { label: "现金流/净利润", value: `${round(report.metrics.cashProfitRatio, 2)}%` },
    { label: "应收/收入", value: `${round(report.metrics.receivableRevenueRatio, 2)}%` }
  ];
}

function StockAnnualFinancialReportSection({ stock }: { stock: Stock }) {
  const reports = buildAnnualFinancialReports(stock);
  const [selectedYear, setSelectedYear] = useState<AnnualFinancialReportYear>("2025");

  useEffect(
    function resetAnnualReportYear() {
      setSelectedYear("2025");
    },
    [stock.code]
  );

  if (!reports.length) {
    return (
      <div className="stock-info-section annual-report-section">
        <div className="stock-info-section-title annual-report-title">
          <div>
            <h4>财报摘要</h4>
            <p>本地样本财报已清空，当前仅展示真实财报源返回的数据。</p>
          </div>
        </div>
        <div className="stock-related-info-empty">尚未接入该股票的真实年度财报源文件，暂不展示财报摘要或下载源文件。</div>
      </div>
    );
  }

  const selectedReport = reports.find((report) => report.year === selectedYear) ?? reports[0];
  const statementItems = buildAnnualReportStatementItems(selectedReport);
  const ratioItems = buildAnnualReportRatioItems(selectedReport);

  return (
    <div className="stock-info-section annual-report-section">
      <div className="stock-info-section-title annual-report-title">
        <div>
          <h4>财报摘要</h4>
          <p>
            {selectedReport.year} 年度报告，报告期 {selectedReport.periodEnd}，披露日期 {selectedReport.disclosureDate}。
          </p>
        </div>
        <div className="annual-report-actions">
          <div className="annual-report-years" role="tablist" aria-label="财报年度">
            {reports.map((report) => (
              <button
                key={report.year}
                className={report.year === selectedReport.year ? "active" : ""}
                onClick={() => setSelectedYear(report.year)}
                role="tab"
                aria-selected={report.year === selectedReport.year}
                type="button"
              >
                {report.year}
              </button>
            ))}
          </div>
          <a className="btn annual-report-source-download" href={buildFinancialReportSourceDataUrl(selectedReport)} download={selectedReport.sourceFileName}>
            <Download size={14} />
            源文件
          </a>
        </div>
      </div>

      <div className="annual-report-source-panel">
        <div>
          <span>源文件</span>
          <strong>{selectedReport.sourceFileName}</strong>
          <em>{selectedReport.sourceNote}</em>
        </div>
        <div>
          <span>来源</span>
          <strong>{selectedReport.sourceProvider}</strong>
          <em>{selectedReport.sourceFileType} / {selectedReport.currencyUnit}</em>
        </div>
      </div>

      <div className="annual-report-subtitle">
        <strong>主要报表项目</strong>
        <span>利润表、资产负债表、现金流量表核心字段</span>
      </div>
      <div className="stock-info-detail-grid columns-4">
        {statementItems.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="annual-report-subtitle">
        <strong>关键财务比率</strong>
        <span>按当前年度报告字段计算，随年度切换同步变化</span>
      </div>
      <div className="stock-info-detail-grid columns-4">
        {ratioItems.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function isDisclosureArticle(article: NewsArticle) {
  return article.category === "公司公告" || article.category === "财报业绩";
}

function sortNewsByPublishTime(articles: NewsArticle[]) {
  return [...articles].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

function StockRelatedArticleCard({ article, fallback }: { article: NewsArticle; fallback?: boolean }) {
  return (
    <article className={`stock-related-info-card ${fallback ? "fallback" : ""}`}>
      <div className="stock-related-info-head">
        <div className="stock-related-info-source">
          <span className="news-source-icon">{article.sourceIcon}</span>
          <span>{article.source}</span>
          <span>{formatNewsDate(article.publishedAt)}</span>
        </div>
        <div className="news-article-badges">
          <span className={`news-badge sentiment-${article.sentiment === "利好" ? "positive" : article.sentiment === "利空" ? "negative" : "neutral"}`}>
            {article.sentiment}
          </span>
          <span className="news-badge category">{article.category}</span>
          {article.importance !== "一般" ? <span className="news-badge importance">{article.importance}</span> : null}
        </div>
      </div>
      <h5>{article.title}</h5>
      <p>{article.summary}</p>
      <div className="stock-related-info-footer">
        {fallback ? <span className="news-tag">行业关联</span> : <span className="news-tag">直接关联</span>}
        {article.tags.slice(0, 3).map((tag) => (
          <span className="news-tag" key={tag}>{tag}</span>
        ))}
      </div>
    </article>
  );
}

function StockRelatedInfoSection({ stock }: { stock: Stock }) {
  const directArticles: NewsArticle[] = [];
  const useFallback = false;
  const displayArticles = directArticles.slice(0, 6);
  const disclosureArticles = displayArticles.filter(isDisclosureArticle);
  const newsArticles = displayArticles.filter((article) => !isDisclosureArticle(article));

  return (
    <div className="stock-info-section stock-related-info-section">
      <div className="stock-info-section-title">
        <div>
          <h4>相关信息</h4>
          <p>
            展示与 {stock.name} 直接关联的新闻、财报业绩和产业链线索；暂无直接信息时展示同一行业线索并明确标注。
          </p>
        </div>
        <span className="stock-related-info-count">
          {`直接关联 ${directArticles.length} 条`}
        </span>
      </div>
      <div className="stock-related-info-notice">本地样本资讯已清空。请通过新闻页面手动刷新真实新闻源，命中该股票后再展示相关新闻、财报或产业链信息。</div>
      <div className="stock-related-info-layout">
        <div className="stock-related-info-column">
          <div className="stock-related-info-column-title">
            <strong>财报/资讯</strong>
            <span>{disclosureArticles.length} 条</span>
          </div>
          {disclosureArticles.length ? (
            disclosureArticles.map((article) => <StockRelatedArticleCard article={article} fallback={useFallback} key={article.id} />)
          ) : (
            <div className="stock-related-info-empty">暂无直接关联的公司公告或财报业绩信息。</div>
          )}
        </div>
        <div className="stock-related-info-column">
          <div className="stock-related-info-column-title">
            <strong>相关新闻</strong>
            <span>{newsArticles.length} 条</span>
          </div>
          {newsArticles.length ? (
            newsArticles.map((article) => <StockRelatedArticleCard article={article} fallback={useFallback} key={article.id} />)
          ) : (
            <div className="stock-related-info-empty">暂无直接关联的新闻、政策或产业链信息。</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StockInfoModal({ target, onClose }: { target: StockInfoTarget; onClose: () => void }) {
  const sourceStock = target.stock;
  const [liveStock, setLiveStock] = useState<Stock | null>(() => sourceStock ?? null);
  const [klinePeriod, setKlinePeriod] = useState<StockKlinePeriod>("day");
  const [klineResult, setKlineResult] = useState<StockKlineHistoryResult | null>(null);
  const [klineLoading, setKlineLoading] = useState(false);
  const [stockInfoSyncStatus, setStockInfoSyncStatus] = useState("腾讯股票信息接口已就绪");
  const [stockInfoSyncing, setStockInfoSyncing] = useState(false);
  const stock = liveStock;
  const stockCode = stock?.code ?? "";

  useEffect(
    function resetLiveStockOnTargetChange() {
      setLiveStock(sourceStock ?? null);
      setStockInfoSyncStatus(sourceStock ? "腾讯股票信息接口已就绪" : "当前股票池未收录，无法请求股票信息");
    },
    [sourceStock?.code]
  );

  useEffect(
    function loadStockKlineHistory() {
      if (!stock) {
        setKlineResult(null);
        return;
      }

      let active = true;
      setKlineLoading(true);
      setKlineResult(null);

      fetchStockKlineHistory(stock, klinePeriod)
        .then((result) => {
          if (active) setKlineResult(result);
        })
        .catch((error) => {
          if (!active) return;
          setKlineResult({
            ok: false,
            checkedAt: new Date().toISOString(),
            message: `K线获取失败：${error instanceof Error ? error.message : "未知网络错误"}`,
            points: [],
            sourceRows: 0
          });
        })
        .finally(() => {
          if (active) setKlineLoading(false);
        });

      return function cancelStockKlineHistory() {
        active = false;
      };
    },
    [stockCode, klinePeriod]
  );

  const refreshStockInfo = async () => {
    if (!stock) return;
    setStockInfoSyncing(true);
    setStockInfoSyncStatus("正在从腾讯刷新股票行情、估值和成交信息...");
    const result = await syncTencentRealMarketData([stock]);
    if (result.ok && result.stocks[0]) {
      setLiveStock(result.stocks[0]);
      setStockInfoSyncStatus(`${result.message}：${result.details}`);
    } else {
      setStockInfoSyncStatus(`${result.message}：${result.details}`);
    }
    setStockInfoSyncing(false);
  };

  if (!stock) {
    const strictCodeMiss = isCodeLikeStockQuery(target.code);
    return (
      <Modal title={`${target.name} ${displayStockCode(target)}`} onClose={onClose}>
        <div className="stock-info-empty">
          <strong>当前股票池暂无该股票基础信息</strong>
          <p>
            {strictCodeMiss
              ? "已按完整股票代码精确查询，当前股票池未收录该证券。可能是已退市/历史代码，系统不会回退到相似代码，避免错配到其他股票。"
              : "该股票来自新闻关联结果，但未包含在当前真实股票池中。接入完整行情和财务数据后可展示详细信息。"}
          </p>
        </div>
      </Modal>
    );
  }

  const metrics = [
    ["现价", formatStockMetric(stock, "price", " 元")],
    ["涨跌幅", formatStockMetric(stock, "pctChange", "%")],
    ["总市值", formatStockMetric(stock, "marketCap", " 亿")],
    ["流通市值", formatStockMetric(stock, "floatMarketCap", " 亿")],
    ["PE", formatStockMetric(stock, "pe", "x")],
    ["PB", formatStockMetric(stock, "pb", "x")],
    ["ROE", formatStockMetric(stock, "roe", "%")],
    ["股息率", formatStockMetric(stock, "dividendYield", "%")],
    ["质量分", formatStockMetric(stock, "qualityScore", "", 1)],
    ["60日动量", formatStockMetric(stock, "momentum60", "%")],
    ["营收增长", formatStockMetric(stock, "revenueGrowth", "%")],
    ["净利增长", formatStockMetric(stock, "profitGrowth", "%")],
    ["负债率", formatStockMetric(stock, "debtRatio", "%")],
    ["流动比率", formatStockMetric(stock, "currentRatio", "x")]
  ];
  const companyAttributeItems = [
    { label: "交易所/板块", value: `${stock.exchange} / ${stock.board}` },
    { label: "行业层级", value: `${stock.industry1} / ${stock.industry2}` },
    { label: "地区/属性", value: `${stock.region} / ${stock.property}` },
    { label: "指数成分", value: stock.indexes.length ? stock.indexes.join(" / ") : "暂无指数成分" },
    { label: "融资融券", value: stock.isMargin ? "融资融券标的" : "非融资融券标的" },
    { label: "特殊状态", value: [stock.isST ? "ST" : "", stock.isSuspended ? "停牌" : "", stock.isSTAR ? "科创属性" : ""].filter(Boolean).join(" / ") || "常规交易" },
    { label: "上市天数", value: formatStockMetric(stock, "listingDays", " 天", 0) },
    { label: "年内交易天数", value: formatStockMetric(stock, "tradingDays", " 天", 0) }
  ];
  const governanceItems = [
    { label: "股权质押比例", value: formatStockMetric(stock, "pledgeRatio", "%") },
    { label: "重大违规风险", value: formatStockMetric(stock, "violationScore", " 分") },
    { label: "股东高管持股", value: formatStockMetric(stock, "insiderHolding", "%") },
    { label: "基金重仓持股", value: formatStockMetric(stock, "fundHolding", "%") },
    { label: "指数权重", value: formatStockMetric(stock, "indexWeight", "%") },
    { label: "评级综合分", value: formatStockMetric(stock, "ratingScore", " / 5", 2) },
    { label: "目标价空间", value: formatStockMetric(stock, "targetUpside", "%") },
    { label: "质量分", value: formatStockMetric(stock, "qualityScore", " 分", 1) }
  ];
  const reportSignals = stockReportSignals(stock);

  return (
    <Modal title="股票信息" onClose={onClose} wide>
      <div className="stock-info-card">
        <div className="stock-info-head">
          <div>
            <h3>{stock.name}</h3>
            <span>{displayStockCode(stock)} / {stock.exchange} / {stock.board}</span>
          </div>
          <div className="stock-info-head-right">
            <div className="stock-info-badges">
              <span>{stock.industry1}</span>
              <span>{stock.industry2}</span>
              <span>{stock.property}</span>
              <span>{stock.region}</span>
              {stock.isST ? <span className="danger">ST</span> : null}
              {stock.isSuspended ? <span className="danger">停牌</span> : null}
            </div>
            <div className="stock-info-live-source">
              <button className="btn" type="button" onClick={refreshStockInfo} disabled={stockInfoSyncing}>
                <RefreshCcw size={14} />
                {stockInfoSyncing ? "刷新中" : "刷新股票信息"}
              </button>
              <span>{stockInfoSyncStatus}</span>
            </div>
          </div>
        </div>

        <div className="stock-info-metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <StockKlinePanel result={klineResult} loading={klineLoading} period={klinePeriod} onPeriodChange={setKlinePeriod} />

        <StockAnnualFinancialReportSection stock={stock} />
        <StockRelatedInfoSection stock={stock} />
        <StockInfoDetailGrid title="公司与交易属性" description="公司属性、交易属性、指数成分与上市交易状态。" items={companyAttributeItems} columns={2} />
        <StockInfoDetailGrid title="治理与机构信息" description="股权质押、违规风险、机构持仓与分析师相关字段。" items={governanceItems} />

        <div className="stock-info-section">
          <div className="stock-info-section-title">
            <div>
              <h4>财报与治理提示</h4>
              <p>基于当前已接入字段生成，只做风险定位，不替代公告核验。</p>
            </div>
          </div>
          <ul className="stock-info-signal-list">
            {reportSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>

      </div>
    </Modal>
  );
}

function StrategyManagerSidebar({
  strategy,
  savedStrategies,
  topSection,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onNew,
  onSave,
  onOptimize,
  onDelete,
  onExport,
  onSectionChange
}: {
  strategy: StrategyConfig;
  savedStrategies: StrategyConfig[];
  topSection: MainSection;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (strategy: StrategyConfig) => void;
  onNew: () => void;
  onSave: () => void;
  onOptimize: () => void;
  onDelete: () => void;
  onExport: () => void;
  onSectionChange: (section: MainSection) => void;
}) {
  const strategies = [strategy, ...savedStrategies.filter((item) => item.id !== strategy.id)];
  const currentSaved = savedStrategies.some((item) => item.id === strategy.id);
  return (
    <aside className={`strategy-manager ${collapsed ? "collapsed" : ""}`}>
      <div className="manager-title">
        <FileText size={17} />
        {!collapsed ? <strong>策略管理</strong> : null}
        <button className="manager-collapse" onClick={onToggleCollapsed} title={collapsed ? "展开策略管理" : "收起策略管理"}>
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {collapsed ? (
        <div className="manager-collapsed-stack">
          <button className={topSection === "strategy" ? "active" : ""} onClick={() => onSectionChange("strategy")} title="策略编辑">
            策
          </button>
          <button className={topSection === "trade" ? "active" : ""} onClick={() => onSectionChange("trade")} title="实盘交易">
            交
          </button>
          <button onClick={onNew} title="新建策略">
            +
          </button>
          <button onClick={onSave} title="保存策略">
            存
          </button>
        </div>
      ) : (
        <>
          <div className="manager-current">
            <span>当前策略</span>
            <strong>{strategy.name}</strong>
            <em>{currentSaved ? "已保存" : "草稿"}</em>
          </div>

          <div className="manager-switch">
            <button className={topSection === "strategy" ? "active" : ""} onClick={() => onSectionChange("strategy")}>
              策略编辑
            </button>
            <button className={topSection === "trade" ? "active" : ""} onClick={() => onSectionChange("trade")}>
              实盘交易
            </button>
          </div>

          <div className="manager-actions">
            <button onClick={onNew}>
              <Plus size={14} />
              新建
            </button>
            <button onClick={onSave}>
              <Save size={14} />
              保存
            </button>
            <button onClick={onExport}>
              <Download size={14} />
              导出
            </button>
            <button onClick={onOptimize}>
              <Activity size={14} />
              调优
            </button>
          </div>

          <div className="manager-stats">
            <div>
              <span>筛选</span>
              <strong>{strategy.filters.length}</strong>
            </div>
            <div>
              <span>排名</span>
              <strong>{strategy.ranks.length}</strong>
            </div>
            <div>
              <span>持仓</span>
              <strong>{strategy.trading.maxHoldings}</strong>
            </div>
          </div>

          <div className="manager-list-title">
            <span>我的策略</span>
            <button onClick={onDelete} disabled={!currentSaved} title="删除当前策略">
              <Trash2 size={14} />
            </button>
          </div>

          <div className="manager-list">
            {strategies.map((item) => (
              <button className={item.id === strategy.id ? "active" : ""} key={item.id} onClick={() => onSelect(item)}>
                <strong>{item.name}</strong>
                <span>
                  {item.filters.length}筛选 / {item.ranks.length}排名
                </span>
                <span className="strategy-updated">{formatStrategyUpdatedAt(item.updatedAt)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function App() {
  purgeLegacyLocalFakeData();
  const [strategy, setStrategy] = useState<StrategyConfig>(() => ensureStrategyUpdatedAt(loadLocal("draftStrategy", createDefaultStrategy())));
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig>(() => loadLocal("backtestConfig", createDefaultBacktestConfig()));
  const [savedStrategies, setSavedStrategies] = useState<StrategyConfig[]>(() => loadLocal<StrategyConfig[]>("savedStrategies", []).map(ensureStrategyUpdatedAt));
  const [customPools, setCustomPools] = useState<StockPool[]>(() => loadLocal("customPools", []));
  const [customFactors, setCustomFactors] = useState<Factor[]>(() => loadLocal("customFactors", []));
  const [activeStep, setActiveStep] = useState<StepKey>("screen");
  const [topSection, setTopSection] = useState<MainSection>("strategy");
  const [managerCollapsed, setManagerCollapsed] = useState(false);
  const [activeFactorGroup, setActiveFactorGroup] = useState<FactorGroup>("行情");
  const [conditionTab, setConditionTab] = useState<"filter" | "rank">("filter");
  const [backtestTab, setBacktestTab] = useState<BacktestTab>("backtest");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalKey>(null);
  const [infoSourceSettings, setInfoSourceSettings] = useState<InfoSourceSettings>(() =>
    ensureInfoSourceSettings(loadLocal("infoSourceSettings", defaultInfoSourceSettings))
  );
  const [infoSourceStatus, setInfoSourceStatus] = useState("未测试");
  const [newsSourceSettings, setNewsSourceSettings] = useState<NewsSourceSettings>(() =>
    ensureNewsSourceSettings(loadLocal("newsSourceSettings", defaultNewsSourceSettings))
  );
  const [newsSourceStatus, setNewsSourceStatus] = useState("新闻源未测试");
  const [newsAnalysisModelSettings, setNewsAnalysisModelSettings] = useState<NewsAnalysisModelSettings>(() =>
    ensureNewsAnalysisModelSettings(loadLocal("newsAnalysisModelSettings", defaultNewsAnalysisModelSettings))
  );
  const [newsAnalysisModelStatus, setNewsAnalysisModelStatus] = useState("新闻分析模型未测试");
  const [stocks, setStocks] = useState<Stock[]>(() => ensureStockData(loadLocal("openSourceStocks", [])));
  const [openSourceSummary, setOpenSourceSummary] = useState<OpenSourceDataSummary>(() => ({
    ...defaultOpenSourceDataSummary,
    stockCount: 0,
    ...loadLocal("openSourceDataSummary", {})
  }));
  const [valuationDataSource, setValuationDataSource] = useState<ValuationDataSource>(() => loadLocal<ValuationDataSource>("valuationDataSource", "none"));
  const [valuationRealDataStatus, setValuationRealDataStatus] = useState("价值核算未接入真实数据，当前不进行本地样本核算");
  const [tradeConnection, setTradeConnection] = useState<TradeConnectionSettings>(() =>
    ensureTradeConnectionSettings(loadLocal("tradeConnectionSettings", defaultTradeConnectionSettings))
  );
  const [tradeConnectionStatus, setTradeConnectionStatus] = useState(() =>
    ensureTradeConnectionSettings(loadLocal("tradeConnectionSettings", defaultTradeConnectionSettings)).bound ? "交易接口已绑定" : "未绑定交易接口"
  );
  const [paperTradeState, setPaperTradeState] = useState<PaperTradeState>(() =>
    ensurePaperTradeState(loadLocal("paperTradeState", defaultPaperTradeState))
  );
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [rankRows, setRankRows] = useState<RankingRow[]>([]);
  const [selectionRows, setSelectionRows] = useState<SelectionRow[]>([]);
  const [stockInfoTarget, setStockInfoTarget] = useState<StockInfoTarget | null>(null);
  const [poolDraft, setPoolDraft] = useState({ name: "我的股票池", codes: "600519,300750,002594,600036,600900" });
  const [customFactorDraft, setCustomFactorDraft] = useState({ name: "质量成长合成", formula: "qualityScore * 0.6 + revenueGrowth * 0.4 - pe * 0.2" });

  useEffect(() => {
    saveLocal("draftStrategy", strategy);
    saveLocal("savedStrategies", savedStrategies);
    saveLocal("infoSourceSettings", infoSourceSettings);
    saveLocal("newsSourceSettings", newsSourceSettings);
    saveLocal("newsAnalysisModelSettings", newsAnalysisModelSettings);
    saveLocal("openSourceStocks", stocks);
    saveLocal("openSourceDataSummary", openSourceSummary);
    saveLocal("tradeConnectionSettings", tradeConnection);
    saveLocal("paperTradeState", paperTradeState);
  }, []);

  const pools = useMemo(() => [...createRuntimeSystemPools(stocks), ...customPools], [stocks, customPools]);
  const factors = useMemo(() => {
    const baseFactors = orderFactors([...FACTORS, ...customFactors]);
    return orderFactors([...baseFactors, ...createDetailFactors(baseFactors)]);
  }, [customFactors]);
  const availableIndustry2 = useMemo(() => {
    const list = stocks.filter((stock) => strategy.industry1 === "全部" || stock.industry1 === strategy.industry1).map((stock) => stock.industry2);
    return ["全部", ...Array.from(new Set(list))];
  }, [stocks, strategy.industry1]);
  const visibleFactors = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const groupKeys = guornFactorKeysByGroup[activeFactorGroup];
    const groupFactors = groupKeys
      ? groupKeys.map((key) => factorByKey(factors, key)).filter((factor): factor is Factor => Boolean(factor))
      : factors.filter((factor) => factor.group === activeFactorGroup && !isDetailFactor(factor));
    return groupFactors.filter((factor) => {
      const queryMatch = !normalized || `${factor.name}${factor.key}${factor.description}`.toLowerCase().includes(normalized);
      return queryMatch;
    });
  }, [activeFactorGroup, factors, query]);
  const previewRows = useMemo(() => screenStocks(strategy, stocks, pools, factors), [strategy, stocks, pools, factors]);
  const openStockInfo = (stock: StockReference) => setStockInfoTarget(resolveStockInfoTarget(stock, stocks));

  const persistStrategy = (next: StrategyConfig, markUpdated = true) => {
    const nextStrategy = markUpdated ? touchStrategyUpdatedAt(next) : next;
    setStrategy(nextStrategy);
    saveLocal("draftStrategy", nextStrategy);
  };

  const patchStrategy = (patch: Partial<StrategyConfig>) => {
    persistStrategy({ ...strategy, ...patch });
  };

  const patchTrading = (patch: Partial<StrategyConfig["trading"]>) => {
    persistStrategy({ ...strategy, trading: { ...strategy.trading, ...patch } });
  };

  const patchTiming = (patch: Partial<StrategyConfig["timing"]>) => {
    persistStrategy({ ...strategy, timing: { ...strategy.timing, ...patch } });
  };

  const patchHedge = (patch: Partial<StrategyConfig["hedge"]>) => {
    persistStrategy({ ...strategy, hedge: { ...strategy.hedge, ...patch } });
  };

  const addFilter = (factorKey: string) => {
    patchStrategy({
      filters: [
        ...strategy.filters,
        {
          id: uid("filter"),
          factorKey,
          operator: "gt",
          value: 10,
          range: "全部",
          enabled: true
        }
      ]
    });
  };

  const addRank = (factorKey: string) => {
    const factor = factorByKey(factors, factorKey);
    patchStrategy({
      ranks: [
        ...strategy.ranks,
        {
          id: uid("rank"),
          factorKey,
          order: factor?.defaultOrder ?? "desc",
          range: "全部",
          weight: 20,
          enabled: true
        }
      ]
    });
  };

  const onPickFactor = (factorKey: string) => {
    if (conditionTab === "filter") {
      addFilter(factorKey);
    } else {
      addRank(factorKey);
    }
  };

  const updateFilter = (id: string, patch: Partial<FilterCondition>) => {
    patchStrategy({ filters: strategy.filters.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const updateRank = (id: string, patch: Partial<RankCondition>) => {
    patchStrategy({ ranks: strategy.ranks.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const runCurrentTask = (tab = backtestTab) => {
    saveLocal("backtestConfig", backtestConfig);
    if (tab === "rank" || tab === "factorCorrelation") {
      setRankRows(rankingAnalysis(strategy, stocks, pools, factors));
      setBacktestTab(tab);
      return;
    }
    if (tab === "daily" || tab === "realtime") {
      setSelectionRows(screenStocks(strategy, stocks, pools, factors));
      setBacktestTab(tab);
      return;
    }
    const next = runBacktest(strategy, stocks, pools, factors, backtestConfig);
    setResult(next);
    setSelectionRows(next.rows);
    setBacktestTab("backtest");
  };

  const saveStrategy = (saveAs = false) => {
    const baseName = (strategy.name || "股票策略").trim();
    const name = saveAs ? `${baseName} 副本` : baseName;
    const next = touchStrategyUpdatedAt({ ...strategy, id: saveAs ? uid("strategy") : strategy.id, name });
    const existingIndex = savedStrategies.findIndex((item) => item.id === next.id);
    const list = existingIndex >= 0 ? savedStrategies.map((item, index) => (index === existingIndex ? next : item)) : [...savedStrategies, next];
    setSavedStrategies(list);
    saveLocal("savedStrategies", list);
    persistStrategy(next, false);
  };

  const newStrategy = () => {
    const next = createDefaultStrategy();
    setResult(null);
    setRankRows([]);
    setSelectionRows([]);
    persistStrategy(next, false);
  };

  const selectStrategy = (next: StrategyConfig) => {
    setResult(null);
    setRankRows([]);
    setSelectionRows([]);
    persistStrategy(next, false);
  };

  const deleteStrategy = () => {
    const list = savedStrategies.filter((item) => item.id !== strategy.id);
    setSavedStrategies(list);
    saveLocal("savedStrategies", list);
    newStrategy();
  };

  const exportStrategy = () => {
    const blob = new Blob([JSON.stringify({ strategy, backtestConfig, customPools, customFactors }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${strategy.name || "strategy"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const createPool = () => {
    const codes = poolDraft.codes
      .split(/[\s,，;；]+/)
      .map((code) => stockCodeForStorage(code, stocks))
      .filter(Boolean);
    const next = createStaticPool(poolDraft.name || "我的股票池", codes);
    const list = [...customPools, next];
    setCustomPools(list);
    saveLocal("customPools", list);
    patchStrategy({ poolId: next.id });
    setModal(null);
  };

  const createFactor = () => {
    if (!customFactorDraft.name.trim() || !customFactorDraft.formula.trim()) return;
    const next = createCustomFactor(customFactorDraft.name.trim(), customFactorDraft.formula.trim());
    const list = [...customFactors, next];
    setCustomFactors(list);
    saveLocal("customFactors", list);
    setActiveFactorGroup("财务指标");
    setModal(null);
  };

  const addAsset = (asset: (typeof SAMPLE_ASSETS)[number]) => {
    const item: AssetItem = {
      id: uid("asset"),
      name: asset.name,
      type: asset.type,
      weight: Math.max(10, Math.round(100 / (strategy.assets.length + 1))),
      startDate: backtestConfig.startDate
    };
    persistStrategy({ ...strategy, assets: [...strategy.assets, item] });
  };

  const optimize = () => {
    const best = optimizeStrategy(strategy, stocks, pools, factors, backtestConfig);
    persistStrategy(best.candidate);
    setResult(best.result);
    setModal(null);
  };

  const patchInfoSourceSettings = (patch: Partial<InfoSourceSettings>) => {
    setInfoSourceSettings((current) => ensureInfoSourceSettings({ ...current, ...patch }));
  };

  const toggleSourceModule = (key: SourceModuleKey) => {
    setInfoSourceSettings((current) =>
      ensureInfoSourceSettings({
        ...current,
        modules: {
          ...current.modules,
          [key]: !current.modules[key]
        }
      })
    );
  };

  const saveInfoSourceSettings = () => {
    const next = ensureInfoSourceSettings({ ...infoSourceSettings, lastSavedAt: new Date().toISOString() });
    setInfoSourceSettings(next);
    saveLocal("infoSourceSettings", next);
    setInfoSourceStatus("已保存信息来源接口配置");
  };

  const runInfoSourceConnectionTest = async () => {
    setInfoSourceStatus("正在检测信息来源接口...");
    const next = ensureInfoSourceSettings({ ...infoSourceSettings, lastTestAt: new Date().toISOString() });
    const result = await testInfoSourceConnection(next);
    const tested = ensureInfoSourceSettings({ ...next, lastTestAt: result.checkedAt });
    setInfoSourceSettings(tested);
    saveLocal("infoSourceSettings", tested);
    setInfoSourceStatus(`${result.message}：${result.details}`);
  };

  const syncOpenSourceData = async () => {
    setInfoSourceStatus("正在同步免费开源数据...");
    const result = await syncOpenSourceMarketData(infoSourceSettings, stocks);
    if (result.ok) {
      setStocks(result.stocks);
      setOpenSourceSummary(result.summary);
      saveLocal("openSourceStocks", result.stocks);
      saveLocal("openSourceDataSummary", result.summary);
      setResult(null);
      setRankRows([]);
      setSelectionRows([]);
    }
    setInfoSourceStatus(`${result.message}：${result.details}`);
  };

  const syncValuationRealData = async () => {
    setValuationRealDataStatus("正在从腾讯行情扫描全市场 A 股代码并接入真实行情...");
    const result = await syncTencentAllAshareMarketData([]);
    if (result.ok) {
      setStocks(result.stocks);
      saveLocal("openSourceStocks", result.stocks);
      setValuationDataSource("tencentQuote");
      saveLocal<ValuationDataSource>("valuationDataSource", "tencentQuote");
      setResult(null);
      setRankRows([]);
      setSelectionRows([]);
    }
    setValuationRealDataStatus(`${result.message}：${result.details}`);
  };

  const patchNewsSource = (id: string, patch: Partial<NewsSourceEndpoint>) => {
    setNewsSourceSettings((current) =>
      ensureNewsSourceSettings({
        ...current,
        sources: current.sources.map((source) => (source.id === id ? { ...source, ...patch } : source))
      })
    );
  };

  const toggleNewsSource = (id: string) => {
    setNewsSourceSettings((current) =>
      ensureNewsSourceSettings({
        ...current,
        sources: current.sources.map((source) => (source.id === id ? { ...source, enabled: !source.enabled } : source))
      })
    );
  };

  const addNewsSource = () => {
    const next = ensureNewsSourceSettings({
      ...newsSourceSettings,
      sources: [...newsSourceSettings.sources, createDefaultNewsSourceEndpoint(uid("news"))]
    });
    setNewsSourceSettings(next);
    setNewsSourceStatus("已新增新闻源接口，请完善配置后保存");
  };

  const removeNewsSource = (id: string) => {
    if (newsSourceSettings.sources.length <= 1) {
      setNewsSourceStatus("至少保留一个新闻源接口");
      return;
    }
    const next = ensureNewsSourceSettings({
      ...newsSourceSettings,
      sources: newsSourceSettings.sources.filter((source) => source.id !== id)
    });
    setNewsSourceSettings(next);
    setNewsSourceStatus("已删除新闻源接口，请保存配置");
  };

  const saveNewsSourceSettings = () => {
    const next = ensureNewsSourceSettings({ ...newsSourceSettings, lastSavedAt: new Date().toISOString() });
    setNewsSourceSettings(next);
    saveLocal("newsSourceSettings", next);
    setNewsSourceStatus("已保存新闻源接口配置");
  };

  const runNewsSourceConnectionTest = async (id: string) => {
    const source = newsSourceSettings.sources.find((item) => item.id === id);
    if (!source) {
      setNewsSourceStatus("未找到新闻源接口");
      return;
    }
    setNewsSourceStatus(`正在检测新闻源：${source.name}...`);
    const result = await testNewsSourceConnection(source);
    setNewsSourceSettings((current) => {
      const next = ensureNewsSourceSettings({
        ...current,
        sources: current.sources.map((item) =>
          item.id === id ? { ...item, lastTestAt: result.checkedAt, lastStatus: `${result.message}：${result.details}` } : item
        )
      });
      saveLocal("newsSourceSettings", next);
      return next;
    });
    setNewsSourceStatus(`${result.message}：${result.details}`);
  };

  const patchNewsAnalysisModelSettings = (patch: Partial<NewsAnalysisModelSettings>) => {
    setNewsAnalysisModelSettings((current) => ensureNewsAnalysisModelSettings({ ...current, ...patch }));
  };

  const toggleNewsAnalysisTask = (key: NewsAnalysisTaskKey) => {
    setNewsAnalysisModelSettings((current) =>
      ensureNewsAnalysisModelSettings({
        ...current,
        tasks: {
          ...current.tasks,
          [key]: !current.tasks[key]
        }
      })
    );
  };

  const saveNewsAnalysisModelSettings = () => {
    const next = ensureNewsAnalysisModelSettings({ ...newsAnalysisModelSettings, lastSavedAt: new Date().toISOString() });
    setNewsAnalysisModelSettings(next);
    saveLocal("newsAnalysisModelSettings", next);
    setNewsAnalysisModelStatus("已保存新闻信息分析模型接口配置");
  };

  const runNewsAnalysisModelConnectionTest = async () => {
    setNewsAnalysisModelStatus("正在检测新闻信息分析模型接口...");
    const next = ensureNewsAnalysisModelSettings({ ...newsAnalysisModelSettings, lastTestAt: new Date().toISOString() });
    const result = await testNewsAnalysisModelConnection(next);
    const tested = ensureNewsAnalysisModelSettings({ ...next, lastTestAt: result.checkedAt });
    setNewsAnalysisModelSettings(tested);
    saveLocal("newsAnalysisModelSettings", tested);
    setNewsAnalysisModelStatus(`${result.message}：${result.details}`);
  };

  const patchTradeConnection = (patch: Partial<TradeConnectionSettings>) => {
    setTradeConnection((current) => ensureTradeConnectionSettings({ ...current, ...patch, bound: false }));
    setTradeConnectionStatus("交易接口配置已修改，请重新绑定");
  };

  const bindTradingInterface = () => {
    const result = bindTradeConnection(tradeConnection);
    if (!result.ok) {
      setTradeConnectionStatus(`交易接口绑定失败：${result.message}`);
      return false;
    }
    setTradeConnection(result.settings);
    saveLocal("tradeConnectionSettings", result.settings);
    setTradeConnectionStatus(result.message);
    return true;
  };

  const exportTradePlan = (rows: SelectionRow[], mode: ExecutionMode, label = "交易指令") => {
    const plan = createTradePlan({
      strategy,
      rows,
      mode,
      accountId: tradeConnection.accountId
    });
    const nextState = ensurePaperTradeState({
      ...paperTradeState,
      plans: [plan, ...paperTradeState.plans.filter((item) => item.id !== plan.id)].slice(0, 30)
    });
    setPaperTradeState(nextState);
    saveLocal("paperTradeState", nextState);
    downloadTextFile(`${safeFileName(strategy.name)}-${label}.csv`, `\ufeff${tradePlanToCsv(plan)}`, "text/csv;charset=utf-8");
    setTradeConnectionStatus(`已生成 ${plan.orders.length} 条${label}`);
    return plan;
  };

  const submitPaperTradePlan = (rows: SelectionRow[]) => {
    if (!tradeConnection.bound) {
      setTradeConnectionStatus("自动交易前必须先绑定交易接口");
      return null;
    }
    const plan = createTradePlan({
      strategy,
      rows,
      mode: "auto",
      accountId: tradeConnection.accountId
    });
    const nextState = submitPaperTradePlanToState(paperTradeState, plan);
    setPaperTradeState(nextState);
    saveLocal("paperTradeState", nextState);
    setTradeConnectionStatus(`纸面交易已成交 ${plan.orders.length} 笔`);
    return plan;
  };

  return (
    <>
      <div className="app-shell">
        <header className="primary-nav">
          <button className={topSection === "strategy" ? "active" : ""} onClick={() => setTopSection("strategy")}>
            <SlidersHorizontal size={16} />
            策略
          </button>
          <button className={topSection === "trade" ? "active" : ""} onClick={() => setTopSection("trade")}>
            <LineChart size={16} />
            交易
          </button>
          <button className={topSection === "sentiment" ? "active" : ""} onClick={() => setTopSection("sentiment")}>
            <Activity size={16} />
            舆情
          </button>
          <button className={topSection === "valuation" ? "active" : ""} onClick={() => setTopSection("valuation")}>
            <BarChart3 size={16} />
            价值核算
          </button>
          <button className={`nav-settings-entry ${topSection === "settings" ? "active" : ""}`} onClick={() => setTopSection("settings")}>
            <Settings size={16} />
            设置
          </button>
        </header>

        <div className={`workspace-layout ${managerCollapsed ? "manager-collapsed" : ""} ${topSection === "settings" || topSection === "sentiment" || topSection === "valuation" ? "settings-mode" : ""}`}>
          {topSection === "strategy" || topSection === "trade" ? (
            <StrategyManagerSidebar
              strategy={strategy}
              savedStrategies={savedStrategies}
              topSection={topSection}
              collapsed={managerCollapsed}
              onToggleCollapsed={() => setManagerCollapsed((value) => !value)}
              onSelect={selectStrategy}
              onNew={newStrategy}
              onSave={() => saveStrategy(false)}
              onOptimize={() => setModal("optimization")}
              onDelete={deleteStrategy}
              onExport={exportStrategy}
              onSectionChange={setTopSection}
            />
          ) : null}
          <div className="workspace-content">
            {topSection === "strategy" ? (
              <main>
                <section className="strategy-title">
                  <div className="title-edit" onClick={() => setModal("summary")}>
                    <Edit3 size={15} />
                    <strong>{strategy.name}</strong>
                    {strategy.description ? <span>{strategy.description}</span> : null}
                  </div>
                  <div className="title-actions">
                    <button onClick={newStrategy}>新建</button>
                    <button onClick={() => setModal("optimization")}>智能调优</button>
                    <button onClick={deleteStrategy} disabled={!savedStrategies.some((item) => item.id === strategy.id)}>
                      删除
                    </button>
                    <button onClick={() => saveStrategy(true)}>另存</button>
                    <button onClick={() => saveStrategy(false)} className="primary-text">
                      保存
                    </button>
                    <button onClick={exportStrategy}>
                      <Download size={14} />
                      导出
                    </button>
                  </div>
                </section>

                <section className="workbench">
                  <StepNav active={activeStep} onChange={setActiveStep} />
                  {activeStep === "screen" ? (
                    <ScreenStep
                      strategy={strategy}
                      patchStrategy={patchStrategy}
                      pools={pools}
                      factors={factors}
                      visibleFactors={visibleFactors}
                      activeFactorGroup={activeFactorGroup}
                      setActiveFactorGroup={setActiveFactorGroup}
                      conditionTab={conditionTab}
                      setConditionTab={setConditionTab}
                      query={query}
                      setQuery={setQuery}
                      availableIndustry2={availableIndustry2}
                      onPickFactor={onPickFactor}
                      updateFilter={updateFilter}
                      updateRank={updateRank}
                      openPoolModal={() => setModal("pool")}
                      openCustomFactorModal={() => setModal("customFactor")}
                    />
                  ) : null}
                  {activeStep === "trading" ? <TradingStep strategy={strategy} patchTrading={patchTrading} factors={factors} /> : null}
                  {activeStep === "timing" ? <TimingStep strategy={strategy} patchTiming={patchTiming} /> : null}
                  {activeStep === "hedge" ? <HedgeStep strategy={strategy} patchHedge={patchHedge} /> : null}
                  <div className="slider-line">
                    <ChevronDown size={18} />
                  </div>
                </section>

                <BacktestPanel
                  tab={backtestTab}
                  setTab={setBacktestTab}
                  config={backtestConfig}
                  setConfig={setBacktestConfig}
                  result={result}
                  selectionRows={selectionRows.length ? selectionRows : previewRows}
                  rankRows={rankRows}
                  factors={factors}
                  strategy={strategy}
                  runCurrentTask={runCurrentTask}
                  openCompare={() => setModal("compare")}
                  onOpenStockInfo={openStockInfo}
                />
              </main>
            ) : topSection === "sentiment" ? (
              <main>
                <SentimentWorkspace stocks={stocks} newsSourceSettings={newsSourceSettings} />
              </main>
            ) : topSection === "valuation" ? (
              <main>
                <ValuationWorkspace
                  stocks={stocks}
                  realDataStatus={valuationRealDataStatus}
                  isRealDataReady={valuationDataSource === "tencentQuote" && stocks.some((stock) => stock.metrics.realQuoteSource === 1)}
                  onSyncRealData={syncValuationRealData}
                />
              </main>
            ) : topSection === "trade" ? (
              <main>
                <TradeWorkspace
                  strategy={strategy}
                  rows={selectionRows.length ? selectionRows : previewRows}
                  tradeConnection={tradeConnection}
                  tradeConnectionStatus={tradeConnectionStatus}
                  paperTradeState={paperTradeState}
                  patchTradeConnection={patchTradeConnection}
                  bindTradingInterface={bindTradingInterface}
                  exportTradePlan={exportTradePlan}
                  submitPaperTradePlan={submitPaperTradePlan}
                  onOpenStockInfo={openStockInfo}
                />
              </main>
            ) : (
              <main>
                <SettingsWorkspace
                  settings={infoSourceSettings}
                  status={infoSourceStatus}
                  summary={openSourceSummary}
                  stockCount={stocks.length}
                  newsSettings={newsSourceSettings}
                  newsStatus={newsSourceStatus}
                  newsAnalysisSettings={newsAnalysisModelSettings}
                  newsAnalysisStatus={newsAnalysisModelStatus}
                  patchSettings={patchInfoSourceSettings}
                  toggleModule={toggleSourceModule}
                  patchNewsSource={patchNewsSource}
                  toggleNewsSource={toggleNewsSource}
                  onAddNewsSource={addNewsSource}
                  onRemoveNewsSource={removeNewsSource}
                  onSaveNewsSources={saveNewsSourceSettings}
                  onTestNewsSource={runNewsSourceConnectionTest}
                  patchNewsAnalysis={patchNewsAnalysisModelSettings}
                  toggleNewsAnalysisTask={toggleNewsAnalysisTask}
                  onSaveNewsAnalysis={saveNewsAnalysisModelSettings}
                  onTestNewsAnalysis={runNewsAnalysisModelConnectionTest}
                  onSave={saveInfoSourceSettings}
                  onTest={runInfoSourceConnectionTest}
                  onSyncOpenData={syncOpenSourceData}
                />
              </main>
            )}
          </div>
        </div>
      </div>

      {modal === "pool" ? (
        <Modal title="新建静态股票池" onClose={() => setModal(null)}>
          <div className="form-grid single">
            <label>
              <span>股票池名称</span>
              <input value={poolDraft.name} onChange={(event) => setPoolDraft({ ...poolDraft, name: event.target.value })} />
            </label>
            <label>
              <span>股票列表</span>
              <textarea value={poolDraft.codes} onChange={(event) => setPoolDraft({ ...poolDraft, codes: event.target.value })} />
            </label>
            <p className="hint-text">支持逗号、空格、换行分隔股票代码。本地版本同时保留系统池、静态池、动态池和合成池的数据结构。</p>
            <button className="btn primary" onClick={createPool}>
              <Save size={15} />
              保存股票池
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "customFactor" ? (
        <Modal title="自定义指标" onClose={() => setModal(null)} wide>
          <div className="custom-factor-layout">
            <div className="form-grid single">
              <label>
                <span>指标名</span>
                <input value={customFactorDraft.name} onChange={(event) => setCustomFactorDraft({ ...customFactorDraft, name: event.target.value })} />
              </label>
              <label>
                <span>公式</span>
                <textarea value={customFactorDraft.formula} onChange={(event) => setCustomFactorDraft({ ...customFactorDraft, formula: event.target.value })} />
              </label>
              <p className="hint-text">可使用系统指标 key，例如 qualityScore、revenueGrowth、pe，以及 abs/sqrt/log/min/max/avg 等函数。</p>
              <button className="btn primary" onClick={createFactor}>
                <Plus size={15} />
                添加指标
              </button>
            </div>
            <div className="factor-help">
              <h4>系统函数</h4>
              <div className="code-list">abs(x) sqrt(x) log(x) min(a,b) max(a,b) avg(a,b,c)</div>
              <h4>常用指标 key</h4>
              <div className="code-list">{FACTORS.slice(0, 36).map((item) => item.key).join("  ")}</div>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "summary" ? (
        <Modal title="策略定义总结" onClose={() => setModal(null)} wide>
          <div className="summary-grid">
            <label>
              <span>策略名称</span>
              <input value={strategy.name} onChange={(event) => patchStrategy({ name: event.target.value })} />
            </label>
            <label>
              <span>说明</span>
              <textarea value={strategy.description} onChange={(event) => patchStrategy({ description: event.target.value })} />
            </label>
            <div className="summary-card">
              <h4>定义摘要</h4>
              <p>股票池：{pools.find((pool) => pool.id === strategy.poolId)?.name}</p>
              <p>筛选条件：{strategy.filters.length} 条，排名条件：{strategy.ranks.length} 条</p>
              <p>
                交易模型：{strategy.trading.mode}，最大持仓 {strategy.trading.maxHoldings} 只，调仓周期 {strategy.trading.period} 交易日
              </p>
              <p>择时：{strategy.timing.mode}，对冲：{strategy.hedge.enabled ? `${strategy.hedge.contract} ${strategy.hedge.ratio}%` : "未开启"}</p>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "asset" ? (
        <Modal title="添加策略/ETF" onClose={() => setModal(null)} wide>
          <AssetEditor strategy={strategy} addAsset={addAsset} patchStrategy={patchStrategy} />
        </Modal>
      ) : null}

      {modal === "optimization" ? (
        <Modal title="参数调优" onClose={() => setModal(null)} wide>
          <div className="optimization-table">
            <table>
              <thead>
                <tr>
                  <th>可调参数</th>
                  <th>当前值</th>
                  <th>调优</th>
                  <th>设置范围</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>最大持仓数</td>
                  <td>{strategy.trading.maxHoldings}</td>
                  <td>
                    <input type="checkbox" defaultChecked />
                  </td>
                  <td>6, 8, 10, 12, 15</td>
                </tr>
                <tr>
                  <td>排名权重</td>
                  <td>{strategy.ranks.map((rank) => `${getFactorName(factors, rank.factorKey)} ${rank.weight}`).join(" / ")}</td>
                  <td>
                    <input type="checkbox" />
                  </td>
                  <td>保留当前权重，本地调优先搜索持仓数</td>
                </tr>
                <tr>
                  <td>调仓周期</td>
                  <td>{strategy.trading.period}</td>
                  <td>
                    <input type="checkbox" />
                  </td>
                  <td>5 - 20 交易日</td>
                </tr>
              </tbody>
            </table>
            <button className="btn primary" onClick={optimize}>
              <SlidersHorizontal size={15} />
              确认调优
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "compare" ? (
        <Modal title="对比策略指标" onClose={() => setModal(null)} wide>
          <ComparePanel result={result} strategy={strategy} />
        </Modal>
      ) : null}

      {stockInfoTarget ? <StockInfoModal target={stockInfoTarget} onClose={() => setStockInfoTarget(null)} /> : null}
    </>
  );
}

function StepNav({ active, onChange }: { active: StepKey; onChange: (step: StepKey) => void }) {
  const steps: Array<{ key: StepKey; label: string }> = [
    { key: "screen", label: "择股设置" },
    { key: "trading", label: "交易模型" },
    { key: "timing", label: "大盘择时" },
    { key: "hedge", label: "股指对冲" }
  ];
  return (
    <div className="step-nav">
      {steps.map((step) => (
        <button key={step.key} className={active === step.key ? "active" : ""} onClick={() => onChange(step.key)}>
          {step.label}
        </button>
      ))}
      <div className="step-links">
        <a onClick={(event) => event.preventDefault()}>策略定义总结</a>
        <a onClick={(event) => event.preventDefault()}>新手帮助</a>
      </div>
    </div>
  );
}

function ScreenStep({
  strategy,
  patchStrategy,
  pools,
  factors,
  visibleFactors,
  activeFactorGroup,
  setActiveFactorGroup,
  conditionTab,
  setConditionTab,
  query,
  setQuery,
  availableIndustry2,
  onPickFactor,
  updateFilter,
  updateRank,
  openPoolModal,
  openCustomFactorModal
}: {
  strategy: StrategyConfig;
  patchStrategy: (patch: Partial<StrategyConfig>) => void;
  pools: StockPool[];
  factors: Factor[];
  visibleFactors: Factor[];
  activeFactorGroup: FactorGroup;
  setActiveFactorGroup: (group: FactorGroup) => void;
  conditionTab: "filter" | "rank";
  setConditionTab: (tab: "filter" | "rank") => void;
  query: string;
  setQuery: (query: string) => void;
  availableIndustry2: string[];
  onPickFactor: (factorKey: string) => void;
  updateFilter: (id: string, patch: Partial<FilterCondition>) => void;
  updateRank: (id: string, patch: Partial<RankCondition>) => void;
  openPoolModal: () => void;
  openCustomFactorModal: () => void;
}) {
  const [expandedFactorKey, setExpandedFactorKey] = useState("price");
  const expandedFactor = visibleFactors.find((factor) => factor.key === expandedFactorKey);
  const expandedDetails = expandedFactor ? getDetailFactors(expandedFactor, factors) : [];
  const factorColumns = 5;
  const factorRows = Array.from({ length: Math.ceil(visibleFactors.length / factorColumns) }, (_, rowIndex) =>
    visibleFactors.slice(rowIndex * factorColumns, rowIndex * factorColumns + factorColumns)
  );

  return (
    <div className="screen-step">
      <div className="range-panel">
        <div className="range-row">
          <label className="inline-select">
            <strong>我的股票池：</strong>
            <select value={strategy.poolId} onChange={(event) => patchStrategy({ poolId: event.target.value })}>
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </label>
          <NumberField label="股票上限(只)" value={strategy.poolLimit} min={1} onChange={(poolLimit) => patchStrategy({ poolLimit })} />
          <NumberField label="调仓周期(交易日)" value={strategy.screenPeriod} min={1} onChange={(screenPeriod) => patchStrategy({ screenPeriod })} />
          <button className="icon-action" onClick={openPoolModal} title="新建股票池">
            <Plus size={17} />
          </button>
          <HelpCircle size={15} className="muted-icon" />
          <label className="inline-select hot">
            <strong>系统股票池：</strong>
            <select value={strategy.hotPoolId} onChange={(event) => patchStrategy({ hotPoolId: event.target.value })}>
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="range-grid">
          <SelectField label="指数成份：" value={strategy.indexMember} options={INDEX_OPTIONS} onChange={(indexMember) => patchStrategy({ indexMember })} />
          <SelectField label="上市板块：" value={strategy.board} options={BOARD_OPTIONS} onChange={(board) => patchStrategy({ board })} />
          <SelectField
            label="行业标准："
            value={strategy.industryStandard}
            options={["申万 2014", "申万 2021"]}
            onChange={(industryStandard) => patchStrategy({ industryStandard: industryStandard as StrategyConfig["industryStandard"] })}
          />
          <SelectField label="一级行业：" value={strategy.industry1} options={INDUSTRY_OPTIONS} onChange={(industry1) => patchStrategy({ industry1, industry2: "全部" })} />
          <SelectField label="二级行业：" value={strategy.industry2} options={availableIndustry2} onChange={(industry2) => patchStrategy({ industry2 })} />
          <SelectField
            label="ST股票："
            value={strategy.stMode}
            options={["包含ST", "排除ST", "仅有ST"]}
            onChange={(stMode) => patchStrategy({ stMode: stMode as StrategyConfig["stMode"] })}
          />
          <SelectField label="交易所：" value={strategy.exchange} options={EXCHANGE_OPTIONS} onChange={(exchange) => patchStrategy({ exchange })} />
          <SelectField label="地域板块：" value={strategy.region} options={REGION_OPTIONS} onChange={(region) => patchStrategy({ region })} />
          <SelectField label="企业性质：" value={strategy.property} options={PROPERTY_OPTIONS} onChange={(property) => patchStrategy({ property })} />
          <SelectField label="融资融券：" value={strategy.marginFlag} options={["全部", "融资融券", "非融资融券"]} onChange={(marginFlag) => patchStrategy({ marginFlag })} />
          <SelectField
            label="科创板："
            value={strategy.starMode}
            options={["排除科创板", "包含科创板", "仅有科创板"]}
            onChange={(starMode) => patchStrategy({ starMode: starMode as StrategyConfig["starMode"] })}
          />
        </div>
        <div className="range-row bottom">
          <label className="check-line">
            <input type="checkbox" checked={strategy.filterSuspended} onChange={(event) => patchStrategy({ filterSuspended: event.target.checked })} />
            过滤停牌股票
          </label>
        </div>
      </div>

      <div className="dual-panel">
        <div className="factor-panel">
          <div className="panel-title">
            <strong>选股指标</strong>
            <label className="factor-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索财务选项与指标" />
            </label>
            <button className="mini-btn" onClick={openCustomFactorModal}>
              <Plus size={14} />
              自定义
            </button>
          </div>
          <div className="tabs">
            {factorTabs.map((group) => (
              <button key={group} className={activeFactorGroup === group ? "active" : ""} onClick={() => setActiveFactorGroup(group)}>
                {group}
              </button>
            ))}
          </div>
          <div className="factor-grid expanded">
            {factorRows.map((row, rowIndex) => (
              <div className="factor-row-group" key={row.map((factor) => factor.key).join("-") || rowIndex}>
                {row.map((factor) => (
                  <button
                    key={factor.key}
                    className={`factor-parent ${expandedFactorKey === factor.key ? "active" : ""}`}
                    onClick={() => setExpandedFactorKey(expandedFactorKey === factor.key ? "" : factor.key)}
                  >
                    <span>{factorOptionLabel(factor)}</span>
                    <ChevronDown size={16} />
                  </button>
                ))}
                {expandedFactor && row.some((factor) => factor.key === expandedFactor.key) && expandedDetails.length ? (
                  <div className="factor-detail-grid">
                    {expandedDetails.map((detail) => (
                      <button key={detail.key} onClick={() => onPickFactor(detail.key)}>
                        {detail.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="condition-panel">
          <div className="panel-title">
            <strong>选股条件</strong>
          </div>
          <div className="tabs">
            <button className={conditionTab === "filter" ? "active" : ""} onClick={() => setConditionTab("filter")}>
              筛选条件 {strategy.filters.length > 0 ? <em>{strategy.filters.length}</em> : null}
            </button>
            <button className={conditionTab === "rank" ? "active" : ""} onClick={() => setConditionTab("rank")}>
              排名条件 {strategy.ranks.length > 0 ? <em>{strategy.ranks.length}</em> : null}
            </button>
          </div>
          {conditionTab === "filter" ? (
            <FilterTable filters={strategy.filters} factors={factors} updateFilter={updateFilter} remove={(id) => patchStrategy({ filters: strategy.filters.filter((item) => item.id !== id) })} />
          ) : (
            <RankTable ranks={strategy.ranks} factors={factors} updateRank={updateRank} remove={(id) => patchStrategy({ ranks: strategy.ranks.filter((item) => item.id !== id) })} />
          )}
        </div>
      </div>
    </div>
  );
}

function FilterTable({
  filters,
  factors,
  updateFilter,
  remove
}: {
  filters: FilterCondition[];
  factors: Factor[];
  updateFilter: (id: string, patch: Partial<FilterCondition>) => void;
  remove: (id: string) => void;
}) {
  if (!filters.length) {
    return <EmptyState>点击选择选股指标，生成股票筛选条件</EmptyState>;
  }
  return (
    <div className="condition-table">
      <div className="table-head filter-head">
        <span>指标</span>
        <span>比较符</span>
        <span>范围</span>
        <span>值</span>
        <span>操作</span>
      </div>
      {filters.map((item) => (
        <div className="condition-row filter-row" key={item.id}>
          <FactorSelect value={item.factorKey} factors={factors} onChange={(factorKey) => updateFilter(item.id, { factorKey })} />
          <select value={normalizeFilterOperator(item.operator)} onChange={(event) => updateFilter(item.id, operatorPatch(item, event.target.value as FilterOperator))}>
            {operators.map((operator) => (
              <option key={operator.value} value={operator.value}>
                {operator.label}
              </option>
            ))}
          </select>
          <select value={item.range} onChange={(event) => updateFilter(item.id, { range: event.target.value as FilterCondition["range"] })}>
            <option>全部</option>
            <option>一级行业</option>
            <option>二级行业</option>
          </select>
          {isRangeOperator(item.operator) ? (
            <div className="range-inputs">
              <input type="number" value={item.min ?? 0} onChange={(event) => updateFilter(item.id, { min: Number(event.target.value) })} />
              <input type="number" value={item.max ?? 100} onChange={(event) => updateFilter(item.id, { max: Number(event.target.value) })} />
            </div>
          ) : (
            <input type="number" value={item.value ?? item.min ?? item.max ?? 0} onChange={(event) => updateFilter(item.id, { value: Number(event.target.value) })} />
          )}
          <button className="icon-btn" onClick={() => remove(item.id)} aria-label="删除筛选条件">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function RankTable({
  ranks,
  factors,
  updateRank,
  remove
}: {
  ranks: RankCondition[];
  factors: Factor[];
  updateRank: (id: string, patch: Partial<RankCondition>) => void;
  remove: (id: string) => void;
}) {
  if (!ranks.length) {
    return <EmptyState>点击选择选股指标，生成排名条件。如无排名条件，则优先买入成交额大的股票。</EmptyState>;
  }
  return (
    <div className="condition-table">
      <div className="table-head rank-head">
        <span>指标</span>
        <span>次序</span>
        <span>范围</span>
        <span>权重</span>
        <span>操作</span>
      </div>
      {ranks.map((item) => (
        <div className="condition-row rank-row" key={item.id}>
          <FactorSelect value={item.factorKey} factors={factors} onChange={(factorKey) => updateRank(item.id, { factorKey })} />
          <select value={item.order} onChange={(event) => updateRank(item.id, { order: event.target.value as RankCondition["order"] })}>
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </select>
          <select value={item.range} onChange={(event) => updateRank(item.id, { range: event.target.value as RankCondition["range"] })}>
            <option>全部</option>
            <option>一级行业</option>
            <option>二级行业</option>
          </select>
          <input type="number" min={1} max={100} value={item.weight} onChange={(event) => updateRank(item.id, { weight: Number(event.target.value) })} />
          <button className="icon-btn" onClick={() => remove(item.id)} aria-label="删除排名条件">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function TradingStep({ strategy, patchTrading, factors }: { strategy: StrategyConfig; patchTrading: (patch: Partial<StrategyConfig["trading"]>) => void; factors: Factor[] }) {
  const t = strategy.trading;
  const addRule = (kind: "buyRules" | "sellRules" | "holdRules") => {
    patchTrading({
      [kind]: [
        ...t[kind],
        {
          id: uid("rule"),
          name: kind === "buyRules" ? "自定义买入限制" : kind === "sellRules" ? "自定义卖出条件" : "自定义不卖条件",
          factorKey: "momentum60",
          operator: kind === "sellRules" ? "lte" : "gte",
          value: kind === "sellRules" ? -10 : 10,
          enabled: true
        }
      ]
    } as Partial<StrategyConfig["trading"]>);
  };
  return (
    <div className="model-step">
      <div className="setting-block">
        <div className="mode-line">
          <strong>交易模型：</strong>
          {(["模型I", "模型II", "模型III"] as const).map((mode) => (
            <label key={mode}>
              <input type="radio" checked={t.mode === mode} onChange={() => patchTrading({ mode })} />
              {mode === "模型I" ? "模型Ⅰ--定期轮动" : mode === "模型II" ? "模型Ⅱ--条件触发" : "模型Ⅲ--专业模型"}
            </label>
          ))}
          <a>了解模型</a>
        </div>
        <div className="form-row">
          <NumberField label="调仓周期（交易日）：" value={t.period} min={1} onChange={(period) => patchTrading({ period })} />
          <SelectField label="调仓时点：" value={t.orderTime} options={["收盘价", "开盘价", "日均成交价"]} onChange={(orderTime) => patchTrading({ orderTime: orderTime as StrategyConfig["trading"]["orderTime"] })} />
          <SelectField label="空闲资金配置：" value={t.cashAsset} options={["无", "货币基金", "短债ETF"]} onChange={(cashAsset) => patchTrading({ cashAsset })} />
          <label className="check-line">
            <input type="checkbox" checked={t.realtimeBacktest} onChange={(event) => patchTrading({ realtimeBacktest: event.target.checked })} />
            实时回测
          </label>
          <label className="check-line">
            <input type="checkbox" checked={t.multiPoint} onChange={(event) => patchTrading({ multiPoint: event.target.checked })} />
            多时点调仓
          </label>
        </div>
        <div className="form-row">
          <NumberField label="最大持仓股票数：" value={t.maxHoldings} min={1} onChange={(maxHoldings) => patchTrading({ maxHoldings })} suffix="只" />
          {t.mode === "模型II" ? (
            <>
              <NumberField label="新股理想仓位：" value={t.idealPosition} min={1} max={100} onChange={(idealPosition) => patchTrading({ idealPosition })} suffix="%" />
              <SelectField label="个股仓位范围：" value={String(t.positionDeviation)} options={["10", "20", "30", "40", "50"]} onChange={(positionDeviation) => patchTrading({ positionDeviation: Number(positionDeviation) })} />
              <NumberField label="最小建仓仓位：" value={t.minPosition} min={1} max={100} onChange={(minPosition) => patchTrading({ minPosition })} suffix="%" />
            </>
          ) : null}
          <NumberField label="备选买入股票数：" value={t.backupCount} min={0} onChange={(backupCount) => patchTrading({ backupCount })} />
          <NumberField label="个股最大买入仓位：" value={t.maxBuyPosition} min={1} max={100} onChange={(maxBuyPosition) => patchTrading({ maxBuyPosition })} suffix="%" />
          <SelectField
            label="个股仓位权重："
            value={t.weightMethod}
            options={["平权", "流通市值", "总市值", "流通市值平方根", "总市值平方根"]}
            onChange={(weightMethod) => patchTrading({ weightMethod: weightMethod as StrategyConfig["trading"]["weightMethod"] })}
          />
        </div>
        <button className="switch-row" onClick={() => patchTrading({ advancedOpen: !t.advancedOpen })}>
          <ChevronDown size={16} />
          高级交易选项
        </button>
        {t.advancedOpen ? (
          <div className="form-row advanced">
            <SelectField label="交易日期：" value={t.tradeDate} options={["不指定", "每周第一个交易日", "每周最后一个交易日", "每月第一个交易日", "每月最后一个交易日", "每季第一个交易日", "每季最后一个交易日"]} onChange={(tradeDate) => patchTrading({ tradeDate })} />
            <label className="check-line">
              <input type="checkbox" checked={t.sellSuspended} onChange={(event) => patchTrading({ sellSuspended: event.target.checked })} />
              停牌卖出
            </label>
            <SelectField label="做空：" value={t.shortSelling} options={["无", "做空低排名", "做空高排名", "多空组合"]} onChange={(shortSelling) => patchTrading({ shortSelling })} />
            <NumberField label="行业市值限制比率：" value={t.industryLimitRatio} min={0} max={100} onChange={(industryLimitRatio) => patchTrading({ industryLimitRatio })} suffix="%" />
            {t.mode === "模型III" ? (
              <>
                <label className="setting-field long">
                  <span>个股仓位权重：</span>
                  <input value={t.positionExpression} onChange={(event) => patchTrading({ positionExpression: event.target.value })} placeholder="例如 sqrt(floatMarketCap)" />
                </label>
                <SelectField label="行业权重基准：" value={t.industryNeutralBenchmark} options={["无", "沪深300", "中证500", "中证流通"]} onChange={(industryNeutralBenchmark) => patchTrading({ industryNeutralBenchmark })} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {t.mode === "模型II" ? (
        <div className="rule-columns">
          <RuleBox title="新股买入附加限制" rules={t.buyRules} factors={factors} onAdd={() => addRule("buyRules")} />
          <RuleBox title="卖出条件" rules={t.sellRules} factors={factors} onAdd={() => addRule("sellRules")} />
          <RuleBox title="不卖条件" rules={t.holdRules} factors={factors} onAdd={() => addRule("holdRules")} />
        </div>
      ) : null}
    </div>
  );
}

function RuleBox({ title, rules, factors, onAdd }: { title: string; rules: StrategyConfig["trading"]["buyRules"]; factors: Factor[]; onAdd: () => void }) {
  return (
    <div className="rule-box">
      <h3>
        {title}
        <Info size={14} />
      </h3>
      {rules.length ? (
        rules.map((rule) => (
          <div className="rule-line" key={rule.id}>
            <span>{rule.name}</span>
            <em>
              {getFactorName(factors, rule.factorKey)} {getOperatorLabel(rule.operator)} {rule.value}
            </em>
          </div>
        ))
      ) : (
        <EmptyState>暂无自定义条件</EmptyState>
      )}
      <button className="btn" onClick={onAdd}>
        <Plus size={15} />
        自定义
      </button>
    </div>
  );
}

function TimingStep({ strategy, patchTiming }: { strategy: StrategyConfig; patchTiming: (patch: Partial<StrategyConfig["timing"]>) => void }) {
  const timing = strategy.timing;
  return (
    <div className="timing-step">
      <div className="setting-block fixed-height">
        <div className="mode-line">
          <strong>大盘择时：</strong>
          {(["不择时", "使用择时模板", "自定义择时公式"] as const).map((mode) => (
            <label key={mode}>
              <input type="radio" checked={timing.mode === mode} onChange={() => patchTiming({ mode })} />
              {mode}
            </label>
          ))}
        </div>
        <div className="form-row">
          <SelectField label="择时指数：" value={timing.index} options={["沪深300", "中证500", "创业板指", "科创50"]} onChange={(index) => patchTiming({ index })} />
          <SelectField
            label="择时模板："
            value={timing.template}
            options={["沪深300收盘价高于MA60", "指数估值低于历史中位", "行业动量转强", "宏观景气扩张"]}
            onChange={(template) => patchTiming({ template })}
          />
          <NumberField label="阈值：" value={timing.threshold} onChange={(threshold) => patchTiming({ threshold })} />
          <SelectField label="空仓配置：" value={timing.cashWhenTimingOut} options={["现金", "货币基金", "国债ETF"]} onChange={(cashWhenTimingOut) => patchTiming({ cashWhenTimingOut })} />
        </div>
        <label className="formula-box">
          <span>自定义择时公式</span>
          <textarea value={timing.formula} onChange={(event) => patchTiming({ formula: event.target.value })} />
        </label>
      </div>
      <div className="template-grid">
        {["均线趋势", "估值分位", "宏观流动性", "行业轮动", "股指贴水", "风险预算"].map((item) => (
          <div className="template-card" key={item}>
            <LineChart size={18} />
            <strong>{item}</strong>
            <span>可作为择时模板或自定义公式输入。</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HedgeStep({ strategy, patchHedge }: { strategy: StrategyConfig; patchHedge: (patch: Partial<StrategyConfig["hedge"]>) => void }) {
  const hedge = strategy.hedge;
  return (
    <div className="hedge-step">
      <div className="setting-block">
        <div className="mode-line">
          <strong>股指对冲：</strong>
          <label>
            <input type="checkbox" checked={hedge.enabled} onChange={(event) => patchHedge({ enabled: event.target.checked })} />
            启用股指期货对冲
          </label>
        </div>
        <div className="form-row">
          <SelectField label="合约：" value={hedge.contract} options={["IF", "IH", "IC", "IM"]} onChange={(contract) => patchHedge({ contract: contract as StrategyConfig["hedge"]["contract"] })} />
          <NumberField label="对冲比例：" value={hedge.ratio} min={0} max={100} onChange={(ratio) => patchHedge({ ratio })} suffix="%" />
          <SelectField label="对冲基准：" value={hedge.benchmark} options={["沪深300", "上证50", "中证500", "中证1000"]} onChange={(benchmark) => patchHedge({ benchmark })} />
          <NumberField label="调仓周期：" value={hedge.rebalance} min={1} onChange={(rebalance) => patchHedge({ rebalance })} suffix="日" />
          <NumberField label="对冲成本：" value={hedge.cost} min={0} onChange={(cost) => patchHedge({ cost })} suffix="‰" />
        </div>
      </div>
      <div className="hedge-note">
        <BarChart3 size={22} />
        <div>
          <strong>本地对冲引擎</strong>
          <p>回测时会按对冲比例扣减基准波动并计入期货成本，用于观察多空组合、低排名做空和风险敞口控制效果。</p>
        </div>
      </div>
    </div>
  );
}

function RefreshControlBar({
  title,
  status,
  lastRefreshAt,
  intervalMinutes,
  onIntervalChange,
  onRefresh
}: {
  title: string;
  status: string;
  lastRefreshAt: string;
  intervalMinutes: number;
  onIntervalChange: (value: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="refresh-control-bar">
      <div className="refresh-control-status">
        <span>{title}</span>
        <strong>最后刷新 {formatDateTime(lastRefreshAt)}</strong>
        <em>{status}</em>
      </div>
      <label>
        <span>刷新频率</span>
        <select value={intervalMinutes} onChange={(event) => onIntervalChange(Number(event.target.value))}>
          {refreshIntervalOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <button className="btn primary" onClick={onRefresh}>
        <RefreshCcw size={14} />
        手动刷新
      </button>
    </div>
  );
}

function NewsFetchModeBar({
  mode,
  onModeChange
}: {
  mode: NewsFetchMode;
  onModeChange: (mode: NewsFetchMode) => void;
}) {
  const activeMode = newsFetchModeOptions.find((item) => item.value === mode) ?? newsFetchModeOptions[0];
  return (
    <div className="news-fetch-mode-bar">
      <label>
        <span>拉取模式</span>
        <select value={mode} onChange={(event) => onModeChange(event.target.value as NewsFetchMode)}>
          {newsFetchModeOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p>{activeMode.description}</p>
    </div>
  );
}

function NewsFetchStatsBar({
  stats,
  effectiveEventCount,
  linkedStockCount
}: {
  stats: NewsFetchStats;
  effectiveEventCount: number;
  linkedStockCount: number;
}) {
  const items = [
    { label: "扫描股票数", value: stats.scannedStocks },
    { label: "请求次数", value: stats.requestCount },
    { label: "返回新闻数", value: stats.returnedRows },
    { label: "有效事件数", value: effectiveEventCount },
    { label: "关联股票数", value: linkedStockCount }
  ];
  return (
    <div className="news-fetch-stats-bar">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

function SentimentWorkspace({ stocks, newsSourceSettings }: { stocks: Stock[]; newsSourceSettings: NewsSourceSettings }) {
  const [sentimentTab, setSentimentTab] = useState<"overview" | "news">("overview");
  const [filters, setFilters] = useState<SentimentFilters>(defaultSentimentFilters);
  const [stockInfoTarget, setStockInfoTarget] = useState<StockInfoTarget | null>(null);
  const [rawSentimentEvents, setRawSentimentEvents] = useState<SentimentEvent[]>([]);
  const [sentimentLastRefreshAt, setSentimentLastRefreshAt] = useState(() => new Date().toISOString());
  const [sentimentRefreshStatus, setSentimentRefreshStatus] = useState("等待接入真实新闻源，当前不使用本地舆情样本");
  const [sentimentRefreshInterval, setSentimentRefreshInterval] = useState(() => loadManualFirstRefreshInterval("sentimentRefreshInterval"));
  const [sentimentFetchMode, setSentimentFetchMode] = useState<NewsFetchMode>(() => loadLocal("sentimentNewsFetchMode", "fast" as NewsFetchMode));
  const [sentimentFetchStats, setSentimentFetchStats] = useState<NewsFetchStats>(defaultNewsFetchStats);
  const [sentimentFetchEventCount, setSentimentFetchEventCount] = useState(0);
  const [sentimentFetchLinkedStockCount, setSentimentFetchLinkedStockCount] = useState(0);
  const industryOptions = useMemo(
    () => ["全部", ...Array.from(new Set(rawSentimentEvents.flatMap((event) => event.industries))).sort()],
    [rawSentimentEvents]
  );
  const events = useMemo(() => filterSentimentEvents(rawSentimentEvents, filters), [rawSentimentEvents, filters]);
  const linkedStocks = useMemo(() => buildSentimentLinkedStocks(events, stocks), [events, stocks]);
  const report = useMemo(() => buildSentimentInsightReport(events, linkedStocks), [events, linkedStocks]);
  const topEvent = events[0];
  const positiveCount = events.filter((event) => event.direction === "利好").length;
  const negativeCount = events.filter((event) => event.direction === "利空").length;
  const majorCount = events.filter((event) => event.severity === "特别重大" || event.severity === "重大").length;
  const focusedIndustry = filters.industry === "全部" ? report.topIndustries[0]?.industry ?? "--" : filters.industry;
  const openStockInfo = (stock: StockReference) => setStockInfoTarget(resolveStockInfoTarget(stock, stocks));

  const refreshSentimentData = async (mode: "手动" | "自动" = "手动") => {
    const fetchModeLabel = newsFetchModeOptions.find((item) => item.value === sentimentFetchMode)?.label ?? "快速";
    setSentimentRefreshStatus(`${mode}刷新中：正在按${fetchModeLabel}模式从真实新闻源拉取新闻并重算舆情事件...`);
    const result = await fetchNewsArticlesFromSources(enabledNewsSources(newsSourceSettings), stocks, fetch, { mode: sentimentFetchMode });
    setSentimentLastRefreshAt(result.checkedAt);
    setSentimentFetchStats(result.stats);
    if (!result.ok) {
      if (!rawSentimentEvents.length) setRawSentimentEvents([]);
      setSentimentFetchEventCount(0);
      setSentimentFetchLinkedStockCount(0);
      setSentimentRefreshStatus(`${mode}${result.message}：${result.details}`);
      return;
    }
    const nextEvents = buildSentimentEventsFromNewsArticles(result.articles, stocks);
    const nextLinkedStocks = buildSentimentLinkedStocks(nextEvents, stocks);
    setRawSentimentEvents(nextEvents);
    setSentimentFetchEventCount(nextEvents.length);
    setSentimentFetchLinkedStockCount(nextLinkedStocks.length);
    setSentimentRefreshStatus(
      nextEvents.length
        ? `${mode}${result.message}：扫描 ${result.stats.scannedStocks} 只股票，请求 ${result.stats.requestCount} 次，返回 ${result.stats.returnedRows} 条新闻，生成 ${nextEvents.length} 个舆情事件，关联 ${nextLinkedStocks.length} 只股票`
        : `${mode}刷新失败：真实新闻源返回 ${result.articles.length} 条数据，但未形成可关联股票的舆情事件`
    );
  };

  const updateSentimentRefreshInterval = (value: number) => {
    setSentimentRefreshInterval(value);
    saveLocal("sentimentRefreshInterval", value);
    setSentimentRefreshStatus(value > 0 ? `已设置每 ${value} 分钟自动刷新` : "已关闭自动刷新");
  };

  const updateSentimentFetchMode = (value: NewsFetchMode) => {
    setSentimentFetchMode(value);
    saveLocal("sentimentNewsFetchMode", value);
    const option = newsFetchModeOptions.find((item) => item.value === value);
    setSentimentRefreshStatus(`已切换为${option?.label ?? "快速"}模式，手动刷新后生效`);
  };

  useEffect(
    function scheduleSentimentAutoRefresh() {
      if (!sentimentRefreshInterval) return;
      const timer = window.setInterval(() => {
        void refreshSentimentData("自动");
      }, sentimentRefreshInterval * 60 * 1000);
      return () => window.clearInterval(timer);
    },
    [sentimentRefreshInterval, newsSourceSettings, stocks, rawSentimentEvents.length, sentimentFetchMode]
  );

  useEffect(
    function loadInitialRealSentimentData() {
      if (!sentimentRefreshInterval) return;
      void refreshSentimentData("自动");
    },
    [sentimentRefreshInterval, newsSourceSettings, stocks]
  );

  const exportReport = () => {
    const lines = [
      `# ${report.title}`,
      "",
      `结论：${report.conclusion}`,
      `筛选：行业 ${filters.industry} / 重大程度 ${filters.severity} / 事件类型 ${filters.category} / 影响方向 ${filters.direction} / 最低价值分 ${filters.minScore}`,
      "",
      "## 高价值事件",
      ...events.map((event) => `- ${event.title}（${event.category}/${event.direction}/${event.severity}，${event.industries.join("、")}，价值分 ${scoreSentimentEvent(event)}）：${event.summary}`),
      "",
      "## 关联股票",
      ...linkedStocks.slice(0, 20).map((item) => `- ${item.stock.name} ${displayStockCode(item.stock)}：${item.relationLevel}，关联度 ${item.relationScore}，${item.reason}`),
      "",
      "## 验证点",
      ...report.validationPoints.map((item) => `- ${item}`)
    ];
    downloadTextFile(`舆情选股洞察-${new Date().toISOString().slice(0, 10)}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
  };

  return (
    <section className="sentiment-workspace">
      <div className="sentiment-title-row">
        <div>
          <h2>舆情选股</h2>
          <p>独立事件驱动板块，用于筛选价值新闻、分类事件、展示关联股票并输出洞察报告，不生成买卖推荐。</p>
        </div>
        <div className="sentiment-sub-tabs">
          <button className={sentimentTab === "overview" ? "active" : ""} onClick={() => setSentimentTab("overview")}>
            舆情概览
          </button>
          <button className={sentimentTab === "news" ? "active" : ""} onClick={() => setSentimentTab("news")}>
            新闻页面
          </button>
        </div>
        <div className="settings-actions">
          {sentimentTab === "overview" ? (
            <>
              <button className="btn" onClick={() => setFilters(defaultSentimentFilters)}>
                重置筛选
              </button>
              <button className="btn primary" onClick={exportReport}>
                <Download size={15} />
                导出报告
              </button>
            </>
          ) : null}
        </div>
      </div>

      {sentimentTab === "overview" ? (
        <>
      <RefreshControlBar
        title="舆情选股刷新"
        status={sentimentRefreshStatus}
        lastRefreshAt={sentimentLastRefreshAt}
        intervalMinutes={sentimentRefreshInterval}
        onIntervalChange={updateSentimentRefreshInterval}
        onRefresh={() => refreshSentimentData("手动")}
      />
      <NewsFetchModeBar mode={sentimentFetchMode} onModeChange={updateSentimentFetchMode} />
      <NewsFetchStatsBar
        stats={sentimentFetchStats}
        effectiveEventCount={sentimentFetchEventCount}
        linkedStockCount={sentimentFetchLinkedStockCount}
      />

      <div className="sentiment-radar">
        <div>
          <span>高价值事件</span>
          <strong>{events.length}</strong>
        </div>
        <div>
          <span>关联股票</span>
          <strong>{linkedStocks.length}</strong>
        </div>
        <div>
          <span>利好 / 利空</span>
          <strong>{positiveCount} / {negativeCount}</strong>
        </div>
        <div>
          <span>最高价值分</span>
          <strong>{topEvent ? scoreSentimentEvent(topEvent) : "--"}</strong>
        </div>
        <div>
          <span>命中行业</span>
          <strong>{focusedIndustry}</strong>
        </div>
        <div>
          <span>重大事件</span>
          <strong>{majorCount}</strong>
        </div>
      </div>

      <div className="sentiment-filters">
        <label>
          <span>事件类型</span>
          <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value as SentimentFilters["category"] }))}>
            {sentimentCategories.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>定点行业</span>
          <select value={filters.industry} onChange={(event) => setFilters((current) => ({ ...current, industry: event.target.value }))}>
            {industryOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>重大程度</span>
          <select value={filters.severity} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value as SentimentFilters["severity"] }))}>
            {sentimentSeverityLevels.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>影响方向</span>
          <select value={filters.direction} onChange={(event) => setFilters((current) => ({ ...current, direction: event.target.value as SentimentFilters["direction"] }))}>
            {sentimentDirections.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>最低价值分</span>
          <input type="number" min={0} max={100} value={filters.minScore} onChange={(event) => setFilters((current) => ({ ...current, minScore: Number(event.target.value) }))} />
        </label>
        <label className="wide">
          <span>关键词 / 股票代码 / 行业</span>
          <input value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="搜索政策、订单、行业、股票代码" />
        </label>
      </div>

      <div className="sentiment-layout">
        <section className="sentiment-panel">
          <div className="sentiment-panel-title">
            <h3>事件雷达</h3>
            <span>按价值分排序</span>
          </div>
          <div className="sentiment-event-list">
            {events.length ? (
              events.map((event) => (
                <article className="sentiment-event" key={event.id}>
                  <div className="sentiment-event-head">
                    <strong>{event.title}</strong>
                    <span className={event.direction === "利空" ? "sentiment-badge negative" : "sentiment-badge"}>{event.direction}</span>
                  </div>
                  <p>{event.summary}</p>
                  <div className="sentiment-meta">
                    <span>{event.category}</span>
                    <span>{event.industries.join("、") || "未识别行业"}</span>
                    <span>{event.horizon}</span>
                    <span>{event.severity}</span>
                    <span>价值分 {scoreSentimentEvent(event)}</span>
                    <span>{event.occurredAt}</span>
                    <span>{event.source}</span>
                  </div>
                </article>
              ))
            ) : (
              <div className="news-empty">
                <p>暂无真实舆情事件。请确认设置中已启用真实新闻源，然后手动刷新；接口失败时不会展示本地样本。</p>
              </div>
            )}
          </div>
        </section>

        <section className="sentiment-panel">
          <div className="sentiment-panel-title">
            <h3>关联股票</h3>
            <span>仅展示真实新闻关联关系</span>
          </div>
          <table className="data-table sentiment-table">
            <thead>
              <tr>
                <th>股票</th>
                <th>方向</th>
                <th>关联度</th>
                <th>关联事件</th>
                <th>关联依据</th>
              </tr>
            </thead>
            <tbody>
              {linkedStocks.length ? (
                linkedStocks.slice(0, 12).map((item) => (
                  <tr key={item.stock.code}>
                    <td>
                      <button className="stock-name-link" type="button" onClick={() => openStockInfo(item.stock)}>
                        <strong>{item.stock.name}</strong>
                        <span>{displayStockCode(item.stock)}</span>
                      </button>
                    </td>
                    <td>{item.direction}</td>
                    <td className="sentiment-relation-score">
                      <strong>{item.relationScore}</strong>
                      <span>{item.relationLevel}</span>
                    </td>
                    <td className="sentiment-reason-cell">{item.reason}</td>
                    <td className="sentiment-reason-cell">{item.evidence.join("、") || "接口代码关联"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>暂无关联股票。只有真实新闻能关联到股票并达到最低价值分时才会显示结果。</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="sentiment-report">
        <div className="sentiment-panel-title">
          <h3>深度洞察报告</h3>
          <span>{report.eventCount} 个事件，{linkedStocks.length} 个关联股票</span>
        </div>
        <div className="report-grid">
          <div>
            <strong>核心结论</strong>
            <p>{report.conclusion}</p>
          </div>
          <div>
            <strong>事件分类</strong>
            <p>{report.topCategories.map((item) => `${item.category} ${item.count}`).join(" / ") || "--"}</p>
          </div>
          <div>
            <strong>行业热度</strong>
            <p>{report.topIndustries.map((item) => `${item.industry} ${item.count}`).join(" / ") || "--"}</p>
          </div>
          <div>
            <strong>验证清单</strong>
            <ul>
              {report.validationPoints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
        </>
      ) : (
        <NewsPage stocks={stocks} newsSourceSettings={newsSourceSettings} onOpenStockInfo={openStockInfo} />
      )}
      {stockInfoTarget ? <StockInfoModal target={stockInfoTarget} onClose={() => setStockInfoTarget(null)} /> : null}
    </section>
  );
}


function NewsPage({
  stocks,
  newsSourceSettings,
  onOpenStockInfo
}: {
  stocks: Stock[];
  newsSourceSettings: NewsSourceSettings;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const [newsFilters, setNewsFilters] = useState<NewsFilters>(defaultNewsFilters);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [newsRefreshKey, setNewsRefreshKey] = useState(0);
  const [newsLastRefreshAt, setNewsLastRefreshAt] = useState(() => new Date().toISOString());
  const [newsRefreshStatus, setNewsRefreshStatus] = useState("等待接入真实新闻源，当前不使用本地新闻样本");
  const [newsRefreshInterval, setNewsRefreshInterval] = useState(() => loadManualFirstRefreshInterval("newsPageRefreshInterval"));
  const [newsFetchMode, setNewsFetchMode] = useState<NewsFetchMode>(() => loadLocal("newsPageFetchMode", "fast" as NewsFetchMode));
  const [newsFetchStats, setNewsFetchStats] = useState<NewsFetchStats>(defaultNewsFetchStats);
  const [newsLinkedStockCount, setNewsLinkedStockCount] = useState(0);
  const pageSize = 10;

  const articles = useMemo(() => filterNewsArticles(newsArticles, newsFilters), [newsArticles, newsFilters, newsRefreshKey]);
  const sourceList = useMemo(() => getNewsSourceList(newsArticles), [newsArticles, newsRefreshKey]);
  const stats = useMemo(() => getNewsStats(articles), [articles]);
  const knownStockCodes = useMemo(() => new Set(stocks.map((stock) => stock.code)), [stocks]);

  const totalPages = Math.max(1, Math.ceil(articles.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageArticles = articles.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

  const patchFilter = (key: keyof NewsFilters, value: string) => {
    setNewsFilters((f) => ({ ...f, [key]: value }));
    setCurrentPage(1);
  };

  const refreshNewsData = async (mode: "手动" | "自动" = "手动") => {
    const fetchModeLabel = newsFetchModeOptions.find((item) => item.value === newsFetchMode)?.label ?? "快速";
    setNewsRefreshStatus(`${mode}刷新中：正在按${fetchModeLabel}模式从真实新闻源拉取数据...`);
    const now = new Date().toISOString();
    const result = await fetchNewsArticlesFromSources(enabledNewsSources(newsSourceSettings), stocks, fetch, { mode: newsFetchMode });
    setNewsLastRefreshAt(result.checkedAt || now);
    setNewsFetchStats(result.stats);
    if (result.ok) {
      const linkedCodeSet = new Set(result.articles.flatMap((article) => article.linkedCodes));
      setNewsArticles(result.articles);
      setNewsLinkedStockCount(linkedCodeSet.size);
      setSelectedArticle(null);
      setCurrentPage(1);
      setNewsRefreshKey((value) => value + 1);
      setNewsRefreshStatus(
        `${mode}${result.message}：扫描 ${result.stats.scannedStocks} 只股票，请求 ${result.stats.requestCount} 次，返回 ${result.stats.returnedRows} 条新闻，有效 ${result.stats.validArticles} 条，关联 ${linkedCodeSet.size} 只股票`
      );
      return;
    }
    setNewsLinkedStockCount(0);
    setNewsRefreshStatus(`${mode}${result.message}：${result.details}`);
  };

  const updateNewsRefreshInterval = (value: number) => {
    setNewsRefreshInterval(value);
    saveLocal("newsPageRefreshInterval", value);
    setNewsRefreshStatus(value > 0 ? `已设置每 ${value} 分钟自动刷新` : "已关闭自动刷新");
  };

  const updateNewsFetchMode = (value: NewsFetchMode) => {
    setNewsFetchMode(value);
    saveLocal("newsPageFetchMode", value);
    const option = newsFetchModeOptions.find((item) => item.value === value);
    setNewsRefreshStatus(`已切换为${option?.label ?? "快速"}模式，手动刷新后生效`);
  };

  useEffect(
    function scheduleNewsAutoRefresh() {
      if (!newsRefreshInterval) return;
      const timer = window.setInterval(() => {
        void refreshNewsData("自动");
      }, newsRefreshInterval * 60 * 1000);
      return () => window.clearInterval(timer);
    },
    [newsRefreshInterval, newsFetchMode, newsSourceSettings, stocks]
  );

  useEffect(
    function loadInitialRealNewsData() {
      if (!newsRefreshInterval) return;
      void refreshNewsData("自动");
    },
    [newsRefreshInterval, newsSourceSettings, stocks]
  );

  if (selectedArticle) {
    return (
      <section className="news-detail-view">
        <div className="news-detail-header">
          <button className="btn" onClick={() => setSelectedArticle(null)}>
            &larr; 返回新闻列表
          </button>
          <div className="news-detail-meta-top">
            <span className={`news-badge sentiment-${selectedArticle.sentiment === "利好" ? "positive" : selectedArticle.sentiment === "利空" ? "negative" : "neutral"}`}>
              {selectedArticle.sentiment}
            </span>
            <span className="news-badge importance">{selectedArticle.importance}</span>
            <span className="news-badge category">{selectedArticle.category}</span>
          </div>
        </div>
        <article className="news-detail-body">
          <h2>{selectedArticle.title}</h2>
          <div className="news-detail-info">
            <span>{selectedArticle.source}</span>
            <span>{selectedArticle.author}</span>
            <span>{selectedArticle.publishedAt}</span>
            <span>{selectedArticle.readTime} 分钟阅读</span>
            <span>{selectedArticle.viewCount.toLocaleString()} 阅读</span>
          </div>
          <div className="news-detail-tags">
            {selectedArticle.tags.map((tag) => (
              <span className="news-tag" key={tag}>{tag}</span>
            ))}
          </div>
          <div className="news-detail-content">
            {selectedArticle.content.split("\n\n").map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          {selectedArticle.linkedStocks.length > 0 ? (
          <div className="news-detail-stocks">
              <h4>关联股票</h4>
              <div className="news-stock-chips">
                {selectedArticle.linkedStocks.map((stock) => (
                  <button className={`news-stock-chip ${knownStockCodes.has(stock.code) ? "" : "missing"}`} type="button" key={stock.code} onClick={() => onOpenStockInfo(stock)}>
                    <strong>{stock.name}</strong>
                    <em>{displayStockCode(stock)}</em>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="news-detail-footer">
            <span>来源：{selectedArticle.source}</span>
            <span>采集于 {selectedArticle.fetchedAt}</span>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="news-page">
      <RefreshControlBar
        title="新闻页面刷新"
        status={newsRefreshStatus}
        lastRefreshAt={newsLastRefreshAt}
        intervalMinutes={newsRefreshInterval}
        onIntervalChange={updateNewsRefreshInterval}
        onRefresh={() => refreshNewsData("手动")}
      />
      <NewsFetchModeBar mode={newsFetchMode} onModeChange={updateNewsFetchMode} />
      <NewsFetchStatsBar
        stats={newsFetchStats}
        effectiveEventCount={newsFetchStats.validArticles}
        linkedStockCount={newsLinkedStockCount}
      />

      <div className="news-stats-bar">
        <div>
          <span>新闻总数</span>
          <strong>{stats.total}</strong>
        </div>
        <div>
          <span>未读</span>
          <strong>{stats.unread}</strong>
        </div>
        <div>
          <span>收藏</span>
          <strong>{stats.starred}</strong>
        </div>
        <div>
          <span>利好 / 利空</span>
          <strong>{stats.positive} / {stats.negative}</strong>
        </div>
        <div>
          <span>头条</span>
          <strong>{stats.headlines}</strong>
        </div>
        <div>
          <span>热门分类</span>
          <strong>{stats.topCategories.map(([cat, count]) => `${cat}(${count})`).join(" ")}</strong>
        </div>
      </div>

      <div className="news-filters">
        <label>
          <span>分类</span>
          <select value={newsFilters.category} onChange={(e) => patchFilter("category", e.target.value)}>
            {newsCategoryOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>情绪</span>
          <select value={newsFilters.sentiment} onChange={(e) => patchFilter("sentiment", e.target.value)}>
            {newsSentimentOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>重要性</span>
          <select value={newsFilters.importance} onChange={(e) => patchFilter("importance", e.target.value)}>
            {newsImportanceOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>来源</span>
          <select value={newsFilters.source} onChange={(e) => patchFilter("source", e.target.value)}>
            {sourceList.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>时间</span>
          <select value={newsFilters.dateRange} onChange={(e) => patchFilter("dateRange", e.target.value)}>
            {newsDateRangeOptions.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>搜索</span>
          <input
            value={newsFilters.query}
            onChange={(e) => patchFilter("query", e.target.value)}
            placeholder="搜索标题、内容、股票代码、行业、标签..."
          />
        </label>
        <button className="btn" onClick={() => { setNewsFilters(defaultNewsFilters); setCurrentPage(1); }}>
          重置筛选
        </button>
      </div>

      <div className="news-article-list">
        {pageArticles.length === 0 ? (
          <div className="news-empty">
            <p>暂无匹配的新闻文章，请调整筛选条件。</p>
          </div>
        ) : (
          pageArticles.map((article) => (
            <article
              className={`news-article-card ${article.importance === "头条" ? "headline" : ""} ${article.status === "unread" ? "unread" : ""}`}
              key={article.id}
              onClick={() => setSelectedArticle(article)}
            >
              <div className="news-article-main">
                <div className="news-article-head">
                  <h3>{article.title}</h3>
                  <div className="news-article-badges">
                    {article.importance === "头条" ? <span className="news-badge headline-badge">头条</span> : null}
                    <span className={`news-badge sentiment-${article.sentiment === "利好" ? "positive" : article.sentiment === "利空" ? "negative" : "neutral"}`}>
                      {article.sentiment}
                    </span>
                    <span className="news-badge category">{article.category}</span>
                    {article.status === "starred" ? <span className="news-badge starred">已收藏</span> : null}
                  </div>
                </div>
                <p className="news-article-summary">{article.summary}</p>
                <div className="news-article-footer">
                  <span className="news-source-icon">{article.sourceIcon}</span>
                  <span>{article.source}</span>
                  <span>{formatNewsDate(article.publishedAt)}</span>
                  <span>{article.readTime} 分钟</span>
                  {article.linkedStocks.length > 0 ? (
                    <span className="news-linked-stocks">
                      {article.linkedStocks.map((stock) => (
                        <button
                          className={`stock-inline-link ${knownStockCodes.has(stock.code) ? "" : "missing"}`}
                          type="button"
                          key={stock.code}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenStockInfo(stock);
                          }}
                        >
                          {stock.name}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </div>
                {article.tags.length > 0 ? (
                  <div className="news-article-tags">
                    {article.tags.slice(0, 4).map((tag) => (
                      <span className="news-tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      {totalPages > 1 ? (
        <div className="news-pagination">
          <button
            className="btn"
            disabled={safeCurrentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="news-page-info">第 {safeCurrentPage} / {totalPages} 页，共 {articles.length} 条</span>
          <button
            className="btn"
            disabled={safeCurrentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ValuationWorkspace({
  stocks,
  realDataStatus,
  isRealDataReady,
  onSyncRealData
}: {
  stocks: Stock[];
  realDataStatus: string;
  isRealDataReady: boolean;
  onSyncRealData: () => void;
}) {
  const [filters, setFilters] = useState<ValuationFilters>(defaultValuationFilters);
  const [valuationQuery, setValuationQuery] = useState("");
  const [valuationRecalcKey, setValuationRecalcKey] = useState(0);
  const [valuationCalculatedAt, setValuationCalculatedAt] = useState(() => new Date().toISOString());
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [valuationDetailCollapsed, setValuationDetailCollapsed] = useState(false);
  const [stockInfoTarget, setStockInfoTarget] = useState<StockInfoTarget | null>(null);
  const [valuationSort, setValuationSort] = useState<{ key: ValuationSortKey; direction: SortDirection }>({
    key: "safetyMargin",
    direction: "desc"
  });
  const industryOptions = useMemo(() => ["全部", ...Array.from(new Set(stocks.map((stock) => stock.industry1))).sort()], [stocks]);
  const ownershipOptions = useMemo(() => ["全部", ...Array.from(new Set(stocks.map((stock) => stock.property))).sort()], [stocks]);
  const missingRealValuationCount = useMemo(
    () => (isRealDataReady ? stocks.filter((stock) => !hasRequiredRealValuationData(stock)).length : stocks.length),
    [isRealDataReady, stocks]
  );
  const valuationInputReadyCount = isRealDataReady ? Math.max(stocks.length - missingRealValuationCount, 0) : 0;
  const rows = useMemo(() => (isRealDataReady ? buildValuationRows(stocks, filters) : []), [isRealDataReady, stocks, filters, valuationRecalcKey]);
  const normalizedValuationQuery = valuationQuery.trim().toLowerCase();
  const valuationCodeQuery = useMemo(() => normalizeStockCodeInput(valuationQuery), [valuationQuery]);
  const searchedRows = useMemo(() => {
    if (!normalizedValuationQuery) return rows;
    if (valuationCodeQuery.isCodeLike) {
      const exactRows = rows.filter((row) => stockMatchesCodeQuery(row.stock, valuationQuery));
      if (exactRows.length) return exactRows;
      const exactStock = resolveStockByCode(stocks, valuationQuery);
      return exactStock && isRealDataReady && hasRequiredRealValuationData(exactStock) ? [calculateValuation(exactStock, filters.style)] : [];
    }
    return rows.filter((row) => {
      const stock = row.stock;
      const searchableText = [
        stock.code,
        displayStockCode(stock),
        stock.name,
        stock.exchange,
        stock.board,
        stock.industry1,
        stock.industry2,
        stock.region,
        stock.property,
        row.state,
        row.model,
        row.action,
        row.positionHint
      ].join(" ").toLowerCase();
      return searchableText.includes(normalizedValuationQuery);
    });
  }, [rows, normalizedValuationQuery, valuationCodeQuery.isCodeLike, valuationQuery, stocks, filters.style, isRealDataReady]);
  const sortedRows = useMemo(() => {
    const directionMultiplier = valuationSort.direction === "asc" ? 1 : -1;
    return [...searchedRows].sort((a, b) => {
      const valueDelta = valuationSortValue(a, valuationSort.key) - valuationSortValue(b, valuationSort.key);
      if (valueDelta !== 0) return valueDelta * directionMultiplier;
      return b.safetyMargin - a.safetyMargin || a.stock.code.localeCompare(b.stock.code);
    });
  }, [searchedRows, valuationSort]);
  const summary = useMemo(() => summarizeValuationRows(searchedRows), [searchedRows]);
  const selected = sortedRows.find((row) => row.stock.code === selectedCode) ?? sortedRows[0] ?? null;
  const unmatchedCodeQuery = Boolean(normalizedValuationQuery && valuationCodeQuery.isCodeLike && !searchedRows.length);
  const firstMissingRealFields = useMemo(() => {
    if (!isRealDataReady) return "";
    const sample = stocks.find((stock) => !hasRequiredRealValuationData(stock));
    return sample ? missingRealValuationFields(sample).slice(0, 8).join("、") : "";
  }, [isRealDataReady, stocks]);
  const valuationGateMessage = !isRealDataReady
    ? "价值核算已关闭本地样本兜底。请先点击“接入全市场股票”，系统只使用真实行情；缺少真实财报字段时不会生成核算价值。"
    : valuationInputReadyCount === 0
      ? `已接入 ${stocks.length} 只真实行情，但腾讯行情接口不提供完整财报、现金流和资产负债拆分，当前无法按严苛口径核算。缺少字段示例：${firstMissingRealFields || "真实财报字段"}。`
      : "";

  const patchFilters = (patch: Partial<ValuationFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSelectedCode(null);
  };
  const resetValuationControls = () => {
    setFilters(defaultValuationFilters);
    setValuationQuery("");
    setSelectedCode(null);
  };
  const recalculateValuation = () => {
    setValuationRecalcKey((current) => current + 1);
    setValuationCalculatedAt(new Date().toISOString());
    setSelectedCode(null);
  };

  const formatValue = (value: number, suffix = "") => `${round(value, 2)}${suffix}`;
  const formatMarketCap = (value: number) => `${round(value, 2)}亿`;
  const openStockInfo = (stock: StockReference) => setStockInfoTarget(resolveStockInfoTarget(stock, stocks));
  const updateValuationQuery = (value: string) => {
    setValuationQuery(value);
    setSelectedCode(null);
  };
  const toggleValuationSort = (key: ValuationSortKey) => {
    setValuationSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
    }));
    setSelectedCode(null);
  };
  const sortDirectionLabel = valuationSort.direction === "desc" ? "降序" : "升序";

  return (
    <section className="valuation-workspace">
      <div className="valuation-title-row">
        <div>
          <h2>股票价值核算</h2>
          <p>按最严苛口径核算：多模型低位锚定、现金流约束、治理扣减、财务风险扣减，不用成长溢价抬高结果。</p>
        </div>
      </div>

      <div className="valuation-data-bar">
        <div>
          <span>
            {realDataStatus} · 可核算 {valuationInputReadyCount}/{stocks.length} · 缺少真实财报 {missingRealValuationCount} · 最近核算 {formatDateTime(valuationCalculatedAt)}
          </span>
        </div>
        <div className="valuation-data-actions">
          <button className="btn" type="button" onClick={recalculateValuation} disabled={!isRealDataReady}>
            <RefreshCcw size={15} />
            重新核算
          </button>
          <button className="btn primary" type="button" onClick={onSyncRealData}>
            <RefreshCcw size={15} />
            接入全市场股票
          </button>
        </div>
      </div>

      <div className="valuation-filters">
        <label className="valuation-search-label">
          <span>检索</span>
          <div className="valuation-search-box">
            <Search size={14} />
            <input
              type="search"
              value={valuationQuery}
              onChange={(event) => updateValuationQuery(event.target.value)}
              placeholder="股票名称 / 代码 / 行业 / 地区"
            />
            {valuationQuery ? (
              <button className="valuation-search-clear" type="button" onClick={() => updateValuationQuery("")}>
                清空
              </button>
            ) : null}
          </div>
          {unmatchedCodeQuery ? (
            <em className="valuation-query-warning">
              已按完整代码精确查询 {valuationCodeQuery.normalized}，当前股票池未收录。可能是已退市/历史代码，系统不会用相似代码匹配，避免错配到其他股票。
            </em>
          ) : null}
        </label>
        <label>
          <span>板块</span>
          <select value={filters.board} onChange={(event) => patchFilters({ board: event.target.value as ValuationFilters["board"] })}>
            {valuationBoardOptions.map((board) => (
              <option key={board} value={board}>{board}</option>
            ))}
          </select>
        </label>
        <label>
          <span>行业</span>
          <select value={filters.industry} onChange={(event) => patchFilters({ industry: event.target.value })}>
            {industryOptions.map((industry) => (
              <option key={industry} value={industry}>{industry}</option>
            ))}
          </select>
        </label>
        <label>
          <span>企业状态</span>
          <select value={filters.state} onChange={(event) => patchFilters({ state: event.target.value as ValuationFilters["state"] })}>
            {enterpriseStateOptions.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </label>
        <label>
          <span>企业属性</span>
          <select value={filters.ownership} onChange={(event) => patchFilters({ ownership: event.target.value })}>
            {ownershipOptions.map((ownership) => (
              <option key={ownership} value={ownership}>{ownership}</option>
            ))}
          </select>
        </label>
        <label>
          <span>核算方式</span>
          <select value={filters.style} onChange={(event) => patchFilters({ style: event.target.value as ValuationFilters["style"] })}>
            {valuationStyleOptions.map((style) => (
              <option key={style} value={style}>{style}</option>
            ))}
          </select>
        </label>
        <label>
          <span>最低安全边际</span>
          <input type="number" value={filters.minSafetyMargin} onChange={(event) => patchFilters({ minSafetyMargin: Number(event.target.value) })} />
        </label>
        <label>
          <span>最低治理分</span>
          <input type="number" min={0} max={100} value={filters.minGovernanceScore} onChange={(event) => patchFilters({ minGovernanceScore: Number(event.target.value) })} />
        </label>
        <button className="btn" onClick={resetValuationControls}>重置</button>
      </div>

      <div className="valuation-summary">
        <div>
          <span>低估数量</span>
          <strong>{summary.undervalued}</strong>
        </div>
        <div>
          <span>高估数量</span>
          <strong>{summary.overvalued}</strong>
        </div>
        <div>
          <span>平均安全边际</span>
          <strong>{formatValue(summary.avgSafetyMargin, "%")}</strong>
        </div>
        <div>
          <span>平均治理分</span>
          <strong>{summary.avgGovernance}</strong>
        </div>
        <div>
          <span>平均质量分</span>
          <strong>{summary.avgQuality}</strong>
        </div>
        <div>
          <span>集中行业</span>
          <strong>{summary.topIndustry}</strong>
        </div>
      </div>

      {valuationGateMessage ? (
        <div className="valuation-real-data-warning">
          <strong>{isRealDataReady ? "真实财务数据不足，无法核算" : "未接入真实数据"}</strong>
          <p>{valuationGateMessage}</p>
        </div>
      ) : null}

      <div className={`valuation-layout ${valuationDetailCollapsed ? "detail-collapsed" : ""}`}>
        <section className="valuation-panel valuation-table-panel">
          <div className="valuation-panel-title">
            <h3>价值核算排序</h3>
            <span>
              {normalizedValuationQuery ? `检索 ${searchedRows.length}/${rows.length}，` : `显示 ${sortedRows.length} 只，`}
              按{valuationSortLabels[valuationSort.key]}{sortDirectionLabel}排列
            </span>
          </div>
          <table className="data-table valuation-table">
            <thead>
              <tr>
                <th>股票</th>
                <th>行业</th>
                {(["currentPrice", "fairValue", "marketCap", "fairMarketCap", "safetyMargin", "governanceScore", "action"] as ValuationSortKey[]).map((key) => (
                  <th key={key}>
                    <button className={`valuation-sort-btn ${valuationSort.key === key ? "active" : ""}`} type="button" onClick={() => toggleValuationSort(key)}>
                      {valuationSortLabels[key]}
                      <span>{valuationSort.key === key ? (valuationSort.direction === "desc" ? "↓" : "↑") : "↕"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.stock.code} className={selected?.stock.code === row.stock.code ? "active" : ""} onClick={() => setSelectedCode(row.stock.code)}>
                  <td>
                    <button
                      className="stock-name-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openStockInfo(row.stock);
                      }}
                    >
                      <strong>{row.stock.name}</strong>
                      <span>{displayStockCode(row.stock)}</span>
                    </button>
                  </td>
                  <td>{row.stock.industry1}</td>
                  <td>{formatValue(row.currentPrice)}</td>
                  <td>{formatValue(row.fairValue)}</td>
                  <td>{formatMarketCap(row.marketCap)}</td>
                  <td>{formatMarketCap(valuationFairMarketCap(row))}</td>
                  <td className={row.safetyMargin >= 0 ? "positive" : "negative"}>{formatValue(row.safetyMargin, "%")}</td>
                  <td>{row.governanceScore}</td>
                  <td>{row.positionHint}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!searchedRows.length ? (
            <EmptyState>
              {valuationGateMessage
                ? "当前不会使用本地样本或推导财务数据生成核算结果。"
                : rows.length
                  ? "当前检索条件下没有匹配股票，请调整关键词。"
                  : "当前筛选条件下没有符合要求的股票，请降低安全边际或治理分限制。"}
            </EmptyState>
          ) : null}
        </section>

        <section className={`valuation-panel valuation-detail-panel ${valuationDetailCollapsed ? "collapsed" : ""}`}>
          {selected ? (
            valuationDetailCollapsed ? (
              <div className="valuation-side-rail">
                <button className="valuation-side-toggle" type="button" onClick={() => setValuationDetailCollapsed(false)} aria-label="展开价值核算详情">
                  <ChevronDown size={16} />
                  <span>展开详情</span>
                </button>
                <div className="valuation-side-summary">
                  <strong>{selected.stock.name}</strong>
                  <span>{displayStockCode(selected.stock)}</span>
                  <em>{selected.verdict}</em>
                  <b className={selected.safetyMargin >= 0 ? "positive" : "negative"}>{formatValue(selected.safetyMargin, "%")}</b>
                </div>
              </div>
            ) : (
              <>
              <div className="valuation-detail-head">
                <div>
                  <h3>
                    <button className="stock-title-button" type="button" onClick={() => openStockInfo(selected.stock)}>
                      {selected.stock.name}
                      <span>{displayStockCode(selected.stock)}</span>
                    </button>
                  </h3>
                  <p>{selected.stock.industry1} / {selected.stock.industry2} / {selected.stock.property}</p>
                </div>
                <div className="valuation-detail-actions">
                  <span className={`valuation-verdict ${selected.safetyMargin >= 15 ? "good" : selected.safetyMargin < -10 ? "bad" : ""}`}>{selected.verdict}</span>
                  <button className="valuation-collapse-button" type="button" onClick={() => setValuationDetailCollapsed(true)}>
                    收起
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>

              <div className="valuation-price-grid">
                <div>
                  <span>现价</span>
                  <strong>{formatValue(selected.currentPrice)}</strong>
                </div>
                <div>
                  <span>核算价值</span>
                  <strong>{formatValue(selected.fairValue)}</strong>
                </div>
                <div>
                  <span>当前市值</span>
                  <strong>{formatMarketCap(selected.marketCap)}</strong>
                </div>
                <div>
                  <span>核算市值</span>
                  <strong>{formatMarketCap(valuationFairMarketCap(selected))}</strong>
                </div>
                <div>
                  <span>熊市估值</span>
                  <strong>{formatValue(selected.bearValue)}</strong>
                </div>
                <div>
                  <span>牛市估值</span>
                  <strong>{formatValue(selected.bullValue)}</strong>
                </div>
              </div>
              <p className="valuation-market-note">核算市值 = 当前市值 ÷ 现价 × 核算价值，沿用当前总股本口径折算，单位为亿元。</p>

              <div className="valuation-action-card">
                <div>
                  <span>操作建议</span>
                  <strong>{selected.action}</strong>
                </div>
                <div>
                  <span>单股仓位</span>
                  <strong>{selected.positionHint}</strong>
                </div>
              </div>

              <div className="valuation-score-grid">
                {[
                  ["行业适配", selected.industryFitScore],
                  ["企业质量", selected.qualityScore],
                  ["成长能力", selected.growthScore],
                  ["偿债能力", selected.solvencyScore],
                  ["治理质量", selected.governanceScore]
                ].map(([label, value]) => (
                  <div className="valuation-score" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <i style={{ width: `${Math.max(4, Math.min(100, Number(value)))}%` }} />
                  </div>
                ))}
              </div>

              <div className="valuation-breakdown">
                <h4>分模型核算</h4>
                <div className="valuation-formula-list">
                  {selected.components.formulaRows.map((row) => (
                    <div className="valuation-formula-row" key={row.name}>
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.formula}</span>
                        <em>{row.substitution}</em>
                      </div>
                      <b>{formatValue(row.value)}</b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="valuation-profile">
                <h4>差异化口径</h4>
                <p>{selected.profile.industry}：{selected.model}，行业倍数先压低，再取最低两项模型值做锚定；风险缓冲 {selected.profile.riskBuffer}%。</p>
                <p>公司治理折扣 {selected.governanceModifier}x，企业状态折扣 {selected.statusModifier}x，财务扣减 {selected.financialModifier}x，综合风险折扣 {selected.riskDiscount}x。</p>
              </div>

              <div className="valuation-lists">
                <div>
                  <h4>核心驱动</h4>
                  <ul>
                    {selected.drivers.map((driver) => (
                      <li key={driver}>{driver}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>风险提示</h4>
                  {selected.warnings.length ? (
                    <ul>
                      {selected.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>暂无显著治理或财务折价项。</p>
                  )}
                </div>
              </div>
              </>
            )
          ) : (
            <EmptyState>请选择一只股票查看价值核算拆解。</EmptyState>
          )}
        </section>
      </div>
      {stockInfoTarget ? <StockInfoModal target={stockInfoTarget} onClose={() => setStockInfoTarget(null)} /> : null}
    </section>
  );
}

function SettingsWorkspace({
  settings,
  status,
  summary,
  stockCount,
  newsSettings,
  newsStatus,
  newsAnalysisSettings,
  newsAnalysisStatus,
  patchSettings,
  toggleModule,
  patchNewsSource,
  toggleNewsSource,
  onAddNewsSource,
  onRemoveNewsSource,
  onSaveNewsSources,
  onTestNewsSource,
  patchNewsAnalysis,
  toggleNewsAnalysisTask,
  onSaveNewsAnalysis,
  onTestNewsAnalysis,
  onSave,
  onTest,
  onSyncOpenData
}: {
  settings: InfoSourceSettings;
  status: string;
  summary: OpenSourceDataSummary;
  stockCount: number;
  newsSettings: NewsSourceSettings;
  newsStatus: string;
  newsAnalysisSettings: NewsAnalysisModelSettings;
  newsAnalysisStatus: string;
  patchSettings: (patch: Partial<InfoSourceSettings>) => void;
  toggleModule: (key: SourceModuleKey) => void;
  patchNewsSource: (id: string, patch: Partial<NewsSourceEndpoint>) => void;
  toggleNewsSource: (id: string) => void;
  onAddNewsSource: () => void;
  onRemoveNewsSource: (id: string) => void;
  onSaveNewsSources: () => void;
  onTestNewsSource: (id: string) => void;
  patchNewsAnalysis: (patch: Partial<NewsAnalysisModelSettings>) => void;
  toggleNewsAnalysisTask: (key: NewsAnalysisTaskKey) => void;
  onSaveNewsAnalysis: () => void;
  onTestNewsAnalysis: () => void;
  onSave: () => void;
  onTest: () => void;
  onSyncOpenData: () => void;
}) {
  const enabledCount = enabledSourceModules(settings).length;
  const enabledNewsCount = enabledNewsSources(newsSettings).length;
  const enabledAnalysisTaskCount = enabledNewsAnalysisTasks(newsAnalysisSettings).length;
  return (
    <section className="settings-workspace">
      <div className="settings-title-row">
        <div>
          <h2>设置</h2>
          <p>信息来源接口用于接入行情、财务、公告和资讯数据源。</p>
        </div>
        <div className="settings-actions">
          <button className="btn" onClick={onTest}>
            测试连接
          </button>
          <button className="btn" onClick={onSyncOpenData}>
            同步开源数据
          </button>
          <button className="btn primary" onClick={onSave}>
            <Save size={15} />
            保存设置
          </button>
        </div>
      </div>

      <div className="settings-panel">
        <div className="settings-panel-title">
          <h3>信息来源接口</h3>
          <span className={status.includes("失败") ? "settings-status danger" : "settings-status"}>{status}</span>
        </div>

        <div className="settings-form-grid">
          <label>
            <span>接口来源</span>
            <select
              value={settings.provider}
              onChange={(event) => {
                const provider = event.target.value;
                patchSettings({ provider, baseUrl: defaultBaseUrlForProvider(provider) });
              }}
            >
              {infoSourceProviderOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>接口地址</span>
            <input value={settings.baseUrl} onChange={(event) => patchSettings({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
          </label>
          <label>
            <span>接口 Token</span>
            <input
              type="password"
              value={settings.apiToken}
              onChange={(event) => patchSettings({ apiToken: event.target.value })}
              placeholder="真实接口需要时填写 Token"
            />
          </label>
          <label>
            <span>超时时间（秒）</span>
            <input
              type="number"
              min={3}
              max={120}
              value={settings.timeoutSeconds}
              onChange={(event) => patchSettings({ timeoutSeconds: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>刷新周期（分钟）</span>
            <input
              type="number"
              min={1}
              max={240}
              value={settings.refreshInterval}
              onChange={(event) => patchSettings({ refreshInterval: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="settings-module-list">
          {sourceModuleLabels.map((item) => (
            <label className="settings-module-row" key={item.key}>
              <input type="checkbox" checked={settings.modules[item.key]} onChange={() => toggleModule(item.key)} />
              <span>
                <strong>{item.label}</strong>
                <em>{item.description}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-panel news-source-panel">
        <div className="settings-panel-title">
          <div>
            <h3>新闻源接口管理</h3>
            <p>用于舆情选股的新闻事件输入源，可按来源独立启停、测试和保存。</p>
          </div>
          <div className="settings-actions">
            <span className={newsStatus.includes("失败") ? "settings-status danger" : "settings-status"}>{newsStatus}</span>
            <button className="btn" onClick={onAddNewsSource}>
              <Plus size={14} />
              新增新闻源
            </button>
            <button className="btn primary" onClick={onSaveNewsSources}>
              <Save size={15} />
              保存新闻源
            </button>
          </div>
        </div>

        <div className="news-source-list">
          {newsSettings.sources.map((source) => (
            <section className="news-source-card" key={source.id}>
              <div className="news-source-card-title">
                <label className="settings-module-row compact">
                  <input type="checkbox" checked={source.enabled} onChange={() => toggleNewsSource(source.id)} />
                  <span>
                    <strong>{source.name}</strong>
                    <em>{source.enabled ? "已启用" : "已停用"} · {source.provider}</em>
                  </span>
                </label>
                <div className="news-source-actions">
                  <button className="btn" onClick={() => onTestNewsSource(source.id)}>
                    测试接口
                  </button>
                  <button className="btn danger" onClick={() => onRemoveNewsSource(source.id)} disabled={newsSettings.sources.length <= 1}>
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </div>

              <div className="news-source-grid">
                <label>
                  <span>新闻源名称</span>
                  <input value={source.name} onChange={(event) => patchNewsSource(source.id, { name: event.target.value })} />
                </label>
                <label>
                  <span>来源类型</span>
                  <select
                    value={source.provider}
                    onChange={(event) => {
                      const provider = event.target.value as NewsSourceProvider;
                      patchNewsSource(source.id, { provider, baseUrl: defaultBaseUrlForNewsProvider(provider) });
                    }}
                  >
                    {newsSourceProviderOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  <span>接口地址</span>
                  <input value={source.baseUrl} onChange={(event) => patchNewsSource(source.id, { baseUrl: event.target.value })} />
                </label>
                <label>
                  <span>API Token</span>
                  <input type="password" value={source.apiToken} onChange={(event) => patchNewsSource(source.id, { apiToken: event.target.value })} />
                </label>
                <label>
                  <span>语言</span>
                  <select value={source.language} onChange={(event) => patchNewsSource(source.id, { language: event.target.value as NewsSourceEndpoint["language"] })}>
                    {newsLanguageOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>刷新周期（分钟）</span>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={source.refreshInterval}
                    onChange={(event) => patchNewsSource(source.id, { refreshInterval: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>单次拉取</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={source.maxItems}
                    onChange={(event) => patchNewsSource(source.id, { maxItems: Number(event.target.value) })}
                  />
                </label>
                <label className="wide">
                  <span>关键词 / 查询语句</span>
                  <input value={source.query} onChange={(event) => patchNewsSource(source.id, { query: event.target.value })} />
                </label>
              </div>

              <div className="news-source-meta">
                <span>最近测试：{formatDateTime(source.lastTestAt)}</span>
                <span>{source.lastStatus ?? "尚未测试"}</span>
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="settings-panel news-analysis-model-panel">
        <div className="settings-panel-title">
          <div>
            <h3>新闻信息分析模型接口</h3>
            <p>用于对新闻正文进行情绪判断、事件抽取、关联股票识别和风险摘要生成，和新闻源输入接口分开配置。</p>
          </div>
          <div className="settings-actions">
            <span className={newsAnalysisStatus.includes("失败") ? "settings-status danger" : "settings-status"}>{newsAnalysisStatus}</span>
            <button className="btn" onClick={onTestNewsAnalysis}>
              测试模型
            </button>
            <button className="btn primary" onClick={onSaveNewsAnalysis}>
              <Save size={15} />
              保存模型
            </button>
          </div>
        </div>

        <div className="settings-form-grid news-analysis-grid">
          <label className="settings-module-row compact switch-row">
            <input type="checkbox" checked={newsAnalysisSettings.enabled} onChange={(event) => patchNewsAnalysis({ enabled: event.target.checked })} />
            <span>
              <strong>启用模型分析</strong>
              <em>{newsAnalysisSettings.enabled ? "新闻进入舆情分析时调用该模型" : "停用后仅使用本地规则，不加载样本标签"}</em>
            </span>
          </label>
          <label>
            <span>模型来源</span>
            <select
              value={newsAnalysisSettings.provider}
              onChange={(event) => {
                const provider = event.target.value as NewsAnalysisModelProvider;
                patchNewsAnalysis({
                  provider,
                  baseUrl: defaultBaseUrlForNewsAnalysisProvider(provider),
                  model: defaultModelForNewsAnalysisProvider(provider),
                  apiKey: provider === "本地规则模型" ? "" : newsAnalysisSettings.apiKey
                });
              }}
            >
              {newsAnalysisModelProviderOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>分析深度</span>
            <select value={newsAnalysisSettings.depth} onChange={(event) => patchNewsAnalysis({ depth: event.target.value as NewsAnalysisModelSettings["depth"] })}>
              {newsAnalysisDepthOptions.map((depth) => (
                <option key={depth} value={depth}>
                  {depth}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>模型接口地址</span>
            <input value={newsAnalysisSettings.baseUrl} onChange={(event) => patchNewsAnalysis({ baseUrl: event.target.value })} />
          </label>
          <label>
            <span>模型名称</span>
            <input value={newsAnalysisSettings.model} onChange={(event) => patchNewsAnalysis({ model: event.target.value })} />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={newsAnalysisSettings.apiKey}
              onChange={(event) => patchNewsAnalysis({ apiKey: event.target.value })}
              placeholder="本地规则模型可留空"
            />
          </label>
          <label>
            <span>超时时间（秒）</span>
            <input
              type="number"
              min={3}
              max={180}
              value={newsAnalysisSettings.timeoutSeconds}
              onChange={(event) => patchNewsAnalysis({ timeoutSeconds: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>最大输出 Token</span>
            <input
              type="number"
              min={256}
              max={8000}
              value={newsAnalysisSettings.maxTokens}
              onChange={(event) => patchNewsAnalysis({ maxTokens: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>温度参数</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={newsAnalysisSettings.temperature}
              onChange={(event) => patchNewsAnalysis({ temperature: Number(event.target.value) })}
            />
          </label>
          <label className="wide prompt-field">
            <span>系统提示词</span>
            <textarea value={newsAnalysisSettings.systemPrompt} onChange={(event) => patchNewsAnalysis({ systemPrompt: event.target.value })} rows={4} />
          </label>
        </div>

        <div className="settings-module-list news-analysis-task-list">
          {newsAnalysisTaskLabels.map((item) => (
            <label className="settings-module-row" key={item.key}>
              <input type="checkbox" checked={newsAnalysisSettings.tasks[item.key]} onChange={() => toggleNewsAnalysisTask(item.key)} />
              <span>
                <strong>{item.label}</strong>
                <em>{item.description}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-summary">
        <div>
          <span>已启用模块</span>
          <strong>{enabledCount} / {sourceModuleLabels.length}</strong>
        </div>
        <div>
          <span>最近测试</span>
          <strong>{formatDateTime(settings.lastTestAt)}</strong>
        </div>
        <div>
          <span>最近保存</span>
          <strong>{formatDateTime(settings.lastSavedAt)}</strong>
        </div>
        <div>
          <span>股票数据</span>
          <strong>{stockCount} 只</strong>
        </div>
        <div>
          <span>开源同步</span>
          <strong>{summary.sourceRows ? `${summary.matchedRows} / ${summary.sourceRows}` : "--"}</strong>
        </div>
        <div>
          <span>最近同步</span>
          <strong>{formatDateTime(summary.lastSyncAt)}</strong>
        </div>
        <div>
          <span>新闻源</span>
          <strong>{enabledNewsCount} / {newsSettings.sources.length}</strong>
        </div>
        <div>
          <span>新闻源保存</span>
          <strong>{formatDateTime(newsSettings.lastSavedAt)}</strong>
        </div>
        <div>
          <span>分析模型</span>
          <strong>{newsAnalysisSettings.enabled ? newsAnalysisSettings.model : "已停用"}</strong>
        </div>
        <div>
          <span>分析任务</span>
          <strong>{enabledAnalysisTaskCount} / {newsAnalysisTaskLabels.length}</strong>
        </div>
        <div>
          <span>模型保存</span>
          <strong>{formatDateTime(newsAnalysisSettings.lastSavedAt)}</strong>
        </div>
      </div>
    </section>
  );
}

function TradeWorkspace({
  strategy,
  rows,
  tradeConnection,
  tradeConnectionStatus,
  paperTradeState,
  patchTradeConnection,
  bindTradingInterface,
  exportTradePlan,
  submitPaperTradePlan,
  onOpenStockInfo
}: {
  strategy: StrategyConfig;
  rows: SelectionRow[];
  tradeConnection: TradeConnectionSettings;
  tradeConnectionStatus: string;
  paperTradeState: PaperTradeState;
  patchTradeConnection: (patch: Partial<TradeConnectionSettings>) => void;
  bindTradingInterface: () => boolean;
  exportTradePlan: (rows: SelectionRow[], mode: ExecutionMode, label?: string) => TradePlan;
  submitPaperTradePlan: (rows: SelectionRow[]) => TradePlan | null;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const [tradeMode, setTradeMode] = useState<"strategy" | "condition">("strategy");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("manual");
  const [tradeTab, setTradeTab] = useState<"holding" | "rebalance" | "log" | "history">("holding");
  const tradeInterfaceBound = tradeConnection.bound;
  const holdings = rows.slice(0, Math.max(strategy.trading.maxHoldings, 1));
  const accountAsset = 1000000;
  const strategyAsset = 500000;
  const outsideCash = accountAsset - strategyAsset;
  const holdingValue = round(strategyAsset * 0.64, 2);
  const strategyCash = round(strategyAsset - holdingValue, 2);
  const dailyReturn = holdings.length ? round(holdings.reduce((sum, row) => sum + (row.stock.metrics.pctChange ?? 0), 0) / holdings.length, 2) : 0;
  const nextRebalanceDate = "2026-05-26";
  const tradeTime = "14:55";
  const formatMoney = (value: number) =>
    value.toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  const planRows = holdings.slice(0, 8).map((row) => {
    const price = row.stock.metrics.price ?? 1;
    const shares = Math.max(100, Math.floor(strategyAsset / Math.max(holdings.length, 1) / price / 100) * 100);
    return {
      ...row,
      shares,
      amount: round(price * shares, 2)
    };
  });
  const historyRows = planRows.slice(0, 10).map((row, index) => ({
    ...row,
    time: `2026-05-2${index % 4} 11:${String(8 + index).padStart(2, "0")}:27`
  }));
  const logRows = planRows.slice(0, 8).map((row, index) => ({
    time: `2026-05-25 11:${String(8 + index).padStart(2, "0")}:26`,
    type: index < 2 ? "提醒" : "买入",
    message:
      index < 2
        ? `开始执行买入指令，买入${row.stock.name}${row.shares}股。`
        : `订单 ${1531451296800 + index} 已全部成交：买入${row.shares}股${row.stock.name}，成交均价：${row.stock.metrics.price?.toFixed(3)}。`
  }));
  const paperFills = paperTradeState.fills.slice(0, 8);
  const conditionRows = holdings.slice(0, 5).map((row, index) => {
    const price = row.stock.metrics.price ?? 0;
    const direction = index % 2 === 0 ? "买入" : "卖出";
    const triggerOperator = direction === "买入" ? "<=" : ">=";
    const triggerPrice = direction === "买入" ? price * 0.98 : price * 1.04;
    const shares = Math.max(100, Math.floor((80000 / Math.max(price, 1)) / 100) * 100);
    return {
      id: `condition-${row.stock.code}`,
      stock: row.stock,
      name: `${row.stock.name}${direction}条件单`,
      direction,
      triggerOperator,
      triggerPrice: round(triggerPrice, 2),
      orderPrice: direction === "买入" ? "卖五价+0.05" : "跌停价",
      shares,
      amount: round(price * shares, 2),
      status: index === 0 ? "运行中" : index === 1 ? "已触发" : "暂停",
      validUntil: "2026-06-25"
    };
  });
  const tabs = [
    { key: "holding", label: "持仓" },
    { key: "rebalance", label: "调仓" },
    { key: "log", label: "日志" },
    { key: "history", label: "历史" }
  ] as const;

  return (
    <section className="trade-workspace live-trade">
      <div className="live-title-row">
        <div>
          <h2>
            {strategy.name}的实盘 <span className="live-notice">交易设置</span>
          </h2>
          <p>
            <span className="live-dot" />
            连接正常，资金账号：*****0624
          </p>
        </div>
        <a>了解实盘管家</a>
      </div>

      <div className="instruction-mode-panel">
        <div>
          <strong>交易指令模式</strong>
          <p>
            {executionMode === "manual"
              ? "手动模式：系统生成交易指令，用户自行在股票软件内填写并下单。"
              : tradeInterfaceBound
                ? "自动模式：交易接口已绑定，系统可按确认后的交易计划自动提交。"
                : "自动模式：请先绑定交易接口，绑定后系统可按交易计划自动提交。"}
          </p>
        </div>
        <div className="instruction-mode-tabs">
          <button className={executionMode === "manual" ? "active" : ""} onClick={() => setExecutionMode("manual")}>
            手动模式
          </button>
          <button className={executionMode === "auto" ? "active" : ""} onClick={() => setExecutionMode("auto")}>
            自动模式
          </button>
        </div>
        {executionMode === "auto" ? (
          <button className="btn primary" onClick={bindTradingInterface}>
            {tradeInterfaceBound ? "交易接口已绑定" : "绑定交易接口"}
          </button>
        ) : (
          <button className="btn" onClick={() => exportTradePlan(rows, "manual", "指令模板")}>导出指令模板</button>
        )}
      </div>

      {executionMode === "auto" ? (
        <div className="trade-connection-panel">
          <label>
            <span>交易接口</span>
            <input value={tradeConnection.provider} onChange={(event) => patchTradeConnection({ provider: event.target.value })} />
          </label>
          <label>
            <span>接口地址</span>
            <input value={tradeConnection.endpoint} onChange={(event) => patchTradeConnection({ endpoint: event.target.value })} />
          </label>
          <label>
            <span>资金账号</span>
            <input value={tradeConnection.accountId} onChange={(event) => patchTradeConnection({ accountId: event.target.value })} />
          </label>
          <label>
            <span>接口 Token</span>
            <input type="password" value={tradeConnection.token} onChange={(event) => patchTradeConnection({ token: event.target.value })} placeholder="纸面交易可为空" />
          </label>
          <p className={tradeConnectionStatus.includes("失败") || tradeConnectionStatus.includes("必须") ? "trade-connection-status danger" : "trade-connection-status"}>
            {tradeConnectionStatus}
          </p>
        </div>
      ) : null}

      <div className="trade-mode-tabs">
        <button className={tradeMode === "strategy" ? "active" : ""} onClick={() => setTradeMode("strategy")}>
          策略交易
        </button>
        <button className={tradeMode === "condition" ? "active" : ""} onClick={() => setTradeMode("condition")}>
          条件单交易
        </button>
      </div>

      {tradeMode === "strategy" ? (
        <>
          <div className="live-tabs">
            {tabs.map((item) => (
              <button className={tradeTab === item.key ? "active" : ""} key={item.key} onClick={() => setTradeTab(item.key)}>
                {item.label}
                {item.key === "rebalance" && planRows.length ? <em /> : null}
              </button>
            ))}
          </div>

          {tradeTab === "holding" ? (
        <div className="live-panel">
          <div className="live-actions">
            <button className="btn primary">
              <RefreshCcw size={14} />
              资产同步
            </button>
          </div>
          <h3>持仓总结</h3>
          <div className="live-summary-row">
            <div>
              <span>当前净值</span>
              <strong>1.0000</strong>
            </div>
            <div>
              <span>总资产</span>
              <strong>{formatMoney(accountAsset)}</strong>
            </div>
            <div>
              <span>持仓市值</span>
              <strong>{formatMoney(holdingValue)}</strong>
            </div>
            <div>
              <span>可用现金</span>
              <strong>{formatMoney(strategyCash + outsideCash)}</strong>
            </div>
          </div>

          <div className="live-section-title">
            <h3>持仓策略</h3>
            <button className="btn primary">新增策略</button>
          </div>
          <table className="live-table">
            <thead>
              <tr>
                <th>策略</th>
                <th>持仓市值</th>
                <th>可用现金</th>
                <th>日收益率 ↓</th>
                <th>下次调仓</th>
                <th>调仓时点</th>
                <th>调仓次数</th>
                <th>指令模式</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a>{strategy.name}</a>
                </td>
                <td>{formatMoney(holdingValue)}</td>
                <td>{formatMoney(strategyCash)}</td>
                <td className={dailyReturn >= 0 ? "positive" : "negative"}>{pct(dailyReturn)}</td>
                <td>{nextRebalanceDate}</td>
                <td>{tradeTime}</td>
                <td>0次</td>
                <td>
                  {executionMode === "manual" ? (
                    <>
                      <button className="text-link">手动确认</button>
                      <button className="text-link" onClick={() => exportTradePlan(rows, "manual", "交易指令")}>生成指令</button>
                    </>
                  ) : (
                    <>
                      <button className="text-link">{tradeInterfaceBound ? "自动执行" : "待绑定"}</button>
                      <button className="text-link" onClick={bindTradingInterface}>
                        绑定接口
                      </button>
                    </>
                  )}
                </td>
                <td className="live-ops">S × ×</td>
              </tr>
              <tr>
                <td>策略外资产</td>
                <td>0.00</td>
                <td>{formatMoney(outsideCash)}</td>
                <td>0.00%</td>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
              <tr>
                <td>总计</td>
                <td>{formatMoney(holdingValue)}</td>
                <td>{formatMoney(strategyCash + outsideCash)}</td>
                <td className={dailyReturn >= 0 ? "positive" : "negative"}>{pct(dailyReturn)}</td>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
          <p className="live-note">注：持仓市值和今日涨跌根据本地策略信号模拟生成，页面结构对应果仁实盘管家。</p>

          <div className="live-section-title">
            <h3>持仓详情</h3>
            <label className="inline-select slim">
              <span>选择策略：</span>
              <select>
                <option>全部</option>
                <option>{strategy.name}</option>
              </select>
            </label>
            <div className="live-title-links">
              <a>资产分配</a>
              <a>导出</a>
            </div>
          </div>
          <table className="live-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>标的名称</th>
                <th>行业</th>
                <th>总持仓股数</th>
                <th>总持仓市值</th>
                <th>最新价</th>
                <th>日涨跌幅</th>
                <th>策略外资产</th>
              </tr>
            </thead>
            <tbody>
              {holdings.slice(0, 8).map((row, index) => {
                const shares = planRows[index]?.shares ?? 0;
                const price = row.stock.metrics.price ?? 0;
                return (
                  <tr key={row.stock.code}>
                    <td>{index + 1}</td>
                    <td>
                      <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} />
                    </td>
                    <td>{row.stock.industry1}</td>
                    <td>{shares}</td>
                    <td>{formatMoney(price * shares)}</td>
                    <td>{price.toFixed(2)}</td>
                    <td className={(row.stock.metrics.pctChange ?? 0) >= 0 ? "positive" : "negative"}>{pct(row.stock.metrics.pctChange ?? 0)}</td>
                    <td>0.00</td>
                  </tr>
                );
              })}
              <tr>
                <td>{holdings.length + 1}</td>
                <td>现金</td>
                <td />
                <td>{formatMoney(strategyCash + outsideCash)}</td>
                <td>{formatMoney(strategyCash + outsideCash)}</td>
                <td>1.00</td>
                <td>0.00%</td>
                <td>{formatMoney(outsideCash)}</td>
              </tr>
            </tbody>
          </table>
        </div>
          ) : null}

          {tradeTab === "rebalance" ? (
        <div className="live-panel">
          <div className="rebalance-toolbar">
            <div>
              <h3>交易指令（2026-05-25）</h3>
              <button className="btn primary" onClick={() => (executionMode === "manual" ? exportTradePlan(rows, "manual", "交易指令") : submitPaperTradePlan(rows))}>
                {executionMode === "manual" ? "生成手动交易指令" : "确认自动交易计划"}
              </button>
              {executionMode === "manual" ? <button className="btn primary" onClick={() => exportTradePlan(rows, "manual", "交易指令")}>导出交易指令</button> : null}
              {executionMode === "auto" ? (
                <button className="btn primary" onClick={bindTradingInterface}>
                  {tradeInterfaceBound ? "交易接口已绑定" : "绑定交易接口"}
                </button>
              ) : null}
              <button className="btn primary">解除指令</button>
            </div>
            <div>
              <button className="btn">切换到高级操作</button>
              <label className="setting-field compact">
                <span>最小买卖金额：</span>
                <input type="number" defaultValue={1000} />
              </label>
              <button className="btn">保存</button>
            </div>
          </div>
          <p className="instruction-note">
            {executionMode === "manual"
              ? "手动模式下，系统只生成买卖方向、数量、参考价和参考金额，用户需自行在股票软件内填写并提交。"
              : tradeInterfaceBound
                ? "自动模式下，交易接口已绑定，用户确认交易计划后系统将在指定时点提交交易。"
                : "自动模式下，需要先绑定交易接口；未绑定前不会自动提交交易。"}
          </p>
          <p className="trade-alarm">
            <span>●</span> {tradeTime} {executionMode === "manual" ? "生成指令" : "自动执行"}
            <a>生成交易状态表</a>
          </p>
          <table className="live-table">
            <thead>
              <tr>
                <th>股票名称</th>
                <th>行业</th>
                <th>实际股数</th>
                <th>参考价</th>
                <th>参考金额</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((row) => (
                <tr key={row.stock.code}>
                  <td>
                    <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} className="stock-title-button">
                      {row.stock.name}
                      <span>{displayStockCode(row.stock)}</span>
                    </StockNameAction>
                  </td>
                  <td>{row.stock.industry1}</td>
                  <td className="positive">买{row.shares}</td>
                  <td>{row.stock.metrics.price?.toFixed(2)}</td>
                  <td className="negative">-{formatMoney(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          ) : null}

          {tradeTab === "log" ? (
        <div className="live-panel">
          <div className="history-toolbar">
            <span>选择时间：</span>
            <button className="date-step">◀</button>
            <input type="date" defaultValue="2026-05-22" />
            <span>-</span>
            <input type="date" defaultValue="2026-05-25" />
            <button className="date-step">▶</button>
            <button className="btn primary">查看日志</button>
            <a>日志说明</a>
          </div>
          <table className="live-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>信息</th>
              </tr>
            </thead>
            <tbody>
              {logRows.map((row, index) => (
                <tr key={`${row.time}-${index}`}>
                  <td>{row.time}</td>
                  <td>
                    <span className={row.type === "买入" ? "log-type buy" : "log-type info"}>{row.type}</span>
                  </td>
                  <td>{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          ) : null}

          {tradeTab === "history" ? (
        <div className="live-panel">
          <div className="history-toolbar">
            <span>成交时间：</span>
            <button className="date-step">◀</button>
            <input type="date" defaultValue="2026-05-22" />
            <span>-</span>
            <input type="date" defaultValue="2026-05-25" />
            <button className="date-step">▶</button>
            <SelectField label="选择策略：" value={strategy.name} options={[strategy.name, "策略外资产"]} onChange={() => undefined} />
            <button className="btn primary">查看历史记录</button>
            <a>导出</a>
            <span>纸面成交：{paperFills.length}笔</span>
          </div>
          <table className="live-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>时间</th>
                <th>标的名称</th>
                <th>标的代码</th>
                <th>变更(股数)</th>
                <th>成交均价</th>
                <th>发生金额</th>
                <th>策略外资产</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row, index) => (
                <tr key={`${row.stock.code}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{row.time}</td>
                  <td>
                    <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} />
                  </td>
                  <td>
                    <a>{displayStockCode(row.stock)}</a>
                  </td>
                  <td>买入{row.shares}</td>
                  <td>{row.stock.metrics.price?.toFixed(3)}</td>
                  <td className="negative">-{formatMoney(row.amount)}</td>
                  <td />
                </tr>
              ))}
              {paperFills.map((fill, index) => (
                <tr key={fill.id}>
                  <td>{historyRows.length + index + 1}</td>
                  <td>{fill.filledAt.replace("T", " ").slice(0, 19)}</td>
                  <td>
                    <StockNameAction stock={{ code: fill.code, name: fill.name }} onOpen={onOpenStockInfo} />
                  </td>
                  <td>
                    <a>{displayStockCode(fill.code)}</a>
                  </td>
                  <td>{fill.side}{fill.shares}</td>
                  <td>{fill.price.toFixed(3)}</td>
                  <td className={fill.side === "买入" ? "negative" : "positive"}>{fill.side === "买入" ? "-" : "+"}{formatMoney(fill.amount)}</td>
                  <td />
                </tr>
              ))}
              <tr>
                <td>{historyRows.length + 1}</td>
                <td>2026-05-22 17:49:53</td>
                <td>现金</td>
                <td />
                <td>资产同步</td>
                <td>N/A</td>
                <td>N/A</td>
                <td>{formatMoney(accountAsset)}</td>
              </tr>
            </tbody>
          </table>
        </div>
          ) : null}
        </>
      ) : (
        <ConditionTradePanel
          rows={conditionRows}
          strategy={strategy}
          formatMoney={formatMoney}
          executionMode={executionMode}
          tradeInterfaceBound={tradeInterfaceBound}
          bindTradeInterface={bindTradingInterface}
          exportConditionInstructions={() => exportTradePlan(rows, "manual", "条件单指令")}
          onOpenStockInfo={onOpenStockInfo}
        />
      )}
    </section>
  );
}

function ConditionTradePanel({
  rows,
  strategy,
  formatMoney,
  executionMode,
  tradeInterfaceBound,
  bindTradeInterface,
  exportConditionInstructions,
  onOpenStockInfo
}: {
  rows: Array<{
    id: string;
    stock: SelectionRow["stock"];
    name: string;
    direction: string;
    triggerOperator: string;
    triggerPrice: number;
    orderPrice: string;
    shares: number;
    amount: number;
    status: string;
    validUntil: string;
  }>;
  strategy: StrategyConfig;
  formatMoney: (value: number) => string;
  executionMode: "manual" | "auto";
  tradeInterfaceBound: boolean;
  bindTradeInterface: () => boolean;
  exportConditionInstructions: () => void;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const first = rows[0];
  return (
    <div className="condition-panel-live">
      <div className="condition-toolbar">
        <div>
          <h3>条件单交易</h3>
          <p>
            {executionMode === "manual"
              ? "手动模式：条件触发后生成交易指令，由用户自行在股票软件内填写。"
              : tradeInterfaceBound
                ? "自动模式：条件触发后通过已绑定交易接口提交交易计划。"
                : "自动模式：请先绑定交易接口，未绑定前仅生成待确认指令。"}
          </p>
        </div>
        <div>
          <button className="btn primary">
            <Plus size={14} />
            新增条件单
          </button>
          {executionMode === "auto" ? (
            <button className="btn primary" onClick={bindTradeInterface}>
              {tradeInterfaceBound ? "交易接口已绑定" : "绑定交易接口"}
            </button>
          ) : (
            <button className="btn" onClick={exportConditionInstructions}>导出条件单指令</button>
          )}
          <button className="btn">暂停全部</button>
        </div>
      </div>

      <div className="condition-layout">
        <section className="condition-editor">
          <div className="live-section-title compact">
            <h3>条件单设置</h3>
            <span>资金账号：*****0624</span>
          </div>
          <div className="condition-form-grid">
            <label>
              <span>条件单名称</span>
              <input defaultValue={first?.name ?? `${strategy.name}条件单`} />
            </label>
            <label>
              <span>证券代码</span>
              <input defaultValue={first ? displayStockCode(first.stock) : "SH600519"} />
            </label>
            <label>
              <span>证券名称</span>
              <input defaultValue={first?.stock.name ?? "贵州茅台"} />
            </label>
            <label>
              <span>监控价格</span>
              <select defaultValue="最新价">
                <option>最新价</option>
                <option>买一价</option>
                <option>卖一价</option>
                <option>涨跌幅</option>
              </select>
            </label>
            <label>
              <span>触发条件</span>
              <div className="condition-inline">
                <select defaultValue={first?.triggerOperator ?? "<="}>
                  <option>{">="}</option>
                  <option>{"<="}</option>
                  <option>{">"}</option>
                  <option>{"<"}</option>
                </select>
                <input type="number" defaultValue={first?.triggerPrice ?? 180} />
              </div>
            </label>
            <label>
              <span>触发后操作</span>
              <select defaultValue={first?.direction ?? "买入"}>
                <option>买入</option>
                <option>卖出</option>
                <option>提醒</option>
              </select>
            </label>
            <label>
              <span>执行模式</span>
              <input value={executionMode === "manual" ? "手动生成指令" : tradeInterfaceBound ? "自动接口交易" : "自动交易-待绑定"} readOnly />
            </label>
            <label>
              <span>委托价格</span>
              <select defaultValue={first?.orderPrice ?? "卖五价+0.05"}>
                <option>卖五价+0.05</option>
                <option>买五价-0.05</option>
                <option>涨停价</option>
                <option>跌停价</option>
                <option>限价</option>
              </select>
            </label>
            <label>
              <span>委托数量</span>
              <input type="number" step={100} defaultValue={first?.shares ?? 100} />
            </label>
            <label>
              <span>有效期至</span>
              <input type="date" defaultValue={first?.validUntil ?? "2026-06-25"} />
            </label>
          </div>
          <div className="condition-actions">
            <button className="btn primary">保存条件单</button>
            <button className="btn">立即试算</button>
          </div>
        </section>

        <section className="condition-list">
          <div className="condition-filter-row">
            <strong>我的条件单</strong>
            <label>
              <span>状态：</span>
              <select defaultValue="全部">
                <option>全部</option>
                <option>运行中</option>
                <option>已触发</option>
                <option>暂停</option>
              </select>
            </label>
            <a>导出</a>
          </div>
          <table className="live-table">
            <thead>
              <tr>
                <th>条件单名称</th>
                <th>证券</th>
                <th>触发条件</th>
                <th>委托方向</th>
                <th>委托价格</th>
                <th>委托数量</th>
                <th>有效期</th>
                <th>执行模式</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a>{row.name}</a>
                  </td>
                  <td>
                    <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} className="stock-title-button">
                      {row.stock.name}
                      <span>{displayStockCode(row.stock)}</span>
                    </StockNameAction>
                  </td>
                  <td>
                    最新价 {row.triggerOperator} {row.triggerPrice.toFixed(2)}
                  </td>
                  <td className={row.direction === "买入" ? "positive" : "negative"}>{row.direction}</td>
                  <td>{row.orderPrice}</td>
                  <td>{row.shares}</td>
                  <td>{row.validUntil}</td>
                  <td>{executionMode === "manual" ? "手动指令" : tradeInterfaceBound ? "自动接口" : "待绑定"}</td>
                  <td>
                    <span className={`condition-status ${row.status === "运行中" ? "running" : row.status === "已触发" ? "done" : "paused"}`}>{row.status}</span>
                  </td>
                  <td>
                    <button className="text-link">设置</button>
                    <button className="text-link">暂停</button>
                    <button className="text-link">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="condition-log">
        <div className="live-section-title compact">
          <h3>触发记录</h3>
          <a>查看全部</a>
        </div>
        <table className="live-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>条件单</th>
              <th>触发价</th>
              <th>计划金额</th>
              <th>执行结果</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 3).map((row, index) => (
              <tr key={`${row.id}-log`}>
                <td>2026-05-25 09:{15 + index}:26</td>
                <td>{row.name}</td>
                <td>{row.triggerPrice.toFixed(2)}</td>
                <td>{formatMoney(row.amount)}</td>
                <td>
                  {row.status === "已触发"
                    ? executionMode === "manual"
                      ? "已生成手动交易指令"
                      : tradeInterfaceBound
                        ? "已通过交易接口提交"
                        : "已生成交易计划，等待接口绑定"
                    : "继续监控"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function BacktestPanel({
  tab,
  setTab,
  config,
  setConfig,
  result,
  selectionRows,
  rankRows,
  factors,
  strategy,
  runCurrentTask,
  openCompare,
  onOpenStockInfo
}: {
  tab: BacktestTab;
  setTab: (tab: BacktestTab) => void;
  config: BacktestConfig;
  setConfig: (config: BacktestConfig) => void;
  result: BacktestResult | null;
  selectionRows: SelectionRow[];
  rankRows: RankingRow[];
  factors: Factor[];
  strategy: StrategyConfig;
  runCurrentTask: (tab?: BacktestTab) => void;
  openCompare: () => void;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const [factorCorrelationPeriod, setFactorCorrelationPeriod] = useState(20);
  const tabs: Array<{ key: BacktestTab; label: string; icon: React.ReactNode }> = [
    { key: "backtest", label: "策略回测", icon: <Activity size={15} /> },
    { key: "daily", label: "每日选股", icon: <CalendarDays size={15} /> },
    { key: "realtime", label: "实时选股", icon: <Filter size={15} /> },
    { key: "rank", label: "排名分析", icon: <BarChart3 size={15} /> },
    { key: "factorCorrelation", label: "因子相关性", icon: <LineChart size={15} /> }
  ];
  const description =
    tab === "backtest"
      ? "计算以上策略模型在历史上的收益。"
      : tab === "rank"
        ? "查看当前股票池内所有股票的排名分数。"
        : tab === "factorCorrelation"
          ? "对排名条件里的排名因子逐个计算IC曲线，并计算它们之间的相关性。"
          : "按当前策略条件生成选股清单。";
  return (
    <section className="backtest-panel">
      <div className="result-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => {
              setTab(item.key);
              if (item.key !== "backtest") runCurrentTask(item.key);
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      <div className="backtest-config">
        <p>
          {description}
          <a>了解回测</a>
        </p>
        <div className="config-row">
          <span>回测时间：</span>
          <button className="date-step">◀</button>
          <input type="date" value={config.startDate} onChange={(event) => setConfig({ ...config, startDate: event.target.value })} />
          <span>-</span>
          <input type="date" value={config.endDate} onChange={(event) => setConfig({ ...config, endDate: event.target.value })} />
          <button className="date-step">▶</button>
          {tab === "factorCorrelation" ? (
            <label className="setting-field compact">
              <span>调仓周期（交易日）：</span>
              <input
                type="number"
                min={1}
                value={factorCorrelationPeriod}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setFactorCorrelationPeriod(Number.isFinite(next) && next > 0 ? next : 1);
                }}
              />
            </label>
          ) : (
            <>
              <SelectField label="收益基准：" value={config.benchmark} options={["沪深300", "中证500", "创业板指", "科创50"]} onChange={(benchmark) => setConfig({ ...config, benchmark })} />
              <SelectField label="交易成本（单边）：" value={String(config.cost)} options={["0", "0.1", "0.2", "0.3", "0.5", "1"]} onChange={(cost) => setConfig({ ...config, cost: Number(cost) })} />
              <label className="check-line">
                <input type="checkbox" checked={config.excludeTimeRange} onChange={(event) => setConfig({ ...config, excludeTimeRange: event.target.checked })} />
                排除时间段
              </label>
            </>
          )}
        </div>
        <div className="button-row">
          <button className="btn primary" onClick={() => runCurrentTask(tab)}>
            <Play size={15} />
            {tab === "backtest" ? "开始回测" : tab === "rank" || tab === "factorCorrelation" ? "开始分析" : "开始选股"}
          </button>
          {tab === "factorCorrelation" ? <span className="button-hint">分析排名因子IC关系</span> : null}
          {tab !== "factorCorrelation" ? (
            <button className="btn" onClick={openCompare}>
              <BarChart3 size={15} />
              对比策略指标
            </button>
          ) : null}
        </div>
      </div>

      {tab === "backtest" ? <BacktestResultView result={result} rows={selectionRows} factors={factors} strategy={strategy} onOpenStockInfo={onOpenStockInfo} /> : null}
      {tab === "daily" || tab === "realtime" ? <SelectionTable rows={selectionRows} factors={factors} strategy={strategy} realtime={tab === "realtime"} onOpenStockInfo={onOpenStockInfo} /> : null}
      {tab === "rank" ? <RankingTable rows={rankRows} factors={factors} strategy={strategy} onOpenStockInfo={onOpenStockInfo} /> : null}
      {tab === "factorCorrelation" ? <FactorCorrelationPanel rows={rankRows} factors={factors} strategy={strategy} /> : null}
    </section>
  );
}

function BacktestResultView({
  result,
  rows,
  factors,
  strategy,
  onOpenStockInfo
}: {
  result: BacktestResult | null;
  rows: SelectionRow[];
  factors: Factor[];
  strategy: StrategyConfig;
  onOpenStockInfo?: (stock: StockReference) => void;
}) {
  if (!result) {
    return (
      <div className="preview-results">
        <SelectionTable rows={rows} factors={factors} strategy={strategy} compact onOpenStockInfo={onOpenStockInfo} />
      </div>
    );
  }
  return (
    <div className="backtest-results">
      <div className="metric-cards">
        <MetricCard title="累计收益" value={pct(result.metrics.cumulativeReturn)} />
        <MetricCard title="年化收益" value={pct(result.metrics.annualReturn)} />
        <MetricCard title="最大回撤" value={pct(result.metrics.maxDrawdown)} negative />
        <MetricCard title="夏普比率" value={String(result.metrics.sharpe)} />
        <MetricCard title="胜率" value={pct(result.metrics.winRate)} />
        <MetricCard title="换手率" value={pct(result.metrics.turnover)} />
      </div>
      <EquityChart result={result} hedge={strategy.hedge.enabled} />
      <div className="result-grid">
        <SelectionTable rows={result.rows} factors={factors} strategy={strategy} compact onOpenStockInfo={onOpenStockInfo} />
        <div className="mini-table">
          <h3>年度收益统计</h3>
          <table>
            <thead>
              <tr>
                <th>年份</th>
                <th>策略</th>
                <th>基准</th>
                <th>超额</th>
              </tr>
            </thead>
            <tbody>
              {result.yearly.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{pct(row.strategy)}</td>
                  <td>{pct(row.benchmark)}</td>
                  <td>{pct(row.excess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>调仓记录</h3>
          <table>
            <tbody>
              {result.trades.slice(0, 8).map((trade) => (
                <tr key={`${trade.date}-${trade.code}-${trade.action}`}>
                  <td>{trade.date}</td>
                  <td>{trade.action}</td>
                  <td>
                    <StockNameAction stock={{ code: trade.code, name: trade.name }} onOpen={onOpenStockInfo} />
                  </td>
                  <td>{trade.weight}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, negative = false }: { title: string; value: string; negative?: boolean }) {
  return (
    <div className="metric-card">
      <span>{title}</span>
      <strong className={negative ? "negative" : value.startsWith("-") ? "negative" : "positive"}>{value}</strong>
    </div>
  );
}

function EquityChart({ result, hedge }: { result: BacktestResult; hedge: boolean }) {
  const width = 760;
  const height = 220;
  const points = result.curve;
  const values = points.flatMap((point) => [point.strategy, point.benchmark, hedge && point.hedge ? point.hedge : point.strategy]);
  const min = Math.min(...values) * 0.98;
  const max = Math.max(...values) * 1.02;
  const pathFor = (key: "strategy" | "benchmark" | "hedge") =>
    points
      .map((point, index) => {
        const x = (index / Math.max(points.length - 1, 1)) * width;
        const y = height - (((point[key] ?? point.strategy) - min) / Math.max(max - min, 0.01)) * height;
        return `${index === 0 ? "M" : "L"}${round(x, 2)},${round(y, 2)}`;
      })
      .join(" ");
  return (
    <div className="chart-panel">
      <div className="chart-title">
        <h3>策略净值曲线</h3>
        <div className="legend">
          <span className="strategy">策略</span>
          <span className="benchmark">基准</span>
          {hedge ? <span className="hedge">对冲前</span> : null}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="净值曲线">
        <g className="grid-lines">
          {[0, 1, 2, 3].map((line) => (
            <line key={line} x1="0" x2={width} y1={(height / 3) * line} y2={(height / 3) * line} />
          ))}
        </g>
        <path className="curve benchmark" d={pathFor("benchmark")} />
        {hedge ? <path className="curve hedge" d={pathFor("hedge")} /> : null}
        <path className="curve strategy" d={pathFor("strategy")} />
      </svg>
    </div>
  );
}

function SelectionTable({
  rows,
  factors,
  strategy,
  realtime = false,
  compact = false,
  onOpenStockInfo
}: {
  rows: SelectionRow[];
  factors: Factor[];
  strategy: StrategyConfig;
  realtime?: boolean;
  compact?: boolean;
  onOpenStockInfo?: (stock: StockReference) => void;
}) {
  const rankFactors = getResultFactorKeys(strategy);
  return (
    <div className={`selection-table ${compact ? "compact" : ""}`}>
      <h3>{realtime ? "实时选股结果" : compact ? "候选股票" : "每日选股结果"}</h3>
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>代码</th>
            <th>名称</th>
            <th>行业</th>
            <th>得分</th>
            <th>权重</th>
            {rankFactors.map((key) => (
              <th key={key}>{getFactorName(factors, key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.stock.code}>
              <td>{index + 1}</td>
              <td>{displayStockCode(row.stock)}</td>
              <td>
                <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} />
              </td>
              <td>{row.stock.industry1}</td>
              <td>{row.score.toFixed(2)}</td>
              <td>{row.weight}%</td>
              {rankFactors.map((key) => (
                <td key={key}>{formatMetric(metricValue(row.stock, factorByKey(factors, key), factors), factorByKey(factors, key))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingTable({
  rows,
  factors,
  strategy,
  onOpenStockInfo
}: {
  rows: RankingRow[];
  factors: Factor[];
  strategy: StrategyConfig;
  onOpenStockInfo?: (stock: StockReference) => void;
}) {
  const rankFactors = strategy.ranks.map((rank) => rank.factorKey).slice(0, 5);
  if (!rows.length) {
    return <EmptyState>点击“开始分析”生成排名分析结果。</EmptyState>;
  }
  return (
    <div className="selection-table">
      <h3>排名分析</h3>
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>代码</th>
            <th>名称</th>
            <th>行业</th>
            <th>得分</th>
            {rankFactors.map((key) => (
              <th key={key}>{getFactorName(factors, key)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((row) => (
            <tr key={row.stock.code}>
              <td>{row.rank}</td>
              <td>{displayStockCode(row.stock)}</td>
              <td>
                <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} />
              </td>
              <td>{row.stock.industry1}</td>
              <td>{row.score.toFixed(2)}</td>
              {rankFactors.map((key) => (
                <td key={key}>{formatMetric(row.values[key], factorByKey(factors, key))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FactorCorrelationPanel({ rows, factors, strategy }: { rows: RankingRow[]; factors: Factor[]; strategy: StrategyConfig }) {
  const factorKeys = getRankFactorKeys(strategy);
  const factorItems = factorKeys.map((key) => factorByKey(factors, key)).filter((factor): factor is Factor => Boolean(factor));
  if (factorItems.length < 2) {
    return (
      <div className="factor-correlation-panel">
        <p className="warning-text">请选择至少两个指标到排名条件中</p>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="factor-correlation-panel">
        <EmptyState>点击“开始分析”生成因子相关性结果。</EmptyState>
      </div>
    );
  }

  const factorValues = new Map(factorItems.map((factor) => [factor.key, rows.map((row) => Number(row.values[factor.key] ?? 0))]));
  const forwardReturns = rows.map((row) => {
    const metrics = row.stock.metrics;
    return (metrics.pctChange ?? 0) * 0.45 + (metrics.momentum20 ?? 0) * 0.35 - (metrics.volatility20 ?? 0) * 0.2;
  });
  const icRows = factorItems.map((factor) => {
    const ic = correlation(factorValues.get(factor.key) ?? [], forwardReturns);
    const positiveRatio = rows.length
      ? rows.filter((row, index) => {
          const value = Number(row.values[factor.key] ?? 0);
          return value * forwardReturns[index] >= 0;
        }).length / rows.length
      : 0;
    return {
      factor,
      ic,
      positiveRatio: round(positiveRatio * 100, 2)
    };
  });

  return (
    <div className="factor-correlation-panel">
      <div className="factor-correlation-layout">
        <div className="mini-table factor-ic-table">
          <h3>因子IC概览</h3>
          <table>
            <thead>
              <tr>
                <th>因子</th>
                <th>IC</th>
                <th>同向比例</th>
              </tr>
            </thead>
            <tbody>
              {icRows.map((row) => (
                <tr key={row.factor.key}>
                  <td>{row.factor.name}</td>
                  <td className={row.ic >= 0 ? "positive" : "negative"}>{row.ic.toFixed(3)}</td>
                  <td>{row.positiveRatio.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mini-table factor-matrix-table">
          <h3>因子相关性矩阵</h3>
          <table>
            <thead>
              <tr>
                <th>因子</th>
                {factorItems.map((factor) => (
                  <th key={factor.key}>{factor.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {factorItems.map((rowFactor) => (
                <tr key={rowFactor.key}>
                  <th>{rowFactor.name}</th>
                  {factorItems.map((columnFactor) => {
                    const value = rowFactor.key === columnFactor.key ? 1 : correlation(factorValues.get(rowFactor.key) ?? [], factorValues.get(columnFactor.key) ?? []);
                    return (
                      <td className={value >= 0 ? "positive-cell" : "negative-cell"} key={columnFactor.key}>
                        {value.toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AssetEditor({
  strategy,
  addAsset,
  patchStrategy
}: {
  strategy: StrategyConfig;
  addAsset: (asset: (typeof SAMPLE_ASSETS)[number]) => void;
  patchStrategy: (patch: Partial<StrategyConfig>) => void;
}) {
  const remove = (id: string) => patchStrategy({ assets: strategy.assets.filter((item) => item.id !== id) });
  return (
    <div className="asset-editor">
      <div className="asset-left">
        <div className="pill-tabs">
          {["我的", "订阅", "优选", "收藏", "出租", "策略库"].map((item, index) => (
            <button className={index === 0 ? "active" : ""} key={item}>
              {item}
            </button>
          ))}
        </div>
        <div className="asset-list">
          {SAMPLE_ASSETS.map((asset) => (
            <button key={asset.id} onClick={() => addAsset(asset)}>
              <span>{asset.name}</span>
              <em>{asset.type}</em>
              <Plus size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="asset-right">
        <h4>已选择</h4>
        <table>
          <thead>
            <tr>
              <th>序号</th>
              <th>名称</th>
              <th>类型</th>
              <th>仓位权重</th>
              <th>起始日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {strategy.assets.map((asset, index) => (
              <tr key={asset.id}>
                <td>{index + 1}</td>
                <td>{asset.name}</td>
                <td>{asset.type}</td>
                <td>{asset.weight}%</td>
                <td>{asset.startDate}</td>
                <td>
                  <button className="icon-btn" onClick={() => remove(asset.id)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="corr-box">
          <div className="tabs">
            <button className="active">收益曲线相关度</button>
            <button>持股重合度</button>
            <button>暴露度优化权重</button>
          </div>
          <p>相关度越小，组合抗风险性越好。</p>
        </div>
      </div>
    </div>
  );
}

function ComparePanel({ result, strategy }: { result: BacktestResult | null; strategy: StrategyConfig }) {
  return (
    <div className="compare-panel">
      <div className="metric-cards">
        <MetricCard title="策略资产数" value={String(strategy.assets.length || 1)} />
        <MetricCard title="累计收益" value={result ? pct(result.metrics.cumulativeReturn) : "待回测"} />
        <MetricCard title="最大回撤" value={result ? pct(result.metrics.maxDrawdown) : "待回测"} negative />
        <MetricCard title="相关度估计" value={strategy.assets.length > 1 ? "0.42" : "1.00"} />
      </div>
      <div className="mini-table full">
        <h3>收益分析结果</h3>
        <table>
          <tbody>
            <tr>
              <td>策略名称</td>
              <td>{strategy.name}</td>
              <td>交易模型</td>
              <td>{strategy.trading.mode}</td>
            </tr>
            <tr>
              <td>择时</td>
              <td>{strategy.timing.mode}</td>
              <td>对冲</td>
              <td>{strategy.hedge.enabled ? `${strategy.hedge.contract} ${strategy.hedge.ratio}%` : "无"}</td>
            </tr>
            <tr>
              <td>筛选条件</td>
              <td>{strategy.filters.length}</td>
              <td>排名条件</td>
              <td>{strategy.ranks.length}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
