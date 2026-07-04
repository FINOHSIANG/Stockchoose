import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { createDefaultStrategy } from "./storage";
import type { SelectionRow } from "./types";
import type { TradePlan } from "./tradingServices";
import {
  bindTradeConnection,
  createTradePlanExportBunFirst,
  createTradePlan,
  createTradePlanBunFirst,
  defaultPaperTradeState,
  defaultTradeAssetState,
  defaultTradeConnectionSettings,
  ensurePaperTradeState,
  exportTradePlanBunFirst,
  syncTradeAssetsBunFirst,
  submitPaperTradePlanBunFirst,
  submitPaperTradePlan
} from "./tradingServices";

const rows: SelectionRow[] = STOCKS.slice(0, 3).map((stock, index) => ({
  stock,
  score: 90 - index,
  weight: 10,
  passedFilters: 1
}));

function tradePlanFixture(strategy = createDefaultStrategy(), mode: TradePlan["mode"] = "manual"): TradePlan {
  const generatedAt = "2026-06-09T16:00:00.000Z";
  return {
    id: `plan-fixture-${mode}`,
    strategyId: strategy.id,
    strategyName: strategy.name,
    accountId: "PAPER-0001",
    mode,
    generatedAt,
    status: "draft",
    orders: rows.map((row, index) => {
      const price = Number(row.stock.metrics.price ?? 10);
      const shares = 100 * (index + 1);
      return {
        clientOrderId: `fixture-${index}-${row.stock.code}`,
        code: row.stock.code,
        name: row.stock.name,
        side: "\u4e70\u5165",
        shares,
        price,
        amount: price * shares,
        status: "\u5f85\u786e\u8ba4"
      };
    })
  };
}

describe("tradingServices", () => {
  it("validates and binds the local paper trading interface", () => {
    const result = bindTradeConnection(defaultTradeConnectionSettings);

    expect(result.ok).toBe(true);
    expect(result.settings.bound).toBe(true);
    expect(result.message).toBe("交易接口已绑定");
  });

  it("does not create browser-side executable order fields", () => {
    const strategy = createDefaultStrategy();
    const plan = createTradePlan({
      strategy,
      rows,
      mode: "manual",
      accountId: "PAPER-0001"
    });

    expect(plan).toMatchObject({
      strategyId: strategy.id,
      accountId: "PAPER-0001",
      status: "draft",
      orders: []
    });
  });

  it("rejects when the Bun trade plan API fails instead of creating browser-side executable orders", async () => {
    const strategy = createDefaultStrategy();
    const localPlan = createTradePlan({ strategy, rows, mode: "manual", accountId: "PAPER-0001" });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));

    await expect(createTradePlanBunFirst(
      { strategy, rows, mode: "manual", accountId: "PAPER-0001" },
      fetchMock
    )).rejects.toThrow("Bun trade API HTTP 503");

    expect(localPlan.orders).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trade/plan",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses Bun trade export payload for client-copyable instructions", async () => {
    const strategy = createDefaultStrategy();
    const bunPlan = tradePlanFixture(strategy);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ plan: bunPlan, clientText: "600519\t买入\t100.000\t100", csv: "\"指令编号\"" }), { status: 200 })
    );

    const result = await createTradePlanExportBunFirst(
      { strategy, rows, mode: "manual", accountId: "PAPER-0001", accountAsset: 300000, minimumAmount: 20000 },
      fetchMock
    );

    expect(result.plan).toEqual(bunPlan);
    expect(result.clientText).toBe("600519\t买入\t100.000\t100");
    expect(result.csv).toBe("\"指令编号\"");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      accountAsset: 300000,
      minimumAmount: 20000
    });
  });

  it("asks Bun to render edited trade plans for export", async () => {
    const strategy = createDefaultStrategy();
    const plan = tradePlanFixture(strategy);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ clientText: "600519\t买入\t100.000\t100", csv: "\"指令编号\"" }), { status: 200 })
    );

    const result = await exportTradePlanBunFirst(plan, fetchMock);

    expect(result.clientText).toContain("\t");
    expect(result.csv).toBe("\"指令编号\"");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/trade/export");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ plan: { id: plan.id } });
  });

  it("rejects when Bun trade export fails instead of returning empty client text", async () => {
    const strategy = createDefaultStrategy();
    const plan = tradePlanFixture(strategy);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "bun unavailable" }), { status: 503 }));

    await expect(exportTradePlanBunFirst(plan, fetchMock)).rejects.toThrow("Bun trade export API HTTP 503");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/trade/export");
  });

  it("syncs manually edited asset state through Bun", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        ok: true,
        asset: {
          netValue: 1.2346,
          holdingValue: 100000,
          strategyCash: 25000,
          outsideAsset: 300000,
          lastSyncedAt: "2026-06-09T16:00:00Z"
        },
        accountAsset: 425000,
        strategyAsset: 125000,
        message: "资产已由 Bun 交易接口同步"
      }), { status: 200 })
    );

    const result = await syncTradeAssetsBunFirst({
      netValue: 1.23456,
      holdingValue: 100000,
      strategyCash: 25000,
      outsideAsset: 300000
    }, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.asset.netValue).toBe(1.2346);
    expect(result.accountAsset).toBe(425000);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/trade/assets/sync");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      asset: {
        holdingValue: 100000,
        strategyCash: 25000
      }
    });
  });

  it("rejects when the Bun asset sync endpoint fails instead of returning fallback assets", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));

    await expect(syncTradeAssetsBunFirst(defaultTradeAssetState, fetchMock)).rejects.toThrow("Bun asset sync API HTTP 503");

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/trade/assets/sync");
  });

  it("submits paper trade plans through the Bun paper trade endpoint", async () => {
    const strategy = createDefaultStrategy();
    const plan = tradePlanFixture(strategy, "auto");
    const bunState = {
      plans: [
        {
          ...plan,
          status: "filled" as const,
          orders: plan.orders.map((order) => ({ ...order, status: "\u5df2\u6210\u4ea4" as const }))
        }
      ],
      fills: plan.orders.map((order) => ({
        id: `fill-${order.clientOrderId}`,
        planId: plan.id,
        strategyId: strategy.id,
        strategyName: strategy.name,
        clientOrderId: order.clientOrderId,
        code: order.code,
        name: order.name,
        side: order.side,
        shares: order.shares,
        price: order.price,
        amount: order.amount,
        filledAt: "2026-06-09T16:01:00Z"
      }))
    };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(bunState), { status: 200 }));

    const result = await submitPaperTradePlanBunFirst(defaultPaperTradeState, plan, fetchMock);

    expect(result).toEqual(bunState);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/trade/paper/submit");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      state: { plans: [], fills: [] },
      plan: { id: plan.id }
    });
  });

  it("rejects when the Bun paper trade endpoint fails instead of creating local fills", async () => {
    const plan = tradePlanFixture(createDefaultStrategy(), "auto");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));

    await expect(submitPaperTradePlanBunFirst(defaultPaperTradeState, plan, fetchMock)).rejects.toThrow("Bun paper trade API HTTP 503");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/trade/paper/submit");
  });

  it("records paper fills without browser-side trade CSV export", () => {
    const strategy = createDefaultStrategy();
    const plan = tradePlanFixture(strategy, "auto");
    const nextState = submitPaperTradePlan(defaultPaperTradeState, plan);

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
    const plan = tradePlanFixture(strategy, "auto");
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
