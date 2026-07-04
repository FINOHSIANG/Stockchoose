import { afterEach, describe, expect, it, vi } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import { defaultNewsAnalysisModelSettings } from "./newsAnalysisModelServices";
import type { NewsArticle } from "./newsPageServices";
import {
  buildSentimentAnalysisBunFirst,
  buildSentimentEventsFromNewsArticles,
  buildSentimentEventsBunFirst,
  buildSentimentInsightReport,
  buildSentimentLinkedStocks,
  filterSentimentEvents,
  scoreSentimentEvent,
  type SentimentEvent
} from "./sentimentServices";

afterEach(() => {
  vi.unstubAllGlobals();
});

const testSentimentEvents: SentimentEvent[] = [
  {
    id: "real-policy-auto",
    title: "新能源汽车真实政策新闻推动充电设施建设",
    summary: "真实新闻源返回政策信息，汽车和电力设备产业链受益。",
    category: "政策监管",
    direction: "利好",
    horizon: "中期",
    severity: "特别重大",
    occurredAt: "2026-05-28 09:20",
    source: "GDELT 全球新闻",
    sourceWeight: 82,
    impact: 86,
    relevance: 84,
    confidence: 76,
    novelty: 64,
    persistence: 82,
    riskPenalty: 10,
    industries: ["汽车", "电力设备"],
    keywords: ["新能源汽车", "充电设施"],
    linkedCodes: ["002594", "300750"]
  },
  {
    id: "real-grid-order",
    title: "电网投资真实新闻显示储能订单增加",
    summary: "真实新闻源返回订单信息，电力设备行业受益。",
    category: "订单合同",
    direction: "利好",
    horizon: "长期",
    severity: "特别重大",
    occurredAt: "2026-05-28 13:30",
    source: "GDELT 全球新闻",
    sourceWeight: 80,
    impact: 78,
    relevance: 82,
    confidence: 74,
    novelty: 62,
    persistence: 85,
    riskPenalty: 10,
    industries: ["电力设备"],
    keywords: ["电网投资", "储能"],
    linkedCodes: ["601012", "600438"]
  }
];

function makeNewsArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: "bun-contract-news-001",
    title: "贵州茅台完成回购，食品饮料板块走强",
    summary: "贵州茅台公告完成回购，市场情绪改善。",
    content: "公司公告显示回购实施完毕。",
    source: "腾讯证券公告",
    sourceIcon: "T",
    category: "公司公告",
    sentiment: "利好",
    importance: "重要",
    status: "unread",
    publishedAt: "2026-05-27 18:42:12",
    fetchedAt: "2026-05-27T18:45:00.000Z",
    url: "https://proxy.finance.qq.com/notice/test",
    imageUrl: "",
    author: "腾讯证券公告",
    readTime: 1,
    linkedCodes: ["600519"],
    linkedStocks: [{ code: "600519", name: "贵州茅台" }],
    industries: ["食品饮料", "白酒"],
    tags: ["公司公告", "回购", "腾讯"],
    viewCount: 0,
    commentCount: 0,
    ...overrides
  };
}

function makeBunSentimentEvent(article = makeNewsArticle()): SentimentEvent {
  return {
    id: `real-news-${article.id}`,
    title: article.title,
    summary: article.summary,
    category: "资金市场",
    direction: "利好",
    horizon: "短期",
    severity: "重大",
    occurredAt: article.publishedAt,
    source: article.source,
    sourceWeight: 88,
    impact: 86,
    relevance: 88,
    confidence: 88,
    novelty: 58,
    persistence: 58,
    riskPenalty: 4,
    industries: ["食品饮料", "白酒"],
    keywords: ["公司公告", "利好", "回购", "腾讯", "贵州茅台"],
    linkedCodes: ["600519"]
  };
}

describe("sentimentServices", () => {
  it("does not synthesize sentiment events in the browser", () => {
    const article = makeNewsArticle({ id: "browser-local-disabled" });

    expect(buildSentimentEventsFromNewsArticles([article], STOCKS)).toEqual([]);
  });

  it("uses Bun sentiment event generation on the local app proxy", async () => {
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const article: NewsArticle = {
      id: "bun-news-001",
      title: "贵州茅台完成回购，食品饮料板块走强",
      summary: "贵州茅台公告完成回购，市场情绪改善。",
      content: "公司公告显示回购实施完毕。",
      source: "腾讯证券公告",
      sourceIcon: "T",
      category: "公司公告",
      sentiment: "利好",
      importance: "重要",
      status: "unread",
      publishedAt: "2026-05-27 18:42:12",
      fetchedAt: "2026-05-27T18:45:00.000Z",
      url: "https://proxy.finance.qq.com/notice/test",
      imageUrl: "",
      author: "腾讯证券公告",
      readTime: 1,
      linkedCodes: ["600519"],
      linkedStocks: [{ code: "600519", name: "贵州茅台" }],
      industries: ["食品饮料", "白酒"],
      tags: ["公司公告", "回购", "腾讯"],
      viewCount: 0,
      commentCount: 0
    };
    const bunEvent: SentimentEvent = {
      id: "real-news-bun-news-001",
      title: article.title,
      summary: article.summary,
      category: "资金市场",
      direction: "利好",
      horizon: "短期",
      severity: "重大",
      occurredAt: article.publishedAt,
      source: article.source,
      sourceWeight: 88,
      impact: 86,
      relevance: 88,
      confidence: 88,
      novelty: 58,
      persistence: 58,
      riskPenalty: 4,
      industries: ["食品饮料", "白酒"],
      keywords: ["公司公告", "利好", "回购", "腾讯", "贵州茅台"],
      linkedCodes: ["600519"]
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/sentiment/events") {
        return new Response(JSON.stringify({ engine: "bun", events: [bunEvent] }), { status: 200 });
      }
      return new Response(JSON.stringify({ events: [] }), { status: 404 });
    });

    const events = await buildSentimentEventsBunFirst([article], STOCKS, fetchMock);

    expect(events).toEqual([bunEvent]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/sentiment/events");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      articles: [{ id: "bun-news-001" }]
    });
  });

  it("uses Bun sentiment event generation without localhost gating", async () => {
    vi.stubGlobal("window", { location: { hostname: "stockchoose.example" } });
    const article = makeNewsArticle({ id: "bun-contract-news-002" });
    const bunEvent = makeBunSentimentEvent(article);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/sentiment/events") {
        return new Response(JSON.stringify({ engine: "bun", events: [bunEvent] }), { status: 200 });
      }
      return new Response(JSON.stringify({ events: [] }), { status: 404 });
    });

    const events = await buildSentimentEventsBunFirst([article], STOCKS, fetchMock);

    expect(events).toEqual([bunEvent]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/sentiment/events");
  });

  it("rejects when Bun sentiment event generation fails instead of using browser fallback", async () => {
    const article = makeNewsArticle();
    expect(buildSentimentEventsFromNewsArticles([article], STOCKS)).toEqual([]);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "bun unavailable" }), { status: 503 }));

    await expect(buildSentimentEventsBunFirst([article], STOCKS, fetchMock)).rejects.toThrow("Bun sentiment API HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses Bun sentiment analysis for linked stocks and insight reports on the local app proxy", async () => {
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const event = testSentimentEvents[0];
    const stock = STOCKS.find((item) => item.code === "002594") ?? STOCKS[0];
    const bunLinkedStock = {
      stock,
      events: [event],
      direction: event.direction,
      relationScore: 72.4,
      relationLevel: "直接命中" as const,
      reason: "Bun 关联股票分析",
      evidence: ["Bun 真实新闻源代码直接关联"],
      tags: [event.category]
    };
    const bunReport = {
      title: "Bun 舆情洞察",
      conclusion: "Bun 已完成关联股票分析。",
      eventCount: 1,
      topCategories: [{ category: event.category, count: 1 }],
      topIndustries: [{ industry: event.industries[0], count: 1 }],
      linkedStocks: [bunLinkedStock],
      riskEvents: [],
      validationPoints: ["Bun validation"]
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/sentiment/analysis") {
        return new Response(JSON.stringify({ engine: "bun", linkedStocks: [bunLinkedStock], report: bunReport }), { status: 200 });
      }
      return new Response(JSON.stringify({ linkedStocks: [], report: bunReport }), { status: 404 });
    });

    const analysis = await buildSentimentAnalysisBunFirst([event], STOCKS, fetchMock);

    expect(analysis.linkedStocks).toEqual([bunLinkedStock]);
    expect(analysis.report).toEqual(bunReport);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/sentiment/analysis");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      events: Array<{ id: string }>;
      stocks: Array<{ code: string }>;
    };
    expect(requestBody.events[0].id).toBe(event.id);
    expect(requestBody.stocks.some((item) => item.code === "600519")).toBe(true);
  });

  it("passes enabled news analysis model settings to the Bun sentiment analysis endpoint", async () => {
    const event = testSentimentEvents[0];
    const bunReport = {
      title: "Bun 舆情洞察",
      conclusion: "Bun 模型已参与分析。",
      eventCount: 1,
      topCategories: [{ category: event.category, count: 1 }],
      topIndustries: [{ industry: event.industries[0], count: 1 }],
      linkedStocks: [],
      riskEvents: [],
      validationPoints: ["Bun model validation"]
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", linkedStocks: [], report: bunReport }), { status: 200 })
    );

    await buildSentimentAnalysisBunFirst([event], STOCKS, {
      ...defaultNewsAnalysisModelSettings,
      provider: "OpenAI Compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "news-model",
      tasks: { ...defaultNewsAnalysisModelSettings.tasks, riskSummary: false }
    }, fetchMock);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      analysisModel?: { provider?: string; baseUrl?: string; apiKey?: string; model?: string; tasks?: string[] };
    };
    expect(requestBody.analysisModel).toMatchObject({
      provider: "OpenAI Compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "news-model",
      tasks: ["sentiment", "eventExtraction", "stockMapping"]
    });
  });

  it("rejects when Bun sentiment analysis fails instead of using browser fallback", async () => {
    const event = makeBunSentimentEvent();
    expect(buildSentimentLinkedStocks([event], STOCKS)).toEqual([]);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "bun unavailable" }), { status: 503 }));

    await expect(buildSentimentAnalysisBunFirst([event], STOCKS, fetchMock)).rejects.toThrow("Bun sentiment analysis API HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("scores high value events within a normalized range", () => {
    const scores = testSentimentEvents.map(scoreSentimentEvent);

    expect(scores.every((score) => score >= 0 && score <= 100)).toBe(true);
    expect(Math.max(...scores)).toBeGreaterThan(60);
  });

  it("filters events by category, direction and query", () => {
    const events = filterSentimentEvents(testSentimentEvents, {
      category: "政策监管",
      direction: "利好",
      industry: "全部",
      severity: "全部",
      minScore: 50,
      query: "新能源"
    });

    expect(events).toHaveLength(1);
    expect(events[0].title).toContain("新能源汽车");
  });

  it("filters event radar by target industry and severity", () => {
    const events = filterSentimentEvents(testSentimentEvents, {
      category: "全部",
      direction: "全部",
      industry: "电力设备",
      severity: "特别重大",
      minScore: 50,
      query: ""
    });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.industries.includes("电力设备"))).toBe(true);
    expect(events.every((event) => event.severity === "特别重大")).toBe(true);
  });

  it("does not synthesize linked stocks or insight reports in the browser", () => {
    const events = filterSentimentEvents(testSentimentEvents, {
      category: "全部",
      direction: "全部",
      industry: "全部",
      severity: "全部",
      minScore: 60,
      query: ""
    });
    const linkedStocks = buildSentimentLinkedStocks(events, STOCKS);
    const report = buildSentimentInsightReport(events, linkedStocks);

    expect(linkedStocks).toEqual([]);
    expect(report.title).toBe("舆情关联股票洞察");
    expect(report.eventCount).toBe(events.length);
    expect(report.linkedStocks).toEqual([]);
    expect(report.validationPoints).toEqual(expect.arrayContaining(["舆情事件、股票关联和洞察报告由 Bun 数据接口生成。"]));
  });
});
