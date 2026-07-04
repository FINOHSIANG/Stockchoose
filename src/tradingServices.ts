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

export interface PaperTradeFill {
  id: string;
  planId: string;
  strategyId: string;
  strategyName: string;
  clientOrderId: string;
  code: string;
  name: string;
  side: PlannedOrder["side"];
  shares: number;
  price: number;
  amount: number;
  filledAt: string;
}

export interface PaperTradeState {
  plans: TradePlan[];
  fills: PaperTradeFill[];
}

export interface TradeAssetState {
  netValue: number;
  holdingValue: number;
  strategyCash: number;
  outsideAsset: number;
  lastSyncedAt?: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CreateTradePlanInput {
  strategy: StrategyConfig;
  rows: SelectionRow[];
  mode: ExecutionMode;
  accountId: string;
  accountAsset?: number;
  minimumAmount?: number;
}

export interface TradePlanExport {
  plan: TradePlan;
  clientText: string;
  csv: string;
}

export interface TradeAssetSyncResult {
  ok: boolean;
  asset: TradeAssetState;
  accountAsset: number;
  strategyAsset: number;
  message: string;
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

export const defaultTradeAssetState: TradeAssetState = {
  netValue: 1,
  holdingValue: 320000,
  strategyCash: 180000,
  outsideAsset: 500000
};

export function ensureTradeAssetState(value: Partial<TradeAssetState> | null | undefined): TradeAssetState {
  const positiveNumber = (input: unknown, fallback: number, precision = 4) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    const scale = 10 ** precision;
    return Math.round(parsed * scale) / scale;
  };
  return {
    netValue: positiveNumber(value?.netValue, defaultTradeAssetState.netValue, 4),
    holdingValue: positiveNumber(value?.holdingValue, defaultTradeAssetState.holdingValue, 2),
    strategyCash: positiveNumber(value?.strategyCash, defaultTradeAssetState.strategyCash, 2),
    outsideAsset: positiveNumber(value?.outsideAsset, defaultTradeAssetState.outsideAsset, 2),
    lastSyncedAt: value?.lastSyncedAt
  };
}

export function ensureTradeConnectionSettings(settings: Partial<TradeConnectionSettings> | null | undefined): TradeConnectionSettings {
  return { ...defaultTradeConnectionSettings, ...(settings ?? {}) };
}

export function ensurePaperTradeState(state: Partial<PaperTradeState> | null | undefined): PaperTradeState {
  const plans = state?.plans ?? [];
  return {
    plans,
    fills: (state?.fills ?? []).map((fill) => {
      const relatedPlan = plans.find((plan) => plan.orders.some((order) => order.clientOrderId === fill.clientOrderId));
      return {
        ...fill,
        planId: fill.planId ?? relatedPlan?.id ?? "",
        strategyId: fill.strategyId ?? relatedPlan?.strategyId ?? "",
        strategyName: fill.strategyName ?? relatedPlan?.strategyName ?? ""
      };
    })
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

export function createTradePlan(input: CreateTradePlanInput): TradePlan {
  return createEmptyTradePlan(input);
}

function createEmptyTradePlan({ strategy, mode, accountId }: CreateTradePlanInput): TradePlan {
  const generatedAt = new Date().toISOString();
  return {
    id: `plan-empty-${Date.now().toString(36)}`,
    strategyId: strategy.id,
    strategyName: strategy.name,
    accountId,
    mode,
    generatedAt,
    orders: [],
    status: "draft"
  };
}

function responseErrorSuffix(response: Response) {
  return response
    .text()
    .then((details) => {
      const trimmed = details.trim();
      return trimmed ? `: ${trimmed.slice(0, 300)}` : "";
    })
    .catch(() => "");
}

async function jsonFromResponse(response: Response, label: string) {
  try {
    return await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${label} returned invalid JSON: ${detail}`);
  }
}

function isTradeAssetPayload(value: unknown): value is TradeAssetState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TradeAssetState>;
  return (
    typeof candidate.netValue === "number" &&
    typeof candidate.holdingValue === "number" &&
    typeof candidate.strategyCash === "number" &&
    typeof candidate.outsideAsset === "number"
  );
}

export async function createTradePlanExportBunFirst(input: CreateTradePlanInput, fetchImpl?: FetchLike): Promise<TradePlanExport> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun trade API unavailable: fetch is not available");

  const response = await request("/api/trade/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      strategy: input.strategy,
      rows: input.rows,
      mode: input.mode,
      accountId: input.accountId,
      accountAsset: input.accountAsset ?? 500000,
      minimumAmount: input.minimumAmount ?? 0
    })
  });
  if (!response.ok) {
    throw new Error(`Bun trade API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  }
  const payload = await jsonFromResponse(response, "Bun trade API");
  if (!Array.isArray(payload?.plan?.orders) || typeof payload.clientText !== "string" || typeof payload.csv !== "string") {
    throw new Error("Bun trade API returned invalid trade export payload");
  }
  return {
    plan: payload.plan as TradePlan,
    clientText: payload.clientText,
    csv: payload.csv
  };
}

export async function createTradePlanBunFirst(input: CreateTradePlanInput, fetchImpl?: FetchLike): Promise<TradePlan> {
  return (await createTradePlanExportBunFirst(input, fetchImpl)).plan;
}

export async function exportTradePlanBunFirst(plan: TradePlan, fetchImpl?: FetchLike): Promise<Pick<TradePlanExport, "clientText" | "csv">> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun trade export API unavailable: fetch is not available");

  const response = await request("/api/trade/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan })
  });
  if (!response.ok) {
    throw new Error(`Bun trade export API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  }
  const payload = await jsonFromResponse(response, "Bun trade export API");
  if (typeof payload.clientText !== "string" || typeof payload.csv !== "string") {
    throw new Error("Bun trade export API returned invalid export payload");
  }
  return {
    clientText: payload.clientText,
    csv: payload.csv
  };
}

function isPaperTradeStatePayload(value: unknown): value is Partial<PaperTradeState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PaperTradeState>;
  return Array.isArray(candidate.plans) && Array.isArray(candidate.fills);
}

export async function submitPaperTradePlanBunFirst(state: PaperTradeState, plan: TradePlan, fetchImpl?: FetchLike): Promise<PaperTradeState> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun paper trade API unavailable: fetch is not available");

  const response = await request("/api/trade/paper/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state: ensurePaperTradeState(state),
      plan
    })
  });
  if (!response.ok) {
    throw new Error(`Bun paper trade API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  }
  const payload = await jsonFromResponse(response, "Bun paper trade API");
  if (!isPaperTradeStatePayload(payload)) {
    throw new Error("Bun paper trade API returned invalid paper trade state");
  }
  return ensurePaperTradeState(payload);
}

export async function syncTradeAssetsBunFirst(asset: TradeAssetState, fetchImpl?: FetchLike): Promise<TradeAssetSyncResult> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun asset sync API unavailable: fetch is not available");

  const response = await request("/api/trade/assets/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ asset })
  });
  if (!response.ok) {
    throw new Error(`Bun asset sync API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  }
  const payload = await jsonFromResponse(response, "Bun asset sync API");
  if (!isTradeAssetPayload(payload?.asset) || typeof payload?.accountAsset !== "number" || typeof payload?.strategyAsset !== "number") {
    throw new Error("Bun asset sync API returned invalid asset sync payload");
  }
  return {
    ok: payload?.ok === true,
    asset: ensureTradeAssetState(payload.asset),
    accountAsset: payload.accountAsset,
    strategyAsset: payload.strategyAsset,
    message: typeof payload?.message === "string" ? payload.message : "Bun 资产同步接口已返回"
  };
}

export function submitPaperTradePlan(state: PaperTradeState, plan: TradePlan): PaperTradeState {
  const currentState = ensurePaperTradeState(state);
  const submittedAt = new Date().toISOString();
  const submittedPlan: TradePlan = {
    ...plan,
    status: "filled",
    orders: plan.orders.map((order) => ({ ...order, status: "已成交" }))
  };
  const fills = submittedPlan.orders.map((order) => ({
    id: `fill-${order.clientOrderId}`,
    planId: submittedPlan.id,
    strategyId: submittedPlan.strategyId,
    strategyName: submittedPlan.strategyName,
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
    plans: [submittedPlan, ...currentState.plans.filter((item) => item.id !== submittedPlan.id)].slice(0, 30),
    fills: [...fills, ...currentState.fills].slice(0, 200)
  };
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
