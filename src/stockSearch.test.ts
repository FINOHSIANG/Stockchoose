import { describe, expect, it } from "vitest";
import { findStockSuggestions } from "./stockSearch";
import type { Stock } from "./types";

function stock(code: string, name: string, price = 10, marketCap = 100): Stock {
  return {
    code,
    name,
    exchange: code.startsWith("6") ? "沪市" : "深市",
    board: "主板",
    industry1: "制造业",
    industry2: "设备制造",
    region: "上海",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: false,
    indexes: [],
    metrics: { price, marketCap }
  };
}

describe("findStockSuggestions", () => {
  const stocks = [
    stock("600519", "贵州茅台"),
    stock("000001", "平安银行"),
    stock("601318", "中国平安"),
    stock("000003", "PT金田A", 0, 0)
  ];

  it("matches names, raw codes and exchange-prefixed display codes", () => {
    expect(findStockSuggestions(stocks, "茅台").items.map((item) => item.code)).toEqual(["600519"]);
    expect(findStockSuggestions(stocks, "000001").items.map((item) => item.code)).toEqual(["000001"]);
    expect(findStockSuggestions(stocks, "SH600519").items.map((item) => item.code)).toEqual(["600519"]);
  });

  it("prioritizes exact and prefix matches and excludes invalid historical securities", () => {
    expect(findStockSuggestions(stocks, "平安").items.map((item) => item.code)).toEqual(["000001", "601318"]);
    expect(findStockSuggestions(stocks, "000003").items).toEqual([]);
    expect(findStockSuggestions([{ ...stock("600000", "浦发银行"), metrics: { price: 10 } }], "浦发").items).toHaveLength(1);
  });

  it("returns the full match count while limiting rendered suggestions", () => {
    const result = findStockSuggestions([stock("600001", "测试一"), stock("600002", "测试二")], "600", 1);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
  });
});
