import type { Stock } from "../../src/types";
import type { CrawlArticleRow, CrawlSource } from "../crawler/engine";
import { cacheGet, cacheSet, domainFromUrl, fetchJson, fetchText, parseRssArticles } from "../crawler/engine";

export interface NewsSourceDiagnostic {
  sourceId: string;
  sourceName: string;
  provider: string;
  fallbackSource?: string;
  fallbackReason?: string;
}

const GDELT_DOC_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const EASTMONEY_NEWS_BASE = "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const nowIso = () => new Date().toISOString();
const unique = <T>(items: T[]) => Array.from(new Set(items.filter(Boolean)));

function normalizeGdeltQuery(query: string) {
  const text = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token.includes("-") && !token.includes('"') ? `"${token}"` : token))
    .join(" ")
    .trim();
  return text || "stock";
}

async function fetchGdeltRows(query: string, maxRecords: number) {
  const normalized = normalizeGdeltQuery(query);
  const cacheKey = `gdelt:${normalized}:${maxRecords}`;
  const cached = cacheGet<CrawlArticleRow[]>(cacheKey);
  if (cached) return cached;
  const url = new URL(GDELT_DOC_BASE);
  url.searchParams.set("query", normalized);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(clamp(maxRecords, 1, 250)));
  url.searchParams.set("sort", "HybridRel");
  const payload = await fetchJson(url, { headers: { "accept-encoding": "identity" } }, 30000);
  const rows = (((payload as any)?.articles ?? []) as Record<string, unknown>[]).map((row) => ({
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    publishedAt: String(row.seendate ?? ""),
    source: String(row.domain ?? "GDELT"),
    summary: String(row.extras ?? ""),
    content: ""
  })).filter((row) => row.title && row.url);
  if (!rows.length) throw new Error("GDELT returned no article rows");
  return cacheSet(cacheKey, rows, 90000);
}

export async function fetchEastmoneyNewsRows(maxRecords: number) {
  const url = new URL(EASTMONEY_NEWS_BASE);
  url.searchParams.set("client", "web");
  url.searchParams.set("biz", "web_news_col");
  url.searchParams.set("column", "353");
  url.searchParams.set("order", "1");
  url.searchParams.set("needInteractData", "0");
  url.searchParams.set("page_index", "1");
  url.searchParams.set("page_size", String(clamp(maxRecords, 1, 100)));
  url.searchParams.set("req_trace", "stockchoose-bun");
  const payload = await fetchJson(url, { headers: { referer: "https://finance.eastmoney.com/" } }, 20000);
  const rows = (((payload as any)?.data?.list ?? []) as Record<string, unknown>[]).map((row) => ({
    title: String(row.title ?? row.summary ?? ""),
    url: String(row.url ?? row.uniqueUrl ?? ""),
    publishedAt: String(row.showTime ?? ""),
    source: String(row.mediaName ?? "东方财富"),
    summary: String(row.summary ?? ""),
    content: String(row.digest ?? "")
  })).filter((row) => row.title && row.url);
  if (!rows.length) throw new Error("Eastmoney news returned no article rows");
  return rows;
}

async function fetchNewsApiRows(source: CrawlSource) {
  const base = source.baseUrl?.trim() || "https://newsapi.org";
  const url = new URL(base.endsWith("/v2/everything") ? base : `${base.replace(/\/$/, "")}/v2/everything`);
  url.searchParams.set("q", source.query?.trim() || "stock");
  url.searchParams.set("pageSize", String(clamp(source.maxItems ?? 20, 1, 100)));
  url.searchParams.set("sortBy", "publishedAt");
  if (source.language?.startsWith("zh")) url.searchParams.set("language", "zh");
  const payload = await fetchJson(url, {
    headers: source.apiToken ? { authorization: `Bearer ${source.apiToken}`, "x-api-key": source.apiToken } : undefined
  }, 20000);
  return articleRowsFromPayload(payload, source.name);
}

async function fetchCustomRestRows(source: CrawlSource) {
  const url = new URL(source.baseUrl);
  if (source.query?.trim()) url.searchParams.set("q", source.query.trim());
  url.searchParams.set("limit", String(clamp(source.maxItems ?? 20, 1, 250)));
  const payload = await fetchJson(url, {
    headers: source.apiToken ? { authorization: `Bearer ${source.apiToken}`, "x-api-key": source.apiToken } : undefined
  }, 20000);
  return articleRowsFromPayload(payload, source.name);
}

async function fetchRssRows(source: CrawlSource) {
  const xml = await fetchText(source.baseUrl, {
    headers: source.apiToken ? { authorization: `Bearer ${source.apiToken}` } : undefined
  }, 20000);
  const rows = parseRssArticles(xml, source.maxItems ?? 20);
  if (!rows.length) throw new Error("RSS returned no item/entry rows");
  return rows;
}

function articleRowsFromPayload(payload: unknown, sourceLabel: string): CrawlArticleRow[] {
  const root = payload as any;
  const rows = Array.isArray(root) ? root : root?.articles ?? root?.data ?? root?.items ?? root?.news ?? [];
  if (!Array.isArray(rows)) throw new Error(`${sourceLabel} article container must be an array`);
  return rows.map((row: any) => ({
    title: String(row.title ?? row.headline ?? row.name ?? ""),
    url: String(row.url ?? row.link ?? row.webUrl ?? row.guid ?? ""),
    publishedAt: String(row.seendate ?? row.publishedAt ?? row.pubDate ?? row.published ?? row.updated ?? row.date ?? ""),
    source: String(row.domain ?? row.sourceName ?? row.provider ?? row.source?.name ?? ""),
    summary: String(row.summary ?? row.description ?? ""),
    content: String(row.content ?? row.body ?? ""),
    imageUrl: String(row.urlToImage ?? row.imageUrl ?? row.image ?? ""),
    author: String(row.author ?? row.byline ?? "")
  })).filter((row) => row.title && row.url);
}

export async function fetchSourceRows(source: CrawlSource) {
  const provider = source.provider.toLowerCase();
  if (source.provider === "GDELT 2.1") return await fetchGdeltRows(source.query ?? "China A-shares stock market", source.maxItems ?? 20);
  if (source.provider === "NewsAPI") return await fetchNewsApiRows(source);
  if (source.provider.includes("RSS")) return await fetchRssRows(source);
  if (source.provider.includes("REST")) return await fetchCustomRestRows(source);
  if (provider.includes("eastmoney") || source.provider.includes("??????")) return await fetchEastmoneyNewsRows(source.maxItems ?? 20);
  throw new Error(`unsupported news provider: ${source.provider}`);
}

function classifyArticle(row: CrawlArticleRow) {
  const text = `${row.title} ${row.summary ?? ""} ${row.content ?? ""}`;
  if (/公告|披露|股东|回购|减持|增持/.test(text)) return "公司公告";
  if (/财报|利润|营收|业绩|亏损|增长/.test(text)) return "财报业绩";
  if (/政策|监管|证监|央行|发改委/.test(text)) return "宏观政策";
  if (/产业链|供应|订单|合同/.test(text)) return "产业链";
  if (/国际|美股|美元|欧洲|全球/.test(text)) return "国际财经";
  return "市场评论";
}

function sentimentOf(row: CrawlArticleRow) {
  const text = `${row.title} ${row.summary ?? ""} ${row.content ?? ""}`;
  if (/处罚|调查|亏损|违约|下跌|利空|风险|终止/.test(text)) return "利空";
  if (/增长|中标|回购|增持|突破|获批|利好|上涨/.test(text)) return "利好";
  return "中性";
}

function linkedStocks(row: CrawlArticleRow, stocks: Stock[]) {
  const text = `${row.title} ${row.summary ?? ""} ${row.content ?? ""}`;
  return stocks.filter((stock) => text.includes(stock.code) || (!!stock.name && text.includes(stock.name))).slice(0, 8);
}

export function normalizeNewsArticles(rows: CrawlArticleRow[], stocks: Stock[], sourceName = "Bun crawler") {
  const fetchedAt = nowIso();
  return rows.map((row, index) => {
    const linked = linkedStocks(row, stocks);
    const industries = unique(linked.flatMap((stock) => [stock.industry1, stock.industry2])).slice(0, 6);
    const category = classifyArticle(row);
    const sentiment = sentimentOf(row);
    return {
      id: `bun-news-${Math.abs(hash(`${row.url}-${index}`))}`,
      title: row.title,
      summary: row.summary || row.title,
      content: row.content || row.summary || row.title,
      source: row.source || sourceName || domainFromUrl(row.url),
      sourceIcon: "🧭",
      category,
      sentiment,
      importance: linked.length ? "重要" : "一般",
      status: "unread",
      publishedAt: row.publishedAt || fetchedAt,
      fetchedAt,
      url: row.url,
      imageUrl: row.imageUrl || "",
      author: row.author || "",
      readTime: Math.max(1, Math.ceil((row.content?.length || row.summary?.length || row.title.length) / 500)),
      linkedCodes: linked.map((stock) => stock.code),
      linkedStocks: linked.map((stock) => ({ code: stock.code, name: stock.name })),
      industries,
      tags: unique([category, sentiment, ...industries]).slice(0, 8),
      viewCount: 0,
      commentCount: 0
    };
  });
}

function hash(input: string) {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) value = (value * 31 + input.charCodeAt(index)) % 1000000007;
  return value;
}

export async function fetchNewsArticles(sources: CrawlSource[], stocks: Stock[], mode = "fast") {
  const activeSources = sources.filter((source) => source.provider && source.baseUrl !== "local://sample");
  const diagnostics: NewsSourceDiagnostic[] = [];
  const allRows: CrawlArticleRow[] = [];
  for (const source of activeSources.length ? activeSources : [{ id: "eastmoney", name: "东方财富真实新闻", provider: "东方财富", baseUrl: EASTMONEY_NEWS_BASE, maxItems: 20 }]) {
    try {
      const rows = await fetchSourceRows({ ...source, maxItems: source.maxItems ?? (mode === "full" ? 50 : mode === "standard" ? 30 : 12) });
      allRows.push(...rows);
    } catch (error) {
      if (source.provider === "GDELT 2.1") {
        const fallbackRows = await fetchEastmoneyNewsRows(source.maxItems ?? 20);
        allRows.push(...fallbackRows);
        diagnostics.push({
          sourceId: source.id,
          sourceName: source.name,
          provider: source.provider,
          fallbackSource: "eastmoney",
          fallbackReason: error instanceof Error ? error.message : String(error)
        });
      } else {
        throw error;
      }
    }
  }
  const deduped = Array.from(new Map(allRows.map((row) => [row.url, row])).values());
  const articles = normalizeNewsArticles(deduped, stocks);
  return {
    articles,
    stats: {
      mode,
      scannedStocks: stocks.length,
      requestCount: activeSources.length || 1,
      returnedRows: allRows.length,
      validArticles: articles.length
    },
    sourceDiagnostics: diagnostics
  };
}

