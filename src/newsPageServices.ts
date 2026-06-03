import type { Stock } from "./types";
import { isAnnouncementNewsSource, type NewsSourceEndpoint } from "./newsSourceServices";
import { displayStockCode } from "./stockIdentity";

// --- Types ---

export type NewsCategory = "宏观政策" | "行业动态" | "公司公告" | "财报业绩" | "市场评论" | "国际财经" | "产业链" | "基金持仓";
export type NewsSentiment = "利好" | "利空" | "中性";
export type NewsImportance = "头条" | "重要" | "一般";
export type NewsStatus = "unread" | "read" | "starred";
export type NewsFetchMode = "fast" | "standard" | "full";

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  source: string;
  sourceIcon: string;
  category: NewsCategory;
  sentiment: NewsSentiment;
  importance: NewsImportance;
  status: NewsStatus;
  publishedAt: string;
  fetchedAt: string;
  url: string;
  imageUrl: string;
  author: string;
  readTime: number;
  linkedCodes: string[];
  linkedStocks: Array<{ code: string; name: string }>;
  industries: string[];
  tags: string[];
  viewCount: number;
  commentCount: number;
}

export interface NewsFilters {
  category: "全部" | NewsCategory;
  sentiment: "全部" | NewsSentiment;
  importance: "全部" | NewsImportance;
  status: "全部" | NewsStatus;
  dateRange: "today" | "3d" | "7d" | "30d" | "all";
  source: string;
  query: string;
}

export interface NewsPageState {
  filters: NewsFilters;
  selectedArticleId: string | null;
  currentPage: number;
  pageSize: number;
}

// --- Constants ---

export const newsCategoryOptions: Array<"全部" | NewsCategory> = [
  "全部", "宏观政策", "行业动态", "公司公告", "财报业绩", "市场评论", "国际财经", "产业链", "基金持仓"
];

export const newsSentimentOptions: Array<"全部" | NewsSentiment> = ["全部", "利好", "利空", "中性"];
export const newsImportanceOptions: Array<"全部" | NewsImportance> = ["全部", "头条", "重要", "一般"];
export const newsStatusOptions: Array<"全部" | NewsStatus> = ["全部", "unread", "read", "starred"];
export const newsDateRangeOptions = [
  { label: "今天", value: "today" as const },
  { label: "近3天", value: "3d" as const },
  { label: "近7天", value: "7d" as const },
  { label: "近30天", value: "30d" as const },
  { label: "全部", value: "all" as const }
];

export const defaultNewsFilters: NewsFilters = {
  category: "全部",
  sentiment: "全部",
  importance: "全部",
  status: "全部",
  dateRange: "7d",
  source: "全部来源",
  query: ""
};

export const defaultNewsPageState: NewsPageState = {
  filters: defaultNewsFilters,
  selectedArticleId: null,
  currentPage: 1,
  pageSize: 20
};
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface GdeltArticleRow {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
}

export interface NewsArticleFetchResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
  articles: NewsArticle[];
  sourceRows: number;
  stats: NewsFetchStats;
}

export interface NewsArticleFetchOptions {
  allowLocalFallback?: boolean;
  mode?: NewsFetchMode;
}

export interface NewsFetchStats {
  mode: NewsFetchMode;
  scannedStocks: number;
  requestCount: number;
  returnedRows: number;
  validArticles: number;
}

interface NewsSourceFetchResult {
  articles: NewsArticle[];
  stats: NewsFetchStats;
}

export const newsFetchModeOptions: Array<{ value: NewsFetchMode; label: string; description: string }> = [
  { value: "fast", label: "快速", description: "少量新闻请求，适合自动刷新" },
  { value: "standard", label: "标准", description: "扩大新闻拉取规模，适合日常手动刷新" },
  { value: "full", label: "全市场", description: "按全市场口径处理新闻源，不拉取任何公告接口" }
];

export const defaultNewsFetchStats: NewsFetchStats = {
  mode: "fast",
  scannedStocks: 0,
  requestCount: 0,
  returnedRows: 0,
  validArticles: 0
};

function emptyNewsFetchStats(mode: NewsFetchMode): NewsFetchStats {
  return { ...defaultNewsFetchStats, mode };
}

function mergeNewsFetchStats(items: NewsFetchStats[], mode: NewsFetchMode): NewsFetchStats {
  return items.reduce(
    (sum, item) => ({
      mode,
      scannedStocks: sum.scannedStocks + item.scannedStocks,
      requestCount: sum.requestCount + item.requestCount,
      returnedRows: sum.returnedRows + item.returnedRows,
      validArticles: sum.validArticles + item.validArticles
    }),
    emptyNewsFetchStats(mode)
  );
}

const positiveWords = ["利好", "增长", "创新高", "中标", "回购", "增持", "支持", "突破", "上涨", "扩产", "获批", "签约"];
const negativeWords = ["利空", "下跌", "承压", "风险", "处罚", "调查", "亏损", "减持", "违约", "退市", "下修", "终止"];

const categoryRules: Array<{ category: NewsCategory; words: string[] }> = [
  { category: "公司公告", words: ["公告", "回购", "增持", "减持", "股东", "董事会", "分红"] },
  { category: "财报业绩", words: ["财报", "业绩", "净利润", "营收", "利润", "预告"] },
  { category: "宏观政策", words: ["国务院", "央行", "证监会", "发改委", "政策", "通知", "规划", "会议"] },
  { category: "国际财经", words: ["美联储", "美元", "美国", "欧洲", "全球", "海外"] },
  { category: "基金持仓", words: ["基金", "ETF", "持仓", "北向", "外资"] },
  { category: "产业链", words: ["产业链", "订单", "招标", "供需", "价格", "产能"] }
];

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const withQueryParams = (baseUrl: string, params: URLSearchParams) => `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;

function inferNewsCategory(text: string): NewsCategory {
  return categoryRules.find((rule) => rule.words.some((word) => text.includes(word)))?.category ?? "市场评论";
}

function inferNewsSentiment(text: string): NewsSentiment {
  const positive = positiveWords.some((word) => text.includes(word));
  const negative = negativeWords.some((word) => text.includes(word));
  if (positive && !negative) return "利好";
  if (negative && !positive) return "利空";
  return "中性";
}

function inferNewsImportance(text: string, index: number): NewsImportance {
  if (index < 3 || ["国务院", "央行", "证监会", "重大", "突发"].some((word) => text.includes(word))) return "头条";
  if (index < 10 || ["公告", "业绩", "政策", "回购", "风险"].some((word) => text.includes(word))) return "重要";
  return "一般";
}

function matchLinkedStocks(text: string, stocks: Stock[]) {
  const upperText = text.toUpperCase();
  return stocks
    .filter((stock) => upperText.includes(stock.name.toUpperCase()) || upperText.includes(stock.code) || upperText.includes(displayStockCode(stock)))
    .slice(0, 8)
    .map((stock) => ({ code: stock.code, name: stock.name }));
}

function inferIndustries(text: string, stocks: Stock[], linkedStocks: Array<{ code: string; name: string }>) {
  const linkedCodes = new Set(linkedStocks.map((stock) => stock.code));
  const stockIndustries = stocks.filter((stock) => linkedCodes.has(stock.code)).map((stock) => stock.industry1);
  const mentionedIndustries = Array.from(new Set(stocks.map((stock) => stock.industry1))).filter((industry) => text.includes(industry));
  return Array.from(new Set([...stockIndustries, ...mentionedIndustries])).slice(0, 6);
}

function buildArticleFromGdelt(row: GdeltArticleRow, source: NewsSourceEndpoint, stocks: Stock[], index: number): NewsArticle | null {
  const title = stripHtml(row.title ?? "");
  if (!title || !row.url) return null;
  const linkedStocks = matchLinkedStocks(title, stocks);
  const industries = inferIndustries(title, stocks, linkedStocks);
  const category = inferNewsCategory(title);
  const sentiment = inferNewsSentiment(title);
  return {
    id: `${source.id}-${index}-${row.url}`,
    title,
    summary: title,
    content: title,
    source: row.domain || source.name,
    sourceIcon: (row.domain || source.name).slice(0, 1).toUpperCase(),
    category,
    sentiment,
    importance: inferNewsImportance(title, index),
    status: "unread",
    publishedAt: row.seendate || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    url: row.url,
    imageUrl: "",
    author: row.domain || source.name,
    readTime: 1,
    linkedCodes: linkedStocks.map((stock) => stock.code),
    linkedStocks,
    industries,
    tags: Array.from(new Set([category, sentiment, ...industries])).slice(0, 6),
    viewCount: 0,
    commentCount: 0
  };
}

async function fetchGdeltNews(source: NewsSourceEndpoint, stocks: Stock[], fetchImpl: FetchLike, mode: NewsFetchMode): Promise<NewsSourceFetchResult> {
  const params = new URLSearchParams({
    query: source.query || "A股 OR 中国上市公司",
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(Math.max(source.maxItems || 50, 1), 100)),
    sort: "HybridRel"
  });
  const response = await fetchImpl(withQueryParams(`${source.baseUrl.replace(/\/$/, "")}/doc/doc`, params));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.articles) ? payload.articles as GdeltArticleRow[] : [];
  const articles = rows.map((row, index) => buildArticleFromGdelt(row, source, stocks, index)).filter((article): article is NewsArticle => Boolean(article));
  return {
    articles,
    stats: {
      mode,
      scannedStocks: 0,
      requestCount: 1,
      returnedRows: rows.length,
      validArticles: articles.length
    }
  };
}

export async function fetchNewsArticlesFromSources(
  sources: NewsSourceEndpoint[],
  stocks: Stock[],
  fetchImpl: FetchLike = fetch,
  options: NewsArticleFetchOptions = {}
): Promise<NewsArticleFetchResult> {
  const checkedAt = new Date().toISOString();
  const mode = options.mode ?? "fast";
  const realSources = sources.filter((source) => source.enabled && source.provider !== "本地舆情样本" && !isAnnouncementNewsSource(source));
  if (!realSources.length) {
    return {
      ok: false,
      checkedAt,
      message: "新闻刷新失败",
      details: "未启用可用真实新闻源；公告源已停用，请在设置中启用 GDELT 2.1、NewsAPI 或自定义新闻接口",
      articles: [],
      sourceRows: 0,
      stats: emptyNewsFetchStats(mode)
    };
  }

  const articles: NewsArticle[] = [];
  const sourceStats: NewsFetchStats[] = [];
  const errors: string[] = [];
  for (const source of realSources) {
    try {
      const result =
        source.provider === "GDELT 2.1"
          ? await fetchGdeltNews(source, stocks, fetchImpl, mode)
          : { articles: [], stats: emptyNewsFetchStats(mode) };
      articles.push(...result.articles);
      sourceStats.push(result.stats);
    } catch (error) {
      errors.push(`${source.name}：${error instanceof Error ? error.message : "未知错误"}`);
      sourceStats.push({
        ...emptyNewsFetchStats(mode),
        requestCount: source.provider === "GDELT 2.1" || source.provider === "NewsAPI" || source.provider === "自定义 RSS" || source.provider === "自定义 REST" ? 1 : 0
      });
    }
  }

  const stats = mergeNewsFetchStats(sourceStats, mode);
  const deduped = Array.from(new Map(articles.map((article) => [article.id || article.url, article])).values()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  stats.validArticles = deduped.length;
  if (!deduped.length) {
    return {
      ok: false,
      checkedAt,
      message: "新闻刷新失败",
      details: errors.join("；") || "真实新闻源未返回有效新闻",
      articles: [],
      sourceRows: 0,
      stats
    };
  }

  const modeLabel = newsFetchModeOptions.find((option) => option.value === mode)?.label ?? "快速";
  return {
    ok: true,
    checkedAt,
    message: "新闻刷新完成",
    details: `已按${modeLabel}模式从 ${realSources.map((source) => source.name).join("、")} 拉取 ${deduped.length} 条真实新闻`,
    articles: deduped,
    sourceRows: deduped.length,
    stats
  };
}

// --- Utility functions ---

export function filterNewsArticles(articles: NewsArticle[], filters: NewsFilters): NewsArticle[] {
  const query = filters.query.trim().toLowerCase();
  const now = new Date();

  return articles
    .filter((article) => {
      if (filters.category !== "全部" && article.category !== filters.category) return false;
      if (filters.sentiment !== "全部" && article.sentiment !== filters.sentiment) return false;
      if (filters.importance !== "全部" && article.importance !== filters.importance) return false;
      if (filters.status !== "全部" && article.status !== filters.status) return false;
      if (filters.source !== "全部来源" && article.source !== filters.source) return false;

      // Date range filter
      if (filters.dateRange !== "all") {
        const pubDate = new Date(article.publishedAt);
        const diffMs = now.getTime() - pubDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (filters.dateRange === "today" && diffDays > 1) return false;
        if (filters.dateRange === "3d" && diffDays > 3) return false;
        if (filters.dateRange === "7d" && diffDays > 7) return false;
        if (filters.dateRange === "30d" && diffDays > 30) return false;
      }

      // Text search
      if (query) {
        const haystack = `${article.title}${article.summary}${article.content}${article.industries.join("")}${article.tags.join("")}${article.linkedCodes.join("")}${article.linkedStocks.map((s) => s.name).join("")}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export function getNewsSourceList(articles: NewsArticle[]): string[] {
  const sources = new Set(articles.map((a) => a.source));
  return ["全部来源", ...Array.from(sources).sort()];
}

export function getNewsStats(articles: NewsArticle[]) {
  const total = articles.length;
  const unread = articles.filter((a) => a.status === "unread").length;
  const starred = articles.filter((a) => a.status === "starred").length;
  const positive = articles.filter((a) => a.sentiment === "利好").length;
  const negative = articles.filter((a) => a.sentiment === "利空").length;
  const headlines = articles.filter((a) => a.importance === "头条").length;

  // Category distribution
  const categoryCounts = new Map<string, number>();
  articles.forEach((a) => categoryCounts.set(a.category, (categoryCounts.get(a.category) ?? 0) + 1));
  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return { total, unread, starred, positive, negative, headlines, topCategories };
}

export function formatNewsDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) return `${Math.max(1, Math.floor(diffMs / (1000 * 60)))} 分钟前`;
  if (diffHours < 24) return `${Math.floor(diffHours)} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

