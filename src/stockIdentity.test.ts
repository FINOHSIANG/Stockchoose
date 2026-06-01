import { describe, expect, it } from "vitest";
import { STOCKS } from "./data";
import {
  displayStockCode,
  normalizeStockCodeInput,
  resolveStockByCode,
  stockCodeCandidates,
  stockCodeForStorage,
  stockMatchesCodeQuery
} from "./stockIdentity";

const stockByCode = (code: string) => {
  const stock = STOCKS.find((item) => item.code === code);
  if (!stock) throw new Error(`missing fixture stock ${code}`);
  return stock;
};

describe("stockIdentity", () => {
  it("formats market-prefixed stock codes without dropping board letters", () => {
    expect(displayStockCode(stockByCode("600519"))).toBe("SH600519");
    expect(displayStockCode(stockByCode("000858"))).toBe("SZ000858");
    expect(displayStockCode(stockByCode("430047"))).toBe("BJ920047");
  });

  it("matches Beijing Stock Exchange switched market codes exactly", () => {
    const nosland = stockByCode("430047");

    expect(stockMatchesCodeQuery(nosland, "BJ920047")).toBe(true);
    expect(stockMatchesCodeQuery(nosland, "BJ430047")).toBe(true);
    expect(resolveStockByCode(STOCKS, "BJ920047")?.code).toBe("430047");
    expect(stockCodeCandidates(nosland)).toEqual(expect.arrayContaining(["430047", "BJ430047", "920047", "BJ920047"]));
  });

  it("treats full code queries as strict identity matches instead of fuzzy matches", () => {
    const midea = stockByCode("000333");

    expect(normalizeStockCodeInput("SZ000033")).toMatchObject({ isCodeLike: true, normalized: "SZ000033" });
    expect(stockMatchesCodeQuery(midea, "SZ000033")).toBe(false);
    expect(resolveStockByCode(STOCKS, "SZ000033")).toBeUndefined();
  });

  it("stores prefixed pool inputs as internal codes only when the stock exists", () => {
    expect(stockCodeForStorage("SH600519", STOCKS)).toBe("600519");
    expect(stockCodeForStorage("SZ000003", STOCKS)).toBe("000003");
  });
});
