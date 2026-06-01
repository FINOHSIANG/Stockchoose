import type { NewsArticle, NewsCategory, NewsImportance, NewsSentiment } from "./newsPageServices";
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
  matchScore: number;
  matchLevel: "直接命中" | "强相关" | "中相关" | "弱相关";
  evidence: string[];
}

export type SentimentRelationLevel = "直接命中" | "强相关" | "中相关" | "弱相关";

export interface SentimentLinkedStock {
  stock: Stock;
  events: SentimentEvent[];
  direction: SentimentDirection;
  relationScore: number;
  relationLevel: SentimentRelationLevel;
  reason: string;
  evidence: string[];
  tags: string[];
}

export interface SentimentInsightReport {
  title: string;
  conclusion: string;
  eventCount: number;
  topCategories: Array<{ category: SentimentCategory; count: number }>;
  topIndustries: Array<{ industry: string; count: number }>;
  linkedStocks: SentimentLinkedStock[];
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

const newsCategoryToSentimentCategory: Record<NewsCategory, SentimentCategory> = {
  宏观政策: "政策监管",
  行业动态: "产业链事件",
  公司公告: "资金市场",
  财报业绩: "财报业绩",
  市场评论: "资金市场",
  国际财经: "资金市场",
  产业链: "产业链事件",
  基金持仓: "资金市场"
};

const newsSentimentToDirection: Record<NewsSentiment, SentimentDirection> = {
  利好: "利好",
  利空: "利空",
  中性: "中性"
};

const newsImportanceToSeverity: Record<NewsImportance, SentimentSeverity> = {
  头条: "特别重大",
  重要: "重大",
  一般: "一般"
};

const severePositiveWords = ["重大", "中标", "回购", "增持", "获批", "签约", "高增长", "分红", "突破", "创新高"];
const severeNegativeWords = ["退市", "处罚", "调查", "减持", "亏损", "违约", "终止", "立案", "风险警示", "下修"];
const genericIndustryLabels = new Set(["未分类", "腾讯行情", "其他", "--", ""]);

function clampScore(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function inferEventHorizon(article: NewsArticle): SentimentHorizon {
  if (article.category === "公司公告" || article.category === "市场评论") return "短期";
  if (article.category === "宏观政策" || article.category === "产业链") return "中期";
  if (article.category === "财报业绩" || article.category === "基金持仓") return "中期";
  if (article.category === "国际财经") return "短期";
  return "中期";
}

function articleText(article: NewsArticle) {
  return `${article.title} ${article.summary} ${article.content} ${article.tags.join(" ")} ${article.industries.join(" ")}`;
}

function uniqueArticleKeywords(article: NewsArticle) {
  const raw = [
    article.category,
    article.sentiment,
    ...article.tags,
    ...article.industries,
    ...article.linkedStocks.map((stock) => stock.name)
  ];
  return uniqueTexts(raw).slice(0, 8);
}

function isSpecificIndustry(value: string) {
  return !genericIndustryLabels.has(value.trim());
}

function resolveArticleIndustries(article: NewsArticle, stocks: Stock[]) {
  const linkedCodes = new Set(article.linkedCodes);
  const stockIndustries = stocks.filter((stock) => linkedCodes.has(stock.code)).flatMap((stock) => [stock.industry1, stock.industry2]);
  return uniqueTexts([...article.industries, ...stockIndustries]).filter(isSpecificIndustry).slice(0, 6);
}

function scoreArticleSignals(article: NewsArticle) {
  const text = articleText(article);
  const positiveHit = severePositiveWords.some((word) => text.includes(word));
  const negativeHit = severeNegativeWords.some((word) => text.includes(word));
  const linkedBonus = Math.min(article.linkedCodes.length, 5) * 4;
  const sourceWeight = article.source.includes("公告") || article.source.includes("腾讯") ? 88 : article.source.includes("GDELT") ? 70 : 76;
  const baseImportance = article.importance === "头条" ? 88 : article.importance === "重要" ? 76 : 62;
  const impact = clampScore(baseImportance + linkedBonus + (positiveHit || negativeHit ? 6 : 0));
  const relevance = clampScore(52 + linkedBonus * 2 + (article.industries.length ? 12 : 0) + (article.linkedStocks.length ? 16 : 0));
  const confidence = clampScore(sourceWeight - (article.linkedCodes.length ? 0 : 12));
  const novelty = clampScore(article.importance === "头条" ? 72 : 58);
  const persistence = clampScore(article.category === "宏观政策" || article.category === "产业链" ? 76 : 58);
  const riskPenalty = article.sentiment === "利空" ? 8 : negativeHit ? 12 : 4;

  return { sourceWeight, impact, relevance, confidence, novelty, persistence, riskPenalty };
}

export function buildSentimentEventsFromNewsArticles(articles: NewsArticle[], stocks: Stock[]): SentimentEvent[] {
  return articles
    .filter((article) => article.title.trim())
    .map((article, index) => {
      const signals = scoreArticleSignals(article);
      const text = articleText(article);
      const direction = newsSentimentToDirection[article.sentiment] ?? "不确定";
      const hasSevereRisk = severeNegativeWords.some((word) => text.includes(word));
      return {
        id: `real-news-${article.id || index}`,
        title: article.title,
        summary: article.summary || article.title,
        category: hasSevereRisk ? "风险负面" : newsCategoryToSentimentCategory[article.category] ?? "资金市场",
        direction,
        horizon: inferEventHorizon(article),
        severity: hasSevereRisk ? "重大" : newsImportanceToSeverity[article.importance] ?? "一般",
        occurredAt: article.publishedAt,
        source: article.source,
        ...signals,
        industries: resolveArticleIndustries(article, stocks),
        keywords: uniqueArticleKeywords(article),
        linkedCodes: uniqueTexts(article.linkedCodes)
      } satisfies SentimentEvent;
    })
    .filter((event) => event.linkedCodes.length > 0 || event.industries.length > 0)
    .sort((a, b) => scoreSentimentEvent(b) - scoreSentimentEvent(a));
}

export const sampleSentimentEvents: SentimentEvent[] = [];

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

const industryKeywordProfiles: Record<string, string[]> = {
  汽车: ["新能源汽车", "汽车", "整车", "乘用车", "充电", "县域消费"],
  电力设备: ["电池", "储能", "光伏", "特高压", "电网", "充电"],
  电子: ["半导体", "芯片", "先进封装", "国产替代", "算力", "设备"],
  食品饮料: ["白酒", "批价", "渠道", "库存", "消费"],
  银行: ["银行", "低估值", "回购", "增持", "分红"],
  家用电器: ["家电", "白色家电", "回购", "增持", "消费"],
  非银金融: ["保险", "证券", "低估值", "回购", "增持"],
  公用事业: ["电网", "电力", "绿电", "水电", "特高压", "储能"],
  计算机: ["软件", "人工智能", "AI", "算力", "信创", "数据"],
  医药生物: ["创新药", "医疗", "生物", "临床", "获批", "出海"]
};

const industry2KeywordProfiles: Record<string, string[]> = {
  乘用车: ["新能源汽车", "整车", "乘用车", "汽车", "县域消费"],
  电池: ["动力电池", "电池", "储能", "新能源汽车"],
  光伏设备: ["光伏", "硅片", "组件", "绿电"],
  半导体: ["半导体", "芯片", "先进封装", "国产替代", "设备"],
  白酒: ["白酒", "批价", "渠道库存", "动销"],
  股份行: ["银行", "低估值", "分红", "回购", "增持"],
  白色家电: ["家电", "白色家电", "回购", "增持"],
  保险: ["保险", "低估值", "回购", "增持"],
  水电: ["水电", "电力", "公用事业", "绿电"],
  软件开发: ["软件", "信创", "人工智能", "数据"],
  通信设备: ["通信", "算力", "设备", "国产替代"],
  生物制品: ["生物", "疫苗", "创新药", "临床"],
  化学制药: ["创新药", "药品", "临床", "出海"]
};

const stockKeywordProfiles: Record<string, string[]> = {
  "002594": ["比亚迪", "新能源汽车", "整车", "电池", "乘用车"],
  "300750": ["宁德时代", "动力电池", "电池", "储能"],
  "000625": ["长安汽车", "新能源汽车", "整车", "乘用车"],
  "601012": ["隆基绿能", "光伏", "硅片", "组件", "绿电"],
  "600438": ["通威股份", "光伏", "硅料", "组件"],
  "600900": ["长江电力", "水电", "电力", "公用事业"],
  "002371": ["北方华创", "半导体设备", "国产替代", "设备"],
  "688981": ["中芯国际", "半导体", "晶圆", "芯片"],
  "688008": ["澜起科技", "半导体", "芯片", "先进封装"],
  "600519": ["贵州茅台", "白酒", "批价", "渠道库存"],
  "000858": ["五粮液", "白酒", "批价", "渠道库存"],
  "000568": ["泸州老窖", "白酒", "批价", "渠道库存"],
  "600036": ["招商银行", "银行", "低估值", "分红"],
  "000333": ["美的集团", "家电", "白色家电", "回购"],
  "601318": ["中国平安", "保险", "低估值", "回购"]
};

interface EventStockMatch {
  event: SentimentEvent;
  matchScore: number;
  evidence: string[];
  direct: boolean;
}

function uniqueTexts(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function eventSearchText(event: SentimentEvent) {
  return `${event.title} ${event.summary} ${event.industries.join(" ")} ${event.keywords.join(" ")}`.toLowerCase();
}

function matchedTerms(text: string, terms: string[]) {
  return uniqueTexts(terms).filter((term) => text.includes(term.toLowerCase()));
}

function stockMatchKeywords(stock: Stock) {
  return {
    precise: uniqueTexts([...(stockKeywordProfiles[stock.code] ?? []), ...(industry2KeywordProfiles[stock.industry2] ?? [])]),
    broad: uniqueTexts([...(industryKeywordProfiles[stock.industry1] ?? []), stock.industry1, stock.industry2]).filter(isSpecificIndustry)
  };
}

function calculateEventStockMatch(event: SentimentEvent, stock: Stock): EventStockMatch {
  const text = eventSearchText(event);
  const evidence: string[] = [];
  let matchScore = 0;
  const modelLinked = event.linkedCodes.includes(stock.code);
  const strictSourceLinked = event.source.includes("腾讯证券公告") && event.linkedCodes.length > 0;
  const textDirect = !strictSourceLinked && (text.includes(stock.name.toLowerCase()) || text.includes(stock.code));

  if (modelLinked) {
    matchScore += strictSourceLinked ? 56 : 48;
    evidence.push("真实新闻源代码直接关联");
  } else if (textDirect) {
    matchScore += 50;
    evidence.push("正文直接出现公司或代码");
  }

  if (isSpecificIndustry(stock.industry1) && event.industries.includes(stock.industry1)) {
    matchScore += 16;
    evidence.push(`一级行业匹配：${stock.industry1}`);
  }

  if (isSpecificIndustry(stock.industry2) && text.includes(stock.industry2.toLowerCase())) {
    matchScore += 18;
    evidence.push(`二级行业命中：${stock.industry2}`);
  }

  const { precise, broad } = stockMatchKeywords(stock);
  const preciseHits = matchedTerms(text, precise);
  if (preciseHits.length) {
    matchScore += Math.min(28, preciseHits.length * 9);
    evidence.push(`业务关键词：${preciseHits.slice(0, 3).join("、")}`);
  }

  const broadHits = matchedTerms(text, broad.filter((term) => !preciseHits.includes(term)));
  if (broadHits.length) {
    matchScore += Math.min(12, broadHits.length * 4);
    evidence.push(`行业关键词：${broadHits.slice(0, 3).join("、")}`);
  }

  if ((event.direction === "利空" || event.category === "风险负面") && !textDirect && !modelLinked) {
    matchScore -= 22;
    evidence.push("负面事件仅保留直接关联标的");
  }

  if (stock.isST || stock.isSuspended) {
    matchScore -= 16;
    evidence.push(stock.isST ? "ST 风险降权" : "停牌风险降权");
  }

  return {
    event,
    matchScore: round(Math.max(0, Math.min(100, matchScore)), 1),
    evidence: uniqueTexts(evidence).slice(0, 5),
    direct: textDirect || modelLinked
  };
}

function shouldKeepStockMatch(match: EventStockMatch) {
  if (match.event.direction === "利空" || match.event.category === "风险负面") {
    return match.direct && match.matchScore >= 38;
  }
  if (match.direct && match.matchScore >= 45) return true;
  return match.matchScore >= 42 && match.evidence.length >= 2;
}

function relationMatchLevel(matchScore: number, direct: boolean): SentimentRelationLevel {
  if (direct && matchScore >= 60) return "直接命中";
  if (matchScore >= 62) return "强相关";
  if (matchScore >= 48) return "中相关";
  return "弱相关";
}

function mergeDirection(events: SentimentEvent[]): SentimentDirection {
  const positive = events.filter((event) => event.direction === "利好").length;
  const negative = events.filter((event) => event.direction === "利空").length;
  if (positive > negative) return "利好";
  if (negative > positive) return "利空";
  return events[0]?.direction ?? "不确定";
}

export function buildSentimentRecommendations(events: SentimentEvent[], stocks: Stock[]) {
  const byCode = new Map<string, EventStockMatch[]>();
  events.forEach((event) => {
    stocks.forEach((stock) => {
      const match = calculateEventStockMatch(event, stock);
      if (!shouldKeepStockMatch(match)) return;
      byCode.set(stock.code, [...(byCode.get(stock.code) ?? []), match]);
    });
  });

  return Array.from(byCode.entries())
    .map(([code, matches]) => {
      const stock = stocks.find((item) => item.code === code);
      if (!stock) return null;
      const linkedEvents = matches.map((match) => match.event);
      const weightedTotal = matches.reduce((sum, match) => sum + scoreSentimentEvent(match.event) * (0.7 + match.matchScore / 100), 0);
      const weightBase = matches.reduce((sum, match) => sum + 0.7 + match.matchScore / 100, 0);
      const eventScore = weightedTotal / Math.max(weightBase, 1);
      const matchScore = matches.reduce((sum, match) => sum + match.matchScore, 0) / matches.length;
      const direction = mergeDirection(linkedEvents);
      const negativeCount = linkedEvents.filter((event) => event.direction === "利空").length;
      const weakMatchPenalty = matches.filter((match) => match.matchScore < 50).length * 3;
      const score = round(Math.max(0, Math.min(100, eventScore * 0.64 + matchScore * 0.36 + stockScoreBoost(stock) * 0.5 - negativeCount * 10 - weakMatchPenalty)), 2);
      const topMatch = [...matches].sort((a, b) => b.matchScore + scoreSentimentEvent(b.event) / 10 - (a.matchScore + scoreSentimentEvent(a.event) / 10))[0];
      const topEvent = topMatch.event;
      const risk = negativeCount > 0 || (stock.metrics.volatility20 ?? 0) > 45 || matchScore < 48 ? "高" : score >= 78 && matchScore >= 62 ? "低" : "中";
      const evidence = uniqueTexts(matches.flatMap((match) => match.evidence)).slice(0, 5);
      const roundedMatchScore = round(matchScore, 1);
      return {
        stock,
        events: linkedEvents,
        score,
        direction,
        reason: `${topEvent.category}：${topEvent.summary}｜关联证据：${evidence.slice(0, 3).join("、")}`,
        risk,
        tags: Array.from(new Set(linkedEvents.flatMap((event) => [event.category, ...event.keywords.slice(0, 2)]))).slice(0, 4),
        matchScore: roundedMatchScore,
        matchLevel: relationMatchLevel(roundedMatchScore, matches.some((match) => match.direct)),
        evidence
      } satisfies SentimentRecommendation;
    })
    .filter((item): item is SentimentRecommendation => Boolean(item))
    .sort((a, b) => b.score - a.score);
}

export function buildSentimentLinkedStocks(events: SentimentEvent[], stocks: Stock[]) {
  const byCode = new Map<string, EventStockMatch[]>();
  events.forEach((event) => {
    stocks.forEach((stock) => {
      const match = calculateEventStockMatch(event, stock);
      if (!shouldKeepStockMatch(match)) return;
      byCode.set(stock.code, [...(byCode.get(stock.code) ?? []), match]);
    });
  });

  return Array.from(byCode.entries())
    .map(([code, matches]) => {
      const stock = stocks.find((item) => item.code === code);
      if (!stock) return null;
      const linkedEvents = matches.map((match) => match.event);
      const relationScore = round(matches.reduce((sum, match) => sum + match.matchScore, 0) / matches.length, 1);
      const topMatch = [...matches].sort((a, b) => b.matchScore + scoreSentimentEvent(b.event) / 10 - (a.matchScore + scoreSentimentEvent(a.event) / 10))[0];
      const topEvent = topMatch.event;
      const evidence = uniqueTexts(matches.flatMap((match) => match.evidence)).slice(0, 5);
      return {
        stock,
        events: linkedEvents,
        direction: mergeDirection(linkedEvents),
        relationScore,
        relationLevel: relationMatchLevel(relationScore, matches.some((match) => match.direct)),
        reason: `${topEvent.category}：${topEvent.summary}`,
        evidence,
        tags: Array.from(new Set(linkedEvents.flatMap((event) => [event.category, ...event.keywords.slice(0, 2)]))).slice(0, 4)
      } satisfies SentimentLinkedStock;
    })
    .filter((item): item is SentimentLinkedStock => Boolean(item))
    .sort((a, b) => b.relationScore - a.relationScore || scoreSentimentEvent(b.events[0]) - scoreSentimentEvent(a.events[0]));
}

function topCounts<T extends string>(items: T[], limit: number) {
  const counts = new Map<T, number>();
  items.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function buildSentimentInsightReport(events: SentimentEvent[], linkedStocks: SentimentLinkedStock[]): SentimentInsightReport {
  const topCategories = topCounts(events.map((event) => event.category), 3).map(({ item, count }) => ({ category: item, count }));
  const topIndustries = topCounts(events.flatMap((event) => event.industries), 5).map(({ item, count }) => ({ industry: item, count }));
  const topLinkedStocks = linkedStocks.slice(0, 5);
  const riskEvents = events.filter((event) => event.direction === "利空" || event.category === "风险负面");
  const strongest = topLinkedStocks[0];
  return {
    title: "舆情关联股票洞察",
    conclusion: strongest
      ? `当前高价值事件集中在${topIndustries[0]?.industry ?? "核心行业"}，${strongest.stock.name}与${strongest.events[0].category}事件存在${strongest.relationLevel}关联。`
      : "当前筛选条件下没有形成明确的股票关联关系。",
    eventCount: events.length,
    topCategories,
    topIndustries,
    linkedStocks: topLinkedStocks,
    riskEvents,
    validationPoints: [
      "核对事件是否来自公告、政策原文或多家权威媒体交叉确认。",
      "观察事件后 1-3 个交易日成交额、换手率和相对强弱是否同步放大。",
      "当前列表只表达新闻与股票的关联关系，不构成买入、卖出或持仓建议。",
      "对利空事件单独核查公告原文，避免把短期风险误判为机会。"
    ]
  };
}

