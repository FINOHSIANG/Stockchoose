import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("bun rewrite invariants", () => {
  it("does not use browser-side strategy fallbacks in App user paths", () => {
    expect(appSource).not.toContain("runLocalStrategyTask");
    expect(appSource).not.toMatch(/\b(screenStocks|rankingAnalysis|runBacktest|optimizeStrategy)\(/);
    expect(appSource).not.toContain("\u5df2\u81ea\u52a8\u6539\u7528\u672c\u5730\u7b56\u7565\u5f15\u64ce");
    expect(appSource).not.toContain("\u5df2\u4f7f\u7528\u672c\u5730\u4f18\u5316\u5f15\u64ce");
  });

  it("does not use browser-side paper trade fills in App user paths", () => {
    expect(appSource).not.toContain("submitPaperTradePlanToState");
    expect(appSource).not.toMatch(/submitPaperTradePlan\s+as\s+submitPaperTradePlanToState/);
    expect(appSource).toContain("submitPaperTradePlanBunFirst");
  });

  it("does not show stale local engine labels for Bun-backed workflows", () => {
    expect(appSource).not.toContain("\u672c\u5730\u8c03\u4f18\u5148\u641c\u7d22\u6301\u4ed3\u6570");
    expect(appSource).not.toContain("\u672c\u5730\u5bf9\u51b2\u5f15\u64ce");
    expect(appSource).not.toContain("\u505c\u7528\u540e\u4ec5\u4f7f\u7528\u672c\u5730\u89c4\u5219");
  });
});
