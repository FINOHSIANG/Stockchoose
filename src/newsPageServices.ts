import type { Stock } from "./types";
import type { NewsSourceEndpoint } from "./newsSourceServices";

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
const RUST_NEWS_ARTICLES_URL = "/api/news/articles";

export interface NewsArticleFetchResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
  articles: NewsArticle[];
  sourceRows: number;
  stats: NewsFetchStats;
  sourceDiagnostics: NewsSourceDiagnostic[];
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

export interface NewsSourceDiagnostic {
  sourceId: string;
  sourceName: string;
  provider: string;
  fallbackSource?: string;
  fallbackReason?: string;
}

interface NewsSourceFetchResult {
  articles: NewsArticle[];
  stats: NewsFetchStats;
  sourceDiagnostics: NewsSourceDiagnostic[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function requireString(row: Record<string, unknown>, key: keyof NewsArticle, index: number, allowEmpty = true) {
  const value = row[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`Rust news API returned invalid article row ${index}: ${String(key)} must be a string`);
  }
  return value;
}

function requireNumber(row: Record<string, unknown>, key: keyof NewsArticle, index: number) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Rust news API returned invalid article row ${index}: ${String(key)} must be a finite number`);
  }
  return value;
}

function requireStringArray(row: Record<string, unknown>, key: keyof NewsArticle, index: number) {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Rust news API returned invalid article row ${index}: ${String(key)} must be a string array`);
  }
  return value;
}

function requireLinkedStocks(row: Record<string, unknown>, index: number) {
  const value = row.linkedStocks;
  if (
    !Array.isArray(value) ||
    value.some((item) => !isRecord(item) || typeof item.code !== "string" || typeof item.name !== "string")
  ) {
    throw new Error(`Rust news API returned invalid article row ${index}: linkedStocks must be stock references`);
  }
  return value as Array<{ code: string; name: string }>;
}

function optionalString(row: Record<string, unknown>, key: string, context: string) {
  const value = row[key];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Rust news API returned invalid ${context}: ${key} must be a string when provided`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function newsArticleFromPayloadRow(row: unknown, index: number): NewsArticle {
  if (!isRecord(row)) throw new Error(`Rust news API returned invalid article row ${index}: row must be an object`);
  return {
    id: requireString(row, "id", index, false),
    title: requireString(row, "title", index, false),
    summary: requireString(row, "summary", index),
    content: requireString(row, "content", index),
    source: requireString(row, "source", index, false),
    sourceIcon: requireString(row, "sourceIcon", index),
    category: requireString(row, "category", index, false) as NewsCategory,
    sentiment: requireString(row, "sentiment", index, false) as NewsSentiment,
    importance: requireString(row, "importance", index, false) as NewsImportance,
    status: requireString(row, "status", index, false) as NewsStatus,
    publishedAt: requireString(row, "publishedAt", index, false),
    fetchedAt: requireString(row, "fetchedAt", index),
    url: requireString(row, "url", index, false),
    imageUrl: requireString(row, "imageUrl", index),
    author: requireString(row, "author", index),
    readTime: requireNumber(row, "readTime", index),
    linkedCodes: requireStringArray(row, "linkedCodes", index),
    linkedStocks: requireLinkedStocks(row, index),
    industries: requireStringArray(row, "industries", index),
    tags: requireStringArray(row, "tags", index),
    viewCount: requireNumber(row, "viewCount", index),
    commentCount: requireNumber(row, "commentCount", index)
  };
}

function rustNewsStatsFromPayload(payload: unknown, mode: NewsFetchMode): NewsFetchStats {
  if (!isRecord(payload) || !isRecord(payload.stats)) {
    throw new Error("Rust news API returned invalid stats payload");
  }
  const stats = payload.stats;
  const statNumber = (key: keyof Omit<NewsFetchStats, "mode">) => {
    const value = stats[key];
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Rust news API returned invalid stats payload: ${key} must be a non-negative number`);
    }
    return parsed;
  };
  return {
    mode,
    scannedStocks: statNumber("scannedStocks"),
    requestCount: statNumber("requestCount"),
    returnedRows: statNumber("returnedRows"),
    validArticles: statNumber("validArticles")
  };
}

function newsArticlesFromPayload(payload: unknown): NewsArticle[] {
  if (!isRecord(payload)) throw new Error("Rust news API returned invalid payload: root must be an object");
  if (!Array.isArray(payload.articles)) throw new Error("Rust news API returned invalid payload: articles must be an array");
  return payload.articles.map(newsArticleFromPayloadRow);
}

function newsSourceDiagnosticsFromPayload(payload: unknown): NewsSourceDiagnostic[] {
  if (!isRecord(payload)) throw new Error("Rust news API returned invalid payload: root must be an object");
  const diagnostics = payload.sourceDiagnostics;
  if (diagnostics == null) return [];
  if (!Array.isArray(diagnostics)) {
    throw new Error("Rust news API returned invalid payload: sourceDiagnostics must be an array");
  }
  return diagnostics.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Rust news API returned invalid source diagnostic ${index}: row must be an object`);
    const context = `source diagnostic ${index}`;
    const sourceId = optionalString(item, "sourceId", context);
    const sourceName = optionalString(item, "sourceName", context);
    const provider = optionalString(item, "provider", context);
    if (!sourceId || !sourceName || !provider) {
      throw new Error(`Rust news API returned invalid source diagnostic ${index}: sourceId, sourceName and provider are required`);
    }
    return {
      sourceId,
      sourceName,
      provider,
      fallbackSource: optionalString(item, "fallbackSource", context),
      fallbackReason: optionalString(item, "fallbackReason", context)
    };
  });
}

async function responseErrorSuffix(response: Response) {
  const detail = await response.text().catch(() => "");
  const trimmed = detail.trim();
  return trimmed ? `: ${trimmed.slice(0, 300)}` : "";
}

async function responseJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Rust news API returned invalid JSON: ${errorMessage(error)}`);
  }
}

async function fetchRustNewsArticles(
  sources: NewsSourceEndpoint[],
  stocks: Stock[],
  fetchImpl: FetchLike,
  mode: NewsFetchMode
): Promise<NewsSourceFetchResult> {
  const response = await fetchImpl(RUST_NEWS_ARTICLES_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources, stocks, mode })
  });
  if (!response.ok) throw new Error(`Rust news API HTTP ${response.status}${await responseErrorSuffix(response)}`);
  const payload = await responseJson(response);
  const articles = newsArticlesFromPayload(payload);
  const sourceDiagnostics = newsSourceDiagnosticsFromPayload(payload);
  return {
    articles,
    sourceDiagnostics,
    stats: {
      ...rustNewsStatsFromPayload(payload, mode),
      validArticles: articles.length
    }
  };
}

function newsFallbackSourceLabel(source: string) {
  const normalized = source.trim().toLowerCase();
  if (normalized === "eastmoney") return "东方财富";
  return source;
}

function newsSourceDiagnosticsSummary(diagnostics: NewsSourceDiagnostic[]) {
  const fallbackDiagnostics = diagnostics.filter((diagnostic) => diagnostic.fallbackSource);
  if (!fallbackDiagnostics.length) return "";
  return fallbackDiagnostics
    .map((diagnostic) => {
      const target = newsFallbackSourceLabel(diagnostic.fallbackSource ?? "");
      const reason = diagnostic.fallbackReason ? `，原因：${diagnostic.fallbackReason}` : "";
      return `${diagnostic.sourceName || diagnostic.provider} 失败，Rust 已切换 ${target} 真实新闻源${reason}`;
    })
    .join("；");
}

export async function fetchNewsArticlesFromSources(
  sources: NewsSourceEndpoint[],
  stocks: Stock[],
  fetchImpl: FetchLike = fetch,
  options: NewsArticleFetchOptions = {}
): Promise<NewsArticleFetchResult> {
  const checkedAt = new Date().toISOString();
  const mode = options.mode ?? "fast";
  const realSources = sources.filter((source) => source.enabled && source.provider !== "本地舆情样本");
  if (!realSources.length) {
    return {
      ok: false,
      checkedAt,
      message: "新闻刷新失败",
      details: "未启用可用真实新闻源；请在设置中启用 GDELT 2.1、腾讯证券公告、NewsAPI 或自定义新闻接口",
      articles: [],
      sourceRows: 0,
      stats: emptyNewsFetchStats(mode),
      sourceDiagnostics: []
    };
  }

  try {
    const rustResult = await fetchRustNewsArticles(realSources, stocks, fetchImpl, mode);
    if (rustResult.articles.length) {
      const deduped = Array.from(new Map(rustResult.articles.map((article) => [article.id || article.url, article])).values()).sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
      const modeLabel = newsFetchModeOptions.find((option) => option.value === mode)?.label ?? "快速";
      const diagnosticsSummary = newsSourceDiagnosticsSummary(rustResult.sourceDiagnostics);
      return {
        ok: true,
        checkedAt,
        message: "新闻刷新完成",
        details: `已按${modeLabel}模式从 Rust 新闻接口拉取 ${deduped.length} 条真实新闻${diagnosticsSummary ? `；${diagnosticsSummary}` : ""}`,
        articles: deduped,
        sourceRows: deduped.length,
        stats: {
          ...rustResult.stats,
          validArticles: deduped.length
        },
        sourceDiagnostics: rustResult.sourceDiagnostics
      };
    }
    return {
      ok: false,
      checkedAt,
      message: "新闻刷新失败",
      details: "Rust 新闻接口未返回有效新闻；当前不再使用浏览器端采集解析",
      articles: [],
      sourceRows: 0,
      stats: rustResult.stats,
      sourceDiagnostics: rustResult.sourceDiagnostics
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      message: "新闻刷新失败",
      details: `Rust 新闻接口请求失败：${error instanceof Error ? error.message : "未知错误"}`,
      articles: [],
      sourceRows: 0,
      stats: emptyNewsFetchStats(mode),
      sourceDiagnostics: []
    };
  }
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

