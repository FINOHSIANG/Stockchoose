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

const domainNextRequestAt = new Map<string, number>();
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightCache = new Map<string, Promise<unknown>>();
const MAX_MEMORY_CACHE_ENTRIES = 500;
const CACHE_SWEEP_INTERVAL_MS = 60000;
let lastCacheSweepAt = 0;

export class CrawlError extends Error {}

function sweepMemoryCache(now = Date.now()) {
  if (now - lastCacheSweepAt < CACHE_SWEEP_INTERVAL_MS && memoryCache.size <= MAX_MEMORY_CACHE_ENTRIES) return;
  lastCacheSweepAt = now;
  for (const [key, entry] of memoryCache) {
    if (now > entry.expiresAt) memoryCache.delete(key);
  }
  while (memoryCache.size > MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  sweepMemoryCache();
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  sweepMemoryCache();
  memoryCache.delete(key);
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  sweepMemoryCache();
  return value;
}

export async function cacheGetOrCreate<T>(key: string, ttlMs: number | ((value: T) => number), loader: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const active = inFlightCache.get(key) as Promise<T> | undefined;
  if (active) return active;

  const request = loader()
    .then((value) => cacheSet(key, value, typeof ttlMs === "function" ? ttlMs(value) : ttlMs))
    .finally(() => {
      if (inFlightCache.get(key) === request) inFlightCache.delete(key);
    });
  inFlightCache.set(key, request);
  return request;
}

export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function waitForRateLimit(waitMs: number, signal: AbortSignal) {
  if (waitMs <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(Object.assign(new Error("request aborted while rate-limited"), { name: "AbortError" }));
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, waitMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(Object.assign(new Error("request aborted while rate-limited"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function rateLimit(url: URL, minGapMs: number, signal: AbortSignal) {
  const key = url.hostname;
  const now = Date.now();
  const scheduledAt = Math.max(now, domainNextRequestAt.get(key) ?? 0);
  domainNextRequestAt.set(key, scheduledAt + Math.max(0, minGapMs));
  const waitMs = Math.max(0, scheduledAt - now);
  await waitForRateLimit(waitMs, signal);
}

export async function crawlerFetch(url: string | URL, init: RequestInit = {}, timeoutMs = 20000, minGapMs = 350) {
  const target = typeof url === "string" ? new URL(url) : url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  try {
    await rateLimit(target, minGapMs, controller.signal);
    const response = await fetch(target, {
      ...init,
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "StockChoose-BunCrawler/0.1 Mozilla/5.0",
        ...(init.headers ?? {})
      }
    });
    if (!response.body) return response;
    // 超时覆盖响应体读取，避免上游只发 headers 就让整个同步永久等待。
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const maxBytes = 64 * 1024 * 1024;
    const abortReader = () => { void reader.cancel(controller.signal.reason).catch(() => undefined); };
    controller.signal.addEventListener("abort", abortReader, { once: true });
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new CrawlError("upstream response exceeds 64 MiB");
        }
        chunks.push(value);
      }
    } finally {
      controller.signal.removeEventListener("abort", abortReader);
      reader.releaseLock();
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export async function fetchJson(url: string | URL, init: RequestInit = {}, timeoutMs = 20000, minGapMs = 350) {
  const response = await crawlerFetch(url, init, timeoutMs, minGapMs);
  if (!response.ok) throw new CrawlError(`upstream HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new CrawlError(`upstream returned invalid JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

export async function fetchText(url: string | URL, init: RequestInit = {}, timeoutMs = 20000, minGapMs = 350) {
  const response = await crawlerFetch(url, init, timeoutMs, minGapMs);
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
