import type { SelectionRow, StrategyConfig } from "./types";

export type ExecutionMode = "manual" | "auto";

export interface TradeConnectionSettings {
  provider: string;
  endpoint: string;
  accountId: string;
  token: string;
  bound: boolean;
  boundAt?: string;
  lastSyncAt?: string;
}

export interface PlannedOrder {
  clientOrderId: string;
  code: string;
  name: string;
  side: "买入" | "卖出";
  shares: number;
  price: number;
  amount: number;
  status: "待确认" | "已提交" | "已成交";
}

export interface TradePlan {
  id: string;
  strategyId: string;
  strategyName: string;
  accountId: string;
  mode: ExecutionMode;
  generatedAt: string;
  orders: PlannedOrder[];
  status: "draft" | "confirmed" | "submitted" | "filled";
}

export interface PaperTradeState {
  plans: TradePlan[];
  fills: Array<{
    id: string;
    clientOrderId: string;
    code: string;
    name: string;
    side: PlannedOrder["side"];
    shares: number;
    price: number;
    amount: number;
    filledAt: string;
  }>;
}

export const defaultTradeConnectionSettings: TradeConnectionSettings = {
  provider: "本地纸面交易接口",
  endpoint: "paper://local",
  accountId: "PAPER-0001",
  token: "",
  bound: false
};

export const defaultPaperTradeState: PaperTradeState = {
  plans: [],
  fills: []
};

export function ensureTradeConnectionSettings(settings: Partial<TradeConnectionSettings> | null | undefined): TradeConnectionSettings {
  return { ...defaultTradeConnectionSettings, ...(settings ?? {}) };
}

export function ensurePaperTradeState(state: Partial<PaperTradeState> | null | undefined): PaperTradeState {
  return {
    plans: state?.plans ?? [],
    fills: state?.fills ?? []
  };
}

export function validateTradeConnection(settings: TradeConnectionSettings) {
  const errors: string[] = [];
  if (!settings.provider.trim()) errors.push("交易接口名称不能为空");
  if (!settings.accountId.trim()) errors.push("资金账号不能为空");
  if (!settings.endpoint.trim()) errors.push("交易接口地址不能为空");
  if (!settings.endpoint.startsWith("paper://") && !/^https?:\/\/.+/i.test(settings.endpoint)) {
    errors.push("交易接口地址必须是 paper:// 或 http(s)://");
  }
  return errors;
}

export function bindTradeConnection(settings: TradeConnectionSettings) {
  const errors = validateTradeConnection(settings);
  if (errors.length) {
    return { ok: false, settings, message: errors.join("；") };
  }
  return {
    ok: true,
    settings: { ...settings, bound: true, boundAt: new Date().toISOString() },
    message: "交易接口已绑定"
  };
}

export function createTradePlan({
  strategy,
  rows,
  mode,
  accountId,
  accountAsset = 500000
}: {
  strategy: StrategyConfig;
  rows: SelectionRow[];
  mode: ExecutionMode;
  accountId: string;
  accountAsset?: number;
}): TradePlan {
  const generatedAt = new Date().toISOString();
  const selected = rows.slice(0, Math.max(strategy.trading.maxHoldings, 1));
  const orders = selected.map((row, index) => {
    const price = Number(row.stock.metrics.price ?? 1);
    const targetAmount = accountAsset * Math.max(row.weight, 1) / 100;
    const shares = Math.max(100, Math.floor(targetAmount / Math.max(price, 1) / 100) * 100);
    const amount = round(price * shares, 2);
    return {
      clientOrderId: `${strategy.id}-${generatedAt}-${index}-${row.stock.code}`,
      code: row.stock.code,
      name: row.stock.name,
      side: "买入" as const,
      shares,
      price: round(price, 3),
      amount,
      status: "待确认" as const
    };
  });
  return {
    id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    strategyId: strategy.id,
    strategyName: strategy.name,
    accountId,
    mode,
    generatedAt,
    orders,
    status: "draft"
  };
}

export function submitPaperTradePlan(state: PaperTradeState, plan: TradePlan): PaperTradeState {
  const submittedAt = new Date().toISOString();
  const submittedPlan: TradePlan = {
    ...plan,
    status: "filled",
    orders: plan.orders.map((order) => ({ ...order, status: "已成交" }))
  };
  const fills = submittedPlan.orders.map((order) => ({
    id: `fill-${order.clientOrderId}`,
    clientOrderId: order.clientOrderId,
    code: order.code,
    name: order.name,
    side: order.side,
    shares: order.shares,
    price: order.price,
    amount: order.amount,
    filledAt: submittedAt
  }));
  return {
    plans: [submittedPlan, ...state.plans.filter((item) => item.id !== submittedPlan.id)].slice(0, 30),
    fills: [...fills, ...state.fills].slice(0, 200)
  };
}

export function tradePlanToCsv(plan: TradePlan) {
  const header = ["指令编号", "策略", "资金账号", "模式", "股票代码", "股票名称", "方向", "数量", "参考价", "参考金额", "状态"];
  const rows = plan.orders.map((order) => [
    order.clientOrderId,
    plan.strategyName,
    plan.accountId,
    plan.mode === "manual" ? "手动" : "自动",
    order.code,
    order.name,
    order.side,
    String(order.shares),
    String(order.price),
    String(order.amount),
    order.status
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
