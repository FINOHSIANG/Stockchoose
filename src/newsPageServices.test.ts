import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("passes Tencent announcement sources to the Rust news collector", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/articles") {
        return new Response(JSON.stringify({
          articles: [
            {
              id: "news-tencent-notice-0-ann-600519",
              title: "贵州茅台发布年度权益分派公告",
              summary: "公司公告 贵州茅台",
              content: "贵州茅台发布年度权益分派公告",
              source: "腾讯证券公告",
              sourceIcon: "腾",
              category: "公司公告",
              sentiment: "中性",
              importance: "重要",
              status: "unread",
              publishedAt: "2026-05-27 18:42:12",
              fetchedAt: "2026-05-27T18:42:12.000Z",
              url: "https://data.eastmoney.com/notices/detail/600519/AN202605270001.html",
              imageUrl: "",
              author: "腾讯证券公告",
              readTime: 1,
              linkedCodes: ["600519"],
              linkedStocks: [{ code: "600519", name: "贵州茅台" }],
              industries: ["食品饮料"],
              tags: ["公司公告", "年度权益分派"],
              viewCount: 0,
              commentCount: 0
            }
          ],
          stats: { mode: "fast", scannedStocks: 1, requestCount: 1, returnedRows: 1, validArticles: 1 }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [] }), { status: 500 });
    });

    const result = await fetchNewsArticlesFromSources([tencentNoticeSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { sources: NewsSourceEndpoint[]; stocks: Array<{ code: string }> };

    expect(result.ok).toBe(true);
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      title: "贵州茅台发布年度权益分派公告",
      source: "腾讯证券公告",
      category: "公司公告",
      linkedCodes: ["600519"]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/articles");
    expect(requestBody.sources[0]).toMatchObject({
      provider: "腾讯证券公告",
      maxItems: 10
    });
    expect(requestBody.stocks.map((stock) => stock.code)).toEqual(["600519"]);
    expect(result.stats).toMatchObject({
      scannedStocks: 1,
      requestCount: 1,
      returnedRows: 1,
      validArticles: 1
    });
  });

  it("passes GDELT sources to the Rust news collector", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/articles") {
        return new Response(JSON.stringify({
          articles: [
            {
              id: "news-gdelt-global-0-https://example.com/news/maotai",
              title: "贵州茅台股价上涨，食品饮料板块走强",
              summary: "贵州茅台股价上涨，食品饮料板块走强",
              content: "贵州茅台股价上涨，食品饮料板块走强",
              source: "example.com",
              sourceIcon: "E",
              category: "市场评论",
              sentiment: "利好",
              importance: "头条",
              status: "unread",
              publishedAt: "2026-05-27 18:42:12",
              fetchedAt: "2026-05-27 18:42:12",
              url: "https://example.com/news/maotai",
              imageUrl: "",
              author: "example.com",
              readTime: 1,
              linkedCodes: ["600519"],
              linkedStocks: [{ code: "600519", name: "贵州茅台" }],
              industries: ["食品饮料"],
              tags: ["市场评论", "利好", "食品饮料"],
              viewCount: 0,
              commentCount: 0
            }
          ],
          stats: { mode: "fast", scannedStocks: 1, requestCount: 1, returnedRows: 1, validArticles: 1 }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [] }), { status: 500 });
    });

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { sources: NewsSourceEndpoint[]; mode: string };

    expect(result.ok).toBe(true);
    expect(result.articles).toHaveLength(1);
    expect(result.stats).toMatchObject({
      mode: "fast",
      scannedStocks: 1,
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
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/articles");
    expect(requestBody.sources[0]).toMatchObject({
      provider: "GDELT 2.1",
      baseUrl: "/gdelt-news",
      query: "贵州茅台 OR A股"
    });
  });

  it("surfaces real-source fallback diagnostics from the Rust news collector", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/articles") {
        return new Response(JSON.stringify({
          articles: [
            {
              id: "news-gdelt-global-0-https://example.com/news/fallback",
              title: "A-share market update",
              summary: "A-share market update",
              content: "A-share market update",
              source: "Eastmoney",
              sourceIcon: "E",
              category: "market",
              sentiment: "positive",
              importance: "important",
              status: "unread",
              publishedAt: "2026-06-09T09:00:00Z",
              fetchedAt: "2026-06-09T09:00:00Z",
              url: "https://example.com/news/fallback",
              imageUrl: "",
              author: "Eastmoney",
              readTime: 1,
              linkedCodes: ["600519"],
              linkedStocks: [{ code: "600519", name: "Kweichow Moutai" }],
              industries: ["consumer"],
              tags: ["market", "positive"],
              viewCount: 0,
              commentCount: 0
            }
          ],
          stats: { mode: "fast", scannedStocks: 1, requestCount: 1, returnedRows: 1, validArticles: 1 },
          sourceDiagnostics: [
            {
              sourceId: "news-gdelt-global",
              sourceName: "GDELT global news",
              provider: "GDELT 2.1",
              fallbackSource: "eastmoney",
              fallbackReason: "GDELT request timed out"
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [] }), { status: 500 });
    });

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(true);
    expect(result.sourceDiagnostics).toEqual([
      expect.objectContaining({
        provider: "GDELT 2.1",
        fallbackSource: "eastmoney",
        fallbackReason: "GDELT request timed out"
      })
    ]);
    expect(result.details).toContain("Rust 已切换 东方财富 真实新闻源");
    expect(result.details).toContain("GDELT request timed out");
  });

  it("uses Rust structured news articles without browser-side parsing", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/news/articles") {
        return new Response(JSON.stringify({
          articles: [
            {
              id: "news-gdelt-global-0-https://example.com/news/maotai",
              title: "贵州茅台股价上涨，食品饮料板块走强",
              summary: "贵州茅台股价上涨，食品饮料板块走强",
              content: "贵州茅台股价上涨，食品饮料板块走强",
              source: "example.com",
              sourceIcon: "E",
              category: "市场评论",
              sentiment: "利好",
              importance: "头条",
              status: "unread",
              publishedAt: "2026-05-27 18:42:12",
              fetchedAt: "2026-05-27 18:42:12",
              url: "https://example.com/news/maotai",
              imageUrl: "",
              author: "example.com",
              readTime: 1,
              linkedCodes: ["600519"],
              linkedStocks: [{ code: "600519", name: "贵州茅台" }],
              industries: ["食品饮料"],
              tags: ["市场评论", "利好", "食品饮料"],
              viewCount: 0,
              commentCount: 0
            }
          ],
          stats: {
            mode: "fast",
            scannedStocks: 1,
            requestCount: 1,
            returnedRows: 1,
            validArticles: 1
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [] }), { status: 500 });
    });

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("Rust 新闻接口");
    expect(result.articles[0]).toMatchObject({
      source: "example.com",
      sentiment: "利好",
      linkedCodes: ["600519"]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/articles");
  });

  it("passes NewsAPI and custom remote source settings to the Rust news collector", async () => {
    const source: NewsSourceEndpoint = {
      id: "news-newsapi",
      name: "NewsAPI",
      provider: "NewsAPI",
      baseUrl: "https://newsapi.org",
      apiToken: "token-001",
      enabled: true,
      language: "zh-CN",
      refreshInterval: 15,
      maxItems: 20,
      query: "A股 上市公司"
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/articles") {
        return new Response(JSON.stringify({
          articles: [
            {
              id: "news-newsapi-0-https://example.com/news/stock",
              title: "A股上市公司订单增长",
              summary: "订单增长带动产业链景气",
              content: "A股上市公司订单增长",
              source: "NewsAPI",
              sourceIcon: "N",
              category: "产业链",
              sentiment: "利好",
              importance: "重要",
              status: "unread",
              publishedAt: "2026-06-09T09:00:00Z",
              fetchedAt: "2026-06-09T09:00:00Z",
              url: "https://example.com/news/stock",
              imageUrl: "",
              author: "NewsAPI",
              readTime: 1,
              linkedCodes: [],
              linkedStocks: [],
              industries: [],
              tags: ["产业链", "利好"],
              viewCount: 0,
              commentCount: 0
            }
          ],
          stats: { mode: "standard", scannedStocks: 1, requestCount: 1, returnedRows: 1, validArticles: 1 }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [] }), { status: 500 });
    });

    const result = await fetchNewsArticlesFromSources([source], STOCKS.slice(0, 1), fetchMock, { mode: "standard" });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { sources: NewsSourceEndpoint[]; mode: string };

    expect(result.ok).toBe(true);
    expect(result.articles[0].source).toBe("NewsAPI");
    expect(requestBody.mode).toBe("standard");
    expect(requestBody.sources[0]).toMatchObject({
      provider: "NewsAPI",
      baseUrl: "https://newsapi.org",
      apiToken: "token-001",
      maxItems: 20
    });
  });

  it("does not fall back to browser-side GDELT parsing when the Rust news API fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/articles") {
        return new Response(JSON.stringify({ message: "unavailable" }), { status: 502 });
      }
      return new Response(JSON.stringify({ articles: [{ title: "should not be used" }] }), { status: 200 });
    });

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.details).toContain("Rust 新闻接口请求失败");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/articles");
  });

  it("preserves the selected fetch mode for non-announcement news sources", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/articles") {
        return new Response(JSON.stringify({
          articles: [
            {
              id: "news-gdelt-global-0-https://example.com/news/standard",
              url: "https://example.com/news/standard",
              title: "A股市场成交活跃",
              summary: "A股市场成交活跃",
              content: "A股市场成交活跃",
              source: "example.com",
              sourceIcon: "E",
              category: "市场评论",
              sentiment: "中性",
              importance: "一般",
              status: "unread",
              publishedAt: "2026-05-27 18:42:12",
              fetchedAt: "2026-05-27 18:42:12",
              imageUrl: "",
              author: "example.com",
              readTime: 1,
              linkedCodes: [],
              linkedStocks: [],
              industries: [],
              tags: ["市场评论", "中性"],
              viewCount: 0,
              commentCount: 0
            }
          ],
          stats: { mode: "standard", scannedStocks: 3, requestCount: 1, returnedRows: 1, validArticles: 1 }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ articles: [] }), { status: 500 });
    });

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS, fetchMock, { mode: "standard" });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { mode: string };

    expect(result.ok).toBe(true);
    expect(requestBody.mode).toBe("standard");
    expect(result.stats).toMatchObject({
      mode: "standard",
      requestCount: 1,
      returnedRows: 1,
      validArticles: 1
    });
  });

  it("returns a hard failure when real news sources return no usable rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ articles: [], stats: { mode: "fast", scannedStocks: 1, requestCount: 1, returnedRows: 0, validArticles: 0 } }), { status: 200 })
    );

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.message).toBe("新闻刷新失败");
    expect(result.stats).toMatchObject({
      scannedStocks: 1,
      requestCount: 1,
      returnedRows: 0,
      validArticles: 0
    });
  });

  it("reports invalid Rust news article payloads explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        articles: { unexpected: true },
        stats: { mode: "fast", scannedStocks: 1, requestCount: 1, returnedRows: 1, validArticles: 0 }
      }), { status: 200 })
    );

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.details).toContain("invalid payload");
  });

  it("reports invalid Rust news source diagnostics explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        articles: [],
        stats: { mode: "fast", scannedStocks: 1, requestCount: 1, returnedRows: 0, validArticles: 0 },
        sourceDiagnostics: { unexpected: true }
      }), { status: 200 })
    );

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.details).toContain("sourceDiagnostics must be an array");
  });

  it("reports invalid Rust news JSON explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));

    const result = await fetchNewsArticlesFromSources([gdeltSource], STOCKS.filter((stock) => stock.code === "600519"), fetchMock);

    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
    expect(result.details).toContain("invalid JSON");
  });
});
