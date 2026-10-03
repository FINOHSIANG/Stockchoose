import { beforeEach, describe, expect, it } from "vitest";
import {
  claimWorkspaceActions,
  completeWorkspaceAction,
  enqueueWorkspaceAction,
  normalizeWorkspaceActionInput,
  resetWorkspaceActionsForTests,
  setWorkspaceActionOwner,
  waitForWorkspaceAction
} from "./workspaceActions";

describe("Agent workspace actions", () => {
  beforeEach(() => resetWorkspaceActionsForTests());

  it("normalizes bounded strategy, pool, factor and section actions", () => {
    expect(normalizeWorkspaceActionInput({ type: "create-strategy", payload: { name: "Quality", addToHoldings: true } })).toEqual({
      type: "create-strategy",
      payload: { name: "Quality", description: "", poolId: "all", addToHoldings: true }
    });
    expect(normalizeWorkspaceActionInput({ type: "create-stock-pool", payload: { name: "Core", codes: ["600519", "bad", "sz000001"] } })).toEqual({
      type: "create-stock-pool",
      payload: { name: "Core", codes: ["600519", "sz000001"], select: true }
    });
    expect(normalizeWorkspaceActionInput({ type: "create-custom-factor", payload: { name: "Growth", formula: "revenueGrowth * 0.6 + roe * 0.4" } })).toMatchObject({
      type: "create-custom-factor"
    });
    expect(normalizeWorkspaceActionInput({ type: "open-section", payload: { section: "valuation" } })).toEqual({
      type: "open-section",
      payload: { section: "valuation" }
    });
  });

  it("rejects unsupported formulas and sections", () => {
    expect(() => normalizeWorkspaceActionInput({ type: "create-custom-factor", payload: { name: "Bad", formula: "globalThis.process" } })).toThrow(/unsupported characters/i);
    expect(() => normalizeWorkspaceActionInput({ type: "open-section", payload: { section: "admin" } })).toThrow(/section is invalid/i);
  });

  it("claims an action and resolves the waiting tool after the UI completes it", async () => {
    const action = enqueueWorkspaceAction(normalizeWorkspaceActionInput({ type: "create-strategy", payload: { name: "Agent Strategy" } }));
    const waiting = waitForWorkspaceAction(action.id, 2_000);
    expect(claimWorkspaceActions()).toEqual([expect.objectContaining({ id: action.id, status: "claimed" })]);
    completeWorkspaceAction(action.id, { ok: true, message: "created", result: { strategyId: "strategy-1" } });
    await expect(waiting).resolves.toMatchObject({
      id: action.id,
      status: "completed",
      result: { strategyId: "strategy-1" }
    });
  });

  it("allows only the registered workspace client to claim actions", () => {
    const action = enqueueWorkspaceAction(normalizeWorkspaceActionInput({ type: "open-section", payload: { section: "valuation" } }));
    setWorkspaceActionOwner("client-active-123", true);
    expect(claimWorkspaceActions(5, "client-background-456")).toEqual([]);
    expect(claimWorkspaceActions(5, "client-active-123")).toEqual([
      expect.objectContaining({ id: action.id, status: "claimed" })
    ]);
  });
});
