import type { Stock } from "./types";

export type SentimentCategory = "政策监管" | "财报业绩" | "订单合同" | "产品技术" | "供需价格" | "产业链事件" | "风险负面" | "资金市场";
export type SentimentDirection = "利好" | "利空" | "中性" | "不确定";
export type SentimentHorizon = "日内" | "短期" | "中期" | "长期";
export type SentimentSeverity = "特别重大" | "重大" | "一般" | "观察";

export interface SentimentEvent {
  id: string;
  title: string;
  summary: string;
  category: SentimentCategory;
  direction: SentimentDirection;
  horizon: SentimentHorizon;
  severity: SentimentSeverity;
  occurredAt: string;
  source: string;
  sourceWeight: number;
  impact: number;
  relevance: number;
  confidence: number;
  novelty: number;
  persistence: number;
  riskPenalty: number;
  industries: string[];
  keywords: string[];
  linkedCodes: string[];
}

export interface SentimentFilters {
  category: "全部" | SentimentCategory;
  direction: "全部" | SentimentDirection;
  industry: "全部" | string;
  severity: "全部" | SentimentSeverity;
  minScore: number;
  query: string;
}

export interface SentimentRecommendation {
  stock: Stock;
  events: SentimentEvent[];
  score: number;
  direction: SentimentDirection;
  reason: string;
  risk: "低" | "中" | "高";
  tags: string[];
}

export interface SentimentInsightReport {
  title: string;
  conclusion: string;
  eventCount: number;
  topCategories: Array<{ category: SentimentCategory; count: number }>;
  topIndustries: Array<{ industry: string; count: number }>;
  longIdeas: SentimentRecommendation[];
  riskEvents: SentimentEvent[];
  validationPoints: string[];
}

const round = (value: number, precision = 2) => {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
};

export const sentimentCategories: Array<"全部" | SentimentCategory> = [
  "全部",
  "政策监管",
  "财报业绩",
  "订单合同",
  "产品技术",
  "供需价格",
  "产业链事件",
  "风险负面",
  "资金市场"
];

export const sentimentDirections: Array<"全部" | SentimentDirection> = ["全部", "利好", "利空", "中性", "不确定"];
export const sentimentSeverityLevels: Array<"全部" | SentimentSeverity> = ["全部", "特别重大", "重大", "一般", "观察"];

export const sampleSentimentEvents: SentimentEvent[] = [
  {
    id: "policy-auto-202605",
    title: "新一轮新能源汽车下乡与充电基础设施补贴预期升温",
    summary: "政策端继续支持新能源汽车消费和县域充电网络建设，整车、电池和充电设备链条受益。",
    category: "政策监管",
    direction: "利好",
    horizon: "中期",
    severity: "特别重大",
    occurredAt: "2026-05-28 09:20",
    source: "公开政策新闻",
    sourceWeight: 88,
    impact: 86,
    relevance: 84,
    confidence: 78,
    novelty: 64,
    persistence: 82,
    riskPenalty: 12,
    industries: ["汽车", "电力设备"],
    keywords: ["新能源汽车", "充电基础设施", "县域消费"],
    linkedCodes: ["002594", "300750", "601012"]
  },
  {
    id: "supply-chip-202605",
    title: "先进封装产能紧张，国产设备验证节奏加快",
    summary: "海外算力需求带动先进封装景气，国产半导体设备进入更多验证环节。",
    category: "产业链事件",
    direction: "利好",
    horizon: "中期",
    severity: "重大",
    occurredAt: "2026-05-28 10:10",
    source: "产业链跟踪",
    sourceWeight: 82,
    impact: 80,
    relevance: 86,
    confidence: 72,
    novelty: 70,
    persistence: 78,
    riskPenalty: 18,
    industries: ["电子"],
    keywords: ["先进封装", "半导体设备", "国产替代"],
    linkedCodes: ["002371", "688981", "688008"]
  },
  {
    id: "risk-liquor-202605",
    title: "高端白酒批价波动，渠道库存压力仍需观察",
    summary: "部分区域渠道反馈动销恢复不均衡，短期估值修复需要更明确的库存改善信号。",
    category: "风险负面",
    direction: "利空",
    horizon: "短期",
    severity: "重大",
    occurredAt: "2026-05-28 11:00",
    source: "渠道调研摘要",
    sourceWeight: 74,
    impact: 68,
    relevance: 80,
    confidence: 70,
    novelty: 58,
    persistence: 55,
    riskPenalty: 8,
    industries: ["食品饮料"],
    keywords: ["白酒", "渠道库存", "批价"],
    linkedCodes: ["600519", "000858", "000568"]
  },
  {
    id: "order-grid-202605",
    title: "电网投资招标规模提升，特高压和储能配套订单增加",
    summary: "电网侧投资节奏较快，设备、储能和功率器件企业订单可见度提升。",
    category: "订单合同",
    direction: "利好",
    horizon: "长期",
    severity: "特别重大",
    occurredAt: "2026-05-28 13:30",
    source: "招投标公开信息",
    sourceWeight: 86,
    impact: 78,
    relevance: 82,
    confidence: 76,
    novelty: 62,
    persistence: 85,
    riskPenalty: 10,
    industries: ["电力设备", "公用事业"],
    keywords: ["电网投资", "储能", "特高压"],
    linkedCodes: ["601012", "600900", "600438"]
  },
  {
    id: "capital-buyback-202605",
    title: "多家龙头公司披露回购或增持计划，稳定市场预期",
    summary: "回购增持强化安全边际，但仍需结合估值、现金流和执行进度判断。",
    category: "资金市场",
    direction: "利好",
    horizon: "短期",
    severity: "一般",
    occurredAt: "2026-05-28 15:05",
    source: "上市公司公告",
    sourceWeight: 90,
    impact: 62,
    relevance: 70,
    confidence: 82,
    novelty: 60,
    persistence: 58,
    riskPenalty: 8,
    industries: ["银行", "家用电器", "非银金融"],
    keywords: ["回购", "增持", "低估值"],
    linkedCodes: ["600036", "000333", "601318"]
  }
];

export function scoreSentimentEvent(event: SentimentEvent) {
  const raw =
    event.impact * 0.24 +
    event.relevance * 0.2 +
    event.confidence * 0.18 +
    event.novelty * 0.12 +
    event.persistence * 0.14 +
    event.sourceWeight * 0.12 -
    event.riskPenalty;
  return round(Math.max(0, Math.min(100, raw)), 2);
}

export function filterSentimentEvents(events: SentimentEvent[], filters: SentimentFilters) {
  const query = filters.query.trim().toLowerCase();
  return events
    .filter((event) => filters.category === "全部" || event.category === filters.category)
    .filter((event) => filters.direction === "全部" || event.direction === filters.direction)
    .filter((event) => filters.industry === "全部" || event.industries.includes(filters.industry))
    .filter((event) => filters.severity === "全部" || event.severity === filters.severity)
    .filter((event) => scoreSentimentEvent(event) >= filters.minScore)
    .filter((event) => {
      if (!query) return true;
      const haystack = `${event.title}${event.summary}${event.industries.join("")}${event.keywords.join("")}${event.linkedCodes.join("")}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => scoreSentimentEvent(b) - scoreSentimentEvent(a));
}

function stockScoreBoost(stock: Stock) {
  const quality = stock.metrics.qualityScore ?? 50;
  const momentum = stock.metrics.momentum60 ?? 0;
  const valuation = stock.metrics.pe ? Math.max(0, 80 - stock.metrics.pe) : 40;
  return quality * 0.18 + momentum * 0.08 + valuation * 0.08;
}

function mergeDirection(events: SentimentEvent[]): SentimentDirection {
  const positive = events.filter((event) => event.direction === "利好").length;
  const negative = events.filter((event) => event.direction === "利空").length;
  if (positive > negative) return "利好";
  if (negative > positive) return "利空";
  return events[0]?.direction ?? "不确定";
}

export function buildSentimentRecommendations(events: SentimentEvent[], stocks: Stock[]) {
  const byCode = new Map<string, SentimentEvent[]>();
  events.forEach((event) => {
    event.linkedCodes.forEach((code) => {
      byCode.set(code, [...(byCode.get(code) ?? []), event]);
    });
  });

  return Array.from(byCode.entries())
    .map(([code, linkedEvents]) => {
      const stock = stocks.find((item) => item.code === code);
      if (!stock) return null;
      const eventScore = linkedEvents.reduce((sum, event) => sum + scoreSentimentEvent(event), 0) / linkedEvents.length;
      const direction = mergeDirection(linkedEvents);
      const negativeCount = linkedEvents.filter((event) => event.direction === "利空").length;
      const score = round(Math.max(0, Math.min(100, eventScore + stockScoreBoost(stock) - negativeCount * 9)), 2);
      const topEvent = [...linkedEvents].sort((a, b) => scoreSentimentEvent(b) - scoreSentimentEvent(a))[0];
      const risk = negativeCount > 0 || (stock.metrics.volatility20 ?? 0) > 45 ? "高" : score >= 78 ? "低" : "中";
      return {
        stock,
        events: linkedEvents,
        score,
        direction,
        reason: `${topEvent.category}：${topEvent.summary}`,
        risk,
        tags: Array.from(new Set(linkedEvents.flatMap((event) => [event.category, ...event.keywords.slice(0, 2)]))).slice(0, 4)
      } satisfies SentimentRecommendation;
    })
    .filter((item): item is SentimentRecommendation => Boolean(item))
    .sort((a, b) => b.score - a.score);
}

function topCounts<T extends string>(items: T[], limit: number) {
  const counts = new Map<T, number>();
  items.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function buildSentimentInsightReport(events: SentimentEvent[], recommendations: SentimentRecommendation[]): SentimentInsightReport {
  const topCategories = topCounts(events.map((event) => event.category), 3).map(({ item, count }) => ({ category: item, count }));
  const topIndustries = topCounts(events.flatMap((event) => event.industries), 5).map(({ item, count }) => ({ industry: item, count }));
  const longIdeas = recommendations.filter((item) => item.direction === "利好").slice(0, 5);
  const riskEvents = events.filter((event) => event.direction === "利空" || event.category === "风险负面");
  const strongest = longIdeas[0];
  return {
    title: "舆情驱动选股洞察",
    conclusion: strongest
      ? `当前高价值事件集中在${topIndustries[0]?.industry ?? "核心行业"}，${strongest.stock.name}因${strongest.events[0].category}事件获得最高综合分。`
      : "当前筛选条件下没有形成明确的舆情交易线索。",
    eventCount: events.length,
    topCategories,
    topIndustries,
    longIdeas,
    riskEvents,
    validationPoints: [
      "核对事件是否来自公告、政策原文或多家权威媒体交叉确认。",
      "观察事件后 1-3 个交易日成交额、换手率和相对强弱是否同步放大。",
      "结合估值分位、业绩质量和行业景气度，剔除纯题材脉冲。",
      "对利空事件设置止损或观察清单，避免把短期风险误判为低估机会。"
    ]
  };
}
