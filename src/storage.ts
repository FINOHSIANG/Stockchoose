import type { BacktestConfig, Factor, StockPool, StrategyConfig } from "./types";

const key = (name: string) => `stockchoose:${name}`;

function desktopStorage() {
  return typeof window !== "undefined" ? window.stockChooseDesktop?.storage : undefined;
}

function reportStorageFailure(name: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "unknown storage error");
  console.warn("StockChoose storage failed for " + name + ": " + message);
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("stockchoose:storage-error", { detail: { name, message } }));
  }
}

export function loadLocal<T>(name: string, fallback: T): T {
  const bridge = desktopStorage();
  if (bridge) {
    try {
      const stored = bridge.load<T>(name);
      if (!stored.ok) {
        reportStorageFailure(name, stored.error);
        return fallback;
      }
      if (stored.found) return stored.value as T;
    } catch (error) {
      reportStorageFailure(name, error);
      return fallback;
    }
  }

  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return fallback;
    const value = JSON.parse(raw) as T;
    if (bridge) {
      const migrated = bridge.save(name, value);
      if (migrated.ok) localStorage.removeItem(key(name));
      else reportStorageFailure(name, migrated.error);
    }
    return value;
  } catch (error) {
    reportStorageFailure(name, error);
    return fallback;
  }
}

export function saveLocal<T>(name: string, value: T) {
  const bridge = desktopStorage();
  if (bridge) {
    try {
      const stored = bridge.save(name, value);
      if (!stored.ok) throw new Error(stored.error || "desktop storage rejected the value");
      localStorage.removeItem(key(name));
      return true;
    } catch (error) {
      reportStorageFailure(name, error);
      return false;
    }
  }

  try {
    localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  } catch (error) {
    reportStorageFailure(name, error);
    return false;
  }
}

export function removeLocal(name: string) {
  const bridge = desktopStorage();
  if (bridge) {
    try {
      const removed = bridge.remove(name);
      if (!removed.ok) throw new Error(removed.error || "desktop storage rejected the removal");
    } catch (error) {
      reportStorageFailure(name, error);
      return false;
    }
  }

  try {
    localStorage.removeItem(key(name));
    return true;
  } catch (error) {
    reportStorageFailure(name, error);
    return false;
  }
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createDefaultStrategy(): StrategyConfig {
  return {
    id: uid("strategy"),
    name: "股票策略",
    updatedAt: new Date().toISOString(),
    description: "",
    poolId: "all",
    hotPoolId: "all",
    poolLimit: 100,
    screenPeriod: 5,
    industryStandard: "申万 2014",
    indexMember: "全部",
    board: "全部",
    industry1: "全部",
    industry2: "全部",
    stMode: "包含ST",
    exchange: "全部",
    region: "全部",
    property: "全部",
    marginFlag: "全部",
    starMode: "排除科创板",
    filterSuspended: false,
    excludeDelisted: false,
    filters: [],
    // 排名条件由用户主动选择指标后生成，不预置任何排名参数。
    ranks: [],
    trading: {
      mode: "模型I",
      period: 5,
      orderTime: "收盘价",
      cashAsset: "无",
      realtimeBacktest: false,
      multiPoint: false,
      maxHoldings: 10,
      idealPosition: 10,
      positionDeviation: 30,
      minPosition: 1,
      backupCount: 5,
      maxBuyPosition: 100,
      weightMethod: "平权",
      advancedOpen: false,
      tradeDate: "不指定",
      sellSuspended: false,
      shortSelling: "无",
      industryLimitRatio: 0,
      positionExpression: "",
      industryNeutralBenchmark: "无",
      buyRules: [],
      sellRules: [],
      holdRules: []
    },
    timing: {
      mode: "不择时",
      template: "沪深300收盘价高于MA60",
      index: "沪深300",
      threshold: 0,
      formula: "hs300Trend > 50 && macroPulse > 45",
      cashWhenTimingOut: "现金"
    },
    hedge: {
      enabled: false,
      contract: "IF",
      ratio: 0,
      benchmark: "沪深300",
      rebalance: 5,
      cost: 0.3
    },
    assets: []
  };
}

export function createDefaultBacktestConfig(): BacktestConfig {
  return {
    startDate: todayOffset(-368),
    endDate: todayOffset(-3),
    benchmark: "沪深300",
    cost: 0.2,
    excludeTimeRange: false
  };
}

export function createCustomFactor(name: string, formula: string): Factor {
  return {
    key: uid("custom"),
    name,
    group: "自定义",
    description: `自定义公式：${formula}`,
    defaultOrder: "desc",
    unit: "",
    precision: 2,
    formula
  } as Factor;
}

export function createStaticPool(name: string, codes: string[]): StockPool {
  return {
    id: uid("pool"),
    name,
    type: "static",
    codes,
    description: "本地静态股票池"
  };
}
