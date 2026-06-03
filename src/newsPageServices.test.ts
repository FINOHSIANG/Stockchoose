import { describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { fetchNewsArticlesFromSources } from "./newsPageServices";
import type { NewsSourceEndpoint } from "./newsSourceServices";

const tencentNoticeSource: NewsSourceEndpoint = {
  id: "news-tencent-notice",
  name: "腾讯证券公告",
  provider: "腾讯证券公告",
  baseUrl: "/tencent-news/ifzqgtimg/appstock/news/noticeList/searchByType",
  apiToken: "",
  enabled: true,
  language: "zh-CN",
  refreshInterval: 15,
  maxItems: 10,
  query: "A股 公告 新闻"
};

const gdeltSource: NewsSourceEndpoint = {
  id: "news-gdelt-global",
  name: "GDELT 全球新闻",
  provider: "GDELT 2.1",
  baseUrl: "/gdelt-news",
  apiToken: "",
  enabled: true,
  language: "zh-CN",
  refreshInterval: 15,
  maxItems: 10,
  query: "贵州茅台 OR A股"
};

describe("newsPageServices", () => {
  it("fails instead of falling back to local samples when no real source is enabled", async () => {
    const result = await fetchNewsArticlesFromSources(
      [{ ...tencentNoticeSource, provider: "本地舆情样本", enabled: true, baseUrl: "local://sentiment-sample" }],
      STOCKS,
      vi.fn<typeof fetch>()
    );

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.details).toContain("未启用可用真实新闻源");
    expect(result.stats.scannedStocks).toBe(0);
    expect(result.stats.requestCount).toBe(0);
  });

  it("does not request Tencent notice sources", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, data: { data: [] } }), { status: 200 }));

    const result = await fetchNewsArticlesFromSources([tencentNoticeSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.details).toContain("公告源已停用");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.stats).toMatchObject({
      scannedStocks: 0,
      requestCount: 0,
      returnedRows: 0,
      validArticles: 0
    });
  });

  it("maps GDELT free news into app news articles", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          articles: [
            {
              url: "https://example.com/news/maotai",
              title: "贵州茅台股价上涨，食品饮料板块走强",
              seendate: "2026-05-27 18:42:12",
              domain: "example.com"
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(true);
    expect(result.articles).toHaveLength(1);
    expect(result.stats).toMatchObject({
      mode: "fast",
      scannedStocks: 0,
      requestCount: 1,
      returnedRows: 1,
      validArticles: 1
    });
    expect(result.articles[0]).toMatchObject({
      title: "贵州茅台股价上涨，食品饮料板块走强",
      source: "example.com",
      sentiment: "利好",
      linkedCodes: ["600519"]
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/doc/doc?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("mode=ArtList");
  });

  it("preserves the selected fetch mode for non-announcement news sources", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          articles: [
            {
              url: "https://example.com/news/standard",
              title: "A股市场成交活跃",
              seendate: "2026-05-27 18:42:12",
              domain: "example.com"
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS, fetchMock, { mode: "standard" });

    expect(result.ok).toBe(true);
    expect(result.stats).toMatchObject({
      mode: "standard",
      requestCount: 1,
      returnedRows: 1,
      validArticles: 1
    });
  });

  it("returns a hard failure when real news sources return no usable rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ articles: [] }), { status: 200 }));

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.message).toBe("新闻刷新失败");
    expect(result.stats).toMatchObject({
      scannedStocks: 0,
      requestCount: 1,
      returnedRows: 0,
      validArticles: 0
    });
  });
});
