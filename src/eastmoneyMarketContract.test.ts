import { describe, expect, it } from "vitest";
import {
  ashareUniverseCodesFromRows,
  assertEastmoneySpotCompleteness,
  createEastmoneySpotPageUrl,
  dedupeEastmoneySpotRows,
  isSelectableEastmoneySpotRow,
  mapTencentQuoteToMarketRow,
  tencentSymbolsFromQuery,
  planEastmoneySpotPages
} from "../bun-api/services/market";
import { buildMarketOverview } from "../bun-api/services/marketOverview";

function rowsForCodes(codes: string[]) {
  return codes.map((code) => ({ f12: code, f14: `股票${code}` }));
}

describe("Eastmoney full-market contract", () => {
  it("uses code-ascending stable pagination at the upstream effective page size", () => {
    const firstPage = createEastmoneySpotPageUrl(1);
    const laterPage = createEastmoneySpotPageUrl(18);

    expect(firstPage.searchParams.get("fid")).toBe("f12");
    expect(firstPage.searchParams.get("po")).toBe("0");
    expect(firstPage.searchParams.get("pz")).toBe("100");
    expect(firstPage.searchParams.get("pn")).toBe("1");
    expect(laterPage.searchParams.get("pn")).toBe("18");
    expect(laterPage.searchParams.get("fid")).toBe(firstPage.searchParams.get("fid"));
    expect(laterPage.searchParams.get("po")).toBe(firstPage.searchParams.get("po"));
    expect(() => createEastmoneySpotPageUrl(0)).toThrow("positive integer");
  });

  it("plans every page from the upstream's actual first-page row count", () => {
    expect(planEastmoneySpotPages(5_050, 100)).toBe(51);
    expect(() => planEastmoneySpotPages(5_050, 0)).toThrow("cannot plan pagination");
  });

  it("deduplicates by stock code and rejects incomplete full-market snapshots", () => {
    const coveredRows = dedupeEastmoneySpotRows(rowsForCodes([
      ...Array.from({ length: 98 }, (_, index) => String(index + 1).padStart(6, "0")),
      "000001",
      "000002"
    ]));
    expect(coveredRows).toHaveLength(98);
    expect(() => assertEastmoneySpotCompleteness(coveredRows, 100)).not.toThrow();

    const incompleteRows = dedupeEastmoneySpotRows(rowsForCodes(
      Array.from({ length: 97 }, (_, index) => String(index + 1).padStart(6, "0"))
    ));
    expect(() => assertEastmoneySpotCompleteness(incompleteRows, 100)).toThrow(/97\.00%.*98\.00%/);
  });

  it("filters zero-price and zero-market-cap historical securities from the selectable universe", () => {
    expect(isSelectableEastmoneySpotRow({
      code: "000001",
      price: 10.92,
      marketCap: 2119.13,
      floatMarketCap: 2119.09
    })).toBe(true);
    expect(isSelectableEastmoneySpotRow({
      code: "000003",
      price: 0,
      marketCap: 0,
      floatMarketCap: 0
    })).toBe(false);
    expect(isSelectableEastmoneySpotRow({
      code: "000024",
      price: 0,
      marketCap: 100,
      floatMarketCap: 80
    })).toBe(false);
  });

  it("builds a deduplicated A-share fallback universe and excludes non-A-share rows", () => {
    expect(ashareUniverseCodesFromRows([
      { SECURITY_CODE: "600519", SECURITY_TYPE_CODE: "058001001" },
      { SECUCODE: "000001.SZ", SECURITY_TYPE_CODE: "058001001" },
      { SECURITY_CODE: "600519", SECURITY_TYPE_CODE: "058001001" },
      { SECUCODE: "430001.NQ", SECURITY_TYPE_CODE: "058001008" },
      { SECURITY_CODE: "000000", SECURITY_TYPE_CODE: "058001001" },
      { SECURITY_CODE: "600000", SECURITY_TYPE_CODE: "unsupported" }
    ])).toEqual(["000001", "600519"]);
  });

  it("maps Tencent quotes into the existing market row contract and preserves BSE prefixes", () => {
    expect(tencentSymbolsFromQuery("920001,430001,600519")).toEqual(["bj920001", "bj430001", "sh600519"]);
    const row = mapTencentQuoteToMarketRow({
      symbol: "sh600519",
      prefix: "sh",
      code: "600519",
      queryCode: "sh600519",
      name: "贵州茅台",
      price: 1237,
      pctChange: -1.14,
      volumeWanShou: 3.12,
      amountYi: 38.67,
      turnover: 0.25,
      pe: 18.99,
      pb: 6.15,
      marketCapYi: 15463.51,
      floatMarketCapYi: 15463.51
    });
    expect(row).toMatchObject({ code: "600519", price: 1237, amount: 38.67, marketCap: 15463.51 });
    expect(isSelectableEastmoneySpotRow(row)).toBe(true);
  });

  it("returns a finite 0..100 score and keeps temperature as its compatibility alias", () => {
    const overview = buildMarketOverview([
      { pctChange: Infinity, amount: Infinity },
      { pctChange: "not-a-number", amount: "not-a-number" },
      { pctChange: 12.5, amount: 100 }
    ], "2026-07-15T00:00:00.000Z");

    expect(Number.isFinite(overview.score)).toBe(true);
    expect(overview.score).toBeGreaterThanOrEqual(0);
    expect(overview.score).toBeLessThanOrEqual(100);
    expect(overview.temperature).toBe(overview.score);
  });
});
