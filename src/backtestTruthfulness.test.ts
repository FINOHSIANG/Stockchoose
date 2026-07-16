import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RULE_SIMULATION_DISCLAIMER = "基于当前股票快照、因子分数和确定性规则生成，不读取逐日历史成交价格，不代表真实历史收益。";

describe("backtest truthfulness copy", () => {
  it("marks the strategy interface as rule simulation", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(appSource).toContain('label: "规则模拟"');
    expect(appSource).toContain("累计模拟收益");
    expect(appSource).toContain(`? "${RULE_SIMULATION_DISCLAIMER}"`);
    expect(appSource).toContain('<p className="button-hint">{result.methodology.disclaimer}</p>');
    expect(appSource).toContain("实时规则模拟");
    expect(appSource).toContain("当前规则模拟仍按");
    expect(appSource).toContain("模拟曲线相关度");
    expect(appSource).toContain('title="模拟相关度估计"');
    expect(appSource).toContain('label="模拟基准："');
    expect(appSource).toContain('aria-label="规则模拟净值曲线"');
    expect(appSource).not.toContain("计算以上策略模型在历史上的收益。");
    expect(appSource).not.toContain("实时回测");
    expect(appSource).not.toContain("当前回测仍按");
    expect(appSource).not.toContain("收益曲线相关度");
    expect(appSource).not.toContain('aria-label="净值曲线"');
  });
});
