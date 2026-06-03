import { describe, expect, it } from "vitest";
import { STOCKS } from "../tests/fixtures/testStockFixtures";
import type { NewsArticle } from "./newsPageServices";
import {
  buildSentimentEventsFromNewsArticles,
  buildSentimentInsightReport,
  buildSentimentLinkedStocks,
  filterSentimentEvents,
  scoreSentimentEvent,
  type SentimentEvent
} from "./sentimentServices";

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

  it("builds linked stocks and a report from matched events without recommendations", () => {
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

    expect(linkedStocks.length).toBeGreaterThan(0);
    expect(linkedStocks[0].stock.code).toMatch(/^\d{6}$/);
    expect(linkedStocks[0].relationScore).toBeGreaterThan(0);
    expect(report.title).toBe("舆情关联股票洞察");
    expect(report.linkedStocks.length).toBeGreaterThan(0);
    expect(report.validationPoints.length).toBeGreaterThan(2);
  });
});
