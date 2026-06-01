import { describe, expect, it } from "vitest";
import { STOCKS } from "./data";
import type { NewsArticle } from "./newsPageServices";
import {
  buildSentimentEventsFromNewsArticles,
  buildSentimentInsightReport,
  buildSentimentLinkedStocks,
  filterSentimentEvents,
  sampleSentimentEvents,
  scoreSentimentEvent
} from "./sentimentServices";

describe("sentimentServices", () => {
  it("turns real news articles into sentiment events for stock picking", () => {
    const article: NewsArticle = {
      id: "tencent-nos-test-001",
      title: "贵州茅台：关于回购股份实施结果暨股份变动的公告",
      summary: "贵州茅台披露回购实施结果，管理层稳定市场预期。",
      content: "公告显示公司完成回购并披露股份变动。",
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

    const events = buildSentimentEventsFromNewsArticles([article], STOCKS);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: article.title,
      source: "腾讯证券公告",
      category: "资金市场",
      direction: "利好",
      linkedCodes: ["600519"]
    });
    expect(scoreSentimentEvent(events[0])).toBeGreaterThan(60);
  });

  it("scores high value events within a normalized range", () => {
    const scores = sampleSentimentEvents.map(scoreSentimentEvent);

    expect(scores.every((score) => score >= 0 && score <= 100)).toBe(true);
    expect(Math.max(...scores)).toBeGreaterThan(60);
  });

  it("filters events by category, direction and query", () => {
    const events = filterSentimentEvents(sampleSentimentEvents, {
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
    const events = filterSentimentEvents(sampleSentimentEvents, {
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

  it("builds linked stocks and a report from matched events without recommendations", () => {
    const events = filterSentimentEvents(sampleSentimentEvents, {
      category: "全部",
      direction: "全部",
      industry: "全部",
      severity: "全部",
      minScore: 60,
      query: ""
    });
    const linkedStocks = buildSentimentLinkedStocks(events, STOCKS);
    const report = buildSentimentInsightReport(events, linkedStocks);

    expect(linkedStocks.length).toBeGreaterThan(0);
    expect(linkedStocks[0].stock.code).toMatch(/^\d{6}$/);
    expect(linkedStocks[0].relationScore).toBeGreaterThan(0);
    expect(report.title).toBe("舆情关联股票洞察");
    expect(report.linkedStocks.length).toBeGreaterThan(0);
    expect(report.validationPoints.length).toBeGreaterThan(2);
  });
});
