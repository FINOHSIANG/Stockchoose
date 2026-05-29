import { describe, expect, it } from "vitest";
import { STOCKS } from "./data";
import {
  buildSentimentInsightReport,
  buildSentimentRecommendations,
  filterSentimentEvents,
  sampleSentimentEvents,
  scoreSentimentEvent
} from "./sentimentServices";

describe("sentimentServices", () => {
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

  it("builds stock recommendations and a report from matched events", () => {
    const events = filterSentimentEvents(sampleSentimentEvents, {
      category: "全部",
      direction: "全部",
      industry: "全部",
      severity: "全部",
      minScore: 60,
      query: ""
    });
    const recommendations = buildSentimentRecommendations(events, STOCKS);
    const report = buildSentimentInsightReport(events, recommendations);

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].stock.code).toMatch(/^\d{6}$/);
    expect(report.title).toBe("舆情驱动选股洞察");
    expect(report.validationPoints.length).toBeGreaterThan(2);
  });
});
