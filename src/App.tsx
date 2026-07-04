import {
  defaultScheduleConfig,
  fetchSyncStatus,
  scheduleSourceLabels,
  saveSyncConfig as saveScheduleSyncConfig,
  triggerManualSync,
  type ScheduleConfig,
  type SyncStatus
} from "./syncSchedulerService";
import { useEffect, useMemo, useRef, useState } from "react";
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
  LayoutDashboard,
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
  PROPERTY_OPTIONS,
  SAMPLE_ASSETS
} from "./data";
import {
  createCustomFactor,
  createDefaultBacktestConfig,
  createDefaultStrategy,
  createStaticPool,
  loadLocal,
  removeLocal,
  saveLocal,
  todayOffset,
  uid
} from "./storage";
import {
  factorByKey,
  formatMetric,
  metricValue,
  optimizeStrategyBunFirst,
  rankingAnalysisBunFirst,
  runBacktestBunFirst,
  screenStocksBunFirst
} from "./strategyEngine";
import {
  ALL_INDUSTRIES,
  compactIndustryTexts,
  inferPrimaryIndustry,
  inferSecondaryIndustry,
  isUsefulIndustryText,
  stockMatchesIndustry
} from "./industryClassification";
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
  syncOpenSourceFinancialReports,
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
  createTradePlanExportBunFirst,
  createTradePlanBunFirst,
  defaultPaperTradeState,
  defaultTradeConnectionSettings,
  defaultTradeAssetState,
  ensureTradeAssetState,
  ensurePaperTradeState,
  ensureTradeConnectionSettings,
  exportTradePlanBunFirst,
  submitPaperTradePlanBunFirst,
  syncTradeAssetsBunFirst,
  type ExecutionMode,
  type PaperTradeState,
  type PlannedOrder,
  type TradeAssetState,
  type TradeConnectionSettings,
  type TradePlan,
  type TradePlanExport
} from "./tradingServices";
import {
  buildSentimentAnalysisBunFirst,
  createEmptySentimentAnalysis,
  buildSentimentEventsBunFirst,
  filterSentimentEvents,
  scoreSentimentEvent,
  sentimentCategories,
  sentimentDirections,
  sentimentSeverityLevels,
  type SentimentAnalysisResult,
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
  type NewsFilters,
  type NewsSourceDiagnostic
} from "./newsPageServices";
import {
  buildAnnualFinancialReportsBunFirst,
  buildFinancialReportSourceDataUrl,
  type AnnualFinancialReport,
  type AnnualFinancialReportYear
} from "./financialReportServices";
import {
  buildValuationRowsBunFirst,
  defaultValuationFilters,
  enterpriseStateOptions,
  hasRequiredRealValuationData,
  missingRealValuationFields,
  summarizeValuationRows,
  valuationBoardOptions,
  valuationStyleOptions,
  type ValuationFilters,
  type ValuationRiskExclusion,
  type ValuationRow
} from "./valuationServices";
import {
  fetchStockProfileAutoMatch,
  fetchStockKlineHistory,
  syncTencentAllAshareMarketData,
  syncTencentRealMarketData,
  type StockKlineHistoryResult,
  type StockKlinePeriod,
  type StockKlinePoint,
  type StockProfileResult
} from "./realMarketDataService";
import {
  displayStockCode,
  isCodeLikeStockQuery,
  normalizeStockCodeInput,
  resolveStockByCode,
  stockCodeCandidates,
  stockCodeForStorage,
  stockMatchesCodeQuery
} from "./stockIdentity";
import {
  computeMarketTemperature,
  computeIndustryMomentum,
  summarizeHoldings,
  type MarketTemperature
} from "./dashboardService";
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
const hiddenSelectionResultFactorKeys = new Set(["qualityScore"]);
const fallbackResultFactorKeys = ["pe", "momentum60", "roe"];
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

function shiftDateInput(value: string, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDateInInputRange(value: string | undefined, start: string, end: string) {
  if (!value) return false;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return (!start || day >= start) && (!end || day <= end);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildCsv(rows: unknown[][]) {
  return rows.map((line) => line.map(csvCell).join(",")).join("\n");
}

const mojibakeTextPattern = /[\uFFFD]|锟|Ã|Â|ŵ|˼/;

function hasRealRuntimeStockData(stock: Stock) {
  return stock.metrics.realQuoteSource === 1 || stock.metrics.openSourceMarketSource === 1 || stock.metrics.realAnnualReportSource === 1;
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

type ModalKey = null | "pool" | "summary" | "asset" | "customFactor" | "optimization" | "compare" | "importHoldings";
type MainSection = "dashboard" | "strategy" | "sentiment" | "valuation" | "trade" | "settings";
type StockReference = Pick<Stock, "code" | "name">;
type StockInfoTarget = StockReference & { stock?: Stock };
type SortDirection = "asc" | "desc";
type SelectionSortKey = "rank" | "code" | "name" | "industry" | "score" | "weight" | `filter:${string}` | `factor:${string}`;
type ValuationDataSource = "none" | "tencentQuote" | "openSource" | "akshare";
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
const defaultValuationPageSize = 50;
const valuationRiskExclusionOptions: Array<{ value: ValuationRiskExclusion; label: string }> = [
  { value: "ST", label: "筛除 ST" },
  { value: "*ST", label: "筛除 *ST" },
  { value: "退市", label: "筛除退市" }
];

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

function toggleAllBackedOption<T extends string>(current: T[], value: T, allValue: T): T[] {
  if (value === allValue) return [allValue];
  const selected = current.filter((item) => item !== allValue);
  const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
  return next.length ? next : [allValue];
}

function toggleOption<T extends string>(current: T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function normalizeMinimumTradeAmount(value: unknown, fallback = 1000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? round(parsed, 2) : fallback;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function ensureValuationDataSource(value: ValuationDataSource): Exclude<ValuationDataSource, "akshare"> {
  return value === "akshare" ? "openSource" : value;
}

function infoSourceDisplayName(settings: Pick<InfoSourceSettings, "provider">) {
  const provider = settings.provider.trim();
  return provider || "当前真实数据源";
}

function newsFallbackSourceLabel(source: string) {
  const normalized = source.trim().toLowerCase();
  if (normalized === "eastmoney") return "东方财富";
  return source;
}

function newsDiagnosticsStatusSuffix(diagnostics: NewsSourceDiagnostic[]) {
  const fallbackDiagnostics = diagnostics.filter((diagnostic) => diagnostic.fallbackSource);
  if (!fallbackDiagnostics.length) return "";
  return fallbackDiagnostics
    .map((diagnostic) => {
      const target = newsFallbackSourceLabel(diagnostic.fallbackSource ?? "");
      const reason = diagnostic.fallbackReason ? `，原因：${diagnostic.fallbackReason}` : "";
      return `${diagnostic.sourceName || diagnostic.provider} 失败，Bun 已切换 ${target} 真实新闻源${reason}`;
    })
    .join("；");
}

function copyTextWithTextarea(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

async function copyTextToClipboard(text: string) {
  if (!text.trim()) return false;
  if (copyTextWithTextarea(text)) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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
    .filter((key) => !hiddenSelectionResultFactorKeys.has(key))
    .filter((key, index, keys) => keys.indexOf(key) === index);
  const merged = [...selected, ...fallbackResultFactorKeys].filter((key, index, keys) => keys.indexOf(key) === index);
  return merged.slice(0, 3);
}

function getFilterConditionValueLabel(condition: FilterCondition) {
  if (isRangeOperator(condition.operator)) {
    return `${condition.min ?? 0} - ${condition.max ?? 100}`;
  }
  return String(condition.value ?? condition.min ?? condition.max ?? 0);
}

function getFilterConditionLabel(condition: FilterCondition, factors: Factor[]) {
  const factorName = getFactorName(factors, condition.factorKey);
  const scope = condition.range === "全部" ? "" : `（${condition.range}）`;
  return `${factorName}${scope} ${getOperatorLabel(condition.operator)} ${getFilterConditionValueLabel(condition)}`;
}

function getFilterMetricItem(row: SelectionRow, condition: FilterCondition, factors: Factor[]) {
  const factor = factorByKey(factors, condition.factorKey);
  const hasRawMetric = Object.prototype.hasOwnProperty.call(row.stock.metrics, condition.factorKey);
  const value = getFilterMetricValue(row, condition, factors);
  return {
    key: `${condition.id}-${condition.factorKey}`,
    name: getFactorName(factors, condition.factorKey),
    value: formatMetric(value, factor),
    title: getFilterConditionLabel(condition, factors)
  };
}

function getFilterMetricValue(row: SelectionRow, condition: FilterCondition, factors: Factor[]) {
  const factor = factorByKey(factors, condition.factorKey);
  const hasRawMetric = Object.prototype.hasOwnProperty.call(row.stock.metrics, condition.factorKey);
  if (factor?.formula || hasRawMetric) {
    return factor ? metricValue(row.stock, factor, factors) : row.stock.metrics[condition.factorKey];
  }
  return Number.NaN;
}

function compareSelectionSortValues(left: number | string, right: number | string, direction: SortDirection) {
  if (typeof left === "number" && typeof right === "number") {
    const leftFinite = Number.isFinite(left);
    const rightFinite = Number.isFinite(right);
    if (leftFinite && rightFinite) return left - right;
    if (leftFinite) return direction === "asc" ? -1 : 1;
    if (rightFinite) return direction === "asc" ? 1 : -1;
    return 0;
  }
  return String(left).localeCompare(String(right), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
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
  max,
  step
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="setting-field compact">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
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

function HoldingStrategyImportModal({
  candidates,
  holdingStrategyIds,
  onImport,
  onClose
}: {
  candidates: StrategyConfig[];
  holdingStrategyIds: Set<string>;
  onImport: (strategies: StrategyConfig[]) => void;
  onClose: () => void;
}) {
  const selectableCandidates = candidates.filter((item) => !holdingStrategyIds.has(item.id));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => selectableCandidates.map((item) => item.id));
  const selectedSet = new Set(selectedIds);

  const toggleSelected = (strategyId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(strategyId) ? current : [...current, strategyId];
      return current.filter((item) => item !== strategyId);
    });
  };

  const importSelected = () => {
    onImport(candidates.filter((item) => selectedSet.has(item.id)));
  };

  return (
    <Modal title="导入持仓策略" onClose={onClose} wide>
      <div className="holding-import-modal">
        <div className="holding-import-head">
          <p className="hint-text">勾选要纳入持仓管理的选股策略。已在持仓中的策略会保留在列表中，但不可重复导入。</p>
          <div className="holding-import-actions">
            <button className="btn" type="button" onClick={() => setSelectedIds(selectableCandidates.map((item) => item.id))} disabled={!selectableCandidates.length}>
              全选可导入
            </button>
            <button className="btn" type="button" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>
              清空选择
            </button>
          </div>
        </div>

        <div className="holding-import-list">
          {candidates.map((item, index) => {
            const imported = holdingStrategyIds.has(item.id);
            const selected = selectedSet.has(item.id);
            const filterCount = item.filters.filter((filter) => filter.enabled).length;
            const rankCount = item.ranks.filter((rank) => rank.enabled).length;
            return (
              <label className={`holding-import-row ${imported ? "imported" : ""}`} key={item.id}>
                <input
                  type="checkbox"
                  checked={imported || selected}
                  disabled={imported}
                  onChange={(event) => toggleSelected(item.id, event.target.checked)}
                  aria-label={`选择持仓策略 ${item.name}`}
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>{filterCount}筛选 / {rankCount}排名 / {item.trading.maxHoldings}持仓</small>
                </span>
                {index === 0 ? <em>当前选股策略</em> : null}
                {imported ? <em>已在持仓</em> : null}
              </label>
            );
          })}
        </div>

        <div className="holding-import-footer">
          <span>已选择 {selectedIds.length} 个可导入策略</span>
          <div>
            <button className="btn" type="button" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" type="button" onClick={importSelected} disabled={!selectedIds.length}>
              确认导入
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatKlineAxisDate(date: string) {
  const parts = date.split("-");
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return date;
}

function formatKlinePointDate(date: string) {
  return date.replace("T", " ").slice(0, 16);
}

function StockKlineChart({ points }: { points: StockKlinePoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 780;
  const height = 320;
  const left = 46;
  const right = 18;
  const top = 18;
  const priceHeight = 210;
  const volumeTop = 244;
  const volumeHeight = 48;
  const plotWidth = width - left - right;
  const plotRight = width - right;
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
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex] ?? null;
  const hoveredX = hoveredIndex === null ? 0 : xPoint(hoveredIndex);
  const tooltipWidth = 168;
  const tooltipHeight = 104;
  const tooltipX = hoveredX > plotRight - tooltipWidth - 12 ? hoveredX - tooltipWidth - 12 : hoveredX + 12;
  const tooltipY = hoveredPoint ? Math.max(top + 4, Math.min(volumeTop - tooltipHeight - 8, yPrice(hoveredPoint.high) - 18)) : top;
  const closeChange = hoveredPoint && hoveredPoint.open ? ((hoveredPoint.close - hoveredPoint.open) / hoveredPoint.open) * 100 : 0;

  return (
    <>
      <div className="stock-kline-chart-wrap">
        <svg className="stock-kline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="股票真实K线图" onMouseLeave={() => setHoveredIndex(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + ratio * priceHeight;
            const price = priceMax - ratio * priceRange;
            return (
              <g key={ratio}>
                <line x1={left} y1={y} x2={plotRight} y2={y} className="kline-grid" />
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
          <line x1={left} y1={volumeTop} x2={plotRight} y2={volumeTop} className="kline-grid strong" />
          {[0, Math.floor(points.length / 2), points.length - 1].map((index) => (
            <text key={index} x={xPoint(index)} y={height - 8} textAnchor="middle" className="kline-axis">{formatKlineAxisDate(points[index].date)}</text>
          ))}
          {points.map((point, index) => {
            const x = xPoint(index);
            return (
              <rect
                aria-label={`${formatKlinePointDate(point.date)} 开盘 ${point.open.toFixed(2)} 收盘 ${point.close.toFixed(2)}`}
                className="kline-hit-area"
                key={`hit-${point.date}-${index}`}
                x={Math.max(left, x - step / 2)}
                y={top}
                width={Math.min(step, plotRight - Math.max(left, x - step / 2))}
                height={volumeTop + volumeHeight - top}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseMove={() => setHoveredIndex(index)}
              >
                <title>{`${formatKlinePointDate(point.date)} 开盘 ${point.open.toFixed(2)} 收盘 ${point.close.toFixed(2)}`}</title>
              </rect>
            );
          })}
          {hoveredPoint && hoveredIndex !== null ? (
            <g className="kline-hover-layer">
              <line x1={hoveredX} y1={top} x2={hoveredX} y2={volumeTop + volumeHeight} className="kline-crosshair" />
              <circle cx={hoveredX} cy={yPrice(hoveredPoint.close)} r={3.5} className={hoveredPoint.close >= hoveredPoint.open ? "kline-hover-point up" : "kline-hover-point down"} />
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx={6} className="kline-tooltip-box" />
              <text x={tooltipX + 10} y={tooltipY + 18} className="kline-tooltip-title">{formatKlinePointDate(hoveredPoint.date)}</text>
              <text x={tooltipX + 10} y={tooltipY + 39} className="kline-tooltip-text">开盘 {hoveredPoint.open.toFixed(2)}</text>
              <text x={tooltipX + 92} y={tooltipY + 39} className="kline-tooltip-text">收盘 {hoveredPoint.close.toFixed(2)}</text>
              <text x={tooltipX + 10} y={tooltipY + 59} className="kline-tooltip-text">最高 {hoveredPoint.high.toFixed(2)}</text>
              <text x={tooltipX + 92} y={tooltipY + 59} className="kline-tooltip-text">最低 {hoveredPoint.low.toFixed(2)}</text>
              <text x={tooltipX + 10} y={tooltipY + 79} className={closeChange >= 0 ? "kline-tooltip-change positive" : "kline-tooltip-change negative"}>
                涨跌 {pct(closeChange)}
              </text>
              <text x={tooltipX + 10} y={tooltipY + 96} className="kline-tooltip-text">成交量 {hoveredPoint.volume.toFixed(2)} 万手</text>
            </g>
          ) : null}
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
  const [reports, setReports] = useState<AnnualFinancialReport[]>([]);
  const [selectedYear, setSelectedYear] = useState<AnnualFinancialReportYear>("");
  const [annualReportStatus, setAnnualReportStatus] = useState("Bun 年报接口等待请求");

  useEffect(
    function loadAnnualReportsFromBun() {
      let cancelled = false;
      setReports([]);
      setAnnualReportStatus("正在通过 Bun 年报接口读取真实财报...");
      buildAnnualFinancialReportsBunFirst(stock)
        .then((nextReports) => {
          if (!cancelled) {
            setReports(nextReports);
            setAnnualReportStatus(`Bun 年报接口完成，返回 ${nextReports.length} 份真实年报`);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setReports([]);
            setAnnualReportStatus(`Bun 年报接口失败：${readableError(error)}`);
          }
        });
      return () => {
        cancelled = true;
      };
    },
    [stock]
  );

  useEffect(
    function resetAnnualReportYear() {
      setSelectedYear(reports[0]?.year ?? "");
    },
    [stock.code, reports[0]?.year]
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
        <div className={annualReportStatus.includes("失败") ? "settings-status danger" : "settings-status"}>{annualReportStatus}</div>
        <div className="stock-related-info-empty">尚未接入该股票的真实年度财报源文件，暂不展示财报摘要或下载源文件。</div>
      </div>
    );
  }

  const selectedReport = reports.find((report) => report.year === selectedYear) ?? reports[0];
  const statementItems = buildAnnualReportStatementItems(selectedReport);
  const ratioItems = buildAnnualReportRatioItems(selectedReport);
  const hasSourceCsv = Boolean(selectedReport.sourceCsv?.trim());

  return (
    <div className="stock-info-section annual-report-section">
      <div className="stock-info-section-title annual-report-title">
        <div>
          <h4>财报摘要</h4>
          <p>
            {selectedReport.year} 年度报告，报告期 {selectedReport.periodEnd}，披露日期 {selectedReport.disclosureDate}。
          </p>
          <p className={annualReportStatus.includes("失败") ? "settings-status danger" : "settings-status"}>{annualReportStatus}</p>
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
          {hasSourceCsv ? (
            <a className="btn annual-report-source-download" href={buildFinancialReportSourceDataUrl(selectedReport)} download={selectedReport.sourceFileName}>
              <Download size={14} />
              源文件
            </a>
          ) : (
            <button className="btn annual-report-source-download" disabled type="button">
              <Download size={14} />
              源文件待同步
            </button>
          )}
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

function compactUniqueTexts(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function normalizeOfficialWebsite(value: string | undefined) {
  if (!value) return "";
  const token = value.split(/[\s,，;；|]+/).find((item) => item.includes(".")) ?? value;
  const trimmed = token.trim().replace(/[。；;，,]+$/g, "");
  if (!trimmed || ["-", "--", "暂无", "未披露"].includes(trimmed)) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function displayWebsiteHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

function stockIndustryTags(stock: Stock) {
  return compactIndustryTexts([
    ...(stock.industryTags ?? []),
    stock.industry1,
    stock.industry2,
    stock.board,
    ...stock.indexes
  ]).slice(0, 12);
}

function usefulIndustryText<T extends string>(primary: T | undefined, fallback: T): T {
  return isUsefulIndustryText(primary) ? primary ?? fallback : fallback;
}

function compactIndustryTagTexts(values: Array<string | undefined>) {
  return compactIndustryTexts(values);
}

function industryTagDisplayScore(tag: string) {
  const longIndustryPenalty = tag.length > 12 ? 40 : 0;
  const broadIndustryPenalty = /制造业|金融业|批发|科学研究/.test(tag) && tag.length > 8 ? 20 : 0;
  return tag.length + longIndustryPenalty + broadIndustryPenalty;
}

function selectionIndustryTags(stock: Stock) {
  return compactIndustryTagTexts([
    stock.industry1,
    stock.industry2,
    ...(stock.industryTags ?? [])
  ]).sort((left, right) => industryTagDisplayScore(left) - industryTagDisplayScore(right)).slice(0, 5);
}

function StockIndustryTagsCell({ stock }: { stock: Stock }) {
  const tags = selectionIndustryTags(stock);
  if (!tags.length) {
    return <span className="selection-industry-empty">{stock.industry1 || "--"}</span>;
  }
  return (
    <div className="selection-industry-tags" title={tags.join("、")}>
      {tags.map((tag, index) => (
        <span className={index < 2 ? "selection-industry-tag primary" : "selection-industry-tag"} key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function buildStockMetadataMap(stocks: Stock[]) {
  const map = new Map<string, Stock>();
  stocks.forEach((stock) => {
    stockCodeCandidates(stock).forEach((key) => {
      if (!map.has(key)) map.set(key, stock);
    });
  });
  return map;
}

function findStockMetadata(stock: Stock, map: Map<string, Stock>) {
  return stockCodeCandidates(stock).map((key) => map.get(key)).find((item): item is Stock => Boolean(item));
}

function mergeStockDisplayMetadata(stock: Stock, source: Stock): Stock {
  return {
    ...stock,
    exchange: stock.exchange || source.exchange,
    board: usefulIndustryText(stock.board, source.board),
    industry1: usefulIndustryText(stock.industry1, source.industry1),
    industry2: usefulIndustryText(stock.industry2, source.industry2),
    website: stock.website ?? source.website,
    industryTags: compactIndustryTagTexts([
      ...(source.industryTags ?? []),
      ...(stock.industryTags ?? []),
      source.industry1,
      source.industry2,
      stock.industry1,
      stock.industry2
    ]),
    region: usefulIndustryText(stock.region, source.region),
    property: stock.property || source.property,
    indexes: stock.indexes?.length ? stock.indexes : source.indexes,
    metrics: {
      ...source.metrics,
      ...stock.metrics
    }
  };
}

function hydrateSelectionRowsWithStockMetadata(rows: SelectionRow[], stocks: Stock[]) {
  const stockMap = buildStockMetadataMap(stocks);
  return rows.map((row) => {
    const source = findStockMetadata(row.stock, stockMap);
    return source ? { ...row, stock: mergeStockDisplayMetadata(row.stock, source) } : row;
  });
}

function shouldMatchIndustryProfile(stock: Stock) {
  return !stock.industryTags?.length || !isUsefulIndustryText(stock.industry1) || !isUsefulIndustryText(stock.industry2);
}

function mergeStocksWithProfiles(stocks: Stock[], profiles: Stock[]) {
  const profileMap = buildStockMetadataMap(profiles);
  return stocks.map((stock) => {
    const profile = findStockMetadata(stock, profileMap);
    return profile ? mergeStockDisplayMetadata(stock, profile) : stock;
  });
}

async function hydrateSelectionRowsWithMatchedIndustryTags(rows: SelectionRow[], stocks: Stock[]) {
  const candidates = rows.filter((row) => shouldMatchIndustryProfile(row.stock)).slice(0, Math.max(1, rows.length));
  const matchedProfiles: Stock[] = [];
  const concurrency = 4;
  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const results = await Promise.all(batch.map((row) => fetchStockProfileAutoMatch(row.stock)));
    results.forEach((result) => {
      if (result.ok && selectionIndustryTags(result.stock).length) {
        matchedProfiles.push(result.stock);
      }
    });
  }
  if (!matchedProfiles.length) {
    return { rows, stocks, matchedCount: 0 };
  }
  const nextStocks = mergeStocksWithProfiles(stocks, matchedProfiles);
  const nextRows = hydrateSelectionRowsWithStockMetadata(rows, nextStocks);
  return { rows: nextRows, stocks: nextStocks, matchedCount: matchedProfiles.length };
}

function StockOfficialInfoSection({
  stock,
  status,
  loading,
  onRefresh
}: {
  stock: Stock;
  status: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const website = normalizeOfficialWebsite(stock.website);
  const tags = stockIndustryTags(stock);
  return (
    <div className="stock-info-section stock-official-section">
      <div className="stock-info-section-title">
        <div>
          <h4>官网与行业标签</h4>
          <p>官网和行业标签来自已同步基础资料，并通过 Bun F10 接口自动匹配补齐。</p>
        </div>
        <div className="stock-official-actions">
          <button className="btn" type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCcw size={14} />
            {loading ? "匹配中" : "自动匹配官网/标签"}
          </button>
        </div>
      </div>
      <div className={status.includes("失败") ? "stock-official-status danger" : "stock-official-status"}>
        {status}
      </div>
      <div className="stock-official-grid">
        <div className="stock-official-card">
          <span>对应官网</span>
          {website ? (
            <a href={website} target="_blank" rel="noreferrer" title={website}>
              {displayWebsiteHost(website)}
            </a>
          ) : (
            <strong>暂无官网数据</strong>
          )}
          <em>{website ? "点击打开公司官方网站" : "同步包含官网字段的基础资料后自动显示"}</em>
        </div>
        <div className="stock-official-card">
          <span>行业标签</span>
          {tags.length ? (
            <div className="stock-industry-tag-list">
              {tags.map((tag) => (
                <b key={tag}>{tag}</b>
              ))}
            </div>
          ) : (
            <strong>暂无行业标签</strong>
          )}
          <em>用于快速识别行业、板块和指数归属</em>
        </div>
      </div>
    </div>
  );
}

function mergeStockProfileFields(current: Stock, profileStock: Stock): Stock {
  return {
    ...current,
    website: profileStock.website ?? current.website,
    industry1: profileStock.industry1,
    industry2: profileStock.industry2,
    industryTags: profileStock.industryTags ?? current.industryTags
  };
}

function stockRelatedNewsSources(newsSourceSettings: NewsSourceSettings, stock: Stock): NewsSourceEndpoint[] {
  const terms = compactUniqueTexts([stock.name, stock.code, stock.industry1, stock.industry2]);
  const query = terms.join(" OR ");
  return enabledNewsSources(newsSourceSettings).map((source) => ({
    ...source,
    query: source.query?.trim() ? `${query} OR (${source.query.trim()})` : query,
    maxItems: Math.max(Number(source.maxItems) || 0, 12)
  }));
}

function stockRelatedArticleText(article: NewsArticle) {
  return `${article.title} ${article.summary} ${article.content} ${article.tags.join(" ")} ${article.industries.join(" ")}`.toLowerCase();
}

function articleDirectlyMentionsStock(article: NewsArticle, stock: Stock) {
  const text = stockRelatedArticleText(article);
  const code = stock.code.toLowerCase();
  const name = stock.name.toLowerCase();
  return text.includes(code) || text.includes(name);
}

function articleMentionsStockIndustry(article: NewsArticle, stock: Stock) {
  const text = stockRelatedArticleText(article);
  return [stock.industry1, stock.industry2].some((industry) => industry && text.includes(industry.toLowerCase()));
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

function StockRelatedInfoSection({
  stock,
  stocks,
  newsSourceSettings
}: {
  stock: Stock;
  stocks: Stock[];
  newsSourceSettings: NewsSourceSettings;
}) {
  const [relatedArticles, setRelatedArticles] = useState<NewsArticle[]>([]);
  const [relatedStatus, setRelatedStatus] = useState("Bun 新闻接口等待请求");

  useEffect(
    function loadRelatedNewsFromBun() {
      let cancelled = false;
      setRelatedArticles([]);
      setRelatedStatus("正在通过 Bun 新闻接口读取该股票相关真实新闻...");
      const requestStocks = Array.from(new Map([stock, ...stocks].map((item) => [item.code, item])).values());
      fetchNewsArticlesFromSources(stockRelatedNewsSources(newsSourceSettings, stock), requestStocks, fetch, { mode: "fast" })
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setRelatedArticles([]);
            setRelatedStatus(`Bun 新闻接口失败：${result.details}`);
            return;
          }
          const diagnosticStatus = newsDiagnosticsStatusSuffix(result.sourceDiagnostics);
          const directCount = result.articles.filter((article) => articleDirectlyMentionsStock(article, stock)).length;
          const industryCount = directCount ? 0 : result.articles.filter((article) => articleMentionsStockIndustry(article, stock)).length;
          setRelatedArticles(result.articles);
          setRelatedStatus(
            `Bun 新闻接口完成：返回 ${result.stats.returnedRows} 条真实新闻，筛选 ${directCount || industryCount} 条相关信息${diagnosticStatus ? `；${diagnosticStatus}` : ""}`
          );
        })
        .catch((error) => {
          if (!cancelled) {
            setRelatedArticles([]);
            setRelatedStatus(`Bun 新闻接口失败：${readableError(error)}`);
          }
        });
      return () => {
        cancelled = true;
      };
    },
    [stock.code, stock.name, stock.industry1, stock.industry2, stocks, newsSourceSettings]
  );

  const directArticles = sortNewsByPublishTime(relatedArticles.filter((article) => articleDirectlyMentionsStock(article, stock)));
  const fallbackArticles = directArticles.length
    ? []
    : sortNewsByPublishTime(relatedArticles.filter((article) => articleMentionsStockIndustry(article, stock)));
  const useFallback = !directArticles.length && fallbackArticles.length > 0;
  const displayArticles = (directArticles.length ? directArticles : fallbackArticles).slice(0, 6);
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
      <div className={relatedStatus.includes("失败") ? "settings-status danger" : "settings-status"}>{relatedStatus}</div>
      <div className="stock-related-info-notice">本地样本资讯已清空。当前仅展示 Bun 新闻接口返回且命中该股票名称、代码或行业的真实新闻。</div>
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

function StockInfoModal({
  target,
  stocks,
  newsSourceSettings,
  onClose
}: {
  target: StockInfoTarget;
  stocks: Stock[];
  newsSourceSettings: NewsSourceSettings;
  onClose: () => void;
}) {
  const sourceStock = target.stock;
  const [liveStock, setLiveStock] = useState<Stock | null>(() => sourceStock ?? null);
  const [klinePeriod, setKlinePeriod] = useState<StockKlinePeriod>("day");
  const [klineResult, setKlineResult] = useState<StockKlineHistoryResult | null>(null);
  const [klineLoading, setKlineLoading] = useState(false);
  const [stockInfoSyncStatus, setStockInfoSyncStatus] = useState("腾讯股票信息接口已就绪");
  const [stockInfoSyncing, setStockInfoSyncing] = useState(false);
  const [stockProfileStatus, setStockProfileStatus] = useState("官网/行业标签自动匹配待请求");
  const [stockProfileLoading, setStockProfileLoading] = useState(false);
  const stock = liveStock;
  const stockCode = stock?.code ?? "";

  const applyStockProfileResult = (result: StockProfileResult) => {
    if (result.ok) {
      setLiveStock((current) =>
        current && current.code === result.stock.code ? mergeStockProfileFields(current, result.stock) : result.stock
      );
    }
    setStockProfileStatus(`${result.message}：${result.details}`);
  };

  useEffect(
    function resetLiveStockOnTargetChange() {
      setLiveStock(sourceStock ?? null);
      setStockInfoSyncStatus(sourceStock ? "腾讯股票信息接口已就绪" : "当前股票池未收录，无法请求股票信息");
      setStockProfileStatus(sourceStock ? "官网/行业标签将在打开后自动匹配" : "当前股票池未收录，无法自动匹配官网/行业标签");
    },
    [sourceStock?.code]
  );

  useEffect(
    function autoMatchStockOfficialInfo() {
      if (!sourceStock) {
        setStockProfileLoading(false);
        return;
      }

      let active = true;
      setStockProfileLoading(true);
      setStockProfileStatus("正在通过 Bun Eastmoney F10 自动匹配官网和行业标签...");

      fetchStockProfileAutoMatch(sourceStock)
        .then((result) => {
          if (active) applyStockProfileResult(result);
        })
        .catch((error) => {
          if (!active) return;
          setStockProfileStatus(`官网/行业标签自动匹配失败：${readableError(error)}`);
        })
        .finally(() => {
          if (active) setStockProfileLoading(false);
        });

      return function cancelStockOfficialInfoMatch() {
        active = false;
      };
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

  const refreshStockProfile = async () => {
    if (!stock) return;
    setStockProfileLoading(true);
    setStockProfileStatus("正在通过 Bun Eastmoney F10 自动匹配官网和行业标签...");
    const result = await fetchStockProfileAutoMatch(stock);
    applyStockProfileResult(result);
    setStockProfileLoading(false);
  };

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

        <StockOfficialInfoSection
          stock={stock}
          status={stockProfileStatus}
          loading={stockProfileLoading}
          onRefresh={refreshStockProfile}
        />
        <StockAnnualFinancialReportSection stock={stock} />
        <StockRelatedInfoSection stock={stock} stocks={stocks} newsSourceSettings={newsSourceSettings} />
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
  onDelete: (strategyId?: string) => void;
  onExport: () => void;
  onSectionChange: (section: MainSection) => void;
}) {
  const strategies = [strategy, ...savedStrategies.filter((item) => item.id !== strategy.id)];
  const currentSaved = savedStrategies.some((item) => item.id === strategy.id);
  const savedStrategyIds = new Set(savedStrategies.map((item) => item.id));
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
            <button className="manager-add-strategy" onClick={onNew}>
              <Plus size={14} />
              新增策略
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
            <button onClick={() => onDelete(strategy.id)} disabled={!currentSaved} title="删除当前策略">
              <Trash2 size={14} />
            </button>
          </div>

          <div className="manager-list">
            {strategies.map((item) => {
              const isSaved = savedStrategyIds.has(item.id);
              return (
                <div className={`manager-list-item ${item.id === strategy.id ? "active" : ""}`} key={item.id}>
                  <button className="strategy-row-main" onClick={() => onSelect(item)}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.filters.length}筛选 / {item.ranks.length}排名
                    </span>
                    <span className="strategy-updated">{formatStrategyUpdatedAt(item.updatedAt)}</span>
                  </button>
                  {isSaved ? (
                    <button className="strategy-row-delete" onClick={() => onDelete(item.id)} title={`删除策略 ${item.name}`}>
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <span className="strategy-row-draft">草稿</span>
                  )}
                </div>
              );
            })}
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
  const [holdingStrategies, setHoldingStrategies] = useState<StrategyConfig[]>(() => loadLocal<StrategyConfig[]>("holdingStrategies", []).map(ensureStrategyUpdatedAt));
  const [customPools, setCustomPools] = useState<StockPool[]>(() => loadLocal("customPools", []));
  const [customFactors, setCustomFactors] = useState<Factor[]>(() => loadLocal("customFactors", []));
  const [activeStep, setActiveStep] = useState<StepKey>("screen");
  const [topSection, setTopSection] = useState<MainSection>("dashboard");
  const [managerCollapsed, setManagerCollapsed] = useState(false);
  const [activeFactorGroup, setActiveFactorGroup] = useState<FactorGroup>("行情");
  const [conditionTab, setConditionTab] = useState<"filter" | "rank">("filter");
  const [backtestTab, setBacktestTab] = useState<BacktestTab>("backtest");
  const backtestTabRef = useRef<BacktestTab>(backtestTab);
  const setActiveBacktestTab = (nextTab: BacktestTab) => {
    backtestTabRef.current = nextTab;
    setBacktestTab(nextTab);
  };
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

  const [syncConfig, setSyncConfig] = useState<ScheduleConfig>(() => ({ ...defaultScheduleConfig }));
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [valuationDataSource, setValuationDataSource] = useState<Exclude<ValuationDataSource, "akshare">>(() =>
    ensureValuationDataSource(loadLocal<ValuationDataSource>("valuationDataSource", "none"))
  );
  const [valuationRealDataStatus, setValuationRealDataStatus] = useState("价值核算未接入真实数据，当前不进行本地样本核算");
  const [valuationDataSyncing, setValuationDataSyncing] = useState(false);
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
  const [strategyRunStatus, setStrategyRunStatus] = useState("");
  const [stockInfoTarget, setStockInfoTarget] = useState<StockInfoTarget | null>(null);
  const [poolDraft, setPoolDraft] = useState({ name: "我的股票池", codes: "600519,300750,002594,600036,600900" });
  const [customFactorDraft, setCustomFactorDraft] = useState({ name: "质量成长合成", formula: "qualityScore * 0.6 + revenueGrowth * 0.4 - pe * 0.2" });

  useEffect(() => {
    const handleClickFeedback = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) return;
      target.classList.remove("button-click-feedback");
      window.requestAnimationFrame(() => {
        target.classList.add("button-click-feedback");
        window.setTimeout(() => target.classList.remove("button-click-feedback"), 360);
      });
    };

    document.addEventListener("click", handleClickFeedback);
    return () => document.removeEventListener("click", handleClickFeedback);
  }, []);

  useEffect(() => {
    saveLocal("draftStrategy", strategy);
    saveLocal("savedStrategies", savedStrategies);
    saveLocal("holdingStrategies", holdingStrategies);
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
  const holdingStrategyImportCandidates = useMemo(() => {
    const candidateById = new Map<string, StrategyConfig>();
    [strategy, ...savedStrategies].forEach((item) => {
      if (!candidateById.has(item.id)) candidateById.set(item.id, ensureStrategyUpdatedAt(item));
    });
    return Array.from(candidateById.values());
  }, [strategy, savedStrategies]);
  const availableIndustry1 = useMemo(() => [ALL_INDUSTRIES, ...Array.from(new Set(stocks.map(inferPrimaryIndustry).filter(Boolean))).sort()], [stocks]);
  const availableIndustry2 = useMemo(() => {
    const list = stocks.filter((stock) => stockMatchesIndustry(stock, "industry1", strategy.industry1)).map(inferSecondaryIndustry).filter(Boolean);
    return [ALL_INDUSTRIES, ...Array.from(new Set(list)).sort()];
  }, [stocks, strategy.industry1]);
  const availableRegions = useMemo(() => ["全部", ...Array.from(new Set(stocks.map((stock) => stock.region).filter(Boolean))).sort()], [stocks]);
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

  const ensureStocksForStrategyRun = async () => {
    if (stocks.length) return stocks;
    setInfoSourceStatus("当前股票池为空，正在通过 Bun 数据接口接入全市场股票...");
    const result = await syncOpenSourceMarketData(infoSourceSettings, []);
    setInfoSourceStatus(`${result.message}；${result.details}`);
    if (!result.ok) {
      setSelectionRows([]);
      setRankRows([]);
      return [];
    }

    setStocks(result.stocks);
    setOpenSourceSummary(result.summary);
    saveLocal("openSourceStocks", result.stocks);
    saveLocal("openSourceDataSummary", result.summary);
    setValuationDataSource("openSource");
    saveLocal<ValuationDataSource>("valuationDataSource", "openSource");
    setValuationRealDataStatus(result.details);
    return result.stocks;
  };

  const runCurrentTask = async (tab = backtestTab) => {
    let strategyStocks: Stock[] = [];
    let strategyPools: StockPool[] = [];
    const label = tab === "backtest" ? "回测" : tab === "rank" || tab === "factorCorrelation" ? "排名分析" : "选股";
    try {
      saveLocal("backtestConfig", backtestConfig);
      setStrategyRunStatus(`正在通过 Bun ${label}接口运行...`);
      strategyStocks = await ensureStocksForStrategyRun();
      strategyPools = [...createRuntimeSystemPools(strategyStocks), ...customPools];
      if (!strategyStocks.length) {
        if (backtestTabRef.current === tab) setActiveBacktestTab(tab);
        setStrategyRunStatus("股票池为空，Bun 数据接口未返回可用股票。");
        return;
      }
      if (tab === "rank" || tab === "factorCorrelation") {
        const rows = await rankingAnalysisBunFirst(strategy, strategyStocks, strategyPools, factors);
        setRankRows(rows);
        if (backtestTabRef.current === tab) setActiveBacktestTab(tab);
        setStrategyRunStatus(`Bun 排名分析完成，返回 ${rows.length} 只股票。`);
        return;
      }
      if (tab === "daily" || tab === "realtime") {
        const rows = await screenStocksBunFirst(strategy, strategyStocks, strategyPools, factors, {
          resultLimit: strategy.poolLimit,
          weightLimit: strategy.trading.maxHoldings
        });
        const hydratedRows = hydrateSelectionRowsWithStockMetadata(rows, strategyStocks);
        setSelectionRows(hydratedRows);
        if (backtestTabRef.current === tab) setActiveBacktestTab(tab);
        setStrategyRunStatus(`Bun 选股完成，返回 ${hydratedRows.length}/${strategy.poolLimit} 只股票，正在自动匹配行业标签...`);
        void hydrateSelectionRowsWithMatchedIndustryTags(hydratedRows, strategyStocks)
          .then((result) => {
            setSelectionRows((currentRows) => hydrateSelectionRowsWithStockMetadata(currentRows, result.rows.map((row) => row.stock)));
            if (result.matchedCount > 0) {
              setStocks(result.stocks);
              saveLocal("openSourceStocks", result.stocks);
              setStrategyRunStatus(`Bun 选股完成，返回 ${hydratedRows.length}/${strategy.poolLimit} 只股票，行业标签已匹配 ${result.matchedCount} 只。`);
            } else {
              setStrategyRunStatus(`Bun 选股完成，返回 ${hydratedRows.length}/${strategy.poolLimit} 只股票，暂无新增行业标签。`);
            }
          })
          .catch((error) => {
            setStrategyRunStatus(`Bun 选股完成，返回 ${hydratedRows.length}/${strategy.poolLimit} 只股票，行业标签匹配失败：${readableError(error)}`);
          });
        return;
      }
      const next = await runBacktestBunFirst(strategy, strategyStocks, strategyPools, factors, backtestConfig);
      setResult(next);
      setSelectionRows(next.rows);
      if (backtestTabRef.current === tab) setActiveBacktestTab("backtest");
      setStrategyRunStatus(`Bun 回测完成，曲线 ${next.curve.length} 个点，持仓 ${next.rows.length} 只。`);
    } catch (error) {
      const detail = readableError(error);
      if (tab === "rank" || tab === "factorCorrelation") {
        setRankRows([]);
      } else {
        setSelectionRows([]);
      }
      if (tab === "backtest") setResult(null);
      if (backtestTabRef.current === tab) setActiveBacktestTab(tab);
      setInfoSourceStatus(`Bun 策略接口失败：${detail}`);
      setStrategyRunStatus(`Bun 策略接口失败：${detail}。当前不会使用浏览器本地策略引擎补齐结果。`);
    }
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
    setTopSection("strategy");
    persistStrategy(next, false);
  };

  const selectStrategy = (next: StrategyConfig) => {
    setResult(null);
    setRankRows([]);
    setSelectionRows([]);
    persistStrategy(next, false);
  };

  const importStrategiesToHoldings = (selectedStrategies: StrategyConfig[]) => {
    if (!selectedStrategies.length) {
      setTradeConnectionStatus("未选择可导入的持仓策略");
      return;
    }

    const importedStrategies = selectedStrategies.map((item) => touchStrategyUpdatedAt(item));
    const importedById = new Map(importedStrategies.map((item) => [item.id, item]));
    const updatedCount = holdingStrategies.filter((item) => importedById.has(item.id)).length;
    const existingWithoutImported = holdingStrategies.filter((item) => !importedById.has(item.id));
    const list = [...importedStrategies, ...existingWithoutImported].slice(0, 20);
    const createdCount = importedStrategies.length - updatedCount;
    setHoldingStrategies(list);
    saveLocal("holdingStrategies", list);
    setModal(null);
    setTradeConnectionStatus(`已导入持仓策略 ${createdCount} 个，更新 ${updatedCount} 个`);
  };

  const removeHoldingStrategy = (strategyId: string) => {
    const target = holdingStrategies.find((item) => item.id === strategyId);
    if (!target) return;
    const confirmed = window.confirm(`确认从持仓策略中移除「${target.name}」？选股策略本身不会删除。`);
    if (!confirmed) return;

    const list = holdingStrategies.filter((item) => item.id !== strategyId);
    setHoldingStrategies(list);
    saveLocal("holdingStrategies", list);
    setTradeConnectionStatus(`已从持仓策略移除：${target.name}`);
  };

  const deleteStrategy = (strategyId = strategy.id) => {
    const target = savedStrategies.find((item) => item.id === strategyId);
    if (!target) return;
    const confirmed = window.confirm(`确认删除策略「${target.name}」？删除后不可恢复。`);
    if (!confirmed) return;

    const list = savedStrategies.filter((item) => item.id !== strategyId);
    setSavedStrategies(list);
    saveLocal("savedStrategies", list);
    const nextHoldingStrategies = holdingStrategies.filter((item) => item.id !== strategyId);
    setHoldingStrategies(nextHoldingStrategies);
    saveLocal("holdingStrategies", nextHoldingStrategies);
    if (strategyId === strategy.id) {
      setResult(null);
      setRankRows([]);
      setSelectionRows([]);
      persistStrategy(list[0] ?? createDefaultStrategy(), false);
    }
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

  const optimize = async () => {
    const strategyStocks = await ensureStocksForStrategyRun();
    if (!strategyStocks.length) return;
    const strategyPools = [...createRuntimeSystemPools(strategyStocks), ...customPools];
    try {
      const best = await optimizeStrategyBunFirst(strategy, strategyStocks, strategyPools, factors, backtestConfig);
      persistStrategy(best.candidate);
      setResult(best.result);
      setModal(null);
    } catch (error) {
      const detail = readableError(error);
      setInfoSourceStatus(`Bun 策略优化接口失败：${detail}`);
      setStrategyRunStatus(`Bun 策略优化接口失败：${detail}。当前不会使用浏览器本地优化引擎补齐候选策略。`);
    }
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

  const refreshSyncStatus = async () => {
    try {
      setSyncStatus(await fetchSyncStatus());
    } catch (error) {
      setInfoSourceStatus("定时同步状态获取失败：" + readableError(error));
    }
  };

  const patchSyncConfig = (patch: Partial<ScheduleConfig>) => {
    setSyncConfig((current) => ({ ...current, ...patch, sources: { ...current.sources, ...(patch.sources ?? {}) } }));
  };

  const toggleSyncSource = (key: keyof ScheduleConfig["sources"]) => {
    setSyncConfig((current) => ({ ...current, sources: { ...current.sources, [key]: !current.sources[key] } }));
  };

  const saveSyncSchedule = async () => {
    setSyncBusy(true);
    try {
      const saved = await saveScheduleSyncConfig(syncConfig);
      setSyncConfig(saved);
      setInfoSourceStatus("定时同步配置已保存并生效");
      await refreshSyncStatus();
    } catch (error) {
      setInfoSourceStatus("定时同步配置保存失败：" + readableError(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const runManualSync = async () => {
    setSyncBusy(true);
    setInfoSourceStatus("正在手动触发数据采集...");
    try {
      const result = await triggerManualSync();
      const okCount = result.results.filter((r) => r.ok).length;
      setInfoSourceStatus("手动同步完成：" + okCount + "/" + result.results.length + " 个数据源成功");
      await refreshSyncStatus();
    } catch (error) {
      setInfoSourceStatus("手动同步失败：" + readableError(error));
    } finally {
      setSyncBusy(false);
    }
  };

  const syncOpenSourceData = async () => {
    setInfoSourceStatus(`正在通过 ${infoSourceDisplayName(infoSourceSettings)} 同步真实数据...`);
    const result = await syncOpenSourceMarketData(infoSourceSettings, stocks);
    if (result.ok) {
      setStocks(result.stocks);
      setOpenSourceSummary(result.summary);
      saveLocal("openSourceStocks", result.stocks);
      saveLocal("openSourceDataSummary", result.summary);
      setValuationDataSource("openSource");
      saveLocal<ValuationDataSource>("valuationDataSource", "openSource");
      setValuationRealDataStatus(result.details);
      setResult(null);
      setRankRows([]);
      setSelectionRows([]);
    }
    setInfoSourceStatus(`${result.message}：${result.details}`);
  };

  const syncValuationRealData = async () => {
    setValuationDataSyncing(true);
    try {
      setValuationRealDataStatus("正在从腾讯行情扫描全市场 A 股代码并接入真实行情...");
      const result = await syncTencentAllAshareMarketData(stocks);
      if (result.ok) {
        const financeMatchedRows = result.stocks.filter((stock) => stock.metrics.realAnnualReportSource === 1).length;
        const valuationReadyRows = result.stocks.filter(hasRequiredRealValuationData).length;
        const nextSummary = {
          ...openSourceSummary,
          lastSyncAt: result.checkedAt,
          matchedRows: result.matchedRows,
          sourceRows: result.sourceRows,
          financeMatchedRows,
          financeSourceRows: financeMatchedRows ? openSourceSummary.financeSourceRows : 0,
          analystMatchedRows: financeMatchedRows ? openSourceSummary.analystMatchedRows : 0,
          analystSourceRows: financeMatchedRows ? openSourceSummary.analystSourceRows : 0,
          marginMatchedRows: financeMatchedRows ? openSourceSummary.marginMatchedRows : 0,
          marginSourceRows: financeMatchedRows ? openSourceSummary.marginSourceRows : 0,
          valuationReadyRows,
          technicalMatchedRows: result.technicalMatchedRows,
          technicalSourceRows: result.technicalSourceRows,
          stockCount: result.stocks.length,
          details: result.details
        };
        setStocks(result.stocks);
        setOpenSourceSummary(nextSummary);
        saveLocal("openSourceStocks", result.stocks);
        saveLocal("openSourceDataSummary", nextSummary);
        setValuationDataSource("tencentQuote");
        saveLocal<ValuationDataSource>("valuationDataSource", "tencentQuote");
        setResult(null);
        setRankRows([]);
        setSelectionRows([]);
      }
      setValuationRealDataStatus(`${result.message}：${result.details}`);
    } finally {
      setValuationDataSyncing(false);
    }
  };

  const syncValuationFinancialReports = async () => {
    setValuationDataSyncing(true);
    try {
      const sourceName = infoSourceDisplayName(infoSourceSettings);
      setValuationRealDataStatus(`正在从 ${sourceName} 同步真实财报...`);
      const result = await syncOpenSourceFinancialReports(infoSourceSettings, stocks);
      if (result.ok) {
        const nextSummary = {
          ...openSourceSummary,
          ...result.summary,
          matchedRows: openSourceSummary.matchedRows,
          sourceRows: openSourceSummary.sourceRows,
          provider: result.summary.provider,
          stockCount: result.summary.stockCount,
          lastSyncAt: result.summary.lastSyncAt,
          details: result.details
        };
        setStocks(result.stocks);
        setOpenSourceSummary(nextSummary);
        saveLocal("openSourceStocks", result.stocks);
        saveLocal("openSourceDataSummary", nextSummary);
        setValuationDataSource("openSource");
        saveLocal<ValuationDataSource>("valuationDataSource", "openSource");
        setResult(null);
        setRankRows([]);
        setSelectionRows([]);
      }
      setValuationRealDataStatus(`${result.message}：${result.details}`);
      setInfoSourceStatus(`${result.message}：${result.details}`);
    } finally {
      setValuationDataSyncing(false);
    }
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

  const saveTradePlan = (plan: TradePlan) => {
    const nextState = ensurePaperTradeState({
      ...paperTradeState,
      plans: [plan, ...paperTradeState.plans.filter((item) => item.id !== plan.id)].slice(0, 30)
    });
    setPaperTradeState(nextState);
    saveLocal("paperTradeState", nextState);
  };

  const generateTradePlan = async (rows: SelectionRow[], mode: ExecutionMode, label = "交易指令", minimumAmount = 0, accountAsset = 500000) => {
    try {
      const tradeExport = await createTradePlanExportBunFirst({
        strategy,
        rows,
        mode,
        accountId: tradeConnection.accountId,
        accountAsset,
        minimumAmount
      });
      const plan = tradeExport.plan;
      saveTradePlan(plan);
      setTradeConnectionStatus(`已生成 ${plan.orders.length} 条${label}`);
      return tradeExport;
    } catch (error) {
      setTradeConnectionStatus(`Bun 交易指令接口失败：${readableError(error)}`);
      throw error;
    }
  };

  const exportTradePlan = async (rows: SelectionRow[], mode: ExecutionMode, label = "交易指令", minimumAmount = 0, accountAsset = 500000) => {
    try {
      const tradeExport = await generateTradePlan(rows, mode, label, minimumAmount, accountAsset);
      downloadTextFile(`${safeFileName(strategy.name)}-${label}.csv`, `\ufeff${tradeExport.csv}`, "text/csv;charset=utf-8");
      setTradeConnectionStatus(`已导出 ${tradeExport.plan.orders.length} 条${label}`);
      return tradeExport;
    } catch (error) {
      setTradeConnectionStatus(`Bun 交易导出接口失败：${readableError(error)}`);
      throw error;
    }
  };

  const clearTradePlans = (strategyId: string) => {
    const nextPlans = paperTradeState.plans.filter((plan) => !(plan.strategyId === strategyId && (plan.status === "draft" || plan.status === "confirmed")));
    const removedCount = paperTradeState.plans.length - nextPlans.length;
    const nextState = ensurePaperTradeState({
      ...paperTradeState,
      plans: nextPlans
    });
    setPaperTradeState(nextState);
    saveLocal("paperTradeState", nextState);
    setTradeConnectionStatus(removedCount ? `已解除 ${removedCount} 个未成交指令` : "当前没有可解除的未成交指令");
    return removedCount;
  };

  const submitPaperTradePlan = async (rows: SelectionRow[], accountAsset = 500000) => {
    if (!tradeConnection.bound) {
      setTradeConnectionStatus("自动交易前必须先绑定交易接口");
      return null;
    }
    try {
      const plan = await createTradePlanBunFirst({
        strategy,
        rows,
        mode: "auto",
        accountId: tradeConnection.accountId,
        accountAsset
      });
      const nextState = await submitPaperTradePlanBunFirst(paperTradeState, plan);
      const submittedPlan = nextState.plans.find((item) => item.id === plan.id) ?? plan;
      setPaperTradeState(nextState);
      saveLocal("paperTradeState", nextState);
      setTradeConnectionStatus(`纸面交易已成交 ${submittedPlan.orders.length} 笔`);
      return submittedPlan;
    } catch (error) {
      setTradeConnectionStatus(`Bun 自动交易接口失败：${readableError(error)}`);
      return null;
    }
  };

  return (
    <>
      <div className="app-shell">
        <header className="primary-nav">
          <button className={topSection === "dashboard" ? "active" : ""} onClick={() => setTopSection("dashboard")}>
            <LayoutDashboard size={16} />
            工作台
          </button>
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

        <div className={`workspace-layout ${managerCollapsed ? "manager-collapsed" : ""} ${topSection === "settings" || topSection === "sentiment" || topSection === "valuation" || topSection === "dashboard" ? "settings-mode" : ""}`}>
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
            {topSection === "dashboard" ? (
              <DashboardWorkspace
                stocks={stocks}
                selectionRows={selectionRows}
                paperTradeState={paperTradeState}
                openSourceSummary={openSourceSummary}
                savedStrategies={savedStrategies}
                syncStatus={syncStatus}
                syncBusy={syncBusy}
                onRunManualSync={runManualSync}
                onNavigate={setTopSection}
              />
            ) : topSection === "strategy" ? (
              <main>
                <section className="strategy-title">
                  <div className="title-edit" onClick={() => setModal("summary")}>
                    <Edit3 size={15} />
                    <strong>{strategy.name}</strong>
                    {strategy.description ? <span>{strategy.description}</span> : null}
                  </div>
                  <div className="title-actions">
                    <button className="title-add-strategy" onClick={newStrategy}>
                      <Plus size={14} />
                      新增策略
                    </button>
                    <button onClick={() => setModal("optimization")}>智能调优</button>
                    <button onClick={() => deleteStrategy(strategy.id)} disabled={!savedStrategies.some((item) => item.id === strategy.id)}>
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
                      availableIndustry1={availableIndustry1}
                      availableIndustry2={availableIndustry2}
                      availableRegions={availableRegions}
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
                  setTab={setActiveBacktestTab}
                  config={backtestConfig}
                  setConfig={setBacktestConfig}
                  result={result}
                  selectionRows={selectionRows}
                  rankRows={rankRows}
                  runStatus={strategyRunStatus}
                  factors={factors}
                  strategy={strategy}
                  patchStrategy={patchStrategy}
                  runCurrentTask={runCurrentTask}
                  openCompare={() => setModal("compare")}
                  onOpenStockInfo={openStockInfo}
                />
              </main>
            ) : topSection === "sentiment" ? (
              <main>
                <SentimentWorkspace
                  stocks={stocks}
                  newsSourceSettings={newsSourceSettings}
                  newsAnalysisModelSettings={newsAnalysisModelSettings}
                />
              </main>
            ) : topSection === "valuation" ? (
              <main>
                <ValuationWorkspace
                  stocks={stocks}
                  newsSourceSettings={newsSourceSettings}
                  infoSourceSettings={infoSourceSettings}
                  realDataStatus={valuationRealDataStatus}
                  financeSummary={openSourceSummary}
                  isDataSyncing={valuationDataSyncing}
                  isRealDataReady={
                    valuationDataSource !== "none" &&
                    stocks.some((stock) => stock.metrics.realQuoteSource === 1 || stock.metrics.openSourceMarketSource === 1 || stock.metrics.realAnnualReportSource === 1)
                  }
                  onSyncRealData={syncValuationRealData}
                  onSyncFinancialReports={syncValuationFinancialReports}
                />
              </main>
            ) : topSection === "trade" ? (
              <main>
                <TradeWorkspace
                  strategy={strategy}
                  rows={selectionRows}
                  tradeConnection={tradeConnection}
                  tradeConnectionStatus={tradeConnectionStatus}
                  paperTradeState={paperTradeState}
                  holdingStrategies={holdingStrategies}
                  patchTradeConnection={patchTradeConnection}
                  bindTradingInterface={bindTradingInterface}
                  openHoldingImportModal={() => setModal("importHoldings")}
                  removeHoldingStrategy={removeHoldingStrategy}
                  generateTradePlan={generateTradePlan}
                  exportTradePlan={exportTradePlan}
                  clearTradePlans={clearTradePlans}
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
        syncConfig={syncConfig}
        syncStatus={syncStatus}
        syncBusy={syncBusy}
        onPatchSyncConfig={patchSyncConfig}
        onToggleSyncSource={toggleSyncSource}
        onSaveSyncConfig={saveSyncSchedule}
        onRunManualSync={runManualSync}
        onRefreshSyncStatus={refreshSyncStatus}
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
                  <td>保留当前权重，Bun 调优优先搜索持仓数</td>
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

      {modal === "importHoldings" ? (
        <HoldingStrategyImportModal
          candidates={holdingStrategyImportCandidates}
          holdingStrategyIds={new Set(holdingStrategies.map((item) => item.id))}
          onImport={importStrategiesToHoldings}
          onClose={() => setModal(null)}
        />
      ) : null}

      {stockInfoTarget ? (
        <StockInfoModal
          target={stockInfoTarget}
          stocks={stocks}
          newsSourceSettings={newsSourceSettings}
          onClose={() => setStockInfoTarget(null)}
        />
      ) : null}
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
  availableIndustry1,
  availableIndustry2,
  availableRegions,
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
  availableIndustry1: string[];
  availableIndustry2: string[];
  availableRegions: string[];
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
          <NumberField label="选股数量" value={strategy.poolLimit} min={1} onChange={(poolLimit) => patchStrategy({ poolLimit })} />
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
          <SelectField label="一级行业：" value={strategy.industry1} options={availableIndustry1} onChange={(industry1) => patchStrategy({ industry1, industry2: ALL_INDUSTRIES })} />
          <SelectField label="二级行业：" value={strategy.industry2} options={availableIndustry2} onChange={(industry2) => patchStrategy({ industry2 })} />
          <SelectField
            label="ST股票："
            value={strategy.stMode}
            options={["包含ST", "排除ST", "仅有ST"]}
            onChange={(stMode) => patchStrategy({ stMode: stMode as StrategyConfig["stMode"] })}
          />
          <SelectField label="交易所：" value={strategy.exchange} options={EXCHANGE_OPTIONS} onChange={(exchange) => patchStrategy({ exchange })} />
          <SelectField label="地域板块：" value={strategy.region} options={availableRegions} onChange={(region) => patchStrategy({ region })} />
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
          <strong>Bun 对冲回测引擎</strong>
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

function NewsSourceInterfaceBar({ sources }: { sources: NewsSourceEndpoint[] }) {
  const enabledSources = enabledNewsSources({ sources });
  return (
    <div className="news-source-interface-bar">
      <span>舆情新闻接口</span>
      <div>
        {enabledSources.length ? (
          enabledSources.map((source) => (
            <span className="news-source-interface-chip" key={source.id} title={source.query}>
              <strong>{source.name}</strong>
              <em>{source.provider}</em>
            </span>
          ))
        ) : (
          <span className="news-source-interface-empty">未启用真实新闻源</span>
        )}
      </div>
    </div>
  );
}

function DashboardWorkspace({
  stocks,
  selectionRows,
  paperTradeState,
  openSourceSummary,
  savedStrategies,
  syncStatus,
  syncBusy,
  onRunManualSync,
  onNavigate
}: {
  stocks: Stock[];
  selectionRows: SelectionRow[];
  paperTradeState: PaperTradeState;
  openSourceSummary: OpenSourceDataSummary;
  savedStrategies: StrategyConfig[];
  syncStatus: SyncStatus | null;
  syncBusy: boolean;
  onRunManualSync: () => void;
  onNavigate: (section: MainSection) => void;
}) {
  const [marketOverview, setMarketOverview] = useState<MarketTemperature | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [selectionMode, setSelectionMode] = useState<"daily" | "realtime">("daily");

  useEffect(() => {
    const fetchOverview = async () => {
      setMarketLoading(true);
      try {
        const res = await fetch("/api/dashboard/market-overview");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        setMarketOverview(data);
        setMarketError("");
      } catch (err) {
        setMarketError(String(err));
      } finally {
        setMarketLoading(false);
      }
    };
    fetchOverview();
    const interval = setInterval(fetchOverview, 60000);
    return () => clearInterval(interval);
  }, []);

  const temperature = useMemo(() => computeMarketTemperature(stocks), [stocks]);
  const allIndustryMomentum = useMemo(() => computeIndustryMomentum(stocks, 200), [stocks]);
  const strongIndustries = useMemo(() => allIndustryMomentum.slice(0, 5), [allIndustryMomentum]);
  const weakIndustries = useMemo(() => allIndustryMomentum.slice(-5).reverse(), [allIndustryMomentum]);
  const holdingSummary = useMemo(() => summarizeHoldings(paperTradeState, stocks), [paperTradeState, stocks]);
  const topSelections = useMemo(() => [...selectionRows].sort((a, b) => b.score - a.score).slice(0, 10), [selectionRows]);
  const unclassifiedCount = useMemo(() => stocks.filter((stock) => !stock.industry1 || stock.industry1 === "未分类").length, [stocks]);
  const marketSession = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (day === 0 || day === 6) return "休市";
    if (minutes < 9 * 60 + 30) return "开盘前";
    if (minutes <= 11 * 60 + 30) return "早盘";
    if (minutes < 13 * 60) return "午间";
    if (minutes <= 15 * 60) return "盘中";
    return "已收盘";
  }, []);

  const fmtAmount = (v: number) => {
    if (v >= 10000) return (v / 10000).toFixed(2) + " 亿";
    return v.toFixed(2) + " 万";
  };
  const fmtPct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  const fmtMoney = (v: number) => v.toFixed(2);

  const overview = marketOverview ?? temperature;
  const latestRun = syncStatus?.runs[0];
  const lastSyncLabel = syncStatus?.lastFullSync ?? openSourceSummary.lastSyncAt ?? "未同步";
  const dataStatusLabel = syncBusy || syncStatus?.running ? "同步中" : latestRun?.ok === false ? "同步异常" : openSourceSummary.lastSyncAt ? "可用" : "待接入";
  const dataStatusTone = dataStatusLabel === "可用" ? "positive" : dataStatusLabel === "同步异常" ? "negative" : "neutral";
  const holdingRiskCount = holdingSummary.totalPnl < 0 ? 1 : 0;
  const syncStateLabel = syncBusy ? "采集中" : syncStatus?.running ? "运行中" : latestRun?.ok === false ? "失败" : "就绪";

  return (
    <main className="dashboard-workspace">
      <section className="dashboard-status-strip">
        <div className="dashboard-status-item">
          <span className="dashboard-status-label">数据状态</span>
          <strong className={dataStatusTone}>{dataStatusLabel}</strong>
          <span>{lastSyncLabel}</span>
        </div>
        <div className="dashboard-status-item">
          <span className="dashboard-status-label">市场状态</span>
          <strong>{marketSession}</strong>
          <span>{overview.label} {fmtPct(overview.avgChange)}</span>
        </div>
        <div className="dashboard-status-item">
          <span className="dashboard-status-label">今日候选</span>
          <strong>{selectionRows.length}</strong>
          <span>{selectionMode === "daily" ? "每日选股" : "实时选股"}</span>
        </div>
        <div className="dashboard-status-item">
          <span className="dashboard-status-label">持仓风险</span>
          <strong className={holdingRiskCount > 0 ? "negative" : ""}>{holdingRiskCount}</strong>
          <span>{holdingSummary.positionCount ? `${holdingSummary.positionCount} 只持仓` : "未导入持仓"}</span>
        </div>
        <div className="dashboard-status-item">
          <span className="dashboard-status-label">同步任务</span>
          <strong>{syncStateLabel}</strong>
          <span>{latestRun ? `${latestRun.source} ${latestRun.rowCount} 行` : "无最近任务"}</span>
        </div>
      </section>

      <section className="dashboard-card dashboard-market-overview">
        <div className="dashboard-card-header">
          <h3>市场总览</h3>
          <div className="dashboard-header-actions">
            <span className="dashboard-data-source">东方财富实时行情</span>
            <button className="dashboard-refresh-btn" onClick={() => {
              setMarketLoading(true);
              fetch("/api/dashboard/market-overview").then((r) => r.json()).then((d) => { setMarketOverview(d); setMarketLoading(false); }).catch(() => setMarketLoading(false));
            }} disabled={marketLoading}>
              <RefreshCcw size={14} />
              {marketLoading ? "刷新中" : "刷新"}
            </button>
          </div>
        </div>
        <div className="dashboard-temperature">
          <div className={"dashboard-temp-score " + (overview.score >= 65 ? "hot" : overview.score >= 45 ? "neutral" : "cold")} style={{ "--score": overview.score } as Record<string, string | number>}>
            <span className="dashboard-temp-value">{overview.score}</span>
            <span className="dashboard-temp-label">{overview.label}</span>
          </div>
          <div className="dashboard-temp-bar">
            <div className="dashboard-temp-bar-fill" style={{ width: overview.score + "%" }} />
          </div>
        </div>
        <div className="dashboard-market-stats">
          <div className="dashboard-stat">
            <span className="dashboard-stat-value positive">{overview.advancers}</span>
            <span className="dashboard-stat-label">上涨</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value negative">{overview.decliners}</span>
            <span className="dashboard-stat-label">下跌</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{overview.limitUp}</span>
            <span className="dashboard-stat-label">涨停</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{overview.limitDown}</span>
            <span className="dashboard-stat-label">跌停</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{fmtPct(overview.avgChange)}</span>
            <span className="dashboard-stat-label">平均涨跌</span>
          </div>
          <div className="dashboard-stat">
            <span className="dashboard-stat-value">{fmtAmount(overview.totalAmount)}</span>
            <span className="dashboard-stat-label">总成交额</span>
          </div>
        </div>
        {marketError ? <p className="dashboard-error">{marketError}</p> : null}
      </section>

      <section className="dashboard-card dashboard-holdings">
        <div className="dashboard-card-header">
          <h3>持仓摘要</h3>
          <button className="dashboard-link-btn" onClick={() => onNavigate("trade")}>
            <LineChart size={14} />
            去交易
          </button>
        </div>
        {holdingSummary.positionCount > 0 ? (
          <div className="dashboard-holdings-body">
            <div className="dashboard-holdings-summary">
              <div className="dashboard-holdings-stat">
                <span className="dashboard-holdings-label">总市值</span>
                <span className="dashboard-holdings-value">{fmtMoney(holdingSummary.totalValue)}</span>
              </div>
              <div className="dashboard-holdings-stat">
                <span className="dashboard-holdings-label">总成本</span>
                <span className="dashboard-holdings-value">{fmtMoney(holdingSummary.totalCost)}</span>
              </div>
              <div className="dashboard-holdings-stat">
                <span className="dashboard-holdings-label">浮动盈亏</span>
                <span className={"dashboard-holdings-value " + (holdingSummary.totalPnl >= 0 ? "positive" : "negative")}>
                  {fmtMoney(holdingSummary.totalPnl)} ({fmtPct(holdingSummary.pnlPercent)})
                </span>
              </div>
              <div className="dashboard-holdings-stat">
                <span className="dashboard-holdings-label">持仓数</span>
                <span className="dashboard-holdings-value">{holdingSummary.positionCount}</span>
              </div>
            </div>
            {holdingSummary.industryBreakdown.length > 0 ? (
              <div className="dashboard-industry-breakdown">
                {holdingSummary.industryBreakdown.slice(0, 5).map((item) => (
                  <div className="dashboard-breakdown-item" key={item.industry}>
                    <span className="dashboard-breakdown-name">{item.industry}</span>
                    <span className="dashboard-breakdown-count">{item.count} 只</span>
                    <span className="dashboard-breakdown-value">{fmtMoney(item.value)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="dashboard-holdings-extremes">
              {holdingSummary.topGainer ? (
                <div className="dashboard-extreme">
                  <span className="dashboard-extreme-label">最大盈利</span>
                  <span className="dashboard-extreme-name">{holdingSummary.topGainer.name}</span>
                  <span className="dashboard-extreme-value positive">{fmtPct(holdingSummary.topGainer.pnlPercent)}</span>
                </div>
              ) : null}
              {holdingSummary.topLoser ? (
                <div className="dashboard-extreme">
                  <span className="dashboard-extreme-label">最大亏损</span>
                  <span className="dashboard-extreme-name">{holdingSummary.topLoser.name}</span>
                  <span className="dashboard-extreme-value negative">{fmtPct(holdingSummary.topLoser.pnlPercent)}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="dashboard-empty-state">
            <strong>暂无持仓记录</strong>
            <span>导入持仓后，工作台会显示行业分布、浮动盈亏和风险提示。</span>
            <button className="dashboard-empty-action" onClick={() => onNavigate("trade")}>
              <LineChart size={14} />
              去导入持仓
            </button>
          </div>
        )}
      </section>

      <section className="dashboard-card dashboard-selections">
        <div className="dashboard-card-header">
          <h3>选股工作区</h3>
          <div className="dashboard-selection-tabs" role="tablist" aria-label="选股类型">
            <button className={selectionMode === "daily" ? "active" : ""} onClick={() => setSelectionMode("daily")}>每日选股</button>
            <button className={selectionMode === "realtime" ? "active" : ""} onClick={() => setSelectionMode("realtime")}>实时选股</button>
          </div>
        </div>
        <div className="dashboard-section-summary">
          <span>{selectionMode === "daily" ? "收盘后策略候选" : "盘中实时候选"}</span>
          <strong>{topSelections.length}</strong>
          <span>展示得分前 10，只用于工作台预览</span>
        </div>
        {topSelections.length > 0 ? (
          <table className="dashboard-selection-table">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>得分</th>
                <th>权重</th>
                <th>行业</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
              {topSelections.map((row) => (
                <tr key={row.stock.code}>
                  <td className="mono">{row.stock.code}</td>
                  <td>{row.stock.name}</td>
                  <td className="mono">{row.score.toFixed(1)}</td>
                  <td className="mono">{(row.weight * 100).toFixed(1)}%</td>
                  <td>{row.stock.industry1}</td>
                  <td><button className="dashboard-table-action" onClick={() => onNavigate("trade")}>交易计划</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dashboard-empty-state">
            <strong>{selectionMode === "daily" ? "尚未生成每日选股" : "尚未生成实时选股"}</strong>
            <span>{selectionMode === "daily" ? "运行策略后，这里会显示候选股票、得分、权重和行业。" : "切到策略页运行实时选股后，这里会显示盘中候选。"}</span>
            <button className="dashboard-empty-action" onClick={() => onNavigate("strategy")}>
              <SlidersHorizontal size={14} />
              去运行策略
            </button>
          </div>
        )}
      </section>

      <section className="dashboard-card dashboard-industry">
        <div className="dashboard-card-header">
          <h3>行业轮动</h3>
          <span className="dashboard-data-source">未分类 {unclassifiedCount}</span>
        </div>
        {allIndustryMomentum.length > 0 ? (
          <div className="dashboard-industry-columns">
            <div className="dashboard-industry-column">
              <div className="dashboard-column-title">强势行业</div>
              {strongIndustries.map((item, idx) => (
                <div className="dashboard-industry-row" key={item.industry}>
                  <span className="dashboard-industry-rank">{idx + 1}</span>
                  <span className="dashboard-industry-name">{item.industry}</span>
                  <span className="dashboard-industry-count">{item.stockCount} 只</span>
                  <span className="dashboard-industry-top">{item.topStock}</span>
                  <span className="dashboard-industry-change positive">{fmtPct(item.avgChange)}</span>
                </div>
              ))}
            </div>
            <div className="dashboard-industry-column">
              <div className="dashboard-column-title">弱势行业</div>
              {weakIndustries.map((item, idx) => (
                <div className="dashboard-industry-row" key={item.industry}>
                  <span className="dashboard-industry-rank">{idx + 1}</span>
                  <span className="dashboard-industry-name">{item.industry}</span>
                  <span className="dashboard-industry-count">{item.stockCount} 只</span>
                  <span className="dashboard-industry-top">{item.topStock}</span>
                  <span className="dashboard-industry-change negative">{fmtPct(item.avgChange)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="dashboard-empty-state">
            <strong>暂无行业轮动信号</strong>
            <span>同步行情并完成行业匹配后，这里会显示强弱行业和领涨股票。</span>
            <button className="dashboard-empty-action" onClick={onRunManualSync} disabled={syncBusy}>
              <RefreshCcw size={14} />
              {syncBusy ? "采集中" : "同步数据"}
            </button>
          </div>
        )}
      </section>

      <section className="dashboard-card dashboard-actions">
        <div className="dashboard-card-header">
          <h3>快速操作</h3>
        </div>
        <div className="dashboard-action-buttons dashboard-toolbar">
          <button className="dashboard-action-btn" onClick={onRunManualSync} disabled={syncBusy}>
            <RefreshCcw size={18} />
            <span>{syncBusy ? "采集中" : "采集数据"}</span>
          </button>
          <button className="dashboard-action-btn" onClick={() => onNavigate("strategy")}>
            <SlidersHorizontal size={18} />
            <span>每日选股</span>
          </button>
          <button className="dashboard-action-btn" onClick={() => onNavigate("strategy")}>
            <Activity size={18} />
            <span>实时选股</span>
          </button>
          <button className="dashboard-action-btn" onClick={() => onNavigate("trade")}>
            <LineChart size={18} />
            <span>交易计划</span>
          </button>
          <button className="dashboard-action-btn" onClick={() => onNavigate("sentiment")}>
            <Activity size={18} />
            <span>舆情监控</span>
          </button>
          <button className="dashboard-action-btn" onClick={() => onNavigate("valuation")}>
            <BarChart3 size={18} />
            <span>价值核算</span>
          </button>
          <button className="dashboard-action-btn" onClick={() => onNavigate("settings")}>
            <Settings size={18} />
            <span>数据设置</span>
          </button>
        </div>
        <div className="dashboard-sync-status">
          {syncStatus ? (
            <>
              <span className="dashboard-sync-info">最近同步: {syncStatus.lastFullSync ?? "--"}</span>
              {syncStatus.runs[0] ? <span className="dashboard-sync-info">{syncStatus.runs[0].ok ? "成功" : "失败"} - {syncStatus.runs[0].rowCount} 行</span> : null}
            </>
          ) : (
            <span className="dashboard-sync-info">同步状态未加载</span>
          )}
        </div>
        <div className="dashboard-strategy-list">
          <span className="dashboard-sync-info">已保存策略: {savedStrategies.length} 个</span>
          <span className="dashboard-sync-info">数据源: {openSourceSummary.provider || "--"}</span>
          <span className="dashboard-sync-info">股票数: {stocks.length}</span>
        </div>
      </section>
    </main>
  );
}

function SentimentWorkspace({
  stocks,
  newsSourceSettings,
  newsAnalysisModelSettings
}: {
  stocks: Stock[];
  newsSourceSettings: NewsSourceSettings;
  newsAnalysisModelSettings: NewsAnalysisModelSettings;
}) {
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
  const [sentimentAnalysis, setSentimentAnalysis] = useState<SentimentAnalysisResult>(() => createEmptySentimentAnalysis());
  const industryOptions = useMemo(
    () => ["全部", ...Array.from(new Set(rawSentimentEvents.flatMap((event) => event.industries))).sort()],
    [rawSentimentEvents]
  );
  const events = useMemo(() => filterSentimentEvents(rawSentimentEvents, filters), [rawSentimentEvents, filters]);
  const linkedStocks = sentimentAnalysis.linkedStocks;
  const report = sentimentAnalysis.report;
  const topEvent = events[0];
  const positiveCount = events.filter((event) => event.direction === "利好").length;
  const negativeCount = events.filter((event) => event.direction === "利空").length;
  const majorCount = events.filter((event) => event.severity === "特别重大" || event.severity === "重大").length;
  const focusedIndustry = filters.industry === "全部" ? report.topIndustries[0]?.industry ?? "--" : filters.industry;
  const openStockInfo = (stock: StockReference) => setStockInfoTarget(resolveStockInfoTarget(stock, stocks));

  useEffect(
    function syncSentimentAnalysisFromBun() {
      let cancelled = false;
      setSentimentAnalysis(createEmptySentimentAnalysis(events));
      void buildSentimentAnalysisBunFirst(events, stocks, newsAnalysisModelSettings, fetch)
        .then((nextAnalysis) => {
          if (!cancelled) setSentimentAnalysis(nextAnalysis);
        })
        .catch((error) => {
          if (!cancelled) {
            setSentimentAnalysis(createEmptySentimentAnalysis(events));
            setSentimentRefreshStatus(`Bun 舆情分析接口失败：${readableError(error)}`);
          }
        });
      return () => {
        cancelled = true;
      };
    },
    [events, stocks, newsAnalysisModelSettings]
  );

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
    const sourceDiagnosticStatus = newsDiagnosticsStatusSuffix(result.sourceDiagnostics);
    try {
      const nextEvents = await buildSentimentEventsBunFirst(result.articles, stocks, fetch);
      const nextAnalysis = await buildSentimentAnalysisBunFirst(nextEvents, stocks, newsAnalysisModelSettings, fetch);
      setRawSentimentEvents(nextEvents);
      setSentimentAnalysis(nextAnalysis);
      setSentimentFetchEventCount(nextEvents.length);
      setSentimentFetchLinkedStockCount(nextAnalysis.linkedStocks.length);
      setSentimentRefreshStatus(
        nextEvents.length
          ? `${mode}${result.message}：扫描 ${result.stats.scannedStocks} 只股票，请求 ${result.stats.requestCount} 次，返回 ${result.stats.returnedRows} 条新闻，生成 ${nextEvents.length} 个舆情事件，关联 ${nextAnalysis.linkedStocks.length} 只股票`
          : `${mode}刷新失败：真实新闻源返回 ${result.articles.length} 条数据，但未形成可关联股票的舆情事件`
      );
      if (sourceDiagnosticStatus) {
        setSentimentRefreshStatus((status) => `${status}；${sourceDiagnosticStatus}`);
      }
    } catch (error) {
      setRawSentimentEvents([]);
      setSentimentAnalysis(createEmptySentimentAnalysis());
      setSentimentFetchEventCount(0);
      setSentimentFetchLinkedStockCount(0);
      setSentimentRefreshStatus(`${mode}Bun 舆情接口失败：${readableError(error)}`);
    }
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
      <NewsSourceInterfaceBar sources={newsSourceSettings.sources} />
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
      {stockInfoTarget ? (
        <StockInfoModal
          target={stockInfoTarget}
          stocks={stocks}
          newsSourceSettings={newsSourceSettings}
          onClose={() => setStockInfoTarget(null)}
        />
      ) : null}
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
      const sourceDiagnosticStatus = newsDiagnosticsStatusSuffix(result.sourceDiagnostics);
      setNewsArticles(result.articles);
      setNewsLinkedStockCount(linkedCodeSet.size);
      setSelectedArticle(null);
      setCurrentPage(1);
      setNewsRefreshKey((value) => value + 1);
      setNewsRefreshStatus(
        `${mode}${result.message}：扫描 ${result.stats.scannedStocks} 只股票，请求 ${result.stats.requestCount} 次，返回 ${result.stats.returnedRows} 条新闻，有效 ${result.stats.validArticles} 条，关联 ${linkedCodeSet.size} 只股票`
      );
      if (sourceDiagnosticStatus) {
        setNewsRefreshStatus((status) => `${status}；${sourceDiagnosticStatus}`);
      }
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
      <NewsSourceInterfaceBar sources={newsSourceSettings.sources} />
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
  newsSourceSettings,
  infoSourceSettings,
  realDataStatus,
  financeSummary,
  isDataSyncing,
  isRealDataReady,
  onSyncRealData,
  onSyncFinancialReports
}: {
  stocks: Stock[];
  newsSourceSettings: NewsSourceSettings;
  infoSourceSettings: InfoSourceSettings;
  realDataStatus: string;
  financeSummary: OpenSourceDataSummary;
  isDataSyncing: boolean;
  isRealDataReady: boolean;
  onSyncRealData: () => void;
  onSyncFinancialReports: () => void;
}) {
  const [filters, setFilters] = useState<ValuationFilters>(defaultValuationFilters);
  const [valuationQuery, setValuationQuery] = useState("");
  const [valuationRunRequest, setValuationRunRequest] = useState(0);
  const [valuationRunFilters, setValuationRunFilters] = useState<ValuationFilters | null>(null);
  const [valuationRunStocks, setValuationRunStocks] = useState<Stock[]>([]);
  const [valuationCalculatedAt, setValuationCalculatedAt] = useState<string | undefined>();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [valuationDetailCollapsed, setValuationDetailCollapsed] = useState(false);
  const [stockInfoTarget, setStockInfoTarget] = useState<StockInfoTarget | null>(null);
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [exactValuationRows, setExactValuationRows] = useState<ValuationRow[]>([]);
  const [valuationApiStatus, setValuationApiStatus] = useState("Bun 估值接口等待运行");
  const [valuationSort, setValuationSort] = useState<{ key: ValuationSortKey; direction: SortDirection }>({
    key: "safetyMargin",
    direction: "desc"
  });
  const [valuationPage, setValuationPage] = useState(1);
  const [valuationPageSize, setValuationPageSize] = useState(defaultValuationPageSize);
  const industryOptions = useMemo(() => ["全部", ...Array.from(new Set(stocks.map((stock) => stock.industry1))).sort()], [stocks]);
  const missingRealValuationCount = useMemo(
    () => (isRealDataReady ? stocks.filter((stock) => !hasRequiredRealValuationData(stock)).length : stocks.length),
    [isRealDataReady, stocks]
  );
  const valuationInputReadyCount = isRealDataReady ? Math.max(stocks.length - missingRealValuationCount, 0) : 0;
  useEffect(() => {
    let cancelled = false;
    if (!isRealDataReady) {
      setRows((current) => (current.length ? [] : current));
      setExactValuationRows((current) => (current.length ? [] : current));
      setValuationRunFilters((current) => (current === null ? current : null));
      setValuationRunStocks((current) => (current.length ? [] : current));
      setValuationRunRequest((current) => (current === 0 ? current : 0));
      setValuationCalculatedAt((current) => (current === undefined ? current : undefined));
      setValuationApiStatus("等待真实行情和真实财报字段后再运行 Bun 估值接口");
      return;
    }
    if (valuationRunRequest <= 0 || !valuationRunFilters || !valuationRunStocks.length) {
      setRows((current) => (current.length ? [] : current));
      setExactValuationRows((current) => (current.length ? [] : current));
      setValuationApiStatus("点击开始核算后运行 Bun 估值接口");
      return;
    }
    setValuationApiStatus("正在通过 Bun 估值接口核算...");
    buildValuationRowsBunFirst(valuationRunStocks, valuationRunFilters)
      .then((nextRows) => {
        if (!cancelled) {
          setRows(nextRows);
          setValuationApiStatus(`Bun 估值接口完成，返回 ${nextRows.length} 条核算结果`);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRows((current) => (current.length ? [] : current));
          setValuationApiStatus(`Bun 估值接口失败：${readableError(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isRealDataReady, valuationRunFilters, valuationRunRequest, valuationRunStocks]);
  const normalizedValuationQuery = valuationQuery.trim().toLowerCase();
  const valuationCodeQuery = useMemo(() => normalizeStockCodeInput(valuationQuery), [valuationQuery]);
  const hasStartedValuation = valuationRunRequest > 0 && Boolean(valuationRunFilters);
  const valuationFiltersPending = useMemo(
    () => hasStartedValuation && valuationRunFilters !== null && JSON.stringify(filters) !== JSON.stringify(valuationRunFilters),
    [filters, hasStartedValuation, valuationRunFilters]
  );
  const exactValuationStock = useMemo(
    () => (hasStartedValuation && valuationCodeQuery.isCodeLike ? resolveStockByCode(valuationRunStocks, valuationQuery) ?? null : null),
    [hasStartedValuation, valuationRunStocks, valuationCodeQuery.isCodeLike, valuationQuery]
  );
  useEffect(() => {
    let cancelled = false;
    const alreadyVisible = Boolean(exactValuationStock && rows.some((row) => stockMatchesCodeQuery(row.stock, exactValuationStock.code)));
    if (
      !isRealDataReady ||
      !hasStartedValuation ||
      !valuationRunFilters ||
      !exactValuationStock ||
      alreadyVisible ||
      !hasRequiredRealValuationData(exactValuationStock)
    ) {
      setExactValuationRows((current) => (current.length ? [] : current));
      return;
    }
    buildValuationRowsBunFirst([exactValuationStock], valuationRunFilters)
      .then((nextRows) => {
        if (!cancelled) {
          setExactValuationRows(nextRows);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setExactValuationRows((current) => (current.length ? [] : current));
          setValuationApiStatus(`Bun 估值接口失败：${readableError(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [exactValuationStock, hasStartedValuation, isRealDataReady, rows, valuationRunFilters]);
  const searchedRows = useMemo(() => {
    if (!normalizedValuationQuery) return rows;
    if (valuationCodeQuery.isCodeLike) {
      const exactRows = rows.filter((row) => stockMatchesCodeQuery(row.stock, valuationQuery));
      if (exactRows.length) return exactRows;
      return exactValuationRows;
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
        row.state,
        row.model,
        row.action,
        row.positionHint
      ].join(" ").toLowerCase();
      return searchableText.includes(normalizedValuationQuery);
    });
  }, [rows, normalizedValuationQuery, valuationCodeQuery.isCodeLike, valuationQuery, exactValuationRows]);
  const sortedRows = useMemo(() => {
    const directionMultiplier = valuationSort.direction === "asc" ? 1 : -1;
    return [...searchedRows].sort((a, b) => {
      const valueDelta = valuationSortValue(a, valuationSort.key) - valuationSortValue(b, valuationSort.key);
      if (valueDelta !== 0) return valueDelta * directionMultiplier;
      return b.safetyMargin - a.safetyMargin || a.stock.code.localeCompare(b.stock.code);
    });
  }, [searchedRows, valuationSort]);
  const totalValuationPages = Math.max(1, Math.ceil(sortedRows.length / valuationPageSize));
  const safeValuationPage = Math.min(valuationPage, totalValuationPages);
  const valuationPageStart = sortedRows.length ? (safeValuationPage - 1) * valuationPageSize : 0;
  const valuationPageRows = sortedRows.slice(valuationPageStart, valuationPageStart + valuationPageSize);
  const valuationPageEnd = valuationPageStart + valuationPageRows.length;
  const summary = useMemo(() => summarizeValuationRows(searchedRows), [searchedRows]);
  const selected = sortedRows.find((row) => row.stock.code === selectedCode) ?? valuationPageRows[0] ?? sortedRows[0] ?? null;
  const unmatchedCodeQuery = Boolean(hasStartedValuation && normalizedValuationQuery && valuationCodeQuery.isCodeLike && !searchedRows.length);
  const firstMissingRealFields = useMemo(() => {
    if (!isRealDataReady) return "";
    const sample = stocks.find((stock) => !hasRequiredRealValuationData(stock));
    return sample ? missingRealValuationFields(sample).slice(0, 8).join("、") : "";
  }, [isRealDataReady, stocks]);
  const realFinancialSourceName = infoSourceDisplayName(infoSourceSettings);
  const valuationGateMessage = !isRealDataReady
    ? "价值核算已关闭本地样本兜底。请先点击“接入全市场股票”接入真实行情，再点击“同步真实财报”补齐年报字段；缺少真实财报字段时不会生成核算价值。"
    : valuationInputReadyCount === 0
      ? `已接入 ${stocks.length} 只真实行情，但腾讯行情接口不提供完整财报、现金流和资产负债拆分。请点击“同步真实财报”从 ${realFinancialSourceName} 拉取年报、利润表、资产负债表和现金流字段。缺少字段示例：${firstMissingRealFields || "真实财报字段"}。`
      : "";

  const patchFilters = (patch: Partial<ValuationFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSelectedCode(null);
    setValuationPage(1);
  };
  const updateValuationPageSize = (value: number) => {
    const pageSize = Number.isFinite(value) ? Math.floor(value) : defaultValuationPageSize;
    setValuationPageSize(Math.max(1, pageSize));
    setValuationPage(1);
    setSelectedCode(null);
  };
  const resetValuationControls = () => {
    setFilters(defaultValuationFilters);
    setValuationQuery("");
    setValuationRunFilters(null);
    setValuationRunStocks([]);
    setValuationRunRequest(0);
    setValuationCalculatedAt(undefined);
    setRows([]);
    setExactValuationRows([]);
    setValuationApiStatus(isRealDataReady ? "点击开始核算后运行 Bun 估值接口" : "等待真实行情和真实财报字段后再运行 Bun 估值接口");
    setSelectedCode(null);
    setValuationPage(1);
    setValuationPageSize(defaultValuationPageSize);
  };
  const recalculateValuation = () => {
    setValuationRunFilters(filters);
    setValuationRunStocks(stocks);
    setValuationRunRequest((current) => current + 1);
    setValuationCalculatedAt(new Date().toISOString());
    setExactValuationRows([]);
    setSelectedCode(null);
    setValuationPage(1);
  };

  const formatValue = (value: number, suffix = "") => `${round(value, 2)}${suffix}`;
  const formatMarketCap = (value: number) => `${round(value, 2)}亿`;
  const openStockInfo = (stock: StockReference) => setStockInfoTarget(resolveStockInfoTarget(stock, stocks));
  const updateValuationQuery = (value: string) => {
    setValuationQuery(value);
    setSelectedCode(null);
    setValuationPage(1);
  };
  const toggleValuationSort = (key: ValuationSortKey) => {
    setValuationSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
    }));
    setSelectedCode(null);
    setValuationPage(1);
  };
  const sortDirectionLabel = valuationSort.direction === "desc" ? "降序" : "升序";
  const financeMatchedRows = financeSummary.financeMatchedRows ?? 0;
  const financeSourceRows = financeSummary.financeSourceRows ?? 0;
  const valuationReadyRows = financeSummary.valuationReadyRows ?? valuationInputReadyCount;
  const valuationStatusText = valuationFiltersPending
    ? `${valuationApiStatus} · 筛选条件已调整，点击开始核算后应用`
    : valuationApiStatus;

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
            {valuationStatusText} 路{" "}
            {realDataStatus} · 可核算 {valuationInputReadyCount}/{stocks.length} · 财报匹配 {financeMatchedRows}/{financeSourceRows} · 估值可用 {valuationReadyRows} · 缺少真实财报 {missingRealValuationCount} · 最近核算 {formatDateTime(valuationCalculatedAt)}
          </span>
        </div>
        <div className="valuation-data-actions">
          <button className="btn" type="button" onClick={recalculateValuation} disabled={!isRealDataReady || isDataSyncing}>
            <RefreshCcw size={15} />
            开始核算
          </button>
          <button className="btn" type="button" onClick={onSyncFinancialReports} disabled={isDataSyncing}>
            <FileText size={15} />
            同步真实财报
          </button>
          <button className="btn primary" type="button" onClick={onSyncRealData} disabled={isDataSyncing}>
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
        <div className="valuation-option-filter valuation-board-filter">
          <span>板块</span>
          <div className="valuation-option-group" role="group" aria-label="价值核算板块">
            {valuationBoardOptions.map((board) => (
              <button
                className={`valuation-option-chip ${filters.boards.includes(board) ? "active" : ""}`}
                type="button"
                key={board}
                aria-pressed={filters.boards.includes(board)}
                onClick={() => patchFilters({ boards: toggleAllBackedOption(filters.boards, board, "全部") })}
              >
                {board}
              </button>
            ))}
          </div>
        </div>
        <div className="valuation-option-filter valuation-status-filter">
          <span>筛除风险</span>
          <div className="valuation-option-group" role="group" aria-label="价值核算风险状态">
            {valuationRiskExclusionOptions.map((option) => (
              <button
                className={`valuation-option-chip ${filters.stockRiskExclusions.includes(option.value) ? "active" : ""}`}
                type="button"
                key={option.value}
                aria-pressed={filters.stockRiskExclusions.includes(option.value)}
                onClick={() => patchFilters({ stockRiskExclusions: toggleOption(filters.stockRiskExclusions, option.value) })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="valuation-option-filter valuation-industry-filter">
          <span>行业</span>
          <div className="valuation-option-group scroll" role="group" aria-label="价值核算行业">
            {industryOptions.map((industry) => (
              <button
                className={`valuation-option-chip ${filters.industries.includes(industry) ? "active" : ""}`}
                type="button"
                key={industry}
                aria-pressed={filters.industries.includes(industry)}
                onClick={() => patchFilters({ industries: toggleAllBackedOption(filters.industries, industry, "全部") })}
              >
                {industry}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span>企业状态</span>
          <select value={filters.state} onChange={(event) => patchFilters({ state: event.target.value as ValuationFilters["state"] })}>
            {enterpriseStateOptions.map((state) => (
              <option key={state} value={state}>{state}</option>
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
        <label>
          <span>每页数量</span>
          <input type="number" min={1} step={1} value={valuationPageSize} onChange={(event) => updateValuationPageSize(Number(event.target.value))} />
        </label>
        <button className="btn valuation-filter-reset" onClick={resetValuationControls}>重置</button>
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
            <div className="valuation-panel-heading">
              <h3>价值核算排序</h3>
              <span>
                {normalizedValuationQuery ? `检索 ${searchedRows.length}/${rows.length}，` : `结果 ${sortedRows.length} 只，`}
                本页 {valuationPageRows.length ? `${valuationPageStart + 1}-${valuationPageEnd}` : "0"}，按{valuationSortLabels[valuationSort.key]}{sortDirectionLabel}排列
              </span>
            </div>
            <div className="valuation-pagination" aria-label="价值核算分页">
              <button className="btn" type="button" disabled={safeValuationPage <= 1} onClick={() => setValuationPage(Math.max(1, safeValuationPage - 1))}>
                上一页
              </button>
              <span>第 {safeValuationPage}/{totalValuationPages} 页</span>
              <button className="btn" type="button" disabled={safeValuationPage >= totalValuationPages} onClick={() => setValuationPage(Math.min(totalValuationPages, safeValuationPage + 1))}>
                下一页
              </button>
            </div>
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
              {valuationPageRows.map((row) => (
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
                  : hasStartedValuation
                    ? "当前筛选条件下没有符合要求的股票，请降低安全边际或治理分限制。"
                    : "请先选择核算范围并点击开始核算。"}
            </EmptyState>
          ) : null}
        </section>

        <section className={`valuation-panel valuation-detail-panel ${valuationDetailCollapsed ? "collapsed" : ""}`}>
          {valuationDetailCollapsed ? (
            <div className="valuation-side-rail">
              <button className="valuation-side-toggle" type="button" onClick={() => setValuationDetailCollapsed(false)} aria-label="展开价值核算详情">
                <ChevronDown size={16} />
                <span>展开详情</span>
              </button>
              {selected ? (
                <div className="valuation-side-summary">
                  <strong>{selected.stock.name}</strong>
                  <span>{displayStockCode(selected.stock)}</span>
                  <em>{selected.verdict}</em>
                  <b className={selected.safetyMargin >= 0 ? "positive" : "negative"}>{formatValue(selected.safetyMargin, "%")}</b>
                </div>
              ) : (
                <div className="valuation-side-summary valuation-side-summary-empty">
                  <strong>价值核算拆解</strong>
                  <span>待选择</span>
                  <em>未选择股票</em>
                </div>
              )}
            </div>
          ) : selected ? (
            <>
              <div className="valuation-detail-head">
                <div>
                  <h3>
                    <button className="stock-title-button" type="button" onClick={() => openStockInfo(selected.stock)}>
                      {selected.stock.name}
                      <span>{displayStockCode(selected.stock)}</span>
                    </button>
                  </h3>
                  <p>{selected.stock.industry1} / {selected.stock.industry2}</p>
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
          ) : (
            <>
              <div className="valuation-detail-head">
                <div>
                  <h3>价值核算拆解</h3>
                  <p>选择左侧股票后显示核算价值、市值、安全边际和模型拆解。</p>
                </div>
                <div className="valuation-detail-actions">
                  <button className="valuation-collapse-button" type="button" onClick={() => setValuationDetailCollapsed(true)}>
                    收起
                    <ChevronDown size={15} />
                  </button>
                </div>
              </div>
              <EmptyState>请选择一只股票查看价值核算拆解。</EmptyState>
            </>
          )}
        </section>
      </div>
      {stockInfoTarget ? (
        <StockInfoModal
          target={stockInfoTarget}
          stocks={stocks}
          newsSourceSettings={newsSourceSettings}
          onClose={() => setStockInfoTarget(null)}
        />
      ) : null}
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
  onSyncOpenData,
  syncConfig,
  syncStatus,
  syncBusy,
  onPatchSyncConfig,
  onToggleSyncSource,
  onSaveSyncConfig,
  onRunManualSync,
  onRefreshSyncStatus
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
  syncConfig: ScheduleConfig;
  syncStatus: SyncStatus | null;
  syncBusy: boolean;
  onPatchSyncConfig: (patch: Partial<ScheduleConfig>) => void;
  onToggleSyncSource: (key: keyof ScheduleConfig["sources"]) => void;
  onSaveSyncConfig: () => void;
  onRunManualSync: () => void;
  onRefreshSyncStatus: () => void;
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
              <em>{newsAnalysisSettings.enabled ? "新闻进入舆情分析时调用该模型" : "停用后仅使用 Bun 规则，不加载样本标签"}</em>
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

      <div className="settings-panel sync-schedule-panel">
        <div className="settings-panel-title">
          <div>
            <h3>定时数据采集</h3>
            <p>后台自动爬取数据并存储到本地 data-cache 目录，应用重启后仍保留快照。</p>
          </div>
          <div className="settings-actions">
            <span className="settings-status">{syncBusy ? "采集中..." : syncStatus?.running ? "定时运行中" : "空闲"}</span>
            <button className="btn" onClick={onRefreshSyncStatus}>刷新状态</button>
            <button className="btn" onClick={onRunManualSync} disabled={syncBusy}>立即采集</button>
            <button className="btn primary" onClick={onSaveSyncConfig} disabled={syncBusy}><Save size={15} />保存配置</button>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="settings-module-row compact switch-row">
            <input type="checkbox" checked={syncConfig.enabled} onChange={(event) => onPatchSyncConfig({ enabled: event.target.checked })} />
            <span><strong>启用定时采集</strong><em>Bun 服务在后台按设定周期自动抓取并落盘</em></span>
          </label>
          <label><span>采集间隔（分钟）</span>
            <input type="number" min={1} max={1440} value={syncConfig.intervalMinutes} onChange={(event) => onPatchSyncConfig({ intervalMinutes: Number(event.target.value) })} />
          </label>
        </div>
        <div className="settings-module-list">
          {scheduleSourceLabels.map((item) => (
            <label className="settings-module-row" key={item.key}>
              <input type="checkbox" checked={syncConfig.sources[item.key]} onChange={() => onToggleSyncSource(item.key)} />
              <span><strong>{item.label}</strong><em>{item.description}</em></span>
            </label>
          ))}
        </div>
        <div className="news-source-meta">
          <span>最近完整采集：{syncStatus?.lastFullSync ? formatDateTime(syncStatus.lastFullSync) : "--"}</span>
          <span>本地快照：{syncStatus?.cacheFiles?.length ?? 0} 个文件</span>
        </div>
        {syncStatus?.runs?.length ? (
          <div className="sync-run-list"><table className="data-table compact"><thead><tr><th>数据源</th><th>状态</th><th>行数</th><th>完成时间</th><th>错误</th></tr></thead><tbody>
            {syncStatus.runs.slice(0, 8).map((run, idx) => (<tr key={idx}><td>{run.source}</td><td>{run.ok ? "成功" : "失败"}</td><td>{run.rowCount}</td><td>{formatDateTime(run.finishedAt)}</td><td>{run.error ?? ""}</td></tr>))}
          </tbody></table></div>
        ) : null}
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
          <span>财报匹配</span>
          <strong>{summary.financeSourceRows ? `${summary.financeMatchedRows ?? 0} / ${summary.financeSourceRows}` : "--"}</strong>
        </div>
        <div>
          <span>估值可用</span>
          <strong>{summary.valuationReadyRows ?? 0} 只</strong>
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
  holdingStrategies,
  patchTradeConnection,
  bindTradingInterface,
  openHoldingImportModal,
  removeHoldingStrategy,
  generateTradePlan,
  exportTradePlan,
  clearTradePlans,
  submitPaperTradePlan,
  onOpenStockInfo
}: {
  strategy: StrategyConfig;
  rows: SelectionRow[];
  tradeConnection: TradeConnectionSettings;
  tradeConnectionStatus: string;
  paperTradeState: PaperTradeState;
  holdingStrategies: StrategyConfig[];
  patchTradeConnection: (patch: Partial<TradeConnectionSettings>) => void;
  bindTradingInterface: () => boolean;
  openHoldingImportModal: () => void;
  removeHoldingStrategy: (strategyId: string) => void;
  generateTradePlan: (rows: SelectionRow[], mode: ExecutionMode, label?: string, minimumAmount?: number, accountAsset?: number) => Promise<TradePlanExport>;
  exportTradePlan: (rows: SelectionRow[], mode: ExecutionMode, label?: string, minimumAmount?: number, accountAsset?: number) => Promise<TradePlanExport>;
  clearTradePlans: (strategyId: string) => number;
  submitPaperTradePlan: (rows: SelectionRow[], accountAsset?: number) => Promise<TradePlan | null>;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const [tradeMode, setTradeMode] = useState<"strategy" | "condition">("strategy");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("manual");
  const [tradeTab, setTradeTab] = useState<"holding" | "rebalance" | "log" | "history">("holding");
  const [tradeLogStartDate, setTradeLogStartDate] = useState(() => todayOffset(-7));
  const [tradeLogEndDate, setTradeLogEndDate] = useState(() => todayOffset(0));
  const [historyStartDate, setHistoryStartDate] = useState(() => todayOffset(-30));
  const [historyEndDate, setHistoryEndDate] = useState(() => todayOffset(0));
  const [tradeAuditStatus, setTradeAuditStatus] = useState("日志和历史仅显示 Bun 交易计划、纸面成交或资产同步记录。");
  const [syncedAssets, setSyncedAssets] = useState<TradeAssetState>(() => ensureTradeAssetState(loadLocal("tradeAssetState", defaultTradeAssetState)));
  const [assetDraft, setAssetDraft] = useState<TradeAssetState>(() => ensureTradeAssetState(loadLocal("tradeAssetState", defaultTradeAssetState)));
  const [assetSyncStatus, setAssetSyncStatus] = useState(() =>
    syncedAssets.lastSyncedAt ? `最近同步 ${syncedAssets.lastSyncedAt.replace("T", " ").slice(0, 16)}` : "资产可手动调整，点击资产同步后生效"
  );
  const tradeInterfaceBound = tradeConnection.bound;
  const holdings = rows.slice(0, Math.max(strategy.trading.maxHoldings, 1));
  const currentNetValue = syncedAssets.netValue;
  const holdingValue = syncedAssets.holdingValue;
  const strategyCash = syncedAssets.strategyCash;
  const outsideCash = syncedAssets.outsideAsset;
  const accountAsset = round(holdingValue + strategyCash + outsideCash, 2);
  const strategyAsset = round(holdingValue + strategyCash, 2);
  const dailyReturn = holdings.length ? round(holdings.reduce((sum, row) => sum + (row.stock.metrics.pctChange ?? 0), 0) / holdings.length, 2) : 0;
  const nextRebalanceDate = todayOffset(1);
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
  const strategyPlans = paperTradeState.plans.filter((plan) => plan.strategyId === strategy.id);
  const strategyFills = paperTradeState.fills.filter((fill) => fill.strategyId === strategy.id);
  const historyFills = strategyFills.filter((fill) => isDateInInputRange(fill.filledAt, historyStartDate, historyEndDate));
  const paperFills = historyFills.slice(0, 8);
  const assetSyncRecord = syncedAssets.lastSyncedAt
    ? {
        time: syncedAssets.lastSyncedAt.replace("T", " ").slice(0, 19),
        amount: accountAsset
      }
    : null;
  const logFills = strategyFills.filter((fill) => isDateInInputRange(fill.filledAt, tradeLogStartDate, tradeLogEndDate));
  const logAssetSyncRecord = assetSyncRecord && isDateInInputRange(assetSyncRecord.time, tradeLogStartDate, tradeLogEndDate) ? assetSyncRecord : null;
  const historyAssetSyncRecord = assetSyncRecord && isDateInInputRange(assetSyncRecord.time, historyStartDate, historyEndDate) ? assetSyncRecord : null;
  const tradeLogRows = [
    ...logFills.map((fill) => ({
      time: fill.filledAt.replace("T", " ").slice(0, 19),
      type: fill.side,
      message: `纸面交易已记录：${fill.side}${fill.shares}股 ${fill.name}，成交均价 ${fill.price.toFixed(3)}。`
    })),
    ...(logAssetSyncRecord
      ? [
          {
            time: logAssetSyncRecord.time,
            type: "资产同步",
            message: `资产同步完成：账户资产 ${formatMoney(logAssetSyncRecord.amount)}。`
          }
        ]
      : [])
  ];
  const latestStrategyPlan = strategyPlans[0];
  const shortStrategyId = strategy.id.length > 8 ? strategy.id.slice(-8) : strategy.id;
  const latestPlanText = latestStrategyPlan
    ? `${latestStrategyPlan.generatedAt.replace("T", " ").slice(0, 16)} ${latestStrategyPlan.mode === "auto" ? "自动" : "手动"}`
    : "尚未生成";
  const [minimumTradeAmount, setMinimumTradeAmount] = useState(() => normalizeMinimumTradeAmount(loadLocal("tradeMinimumAmount", 1000)));
  const [minimumTradeAmountDraft, setMinimumTradeAmountDraft] = useState(() => String(minimumTradeAmount));
  const [advancedInstructions, setAdvancedInstructions] = useState(false);
  const [activeInstructionPlan, setActiveInstructionPlan] = useState<TradePlan | null>(() =>
    latestStrategyPlan?.status === "draft" || latestStrategyPlan?.status === "confirmed" ? latestStrategyPlan : null
  );
  const [activeInstructionClientText, setActiveInstructionClientText] = useState("");
  const [showClientCopyPanel, setShowClientCopyPanel] = useState(false);
  const [instructionStatus, setInstructionStatus] = useState(() =>
    latestStrategyPlan ? `已载入最近一次${latestStrategyPlan.mode === "auto" ? "自动" : "手动"}指令` : "尚未生成本次调仓指令"
  );
  useEffect(() => {
    setShowClientCopyPanel(false);
    setActiveInstructionClientText("");
  }, [executionMode, latestStrategyPlan?.id, strategy.id]);
  useEffect(() => {
    if (latestStrategyPlan?.status === "draft" || latestStrategyPlan?.status === "confirmed") {
      setActiveInstructionPlan((current) => {
        if (current?.id === latestStrategyPlan.id) return current;
        setInstructionStatus(`已载入最近一次${latestStrategyPlan.mode === "auto" ? "自动" : "手动"}指令`);
        return latestStrategyPlan;
      });
      return;
    }
    setActiveInstructionPlan((current) => {
      if (!current || current.strategyId === strategy.id) return current;
      setInstructionStatus("尚未生成本次调仓指令");
      return null;
    });
  }, [latestStrategyPlan?.id, latestStrategyPlan?.status, strategy.id]);
  const instructionTradeDate = activeInstructionPlan?.generatedAt.slice(0, 10) ?? todayOffset(0);
  const patchAssetDraft = (patch: Partial<TradeAssetState>) => {
    setAssetDraft((current) => ensureTradeAssetState({ ...current, ...patch }));
  };
  const syncManualAssets = async () => {
    setAssetSyncStatus("正在通过 Bun 交易接口同步资产...");
    try {
      const result = await syncTradeAssetsBunFirst(assetDraft);
      if (!result.ok) {
        setAssetSyncStatus(result.message);
        return;
      }
      const next = result.asset;
      setSyncedAssets(next);
      setAssetDraft(next);
      saveLocal("tradeAssetState", next);
      setAssetSyncStatus(`${result.message} ${next.lastSyncedAt?.replace("T", " ").slice(0, 16)}`);
    } catch (error) {
      setAssetSyncStatus(`Bun 资产同步接口失败：${readableError(error)}`);
    }
  };
  const instructionOrders = activeInstructionPlan?.orders ?? [];
  const instructionTableRows = instructionOrders.map((order) => {
    const sourceRow = rows.find((row) => row.stock.code === order.code);
    return {
      order,
      stock: sourceRow?.stock ?? { code: order.code, name: order.name },
      industry: sourceRow?.stock.industry1 ?? "--"
    };
  });
  const clientInstructionText = showClientCopyPanel ? activeInstructionClientText : "";
  const formatMinimumTradeAmount = (value: number) => formatMoney(normalizeMinimumTradeAmount(value, 0));
  const generateManualInstructions = async () => {
    try {
      const tradeExport = await generateTradePlan(rows, "manual", "交易指令", minimumTradeAmount, accountAsset);
      const plan = tradeExport.plan;
      setActiveInstructionPlan(plan);
      setActiveInstructionClientText("");
      setShowClientCopyPanel(false);
      setInstructionStatus(`已生成 ${plan.orders.length} 条手动交易指令，最小买卖金额 ${formatMinimumTradeAmount(minimumTradeAmount)}`);
      return plan;
    } catch (error) {
      setActiveInstructionPlan(null);
      setActiveInstructionClientText("");
      setShowClientCopyPanel(false);
      setInstructionStatus(`Bun 交易指令接口失败：${readableError(error)}`);
      return null;
    }
  };
  const prepareManualInstructionPlan = async () => {
    const plan = activeInstructionPlan ?? await generateManualInstructions();
    if (!plan) return null;
    if (!plan.orders.length) {
      setInstructionStatus(`没有达到 ${formatMinimumTradeAmount(minimumTradeAmount)} 的交易指令可导出`);
      return null;
    }
    setActiveInstructionPlan(plan);
    return plan;
  };
  const copyClientInstructions = async () => {
    const plan = await prepareManualInstructionPlan();
    if (!plan) return;
    try {
      const tradeExport = await exportTradePlanBunFirst(plan);
      if (!tradeExport.clientText.trim()) {
        setInstructionStatus("Bun 交易导出接口未返回客户端复制文本");
        return;
      }
      setActiveInstructionClientText(tradeExport.clientText);
      const copied = await copyTextToClipboard(tradeExport.clientText);
      setInstructionStatus(
        copied
          ? `已复制 ${plan.orders.length} 条交易客户端指令，可粘贴到批量下单表格`
          : "浏览器未允许自动复制，请点击“导出交易指令”后手动复制交易客户端文本"
      );
    } catch (error) {
      setInstructionStatus(`Bun 交易导出接口失败：${readableError(error)}`);
    }
  };
  const exportManualInstructions = async () => {
    const plan = await prepareManualInstructionPlan();
    if (!plan) {
      return;
    }
    try {
      const tradeExport = await exportTradePlanBunFirst(plan);
      if (!tradeExport.clientText.trim()) {
        setInstructionStatus("Bun 交易导出接口未返回客户端复制文本");
        return;
      }
      downloadTextFile(`${safeFileName(strategy.name)}-交易客户端指令.txt`, tradeExport.clientText, "text/plain;charset=utf-8");
      setActiveInstructionClientText(tradeExport.clientText);
      setShowClientCopyPanel(true);
      const copied = await copyTextToClipboard(tradeExport.clientText);
      setInstructionStatus(
        copied
          ? `已导出并复制 ${plan.orders.length} 条交易客户端指令`
          : `已导出 ${plan.orders.length} 条交易客户端指令，请手动复制下方文本`
      );
    } catch (error) {
      setInstructionStatus(`Bun 交易导出接口失败：${readableError(error)}`);
    }
  };
  const exportInstructionStatusTable = async () => {
    const plan = activeInstructionPlan;
    if (!plan || !plan.orders.length) {
      setInstructionStatus("请先生成交易指令，再生成交易状态表");
      return;
    }
    try {
      const tradeExport = await exportTradePlanBunFirst(plan);
      if (!tradeExport.csv.trim()) {
        setInstructionStatus("Bun 交易导出接口未返回交易状态表");
        return;
      }
      downloadTextFile(`${safeFileName(strategy.name)}-交易状态表.csv`, `\ufeff${tradeExport.csv}`, "text/csv;charset=utf-8");
      setInstructionStatus(`已生成 ${plan.orders.length} 条交易状态表`);
    } catch (error) {
      setInstructionStatus(`Bun 交易导出接口失败：${readableError(error)}`);
    }
  };
  const saveMinimumTradeAmount = () => {
    const nextMinimum = normalizeMinimumTradeAmount(minimumTradeAmountDraft, minimumTradeAmount);
    setMinimumTradeAmount(nextMinimum);
    setMinimumTradeAmountDraft(String(nextMinimum));
    saveLocal("tradeMinimumAmount", nextMinimum);
    setActiveInstructionPlan(null);
    setActiveInstructionClientText("");
    setShowClientCopyPanel(false);
    setInstructionStatus(`最小买卖金额已保存为 ${formatMinimumTradeAmount(nextMinimum)}，请重新生成交易指令`);
  };
  const toggleAdvancedInstructions = () => {
    setAdvancedInstructions((current) => {
      const next = !current;
      setInstructionStatus(next ? "已切换到高级操作，可调整方向、股数和参考价" : "已切换到普通操作");
      return next;
    });
  };
  const patchInstructionOrder = (clientOrderId: string, patch: Partial<Pick<PlannedOrder, "side" | "shares" | "price">>) => {
    setActiveInstructionPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        orders: current.orders.map((order) => {
          if (order.clientOrderId !== clientOrderId) return order;
          const shares = patch.shares === undefined ? order.shares : Math.max(0, Math.floor(Number(patch.shares) / 100) * 100);
          const price = patch.price === undefined ? order.price : round(Math.max(0, Number(patch.price)), 3);
          return {
            ...order,
            ...patch,
            shares: Number.isFinite(shares) ? shares : order.shares,
            price: Number.isFinite(price) ? price : order.price,
            amount: round((Number.isFinite(price) ? price : order.price) * (Number.isFinite(shares) ? shares : order.shares), 2)
          };
        })
      };
    });
    setActiveInstructionClientText("");
    setShowClientCopyPanel(false);
    setInstructionStatus("已调整当前交易指令，导出前请确认");
  };
  const removeInstructionOrder = (clientOrderId: string) => {
    setActiveInstructionPlan((current) => (current ? { ...current, orders: current.orders.filter((order) => order.clientOrderId !== clientOrderId) } : current));
    setActiveInstructionClientText("");
    setShowClientCopyPanel(false);
    setInstructionStatus("已从当前指令中移除该股票");
  };
  const clearInstructions = () => {
    const removedCount = clearTradePlans(strategy.id);
    setActiveInstructionPlan(null);
    setActiveInstructionClientText("");
    setShowClientCopyPanel(false);
    setInstructionStatus(removedCount ? `已解除 ${removedCount} 个未成交指令` : "已清空当前页面指令草稿");
  };
  const isCurrentStrategyImported = holdingStrategies.some((item) => item.id === strategy.id);
  const holdingStrategyRows = holdingStrategies.map((item) => {
    const isCurrent = item.id === strategy.id;
    const itemPlans = paperTradeState.plans.filter((plan) => plan.strategyId === item.id);
    return {
      strategy: item,
      isCurrent,
      holdingValue: isCurrent ? holdingValue : 0,
      strategyCash: isCurrent ? strategyCash : 0,
      dailyReturn: isCurrent ? dailyReturn : 0,
      nextRebalanceDate: isCurrent ? nextRebalanceDate : "待同步",
      tradeTime: isCurrent ? tradeTime : item.trading.orderTime,
      planCount: itemPlans.length
    };
  });
  const holdingStrategyValueTotal = round(holdingStrategyRows.reduce((sum, row) => sum + row.holdingValue, 0), 2);
  const holdingStrategyCashTotal = round(holdingStrategyRows.reduce((sum, row) => sum + row.strategyCash, 0), 2);
  const outsideCashForTable = round(accountAsset - holdingStrategyValueTotal - holdingStrategyCashTotal, 2);
  const holdingStrategyDailyReturn = holdingStrategyRows.length
    ? round(holdingStrategyRows.reduce((sum, row) => sum + row.dailyReturn, 0) / holdingStrategyRows.length, 2)
    : 0;
  const holdingDetailRows = isCurrentStrategyImported ? holdings.slice(0, 8) : [];
  const shiftTradeLogRange = (days: number) => {
    setTradeLogStartDate((value) => shiftDateInput(value, days));
    setTradeLogEndDate((value) => shiftDateInput(value, days));
  };
  const shiftHistoryRange = (days: number) => {
    setHistoryStartDate((value) => shiftDateInput(value, days));
    setHistoryEndDate((value) => shiftDateInput(value, days));
  };
  const showAssetAllocation = () => {
    setAssetSyncStatus(
      `当前资产分配：持仓市值 ${formatMoney(holdingValue)}，策略现金 ${formatMoney(strategyCash)}，策略外资产 ${formatMoney(outsideCash)}。调整后需点击资产同步。`
    );
  };
  const exportHoldingDetails = () => {
    if (!holdingDetailRows.length && !holdingStrategyCashTotal && !outsideCashForTable) {
      setAssetSyncStatus("暂无可导出的真实持仓详情，请先导入策略并同步资产。");
      return;
    }
    const rowsForCsv = [
      ["序号", "标的名称", "证券代码", "行业", "持仓股数", "持仓市值", "最新价", "日涨跌幅", "策略外资产"],
      ...holdingDetailRows.map((row, index) => {
        const shares = planRows[index]?.shares ?? 0;
        const price = row.stock.metrics.price ?? 0;
        return [
          index + 1,
          row.stock.name,
          displayStockCode(row.stock),
          row.stock.industry1 ?? "",
          shares,
          round(price * shares, 2),
          price.toFixed(2),
          pct(row.stock.metrics.pctChange ?? 0),
          0
        ];
      }),
      [
        holdingDetailRows.length + 1,
        "现金",
        "",
        "",
        formatMoney(holdingStrategyCashTotal + outsideCashForTable),
        formatMoney(holdingStrategyCashTotal + outsideCashForTable),
        "1.00",
        "0.00%",
        formatMoney(outsideCashForTable)
      ]
    ];
    downloadTextFile(`${safeFileName(strategy.name)}-持仓详情.csv`, `\ufeff${buildCsv(rowsForCsv)}`, "text/csv;charset=utf-8");
    setAssetSyncStatus(`已导出 ${Math.max(holdingDetailRows.length, 0)} 条持仓明细和现金记录。`);
  };
  const viewTradeLogs = () => {
    setTradeAuditStatus(
      tradeLogRows.length
        ? `已按 ${tradeLogStartDate} 至 ${tradeLogEndDate} 筛选 ${tradeLogRows.length} 条真实交易日志。`
        : `当前 ${tradeLogStartDate} 至 ${tradeLogEndDate} 没有真实交易日志。`
    );
  };
  const showTradeLogHelp = () => {
    setTradeAuditStatus("日志说明：这里只显示 Bun 交易指令确认后的纸面成交，以及 Bun 资产同步记录；接口失败或没有真实记录时保持空态。");
  };
  const exportTradeLogs = () => {
    if (!tradeLogRows.length) {
      setTradeAuditStatus("当前日期范围内没有真实交易日志可导出。");
      return;
    }
    const csv = buildCsv([["时间", "类型", "信息"], ...tradeLogRows.map((row) => [row.time, row.type, row.message])]);
    downloadTextFile(`${safeFileName(strategy.name)}-交易日志-${tradeLogStartDate}_${tradeLogEndDate}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
    setTradeAuditStatus(`已导出 ${tradeLogRows.length} 条真实交易日志。`);
  };
  const viewTradeHistory = () => {
    const total = historyFills.length + (historyAssetSyncRecord ? 1 : 0);
    setTradeAuditStatus(
      total
        ? `已按 ${historyStartDate} 至 ${historyEndDate} 筛选 ${total} 条真实成交/资产记录。`
        : `当前 ${historyStartDate} 至 ${historyEndDate} 没有真实成交或资产同步记录。`
    );
  };
  const exportTradeHistory = () => {
    const rowsForCsv = [
      ["序号", "时间", "标的名称", "标的代码", "变更(股数)", "成交均价", "发生金额", "策略外资产"],
      ...historyFills.map((fill, index) => [
        index + 1,
        fill.filledAt.replace("T", " ").slice(0, 19),
        fill.name,
        displayStockCode(fill.code),
        `${fill.side}${fill.shares}`,
        fill.price.toFixed(3),
        `${fill.side === "买入" ? "-" : "+"}${formatMoney(fill.amount)}`,
        ""
      ]),
      ...(historyAssetSyncRecord
        ? [
            [
              historyFills.length + 1,
              historyAssetSyncRecord.time,
              "现金",
              "",
              "资产同步",
              "N/A",
              "N/A",
              formatMoney(historyAssetSyncRecord.amount)
            ]
          ]
        : [])
    ];
    if (rowsForCsv.length <= 1) {
      setTradeAuditStatus("当前日期范围内没有真实成交或资产同步记录可导出。");
      return;
    }
    downloadTextFile(`${safeFileName(strategy.name)}-交易历史-${historyStartDate}_${historyEndDate}.csv`, `\ufeff${buildCsv(rowsForCsv)}`, "text/csv;charset=utf-8");
    setTradeAuditStatus(`已导出 ${rowsForCsv.length - 1} 条真实成交/资产记录。`);
  };
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
      status: "运行中",
      validUntil: todayOffset(15)
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
          <button
            className="btn"
            onClick={() => {
              void exportTradePlan(rows, "manual", "指令模板", 0, accountAsset).catch((error) => {
                setInstructionStatus(`Bun 交易导出接口失败：${readableError(error)}`);
              });
            }}
          >
            导出指令模板
          </button>
        )}
      </div>

      <div className="trade-strategy-link" aria-label="当前绑定策略">
        <div className="trade-strategy-link-main">
          <span>当前绑定策略</span>
          <strong>{strategy.name}</strong>
          <em>策略ID：{shortStrategyId}</em>
        </div>
        <div>
          <span>候选持仓</span>
          <strong>{holdings.length}只</strong>
          <em>目标持仓：{strategy.trading.maxHoldings}只</em>
        </div>
        <div>
          <span>交易计划</span>
          <strong>{strategyPlans.length}个</strong>
          <em>{latestPlanText}</em>
        </div>
        <div>
          <span>当前策略成交</span>
          <strong>{strategyFills.length}笔</strong>
          <em>资金账号：{tradeConnection.accountId}</em>
        </div>
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
            <button className="btn primary" onClick={syncManualAssets}>
              <RefreshCcw size={14} />
              资产同步
            </button>
          </div>
          <h3>持仓总结</h3>
          <div className="asset-sync-editor" aria-label="手动资产调整">
            <label>
              <span>当前净值</span>
              <input
                aria-label="手动当前净值"
                type="number"
                min={0}
                step={0.0001}
                value={assetDraft.netValue}
                onChange={(event) => patchAssetDraft({ netValue: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>持仓市值</span>
              <input
                aria-label="手动持仓市值"
                type="number"
                min={0}
                step={1000}
                value={assetDraft.holdingValue}
                onChange={(event) => patchAssetDraft({ holdingValue: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>策略现金</span>
              <input
                aria-label="手动策略现金"
                type="number"
                min={0}
                step={1000}
                value={assetDraft.strategyCash}
                onChange={(event) => patchAssetDraft({ strategyCash: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>策略外资产</span>
              <input
                aria-label="手动策略外资产"
                type="number"
                min={0}
                step={1000}
                value={assetDraft.outsideAsset}
                onChange={(event) => patchAssetDraft({ outsideAsset: Number(event.target.value) })}
              />
            </label>
            <p>{assetSyncStatus}</p>
          </div>
          <div className="live-summary-row">
            <div>
              <span>当前净值</span>
              <strong>{currentNetValue.toFixed(4)}</strong>
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
            <button className="btn primary" onClick={openHoldingImportModal}>
              导入策略
            </button>
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
              {holdingStrategyRows.length ? (
                holdingStrategyRows.map((row) => (
                  <tr key={row.strategy.id}>
                    <td>
                      <a>{row.strategy.name}</a>
                      {row.isCurrent ? <span className="holding-strategy-tag">当前选股策略</span> : null}
                    </td>
                    <td>{formatMoney(row.holdingValue)}</td>
                    <td>{formatMoney(row.strategyCash)}</td>
                    <td className={row.dailyReturn >= 0 ? "positive" : "negative"}>{pct(row.dailyReturn)}</td>
                    <td>{row.nextRebalanceDate}</td>
                    <td>{row.tradeTime}</td>
                    <td>{row.planCount}次</td>
                    <td>
                      {row.isCurrent ? (
                        executionMode === "manual" ? (
                          <>
                            <button className="text-link" onClick={generateManualInstructions}>手动确认</button>
                            <button className="text-link" onClick={generateManualInstructions}>生成指令</button>
                          </>
                        ) : (
                          <>
                            <button className="text-link">{tradeInterfaceBound ? "自动执行" : "待绑定"}</button>
                            <button className="text-link" onClick={bindTradingInterface}>
                              绑定接口
                            </button>
                          </>
                        )
                      ) : (
                        "导入待同步"
                      )}
                    </td>
                    <td className="live-ops">
                      <button
                        className="holding-strategy-delete"
                        onClick={() => removeHoldingStrategy(row.strategy.id)}
                        aria-label={`删除持仓策略 ${row.strategy.name}`}
                        title={`删除持仓策略 ${row.strategy.name}`}
                      >
                        <Trash2 size={13} />
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="holding-strategy-empty" colSpan={9}>
                    暂无持仓策略，请先导入当前选股策略。
                  </td>
                </tr>
              )}
              <tr>
                <td>策略外资产</td>
                <td>0.00</td>
                <td>{formatMoney(outsideCashForTable)}</td>
                <td>0.00%</td>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
              <tr>
                <td>总计</td>
                <td>{formatMoney(holdingStrategyValueTotal)}</td>
                <td>{formatMoney(holdingStrategyCashTotal + outsideCashForTable)}</td>
                <td className={holdingStrategyDailyReturn >= 0 ? "positive" : "negative"}>{pct(holdingStrategyDailyReturn)}</td>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
          <p className="live-note">注：持仓市值来自资产同步后的资产输入，今日涨跌取自已接入的真实行情字段；未生成 Bun 交易指令或未确认纸面成交时不展示本地样本成交。</p>

          <div className="live-section-title">
            <h3>持仓详情</h3>
            <label className="inline-select slim">
              <span>选择策略：</span>
              <select>
                <option>全部</option>
                {holdingStrategies.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <div className="live-title-links">
              <button className="text-link" onClick={showAssetAllocation}>资产分配</button>
              <button className="text-link" onClick={exportHoldingDetails}>导出</button>
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
              {holdingDetailRows.map((row, index) => {
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
                <td>{holdingDetailRows.length + 1}</td>
                <td>现金</td>
                <td />
                <td>{formatMoney(holdingStrategyCashTotal + outsideCashForTable)}</td>
                <td>{formatMoney(holdingStrategyCashTotal + outsideCashForTable)}</td>
                <td>1.00</td>
                <td>0.00%</td>
                <td>{formatMoney(outsideCashForTable)}</td>
              </tr>
            </tbody>
          </table>
        </div>
          ) : null}

          {tradeTab === "rebalance" ? (
        <div className="live-panel">
          <div className="rebalance-toolbar">
            <div>
              <h3>交易指令（{instructionTradeDate}）</h3>
              <button className="btn primary" onClick={() => (executionMode === "manual" ? generateManualInstructions() : submitPaperTradePlan(rows, accountAsset))}>
                {executionMode === "manual" ? "生成手动交易指令" : "确认自动交易计划"}
              </button>
              {executionMode === "manual" ? <button className="btn primary" onClick={exportManualInstructions}>导出交易指令</button> : null}
              {executionMode === "manual" ? <button className="btn" onClick={copyClientInstructions}>复制到交易客户端</button> : null}
              {executionMode === "auto" ? (
                <button className="btn primary" onClick={bindTradingInterface}>
                  {tradeInterfaceBound ? "交易接口已绑定" : "绑定交易接口"}
                </button>
              ) : null}
              <button className="btn primary" onClick={clearInstructions}>解除指令</button>
            </div>
            <div>
              <button className="btn" onClick={toggleAdvancedInstructions}>
                {advancedInstructions ? "切换到普通操作" : "切换到高级操作"}
              </button>
              <label className="setting-field compact">
                <span>最小买卖金额：</span>
                <input
                  aria-label="最小买卖金额"
                  type="number"
                  min={0}
                  step={100}
                  value={minimumTradeAmountDraft}
                  onChange={(event) => setMinimumTradeAmountDraft(event.target.value)}
                />
              </label>
              <button className="btn" onClick={saveMinimumTradeAmount}>保存</button>
            </div>
          </div>
          <p className="instruction-status" aria-live="polite">{instructionStatus}</p>
          {advancedInstructions ? (
            <div className="rebalance-advanced-panel">
              <span>高级操作</span>
              <strong>{activeInstructionPlan ? `当前 ${activeInstructionPlan.orders.length} 条指令可调整` : "请先生成本次交易指令"}</strong>
              <em>调整后导出交易指令会使用当前表格中的方向、股数和参考价。</em>
            </div>
          ) : null}
          <p className="instruction-note">
            {executionMode === "manual"
              ? "手动模式下，系统只生成买卖方向、数量、参考价和参考金额，用户需自行在股票软件内填写并提交。"
              : tradeInterfaceBound
                ? "自动模式下，交易接口已绑定，用户确认交易计划后系统将在指定时点提交交易。"
                : "自动模式下，需要先绑定交易接口；未绑定前不会自动提交交易。"}
          </p>
          <p className="trade-alarm">
            <span>●</span> {tradeTime} {executionMode === "manual" ? "生成指令" : "自动执行"}
            <button className="text-link" onClick={exportInstructionStatusTable}>生成交易状态表</button>
          </p>
          {executionMode === "manual" && showClientCopyPanel && activeInstructionPlan ? (
            <div className="trade-client-copy-panel">
              <div className="trade-client-copy-head">
                <strong>交易客户端复制格式</strong>
                <span>证券代码 / 买卖方向 / 委托价格 / 委托数量</span>
                <button className="btn" onClick={copyClientInstructions}>复制</button>
              </div>
              <textarea
                aria-label="交易客户端复制文本"
                readOnly
                rows={Math.min(Math.max(activeInstructionPlan.orders.length, 3), 8)}
                value={clientInstructionText}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          ) : null}
          <table className="live-table">
            <thead>
              <tr>
                <th>股票名称</th>
                <th>行业</th>
                <th>方向</th>
                <th>实际股数</th>
                <th>参考价</th>
                <th>参考金额</th>
                <th>状态</th>
                {advancedInstructions ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {instructionTableRows.length ? (
                instructionTableRows.map(({ order, stock, industry }) => (
                  <tr key={order.clientOrderId}>
                    <td>
                      <StockNameAction stock={stock} onOpen={onOpenStockInfo} className="stock-title-button">
                        {order.name}
                        <span>{displayStockCode(stock)}</span>
                      </StockNameAction>
                    </td>
                    <td>{industry}</td>
                    <td>
                      {advancedInstructions && activeInstructionPlan ? (
                        <select
                          className="instruction-side-select"
                          aria-label={`交易方向 ${order.name}`}
                          value={order.side}
                          onChange={(event) => patchInstructionOrder(order.clientOrderId, { side: event.target.value as PlannedOrder["side"] })}
                        >
                          <option value="买入">买入</option>
                          <option value="卖出">卖出</option>
                        </select>
                      ) : (
                        order.side
                      )}
                    </td>
                    <td className={order.side === "买入" ? "positive" : "negative"}>
                      {advancedInstructions && activeInstructionPlan ? (
                        <input
                          className="instruction-input"
                          aria-label={`实际股数 ${order.name}`}
                          type="number"
                          min={0}
                          step={100}
                          value={order.shares}
                          onChange={(event) => patchInstructionOrder(order.clientOrderId, { shares: Number(event.target.value) })}
                        />
                      ) : (
                        `${order.side === "买入" ? "买" : "卖"}${order.shares}`
                      )}
                    </td>
                    <td>
                      {advancedInstructions && activeInstructionPlan ? (
                        <input
                          className="instruction-input"
                          aria-label={`参考价 ${order.name}`}
                          type="number"
                          min={0}
                          step={0.01}
                          value={order.price}
                          onChange={(event) => patchInstructionOrder(order.clientOrderId, { price: Number(event.target.value) })}
                        />
                      ) : (
                        order.price.toFixed(2)
                      )}
                    </td>
                    <td className={order.side === "买入" ? "negative" : "positive"}>{order.side === "买入" ? "-" : "+"}{formatMoney(order.amount)}</td>
                    <td>{order.status}</td>
                    {advancedInstructions ? (
                      <td>
                        <button className="text-link" onClick={() => removeInstructionOrder(order.clientOrderId)}>移除</button>
                      </td>
                    ) : null}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="instruction-empty" colSpan={advancedInstructions ? 8 : 7}>
                    {activeInstructionPlan ? "当前没有达到最小买卖金额的交易指令。" : "请先点击生成手动交易指令。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          ) : null}

          {tradeTab === "log" ? (
        <div className="live-panel">
          <div className="history-toolbar">
            <span>选择时间：</span>
            <button className="date-step" onClick={() => shiftTradeLogRange(-1)}>◀</button>
            <input type="date" value={tradeLogStartDate} onChange={(event) => setTradeLogStartDate(event.target.value)} />
            <span>-</span>
            <input type="date" value={tradeLogEndDate} onChange={(event) => setTradeLogEndDate(event.target.value)} />
            <button className="date-step" onClick={() => shiftTradeLogRange(1)}>▶</button>
            <button className="btn primary" onClick={viewTradeLogs}>查看日志</button>
            <button className="text-link" onClick={exportTradeLogs}>导出</button>
            <button className="text-link" onClick={showTradeLogHelp}>日志说明</button>
          </div>
          <p className="instruction-status" aria-live="polite">{tradeAuditStatus}</p>
          <table className="live-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>信息</th>
              </tr>
            </thead>
            <tbody>
              {tradeLogRows.map((row, index) => (
                <tr key={`${row.time}-${index}`}>
                  <td>{row.time}</td>
                  <td>
                    <span className={row.type === "买入" ? "log-type buy" : "log-type info"}>{row.type}</span>
                  </td>
                  <td>{row.message}</td>
                </tr>
              ))}
              {!tradeLogRows.length ? (
                <tr>
                  <td className="instruction-empty" colSpan={3}>
                    暂无真实交易日志。请先通过 Bun 生成交易指令并确认纸面交易，或点击资产同步生成同步记录。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
          ) : null}

          {tradeTab === "history" ? (
        <div className="live-panel">
          <div className="history-toolbar">
            <span>成交时间：</span>
            <button className="date-step" onClick={() => shiftHistoryRange(-1)}>◀</button>
            <input type="date" value={historyStartDate} onChange={(event) => setHistoryStartDate(event.target.value)} />
            <span>-</span>
            <input type="date" value={historyEndDate} onChange={(event) => setHistoryEndDate(event.target.value)} />
            <button className="date-step" onClick={() => shiftHistoryRange(1)}>▶</button>
            <SelectField label="选择策略：" value={strategy.name} options={[strategy.name, "策略外资产"]} onChange={() => undefined} />
            <button className="btn primary" onClick={viewTradeHistory}>查看历史记录</button>
            <button className="text-link" onClick={exportTradeHistory}>导出</button>
            <span>当前范围成交：{historyFills.length} / {strategyFills.length}笔</span>
          </div>
          <p className="instruction-status" aria-live="polite">{tradeAuditStatus}</p>
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
              {paperFills.map((fill, index) => (
                <tr key={fill.id}>
                  <td>{index + 1}</td>
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
              {historyAssetSyncRecord ? (
                <tr>
                  <td>{paperFills.length + 1}</td>
                  <td>{historyAssetSyncRecord.time}</td>
                  <td>现金</td>
                  <td />
                  <td>资产同步</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>{formatMoney(historyAssetSyncRecord.amount)}</td>
                </tr>
              ) : null}
              {!paperFills.length && !historyAssetSyncRecord ? (
                <tr>
                  <td className="instruction-empty" colSpan={8}>
                    暂无真实成交记录。请先通过 Bun 生成交易指令并确认纸面交易，或点击资产同步生成同步记录。
                  </td>
                </tr>
              ) : null}
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
          exportConditionInstructions={() =>
            exportTradePlan(rows, "manual", "条件单指令", 0, accountAsset).catch((error) => {
              setInstructionStatus(`Bun 条件单导出接口失败：${readableError(error)}`);
            })
          }
          onOpenStockInfo={onOpenStockInfo}
        />
      )}
    </section>
  );
}

type ConditionOrderRow = {
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
  triggeredAt?: string;
};

function conditionDraftFromRow(row: ConditionOrderRow | undefined, strategy: StrategyConfig): ConditionOrderRow {
  const fallbackStock = row?.stock ?? {
    code: "",
    name: "",
    exchange: "沪市",
    board: "主板",
    industry1: "",
    industry2: "",
    region: "",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: false,
    indexes: [],
    metrics: {}
  };
  const price = Number(fallbackStock.metrics.price ?? row?.triggerPrice ?? 0);
  return {
    id: row?.id ?? `condition-${Date.now().toString(36)}`,
    stock: fallbackStock,
    name: row?.name ?? `${strategy.name}条件单`,
    direction: row?.direction ?? "买入",
    triggerOperator: row?.triggerOperator ?? "<=",
    triggerPrice: row?.triggerPrice ?? round(price * 0.98, 2),
    orderPrice: row?.orderPrice ?? "卖五价+0.05",
    shares: row?.shares ?? 100,
    amount: row?.amount ?? round(price * 100, 2),
    status: row?.status ?? "运行中",
    validUntil: row?.validUntil ?? todayOffset(15),
    triggeredAt: row?.triggeredAt
  };
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
  rows: ConditionOrderRow[];
  strategy: StrategyConfig;
  formatMoney: (value: number) => string;
  executionMode: "manual" | "auto";
  tradeInterfaceBound: boolean;
  bindTradeInterface: () => boolean;
  exportConditionInstructions: () => void | Promise<unknown>;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const sourceKey = rows.map((row) => `${row.id}:${row.stock.code}:${row.triggerPrice}:${row.status}`).join("|");
  const [conditionOrders, setConditionOrders] = useState<ConditionOrderRow[]>(rows);
  const [statusFilter, setStatusFilter] = useState("全部");
  const [conditionStatus, setConditionStatus] = useState("条件单来自当前真实选股结果，可保存、暂停、删除或导出。");
  const [draft, setDraft] = useState<ConditionOrderRow>(() => conditionDraftFromRow(rows[0], strategy));

  useEffect(() => {
    setConditionOrders(rows.map((row) => ({ ...row, status: row.status === "已触发" ? "运行中" : row.status })));
    setDraft(conditionDraftFromRow(rows[0], strategy));
  }, [sourceKey, strategy.id]);

  const filteredOrders = statusFilter === "全部" ? conditionOrders : conditionOrders.filter((row) => row.status === statusFilter);
  const triggeredRows = conditionOrders.filter((row) => row.status === "已触发" && row.triggeredAt);
  const updateDraft = (patch: Partial<ConditionOrderRow>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      const price = Number(next.stock.metrics.price ?? next.triggerPrice ?? 0);
      return {
        ...next,
        shares: Math.max(0, Math.floor(Number(next.shares) / 100) * 100),
        amount: round(price * Math.max(0, Math.floor(Number(next.shares) / 100) * 100), 2)
      };
    });
  };
  const newConditionOrder = () => {
    if (!rows.length) {
      setConditionStatus("请先运行每日选股或实时选股，生成真实候选股票后再新增条件单。");
      return;
    }
    const next = conditionDraftFromRow({ ...rows[0], id: `condition-${Date.now().toString(36)}` }, strategy);
    setDraft(next);
    setConditionStatus("已创建新的条件单草稿，请检查触发价、方向和委托数量后保存。");
  };
  const saveConditionOrder = () => {
    if (!draft.stock.code) {
      setConditionStatus("缺少证券代码，无法保存条件单。请先接入真实选股结果。");
      return;
    }
    setConditionOrders((current) => {
      const exists = current.some((row) => row.id === draft.id);
      return exists ? current.map((row) => (row.id === draft.id ? draft : row)) : [draft, ...current];
    });
    setConditionStatus(`已保存条件单：${draft.name}`);
  };
  const testConditionOrder = () => {
    const price = Number(draft.stock.metrics.price ?? 0);
    const hit =
      draft.triggerOperator === ">="
        ? price >= draft.triggerPrice
        : draft.triggerOperator === ">"
          ? price > draft.triggerPrice
          : draft.triggerOperator === "<"
            ? price < draft.triggerPrice
            : price <= draft.triggerPrice;
    if (price > 0 && hit) {
      const triggered = { ...draft, status: "已触发", triggeredAt: new Date().toISOString() };
      setDraft(triggered);
      setConditionOrders((current) => {
        const exists = current.some((row) => row.id === triggered.id);
        return exists ? current.map((row) => (row.id === triggered.id ? triggered : row)) : [triggered, ...current];
      });
    }
    setConditionStatus(
      price > 0
        ? `试算完成：最新价 ${price.toFixed(2)} ${hit ? "已满足" : "未满足"} ${draft.triggerOperator} ${draft.triggerPrice.toFixed(2)}。`
        : "试算失败：当前股票缺少真实最新价，请先接入真实行情。"
    );
  };
  const pauseAllConditions = () => {
    setConditionOrders((current) => current.map((row) => ({ ...row, status: "暂停" })));
    setConditionStatus("已暂停全部条件单。");
  };
  const editConditionOrder = (row: ConditionOrderRow) => {
    setDraft(row);
    setConditionStatus(`正在编辑条件单：${row.name}`);
  };
  const toggleConditionOrder = (id: string) => {
    setConditionOrders((current) =>
      current.map((row) => (row.id === id ? { ...row, status: row.status === "暂停" ? "运行中" : "暂停" } : row))
    );
    setConditionStatus("条件单状态已更新。");
  };
  const deleteConditionOrder = (id: string) => {
    setConditionOrders((current) => current.filter((row) => row.id !== id));
    setConditionStatus("条件单已删除。");
  };
  const exportConditionOrders = () => {
    const header = ["条件单名称", "股票代码", "股票名称", "触发条件", "方向", "委托价格", "委托数量", "计划金额", "有效期", "状态"];
    const lines = conditionOrders.map((row) => [
      row.name,
      displayStockCode(row.stock),
      row.stock.name,
      `最新价 ${row.triggerOperator} ${row.triggerPrice.toFixed(2)}`,
      row.direction,
      row.orderPrice,
      String(row.shares),
      String(row.amount),
      row.validUntil,
      row.status
    ]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadTextFile(`${safeFileName(strategy.name)}-条件单列表.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
    setConditionStatus(`已导出 ${conditionOrders.length} 条条件单。`);
  };

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
          <button className="btn primary" onClick={newConditionOrder}>
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
          <button className="btn" onClick={pauseAllConditions}>暂停全部</button>
        </div>
      </div>
      <p className="instruction-status" aria-live="polite">{conditionStatus}</p>

      <div className="condition-layout">
        <section className="condition-editor">
          <div className="live-section-title compact">
            <h3>条件单设置</h3>
            <span>资金账号：*****0624</span>
          </div>
          <div className="condition-form-grid">
            <label>
              <span>条件单名称</span>
              <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
            </label>
            <label>
              <span>证券代码</span>
              <input value={draft.stock.code ? displayStockCode(draft.stock) : ""} placeholder="接入真实选股结果后自动填入" readOnly />
            </label>
            <label>
              <span>证券名称</span>
              <input value={draft.stock.name} placeholder="接入真实选股结果后自动填入" readOnly />
            </label>
            <label>
              <span>监控价格</span>
              <select value="最新价" onChange={() => undefined}>
                <option>最新价</option>
              </select>
            </label>
            <label>
              <span>触发条件</span>
              <div className="condition-inline">
                <select value={draft.triggerOperator} onChange={(event) => updateDraft({ triggerOperator: event.target.value })}>
                  <option>{">="}</option>
                  <option>{"<="}</option>
                  <option>{">"}</option>
                  <option>{"<"}</option>
                </select>
                <input type="number" value={draft.triggerPrice} onChange={(event) => updateDraft({ triggerPrice: Number(event.target.value) })} />
              </div>
            </label>
            <label>
              <span>触发后操作</span>
              <select value={draft.direction} onChange={(event) => updateDraft({ direction: event.target.value })}>
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
              <select value={draft.orderPrice} onChange={(event) => updateDraft({ orderPrice: event.target.value })}>
                <option>卖五价+0.05</option>
                <option>买五价-0.05</option>
                <option>涨停价</option>
                <option>跌停价</option>
                <option>限价</option>
              </select>
            </label>
            <label>
              <span>委托数量</span>
              <input type="number" step={100} value={draft.shares} onChange={(event) => updateDraft({ shares: Number(event.target.value) })} />
            </label>
            <label>
              <span>有效期至</span>
              <input type="date" value={draft.validUntil} onChange={(event) => updateDraft({ validUntil: event.target.value })} />
            </label>
          </div>
          <div className="condition-actions">
            <button className="btn primary" onClick={saveConditionOrder}>保存条件单</button>
            <button className="btn" onClick={testConditionOrder}>立即试算</button>
          </div>
        </section>

        <section className="condition-list">
          <div className="condition-filter-row">
            <strong>我的条件单</strong>
            <label>
              <span>状态：</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option>全部</option>
                <option>运行中</option>
                <option>已触发</option>
                <option>暂停</option>
              </select>
            </label>
            <button className="text-link" onClick={exportConditionOrders}>导出</button>
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
              {filteredOrders.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button className="text-link" onClick={() => editConditionOrder(row)}>{row.name}</button>
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
                    <button className="text-link" onClick={() => editConditionOrder(row)}>设置</button>
                    <button className="text-link" onClick={() => toggleConditionOrder(row.id)}>{row.status === "暂停" ? "启用" : "暂停"}</button>
                    <button className="text-link" onClick={() => deleteConditionOrder(row.id)}>删除</button>
                  </td>
                </tr>
              ))}
              {!filteredOrders.length ? (
                <tr>
                  <td className="instruction-empty" colSpan={10}>
                    暂无条件单。请先运行每日选股/实时选股，再新增并保存条件单。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>

      <section className="condition-log">
        <div className="live-section-title compact">
          <h3>触发记录</h3>
          <button className="text-link" onClick={() => setStatusFilter("全部")}>查看全部</button>
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
            {triggeredRows.map((row) => (
              <tr key={`${row.id}-log`}>
                <td>{row.triggeredAt?.replace("T", " ").slice(0, 19)}</td>
                <td>{row.name}</td>
                <td>{row.triggerPrice.toFixed(2)}</td>
                <td>{formatMoney(row.amount)}</td>
                <td>
                  {executionMode === "manual"
                    ? "已生成手动交易指令"
                    : tradeInterfaceBound
                      ? "已通过交易接口提交"
                      : "已生成交易计划，等待接口绑定"}
                </td>
              </tr>
            ))}
            {!triggeredRows.length ? (
              <tr>
                <td className="instruction-empty" colSpan={5}>
                  暂无真实触发记录。条件触发或手动试算满足条件后再记录。
                </td>
              </tr>
            ) : null}
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
  runStatus,
  factors,
  strategy,
  patchStrategy,
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
  runStatus: string;
  factors: Factor[];
  strategy: StrategyConfig;
  patchStrategy: (patch: Partial<StrategyConfig>) => void;
  runCurrentTask: (tab?: BacktestTab) => void | Promise<void>;
  openCompare: () => void;
  onOpenStockInfo: (stock: StockReference) => void;
}) {
  const [factorCorrelationPeriod, setFactorCorrelationPeriod] = useState(20);
  const tabs: Array<{ key: BacktestTab; label: string; icon: React.ReactNode }> = [
    { key: "daily", label: "每日选股", icon: <CalendarDays size={15} /> },
    { key: "realtime", label: "实时选股", icon: <Filter size={15} /> },
    { key: "rank", label: "排名分析", icon: <BarChart3 size={15} /> },
    { key: "backtest", label: "策略回测", icon: <Activity size={15} /> },
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
            type="button"
            data-backtest-tab={item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => setTab(item.key)}
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
              {tab === "daily" || tab === "realtime" ? (
                <NumberField
                  label="选股数量："
                  value={strategy.poolLimit}
                  min={1}
                  step={1}
                  onChange={(poolLimit) => patchStrategy({ poolLimit: Math.max(1, Math.floor(Number.isFinite(poolLimit) ? poolLimit : 1)) })}
                  suffix="只"
                />
              ) : null}
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
          {runStatus ? <span className={`run-status ${runStatus.includes("失败") ? "danger" : ""}`}>{runStatus}</span> : null}
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

const selectionPageSizeOptions = [20, 50, 100];

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
  const [selectionPage, setSelectionPage] = useState(1);
  const [selectionPageSize, setSelectionPageSize] = useState(selectionPageSizeOptions[0]);
  const [selectionSort, setSelectionSort] = useState<{ key: SelectionSortKey; direction: SortDirection }>({ key: "rank", direction: "asc" });
  const rankFactors = getResultFactorKeys(strategy);
  const enabledFilters = strategy.filters.filter((condition) => condition.enabled);
  const showFilterMetric = !compact;
  const title = realtime ? "实时选股结果" : compact ? "候选股票" : "每日选股结果";
  const enablePagination = !compact;
  const selectionRowsWithRank = useMemo(() => rows.map((row, index) => ({ row, rank: index + 1 })), [rows]);
  const sortedSelectionRows = useMemo(() => {
    const directionMultiplier = selectionSort.direction === "asc" ? 1 : -1;
    function valueFor(row: SelectionRow, rank: number): number | string {
      if (selectionSort.key === "rank") return rank;
      if (selectionSort.key === "code") return displayStockCode(row.stock);
      if (selectionSort.key === "name") return row.stock.name;
      if (selectionSort.key === "industry") return `${row.stock.industry1}${row.stock.industry2}`;
      if (selectionSort.key === "score") return row.score;
      if (selectionSort.key === "weight") return row.weight;
      if (selectionSort.key.startsWith("filter:")) {
        const filterId = selectionSort.key.slice("filter:".length);
        const condition = enabledFilters.find((item) => item.id === filterId);
        return condition ? getFilterMetricValue(row, condition, factors) : Number.NaN;
      }
      if (selectionSort.key.startsWith("factor:")) {
        const factorKey = selectionSort.key.slice("factor:".length);
        return metricValue(row.stock, factorByKey(factors, factorKey), factors);
      }
      return rank;
    }
    return [...selectionRowsWithRank].sort((left, right) => {
      const sortDelta = compareSelectionSortValues(valueFor(left.row, left.rank), valueFor(right.row, right.rank), selectionSort.direction);
      if (sortDelta !== 0) return sortDelta * directionMultiplier;
      return left.rank - right.rank;
    });
  }, [enabledFilters, factors, selectionRowsWithRank, selectionSort]);
  const totalSelectionPages = enablePagination ? Math.max(1, Math.ceil(sortedSelectionRows.length / selectionPageSize)) : 1;
  const safeSelectionPage = Math.min(selectionPage, totalSelectionPages);
  const selectionPageStart = enablePagination && sortedSelectionRows.length ? (safeSelectionPage - 1) * selectionPageSize : 0;
  const selectionPageRows = enablePagination ? sortedSelectionRows.slice(selectionPageStart, selectionPageStart + selectionPageSize) : sortedSelectionRows;
  const selectionPageEnd = selectionPageStart + selectionPageRows.length;
  const targetCount = Math.max(1, Math.floor(strategy.poolLimit || 1));
  const weightedCount = Math.min(rows.length, Math.max(1, strategy.trading.maxHoldings));
  const countLabel = compact
    ? `已选 ${rows.length} 只`
    : `已选 ${rows.length} / 目标 ${targetCount} 只，权重分配 ${weightedCount} 只，本页 ${selectionPageRows.length ? `${selectionPageStart + 1}-${selectionPageEnd}` : "0"}`;
  useEffect(
    function clampSelectionPage() {
      if (!enablePagination) return;
      setSelectionPage((current) => Math.min(Math.max(current, 1), totalSelectionPages));
    },
    [enablePagination, totalSelectionPages]
  );
  useEffect(
    function resetSelectionPageAfterRowsChange() {
      if (!enablePagination) return;
      setSelectionPage(1);
    },
    [enablePagination, rows.length, selectionPageSize, selectionSort]
  );
  const toggleSelectionSort = (key: SelectionSortKey) => {
    setSelectionSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
    }));
  };
  const renderSelectionSortHeader = (key: SelectionSortKey, label: string, titleText?: string) => (
    <button
      className={`selection-sort-btn ${selectionSort.key === key ? "active" : ""}`}
      type="button"
      title={titleText ?? label}
      onClick={() => toggleSelectionSort(key)}
    >
      <span>{label}</span>
      <em>{selectionSort.key === key ? (selectionSort.direction === "desc" ? "\u2193" : "\u2191") : "\u2195"}</em>
    </button>
  );
  if (!rows.length) {
    return (
      <div className={`selection-table ${compact ? "compact" : ""}`}>
        <h3 className="selection-table-title">
          {title}
          <span>{countLabel}</span>
        </h3>
        <EmptyState>
          {compact
            ? "暂无候选股票。请先运行回测/每日选股，或放宽筛选条件。"
            : "暂无选股结果。系统会优先通过 Bun 数据接口接入全市场股票；仍为空时，请同步真实财报补齐质量、估值和成长指标，或放宽当前筛选条件。"}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className={`selection-table ${compact ? "compact" : ""}`}>
      <h3 className="selection-table-title">
        {title}
        <span>{countLabel}</span>
      </h3>
      {enablePagination ? (
        <div className="selection-pagination" aria-label={`${title}分页`}>
          <button className="btn" type="button" disabled={safeSelectionPage <= 1} onClick={() => setSelectionPage((page) => Math.max(1, page - 1))}>
            上一页
          </button>
          <span>第 {safeSelectionPage} / {totalSelectionPages} 页，共 {rows.length} 条</span>
          <button className="btn" type="button" disabled={safeSelectionPage >= totalSelectionPages} onClick={() => setSelectionPage((page) => Math.min(totalSelectionPages, page + 1))}>
            下一页
          </button>
          <label>
            <span>每页</span>
            <select
              value={selectionPageSize}
              onChange={(event) => {
                setSelectionPageSize(Number(event.target.value));
                setSelectionPage(1);
              }}
            >
              {selectionPageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>{renderSelectionSortHeader("rank", "排名")}</th>
            <th>{renderSelectionSortHeader("code", "代码")}</th>
            <th>{renderSelectionSortHeader("name", "名称")}</th>
            <th>{renderSelectionSortHeader("industry", "行业")}</th>
            <th>{renderSelectionSortHeader("score", "得分")}</th>
            <th>{renderSelectionSortHeader("weight", "权重")}</th>
            {showFilterMetric
              ? enabledFilters.map((condition) => (
                  <th className="filter-condition-head" key={condition.id}>
                    {renderSelectionSortHeader(`filter:${condition.id}`, getFilterConditionLabel(condition, factors), getFilterConditionLabel(condition, factors))}
                  </th>
                ))
              : null}
            {rankFactors.map((key) => (
              <th key={key}>{renderSelectionSortHeader(`factor:${key}`, getFactorName(factors, key))}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {selectionPageRows.map(({ row, rank }) => {
            return (
              <tr key={row.stock.code}>
                <td>{rank}</td>
                <td>{displayStockCode(row.stock)}</td>
                <td>
                  <StockNameAction stock={row.stock} onOpen={onOpenStockInfo} />
                </td>
                <td>
                  <StockIndustryTagsCell stock={row.stock} />
                </td>
                <td>{row.score.toFixed(2)}</td>
                <td>{row.weight}%</td>
                {showFilterMetric
                  ? enabledFilters.map((condition) => {
                      const item = getFilterMetricItem(row, condition, factors);
                      return (
                        <td className="filter-pass-cell" key={item.key} title={item.title}>
                          <span className="filter-metric-value">{item.value}</span>
                        </td>
                      );
                    })
                  : null}
                {rankFactors.map((key) => (
                  <td key={key}>{formatMetric(metricValue(row.stock, factorByKey(factors, key), factors), factorByKey(factors, key))}</td>
                ))}
              </tr>
            );
          })}
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
        <div className="factor-correlation-layout">
          <div className="mini-table factor-ic-table">
            <h3>??IC??</h3>
            <EmptyState>????????????IC???</EmptyState>
          </div>
          <div className="mini-table factor-matrix-table">
            <h3>???????</h3>
            <EmptyState>???????????????</EmptyState>
          </div>
        </div>
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
