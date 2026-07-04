import type { SelectionRow, StrategyConfig } from "../../src/types";
import { ensurePaperTradeState, ensureTradeAssetState, submitPaperTradePlan, type PaperTradeState, type TradeAssetState, type TradePlan } from "../../src/tradingServices";

export interface TradePlanRequest {
  strategy: StrategyConfig;
  rows: SelectionRow[];
  mode?: "manual" | "auto";
  accountId?: string;
  accountAsset?: number;
  minimumAmount?: number;
}

const round = (value: number, precision = 2) => Math.round(value * 10 ** precision) / 10 ** precision;

export function createBunTradePlan(request: TradePlanRequest) {
  const accountAsset = Number.isFinite(request.accountAsset) ? Math.max(0, Number(request.accountAsset)) : 500000;
  const minimumAmount = Number.isFinite(request.minimumAmount) ? Math.max(0, Number(request.minimumAmount)) : 0;
  const generatedAt = new Date().toISOString();
  const orders = request.rows
    .filter((row) => row.weight > 0 && Number.isFinite(row.stock.metrics.price) && row.stock.metrics.price > 0)
    .map((row, index) => {
      const price = round(row.stock.metrics.price, 2);
      const targetAmount = accountAsset * Math.max(0, row.weight) / 100;
      const shares = Math.floor(targetAmount / price / 100) * 100;
      const amount = round(shares * price, 2);
      return {
        clientOrderId: `bun-${Date.now().toString(36)}-${index + 1}`,
        code: row.stock.code,
        name: row.stock.name,
        side: "买入" as const,
        shares,
        price,
        amount,
        status: "待确认" as const
      };
    })
    .filter((order) => order.shares > 0 && order.amount >= minimumAmount);
  const plan: TradePlan = {
    id: `plan-bun-${Date.now().toString(36)}`,
    strategyId: request.strategy.id,
    strategyName: request.strategy.name,
    accountId: request.accountId || "PAPER-0001",
    mode: request.mode || "manual",
    generatedAt,
    orders,
    status: "draft"
  };
  return { plan, clientText: tradePlanToClientText(plan), csv: tradePlanToCsv(plan) };
}

export function tradePlanToClientText(plan: TradePlan) {
  return plan.orders.map((order) => `${order.code}\t${order.side}\t${order.price}\t${order.shares}`).join("\n");
}

export function tradePlanToCsv(plan: TradePlan) {
  const header = "clientOrderId,code,name,side,price,shares,amount,status";
  const rows = plan.orders.map((order) => [order.clientOrderId, order.code, order.name, order.side, order.price, order.shares, order.amount, order.status].join(","));
  return [header, ...rows].join("\n");
}

export function submitPaperTrade(state: PaperTradeState, plan: TradePlan) {
  return submitPaperTradePlan(ensurePaperTradeState(state), plan);
}

export function syncTradeAssets(asset: TradeAssetState) {
  const normalized = ensureTradeAssetState(asset);
  const strategyAsset = round(normalized.holdingValue + normalized.strategyCash, 2);
  const accountAsset = round(strategyAsset + normalized.outsideAsset, 2);
  return {
    ok: true,
    asset: { ...normalized, lastSyncedAt: new Date().toISOString() },
    accountAsset,
    strategyAsset,
    message: "Bun 资产同步接口已返回本地确认结果"
  };
}

