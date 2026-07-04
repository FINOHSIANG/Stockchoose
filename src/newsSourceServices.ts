export type NewsSourceProvider = "本地舆情样本" | "腾讯证券公告" | "GDELT 2.1" | "NewsAPI" | "自定义 RSS" | "自定义 REST";
export type NewsLanguage = "zh-CN" | "en-US" | "all";

export interface NewsSourceEndpoint {
  id: string;
  name: string;
  provider: NewsSourceProvider;
  baseUrl: string;
  apiToken: string;
  enabled: boolean;
  language: NewsLanguage;
  refreshInterval: number;
  maxItems: number;
  query: string;
  lastTestAt?: string;
  lastStatus?: string;
}

export interface NewsSourceSettings {
  sources: NewsSourceEndpoint[];
  lastSavedAt?: string;
}

export interface NewsSourceTestResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
}

export const newsSourceProviderOptions: Array<{ label: NewsSourceProvider; value: NewsSourceProvider; defaultBaseUrl: string }> = [
  { label: "GDELT 2.1", value: "GDELT 2.1", defaultBaseUrl: "/gdelt-news" },
  { label: "腾讯证券公告", value: "腾讯证券公告", defaultBaseUrl: "/api/filing/announcements" },
  { label: "NewsAPI", value: "NewsAPI", defaultBaseUrl: "https://newsapi.org" },
  { label: "自定义 RSS", value: "自定义 RSS", defaultBaseUrl: "https://example.com/rss.xml" },
  { label: "自定义 REST", value: "自定义 REST", defaultBaseUrl: "https://example.com/news" }
];

export const newsLanguageOptions: Array<{ label: string; value: NewsLanguage }> = [
  { label: "中文", value: "zh-CN" },
  { label: "英文", value: "en-US" },
  { label: "全部", value: "all" }
];

export const defaultNewsSourceSettings: NewsSourceSettings = {
  sources: [
    {
      id: "news-gdelt-global",
      name: "GDELT 全球新闻",
      provider: "GDELT 2.1",
      baseUrl: "/gdelt-news",
      apiToken: "",
      enabled: true,
      language: "zh-CN",
      refreshInterval: 30,
      maxItems: 100,
      query: "China stock market OR A-shares OR listed companies"
    },
    {
      id: "news-gdelt-international",
      name: "国际新闻接口",
      provider: "GDELT 2.1",
      baseUrl: "/gdelt-news",
      apiToken: "",
      enabled: true,
      language: "en-US",
      refreshInterval: 30,
      maxItems: 120,
      query: "global markets OR Federal Reserve OR oil prices OR exchange rates OR geopolitics"
    },
    {
      id: "news-gdelt-hot-events",
      name: "热点事件接口",
      provider: "GDELT 2.1",
      baseUrl: "/gdelt-news",
      apiToken: "",
      enabled: true,
      language: "all",
      refreshInterval: 15,
      maxItems: 120,
      query: "breaking news OR policy stimulus OR supply chain OR semiconductor OR AI OR new energy"
    }
  ]
};

export function defaultBaseUrlForNewsProvider(provider: NewsSourceProvider) {
  return newsSourceProviderOptions.find((item) => item.value === provider)?.defaultBaseUrl ?? "https://example.com/news";
}

export function isAnnouncementNewsSource(source: Partial<NewsSourceEndpoint> | null | undefined) {
  const provider = String(source?.provider ?? "");
  const baseUrl = String(source?.baseUrl ?? "");
  const name = String(source?.name ?? "");
  return provider === "腾讯证券公告" || baseUrl.includes("noticeList") || /公告/.test(name);
}

function isLocalSampleNewsSource(source: Partial<NewsSourceEndpoint> | null | undefined) {
  return String(source?.provider ?? "") === "本地舆情样本" || String(source?.baseUrl ?? "").startsWith("local://");
}

export function createDefaultNewsSourceEndpoint(id: string): NewsSourceEndpoint {
  return {
    id,
    name: "自定义新闻源",
    provider: "自定义 REST",
    baseUrl: defaultBaseUrlForNewsProvider("自定义 REST"),
    apiToken: "",
    enabled: true,
    language: "zh-CN",
    refreshInterval: 15,
    maxItems: 100,
    query: "A股 上市公司 行业政策"
  };
}

const BUN_NEWS_SOURCE_TEST_URL = "/api/news/source-test";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function responseJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Bun news source test API returned invalid JSON: ${errorMessage(error)}`);
  }
}

function newsSourceTestResultFromPayload(
  payload: unknown,
  source: NewsSourceEndpoint,
  checkedAt: string
): NewsSourceTestResult {
  if (!isRecord(payload) || typeof payload.ok !== "boolean") {
    return {
      ok: false,
      checkedAt,
      message: "新闻源检测失败",
      details: "Bun news source test API returned invalid payload: ok must be a boolean"
    };
  }
  return {
    ok: payload.ok,
    checkedAt,
    message: typeof payload.message === "string" && payload.message.trim()
      ? payload.message
      : payload.ok
        ? "新闻源检测通过"
        : "新闻源检测失败",
    details: typeof payload.details === "string" && payload.details.trim()
      ? payload.details
      : `${source.name} 已由 Bun 新闻采集器完成检测`
  };
}

export function ensureNewsSourceEndpoint(endpoint: Partial<NewsSourceEndpoint> | null | undefined, index = 0): NewsSourceEndpoint {
  const gdeltDefault = defaultNewsSourceSettings.sources.find((source) => source.provider === "GDELT 2.1") ?? defaultNewsSourceSettings.sources[0];
  const isLegacyEastMoney = String(endpoint?.provider ?? "") === "东方财富财经新闻" || endpoint?.id === "news-eastmoney-finance";
  const shouldMigrateToNews = isLegacyEastMoney || isLocalSampleNewsSource(endpoint);
  const fallback = shouldMigrateToNews ? gdeltDefault : defaultNewsSourceSettings.sources[index] ?? createDefaultNewsSourceEndpoint(`news-source-${index + 1}`);
  const rawProvider = shouldMigrateToNews ? fallback.provider : endpoint?.provider ?? fallback.provider;
  const provider = newsSourceProviderOptions.some((item) => item.value === rawProvider) ? rawProvider as NewsSourceProvider : fallback.provider;
  const migratedEndpoint = shouldMigrateToNews ? { id: fallback.id, name: fallback.name, provider: fallback.provider, baseUrl: fallback.baseUrl, query: fallback.query } : endpoint ?? {};
  const shouldUseGdeltProxy = provider === "GDELT 2.1" && (!migratedEndpoint?.baseUrl || migratedEndpoint.baseUrl === "https://api.gdeltproject.org/api/v2");
  return {
    ...fallback,
    ...migratedEndpoint,
    provider,
    baseUrl: shouldUseGdeltProxy ? defaultBaseUrlForNewsProvider("GDELT 2.1") : migratedEndpoint?.baseUrl ?? fallback.baseUrl ?? defaultBaseUrlForNewsProvider(provider),
    enabled: endpoint?.enabled ?? fallback.enabled,
    refreshInterval: Number(endpoint?.refreshInterval ?? fallback.refreshInterval),
    maxItems: Number(endpoint?.maxItems ?? fallback.maxItems)
  };
}

export function ensureNewsSourceSettings(settings: Partial<NewsSourceSettings> | null | undefined): NewsSourceSettings {
  const rawSources = Array.isArray(settings?.sources) && settings?.sources.length ? settings.sources : defaultNewsSourceSettings.sources;
  const seenSourceIds = new Set<string>();
  const normalizedSources = rawSources.map((source, index) => ensureNewsSourceEndpoint(source, index)).filter((source) => {
    if (seenSourceIds.has(source.id)) return false;
    seenSourceIds.add(source.id);
    return true;
  });
  const existingIds = new Set(normalizedSources.map((source) => source.id));
  const missingDefaults = defaultNewsSourceSettings.sources.filter((source) => !existingIds.has(source.id));
  const sourcesWithDefaults = [...normalizedSources, ...missingDefaults];
  const hasEnabledRemoteNewsSource = sourcesWithDefaults.some(
    (source) => source.enabled && source.provider !== "本地舆情样本"
  );
  const sources = hasEnabledRemoteNewsSource
    ? sourcesWithDefaults
    : sourcesWithDefaults.map((source) => (source.provider === "GDELT 2.1" ? { ...source, enabled: true } : source));
  return {
    ...defaultNewsSourceSettings,
    ...(settings ?? {}),
    sources
  };
}

export function enabledNewsSources(settings: NewsSourceSettings) {
  return settings.sources.filter((source) => source.enabled && !isLocalSampleNewsSource(source));
}

export function validateNewsSourceEndpoint(source: NewsSourceEndpoint) {
  const errors: string[] = [];
  if (!source.name.trim()) errors.push("新闻源名称不能为空");
  if (!source.provider.trim()) errors.push("新闻源类型不能为空");
  if (source.provider !== "本地舆情样本" && !/^https?:\/\/.+/i.test(source.baseUrl.trim()) && !source.baseUrl.trim().startsWith("/")) {
    errors.push("新闻源接口地址必须以 http://、https:// 或本地代理 / 开头");
  }
  if (!Number.isFinite(source.refreshInterval) || source.refreshInterval < 1) errors.push("刷新周期不能小于 1 分钟");
  if (!Number.isFinite(source.maxItems) || source.maxItems < 1) errors.push("单次拉取数量不能小于 1");
  return errors;
}

export async function testNewsSourceConnection(
  source: NewsSourceEndpoint,
  fetchImpl: typeof fetch = fetch
): Promise<NewsSourceTestResult> {
  const checkedAt = new Date().toISOString();
  const errors = validateNewsSourceEndpoint(source);
  if (errors.length) {
    return { ok: false, checkedAt, message: "新闻源检测失败", details: errors.join("；") };
  }

  if (source.provider === "本地舆情样本") {
    return {
      ok: false,
      checkedAt,
      message: "新闻源检测失败",
      details: "本地舆情样本已清空，请启用真实新闻源"
    };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(source.refreshInterval, 1) * 1000);
  try {
    const response = await fetchImpl(BUN_NEWS_SOURCE_TEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, checkedAt, message: "新闻源检测失败", details: `Bun 新闻采集器返回 HTTP ${response.status}` };
    }
    const payload = await responseJson(response) as Partial<NewsSourceTestResult> & { rowCount?: number; engine?: string; provider?: string };
    if (!isRecord(payload) || typeof payload.ok !== "boolean") {
      return newsSourceTestResultFromPayload(payload, source, checkedAt);
    }
    return {
      ok: payload.ok,
      checkedAt,
      message: payload.message ?? (payload.ok ? "新闻源检测通过" : "新闻源检测失败"),
      details: payload.details ?? `${source.name} 已由 Bun 新闻采集器响应`
    };
  } catch (error) {
    const details = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, checkedAt, message: "新闻源检测失败", details };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
