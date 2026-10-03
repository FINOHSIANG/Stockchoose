import { describe, expect, it } from "vitest";
import type { Stock } from "./types";
import {
  ALL_INDUSTRIES,
  PRIMARY_INDUSTRIES,
  compactIndustryTexts,
  industryMatchKey,
  inferPrimaryIndustry,
  inferSecondaryIndustry,
  isAllIndustry,
  isUsefulIndustryText,
  normalizedIndustryText,
  stockMatchesIndustry
} from "./industryClassification";

function stock(partial: Partial<Stock>): Stock {
  return {
    code: "600519",
    name: "test",
    exchange: "沪市",
    board: "主板",
    industry1: "",
    industry2: "",
    region: "test",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: false,
    indexes: [],
    metrics: {},
    ...partial
  };
}

describe("industryClassification canonicalization", () => {
  it("exposes the complete primary industry list for selectors", () => {
    expect(PRIMARY_INDUSTRIES).toHaveLength(31);
    expect(PRIMARY_INDUSTRIES).toContain("农林牧渔");
    expect(PRIMARY_INDUSTRIES).toContain("美容护理");
  });

  it("normalizes unusable industry placeholders to empty", () => {
    expect(normalizedIndustryText("未分类")).toBe("");
    expect(normalizedIndustryText("腾讯行情")).toBe("");
    expect(normalizedIndustryText("暂无")).toBe("");
    expect(normalizedIndustryText("  食品饮料  ")).toBe("食品饮料");
  });

  it("recognizes alias industry names to the canonical 申万 primary", () => {
    expect(industryMatchKey("化工")).toBe(industryMatchKey("基础化工"));
    expect(industryMatchKey("电气设备")).toBe(industryMatchKey("电力设备"));
    expect(industryMatchKey("非银金融")).toBe(industryMatchKey("非银金融"));
    expect(industryMatchKey("军工")).toBe(industryMatchKey("国防军工"));
  });

  it("keeps alias and canonical deduplicated in compactIndustryTexts", () => {
    const compact = compactIndustryTexts(["基础化工", "化工", "电力设备", "电气设备"]);
    expect(compact).toEqual(["基础化工", "电力设备"]);
  });

  it("treats all-industry selectors as all", () => {
    expect(isAllIndustry(ALL_INDUSTRIES)).toBe(true);
    expect(isAllIndustry("全部")).toBe(true);
    expect(isAllIndustry("all")).toBe(true);
    expect(isAllIndustry("食品饮料")).toBe(false);
  });
});

describe("industryClassification primary/secondary inference", () => {
  it("infers primary industry from a secondary industry when primary is missing", () => {
    const s = stock({ industry1: "未分类", industry2: "白酒" });
    expect(inferPrimaryIndustry(s)).toBe("食品饮料");
  });

  it("infers primary industry from tags when both industry fields are unusable", () => {
    const s = stock({ industry1: "未分类", industryTags: ["半导体"] });
    expect(inferPrimaryIndustry(s)).toBe("电子");
  });

  it("infers secondary industry while avoiding collision with the inferred primary", () => {
    const s = stock({ industry1: "食品饮料", industry2: "食品饮料", industryTags: ["白酒"] });
    expect(inferSecondaryIndustry(s)).toBe("白酒");
  });

  it("keeps a free-form industry text that is not in the dictionary", () => {
    const s = stock({ industry1: "定制测试行业" });
    expect(inferPrimaryIndustry(s)).toBe("定制测试行业");
    expect(isUsefulIndustryText("定制测试行业")).toBe(true);
  });
});

describe("industryClassification selection matching", () => {
  it("matches a primary selector against a stock whose only industry is a secondary tag", () => {
    const s = stock({ industry1: "未分类", industry2: "未分类", industryTags: ["白酒"] });
    expect(stockMatchesIndustry(s, "industry1", "食品饮料")).toBe(true);
    expect(stockMatchesIndustry(s, "industry1", "银行")).toBe(false);
  });

  it("matches a secondary selector against a stock with that secondary industry tag", () => {
    const s = stock({ industry1: "电子", industry2: "半导体" });
    expect(stockMatchesIndustry(s, "industry2", "半导体")).toBe(true);
    expect(stockMatchesIndustry(s, "industry2", "消费电子")).toBe(false);
  });

  it("still matches when the selector uses an industry alias", () => {
    const s = stock({ industry1: "电力设备", industry2: "光伏设备" });
    expect(stockMatchesIndustry(s, "industry1", "电气设备")).toBe(true);
    expect(stockMatchesIndustry(s, "industry1", "新能源设备")).toBe(true);
  });

  it("treats all-industry selector as a match regardless of stock industry", () => {
    const s = stock({ industry1: "银行" });
    expect(stockMatchesIndustry(s, "industry1", ALL_INDUSTRIES)).toBe(true);
    expect(stockMatchesIndustry(s, "industry1", undefined)).toBe(true);
  });
});
