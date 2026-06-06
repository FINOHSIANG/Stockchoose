import { describe, expect, it } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { createDefaultStrategy } from "./storage";
import type { SelectionRow } from "./types";
import {
  bindTradeConnection,
  createTradePlan,
  defaultPaperTradeState,
  defaultTradeConnectionSettings,
  ensurePaperTradeState,
  submitPaperTradePlan,
  tradePlanToCsv
} from "./tradingServices";

const rows: SelectionRow[] = STOCKS.slice(0, 3).map((stock, index) => ({
  stock,
  score: 90 - index,
  weight: 10,
  passedFilters: 1
}));

describe("tradingServices", () => {
  it("validates and binds the local paper trading interface", () => {
    const result = bindTradeConnection(defaultTradeConnectionSettings);

    expect(result.ok).toBe(true);
    expect(result.settings.bound).toBe(true);
    expect(result.message).toBe("交易接口已绑定");
  });

  it("creates deterministic executable order fields", () => {
    const strategy = createDefaultStrategy();
    const plan = createTradePlan({
      strategy,
      rows,
      mode: "manual",
      accountId: "PAPER-0001"
    });

    expect(plan.orders).toHaveLength(3);
    expect(plan.orders[0]).toMatchObject({
      code: rows[0].stock.code,
      side: "买入",
      status: "待确认"
    });
    expect(plan.orders[0].shares % 100).toBe(0);
    expect(plan.orders[0].amount).toBeGreaterThan(0);
  });

  it("exports trade plan CSV and records paper fills", () => {
    const strategy = createDefaultStrategy();
    const plan = createTradePlan({ strategy, rows, mode: "auto", accountId: "PAPER-0001" });
    const csv = tradePlanToCsv(plan);
    const nextState = submitPaperTradePlan(defaultPaperTradeState, plan);

    expect(csv).toContain("指令编号");
    expect(csv).toContain(rows[0].stock.code);
    expect(nextState.plans[0].status).toBe("filled");
    expect(nextState.fills).toHaveLength(plan.orders.length);
    expect(nextState.fills[0]).toMatchObject({
      planId: plan.id,
      strategyId: strategy.id,
      strategyName: strategy.name
    });
  });

  it("migrates legacy paper fills to the matching strategy plan", () => {
    const strategy = createDefaultStrategy();
    const plan = createTradePlan({ strategy, rows, mode: "auto", accountId: "PAPER-0001" });
    const order = plan.orders[0];
    const state = ensurePaperTradeState({
      plans: [plan],
      fills: [
        {
          id: `legacy-${order.clientOrderId}`,
          clientOrderId: order.clientOrderId,
          code: order.code,
          name: order.name,
          side: order.side,
          shares: order.shares,
          price: order.price,
          amount: order.amount,
          filledAt: plan.generatedAt
        } as never
      ]
    });

    expect(state.fills[0].planId).toBe(plan.id);
    expect(state.fills[0].strategyId).toBe(strategy.id);
    expect(state.fills[0].strategyName).toBe(strategy.name);
  });
});
