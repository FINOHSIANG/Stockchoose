export interface CrawlSource {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiToken?: string;
  language?: string;
  maxItems?: number;
  query?: string;
}

export interface CrawlArticleRow {
  title: string;
  url: string;
  publishedAt?: string;
  source?: string;
  summary?: string;
  content?: string;
  imageUrl?: string;
  author?: string;
}

const domainLastRequestAt = new Map<string, number>();
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();

export class CrawlError extends Error {}

export function cacheGet<T>(key: string): T | undefined {
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function rateLimit(url: URL, minGapMs = 350) {
  const key = url.hostname;
  const last = domainLastRequestAt.get(key) ?? 0;
  const waitMs = Math.max(0, minGapMs - (Date.now() - last));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  domainLastRequestAt.set(key, Date.now());
}

export async function crawlerFetch(url: string | URL, init: RequestInit = {}, timeoutMs = 20000) {
  const target = typeof url === "string" ? new URL(url) : url;
  await rateLimit(target);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(target, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "StockChoose-BunCrawler/0.1 Mozilla/5.0",
        ...(init.headers ?? {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url: string | URL, init: RequestInit = {}, timeoutMs = 20000) {
  const response = await crawlerFetch(url, init, timeoutMs);
  if (!response.ok) throw new CrawlError(`upstream HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new CrawlError(`upstream returned invalid JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

export async function fetchText(url: string | URL, init: RequestInit = {}, timeoutMs = 20000) {
  const response = await crawlerFetch(url, init, timeoutMs);
  if (!response.ok) throw new CrawlError(`upstream HTTP ${response.status}`);
  return await response.text();
}

export function textBetween(input: string, open: string, close: string) {
  const start = input.indexOf(open);
  if (start < 0) return undefined;
  const contentStart = input.indexOf(">", start);
  if (contentStart < 0) return undefined;
  const end = input.indexOf(close, contentStart + 1);
  if (end < 0) return undefined;
  return decodeXml(input.slice(contentStart + 1, end).trim());
}

export function decodeXml(input: string) {
  return input
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

export function parseRssArticles(xml: string, maxItems = 20): CrawlArticleRow[] {
  const tag = xml.includes("<item") ? "item" : "entry";
  const close = `</${tag}>`;
  return xml
    .split(`<${tag}`)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf(close)))
    .filter((chunk) => chunk.length > 0)
    .slice(0, Math.max(1, maxItems))
    .map((item) => {
      const linkText = textBetween(item, "<link", "</link>");
      const href = item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
      return {
        title: textBetween(item, "<title", "</title>") ?? "",
        url: linkText || href || "",
        publishedAt: textBetween(item, "<pubDate", "</pubDate>") ?? textBetween(item, "<published", "</published>") ?? textBetween(item, "<updated", "</updated>"),
        summary: textBetween(item, "<description", "</description>") ?? textBetween(item, "<summary", "</summary>") ?? "",
        content: textBetween(item, "<content", "</content>") ?? "",
        source: domainFromUrl(linkText || href || "")
      };
    })
    .filter((row) => row.title && row.url);
}

export function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "crawler.news";
  }
}

