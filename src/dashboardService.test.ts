import { describe, expect, it } from "vitest";
import { computeStrategyDailyChange } from "./dashboardService";
import type { SelectionRow } from "./types";

function selectionRow(code: string, weight: number, pctChange?: number): SelectionRow {
  return {
    stock: {
      code,
      name: code,
      exchange: "沪市",
      board: "主板",
      industry1: "测试行业",
      industry2: "测试子行业",
      region: "测试地区",
      property: "民企",
      isST: false,
      isSuspended: false,
      isSTAR: false,
      isMargin: false,
      metrics: pctChange === undefined ? {} : { pctChange },
      indexes: [],
    },
    score: 0,
    weight,
    passedFilters: 0,
  };
}

describe("dashboard strategy daily change", () => {
  it("computes a 60/40 weighted daily change", () => {
    const summary = computeStrategyDailyChange([
      selectionRow("600519", 60, 2),
      selectionRow("000858", 40, -1),
    ]);

    expect(summary.changePercent).toBeCloseTo(0.8, 8);
    expect(summary.targetWeight).toBe(100);
    expect(summary.coveragePercent).toBe(100);
  });

  it("keeps cash exposure in the result when target weight is below 100 percent", () => {
    const summary = computeStrategyDailyChange([
      selectionRow("600519", 48, 2),
      selectionRow("000858", 32, -1),
    ]);

    expect(summary.changePercent).toBeCloseTo(0.64, 8);
    expect(summary.targetWeight).toBe(80);
  });

  it("returns a negative value with its original sign", () => {
    const summary = computeStrategyDailyChange([
      selectionRow("600519", 20, 1),
      selectionRow("000858", 80, -2),
    ]);

    expect(summary.changePercent).toBeCloseTo(-1.4, 8);
  });

  it("does not treat missing weighted market data as zero", () => {
    const summary = computeStrategyDailyChange([
      selectionRow("600519", 60, 2),
      selectionRow("000858", 40),
      selectionRow("300750", 0, 3),
    ]);

    expect(summary.changePercent).toBeNull();
    expect(summary.holdingCount).toBe(2);
    expect(summary.validCount).toBe(1);
    expect(summary.coveragePercent).toBe(60);
  });

  it("returns an unavailable summary when no target holdings exist", () => {
    expect(computeStrategyDailyChange([])).toEqual({
      changePercent: null,
      holdingCount: 0,
      validCount: 0,
      targetWeight: 0,
      validWeight: 0,
      coveragePercent: 0,
    });
  });
});
