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
  STOCKS,
  SYSTEM_POOLS
} from "./data";
import {
  createCustomFactor,
  createDefaultBacktestConfig,
  createDefaultStrategy,
  createStaticPool,
  loadLocal,
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

function ensureStockData(value: Stock[]) {
  return Array.isArray(value) && value.length ? value : STOCKS;
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
type MainSection = "strategy" | "trade" | "settings";

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
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
  const [stocks, setStocks] = useState<Stock[]>(() => ensureStockData(loadLocal("openSourceStocks", STOCKS)));
  const [openSourceSummary, setOpenSourceSummary] = useState<OpenSourceDataSummary>(() => ({
    ...defaultOpenSourceDataSummary,
    stockCount: STOCKS.length,
    ...loadLocal("openSourceDataSummary", {})
  }));
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
  const [poolDraft, setPoolDraft] = useState({ name: "我的股票池", codes: "600519,300750,002594,600036,600900" });
  const [customFactorDraft, setCustomFactorDraft] = useState({ name: "质量成长合成", formula: "qualityScore * 0.6 + revenueGrowth * 0.4 - pe * 0.2" });

  useEffect(() => {
    saveLocal("draftStrategy", strategy);
    saveLocal("savedStrategies", savedStrategies);
    saveLocal("infoSourceSettings", infoSourceSettings);
    saveLocal("openSourceStocks", stocks);
    saveLocal("openSourceDataSummary", openSourceSummary);
    saveLocal("tradeConnectionSettings", tradeConnection);
    saveLocal("paperTradeState", paperTradeState);
  }, []);

  const pools = useMemo(() => [...SYSTEM_POOLS, ...customPools], [customPools]);
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
      .map((code) => code.trim())
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
    const result = await syncOpenSourceMarketData(infoSourceSettings, STOCKS);
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
            策略
          </button>
          <button className={topSection === "trade" ? "active" : ""} onClick={() => setTopSection("trade")}>
            交易
          </button>
          <button className={topSection === "settings" ? "active" : ""} onClick={() => setTopSection("settings")}>
            设置
          </button>
        </header>

        <div className={`workspace-layout ${managerCollapsed ? "manager-collapsed" : ""} ${topSection === "settings" ? "settings-mode" : ""}`}>
          {topSection !== "settings" ? (
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
                />
              </main>
            ) : (
              <main>
                <SettingsWorkspace
                  settings={infoSourceSettings}
                  status={infoSourceStatus}
                  summary={openSourceSummary}
                  stockCount={stocks.length}
                  patchSettings={patchInfoSourceSettings}
                  toggleModule={toggleSourceModule}
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
              筛选条件 <em>{strategy.filters.length || ""}</em>
            </button>
            <button className={conditionTab === "rank" ? "active" : ""} onClick={() => setConditionTab("rank")}>
              排名条件 <em>{strategy.ranks.length || ""}</em>
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

function SettingsWorkspace({
  settings,
  status,
  summary,
  stockCount,
  patchSettings,
  toggleModule,
  onSave,
  onTest,
  onSyncOpenData
}: {
  settings: InfoSourceSettings;
  status: string;
  summary: OpenSourceDataSummary;
  stockCount: number;
  patchSettings: (patch: Partial<InfoSourceSettings>) => void;
  toggleModule: (key: SourceModuleKey) => void;
  onSave: () => void;
  onTest: () => void;
  onSyncOpenData: () => void;
}) {
  const enabledCount = enabledSourceModules(settings).length;
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
              placeholder="未填写时使用本地样本数据"
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
  submitPaperTradePlan
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
                    <td>{row.stock.name}</td>
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
                    {row.stock.name}
                    <br />
                    <a>({row.stock.code})</a>
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
                  <td>{row.stock.name}</td>
                  <td>
                    <a>{row.stock.code}</a>
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
                  <td>{fill.name}</td>
                  <td>
                    <a>{fill.code}</a>
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
  exportConditionInstructions
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
              <input defaultValue={first?.stock.code ?? "600519"} />
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
                    {row.stock.name}
                    <br />
                    <a>({row.stock.code})</a>
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
  openCompare
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

      {tab === "backtest" ? <BacktestResultView result={result} rows={selectionRows} factors={factors} strategy={strategy} /> : null}
      {tab === "daily" || tab === "realtime" ? <SelectionTable rows={selectionRows} factors={factors} strategy={strategy} realtime={tab === "realtime"} /> : null}
      {tab === "rank" ? <RankingTable rows={rankRows} factors={factors} strategy={strategy} /> : null}
      {tab === "factorCorrelation" ? <FactorCorrelationPanel rows={rankRows} factors={factors} strategy={strategy} /> : null}
    </section>
  );
}

function BacktestResultView({ result, rows, factors, strategy }: { result: BacktestResult | null; rows: SelectionRow[]; factors: Factor[]; strategy: StrategyConfig }) {
  if (!result) {
    return (
      <div className="preview-results">
        <SelectionTable rows={rows} factors={factors} strategy={strategy} compact />
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
        <SelectionTable rows={result.rows} factors={factors} strategy={strategy} compact />
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
                  <td>{trade.name}</td>
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
  compact = false
}: {
  rows: SelectionRow[];
  factors: Factor[];
  strategy: StrategyConfig;
  realtime?: boolean;
  compact?: boolean;
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
              <td>{row.stock.code}</td>
              <td>{row.stock.name}</td>
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

function RankingTable({ rows, factors, strategy }: { rows: RankingRow[]; factors: Factor[]; strategy: StrategyConfig }) {
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
              <td>{row.stock.code}</td>
              <td>{row.stock.name}</td>
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
