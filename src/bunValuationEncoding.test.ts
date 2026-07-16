import { describe, expect, it } from "vitest";
import { buildBunValuationRows, formatAnnualReportExport } from "../bun-api/services/finance";
import type { Stock } from "./types";

const baseStock: Stock = {
  code: "600000",
  name: "编码测试",
  exchange: "沪市",
  board: "主板",
  industry1: "",
  industry2: "",
  region: "上海",
  property: "国企",
  isST: false,
  isSuspended: false,
  isSTAR: false,
  isMargin: true,
  indexes: [],
  metrics: {
    price: 10,
    marketCap: 1000,
    eps: 30,
    bps: 100,
    revenue: 6000,
    netProfit: 500,
    operatingCashflow: 2000,
    roe: 20,
    netMargin: 15,
    netProfitGrowth: 25,
    debtRatio: 45
  }
};

describe("Bun valuation UTF-8 contract", () => {
  it("formats annual reports and valuation strings as readable Simplified Chinese", () => {
    const annualReport = formatAnnualReportExport({
      code: baseStock.code,
      name: baseStock.name,
      reportDate: "2025-12-31",
      metrics: { revenue: 6000, netProfit: 500, roe: 20 }
    }, baseStock.name);
    const rows = buildBunValuationRows([
      { ...baseStock, metrics: { ...baseStock.metrics, price: 10, marketCap: 1000, netProfitGrowth: 25, debtRatio: 45 } },
      { ...baseStock, code: "600001", metrics: { ...baseStock.metrics, price: 34, marketCap: 3400, netProfitGrowth: 10, debtRatio: 45 } },
      { ...baseStock, code: "600002", metrics: { ...baseStock.metrics, price: 42, marketCap: 4200, netProfitGrowth: 0, debtRatio: 45 } },
      { ...baseStock, code: "600003", metrics: { ...baseStock.metrics, price: 50, marketCap: 5000, netProfitGrowth: -31, debtRatio: 45 } },
      { ...baseStock, code: "600004", metrics: { ...baseStock.metrics, price: 60, marketCap: 6000, netProfitGrowth: 0, debtRatio: 45 } }
    ]);
    const [deepUndervalued, lowUndervalued, reasonable, expensive, highlyOvervalued] = rows;

    expect(annualReport).toMatchObject({
      sourceNote: "由 Bun 财报接口生成。",
      sourceCsv: "股票代码,股票名称,报告期,营业收入,净利润,ROE\r\n600000,编码测试,2025-12-31,6000,500,20"
    });
    expect(deepUndervalued).toMatchObject({
      profile: { industry: "通用行业", model: "PE盈利" },
      model: "PE盈利",
      state: "高速成长",
      verdict: "深度低估",
      action: "进入候选池，等待价格回撤或业绩确认",
      drivers: [
        "Bun 估值接口仅使用传入股票的真实行情和财务字段计算",
        "估值锚点取盈利、资产、收入、现金流模型中较低值组合"
      ]
    });
    expect(deepUndervalued.components.cashflowPolicy.note).toBe("Bun 通用现金流门槛");
    expect(deepUndervalued.components.formulaRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "盈利模型", formula: "max(EPS,0) * 目标PE" }),
      expect.objectContaining({ name: "资产模型", formula: "BPS * 目标PB * 0.65" }),
      expect.objectContaining({ name: "收入模型", formula: "每股收入 * 目标PS * 0.55" }),
      expect.objectContaining({ name: "现金流模型", formula: "每股经营现金流 * 现金流倍数 * 0.65" })
    ]));
    expect(lowUndervalued).toMatchObject({ state: "稳定成熟", verdict: "低估" });
    expect(reasonable).toMatchObject({ state: "周期修复", verdict: "合理" });
    expect(expensive).toMatchObject({
      state: "困境承压",
      verdict: "偏高",
      action: "未满足严苛口径，暂不配置",
      warnings: ["当前价格高于 Bun 核算价值"],
      statusModifier: 0.55
    });
    expect(highlyOvervalued).toMatchObject({ state: "周期修复", verdict: "高估" });

    const serialized = JSON.stringify({ annualReport, rows });
    for (const marker of ["鑲", "鍥", "妯", "鐩", "閫", "鐜", "锟", "�", "ï", "æ", "ç", "è", "é", "å", "ä"]) {
      expect(serialized).not.toContain(marker);
    }
  });
});
