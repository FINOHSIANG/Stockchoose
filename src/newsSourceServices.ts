export type NewsSourceProvider = "本地舆情样本" | "GDELT 2.1" | "NewsAPI" | "自定义 RSS" | "自定义 REST";
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
  { label: "本地舆情样本", value: "本地舆情样本", defaultBaseUrl: "local://sentiment-sample" },
  { label: "GDELT 2.1", value: "GDELT 2.1", defaultBaseUrl: "https://api.gdeltproject.org/api/v2" },
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
      id: "news-local-sample",
      name: "本地舆情样本",
      provider: "本地舆情样本",
      baseUrl: "local://sentiment-sample",
      apiToken: "",
      enabled: true,
      language: "zh-CN",
      refreshInterval: 15,
      maxItems: 50,
      query: "A股 OR 上市公司 OR 行业政策"
    },
    {
      id: "news-gdelt-global",
      name: "GDELT 全球新闻",
      provider: "GDELT 2.1",
      baseUrl: "https://api.gdeltproject.org/api/v2",
      apiToken: "",
      enabled: false,
      language: "zh-CN",
      refreshInterval: 30,
      maxItems: 100,
      query: "A股 OR 中国上市公司 OR 产业政策"
    }
  ]
};

export function defaultBaseUrlForNewsProvider(provider: NewsSourceProvider) {
  return newsSourceProviderOptions.find((item) => item.value === provider)?.defaultBaseUrl ?? "https://example.com/news";
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

export function ensureNewsSourceEndpoint(endpoint: Partial<NewsSourceEndpoint> | null | undefined, index = 0): NewsSourceEndpoint {
  const fallback = defaultNewsSourceSettings.sources[index] ?? createDefaultNewsSourceEndpoint(`news-source-${index + 1}`);
  const provider = (endpoint?.provider ?? fallback.provider) as NewsSourceProvider;
  return {
    ...fallback,
    ...(endpoint ?? {}),
    provider,
    baseUrl: endpoint?.baseUrl ?? fallback.baseUrl ?? defaultBaseUrlForNewsProvider(provider),
    enabled: endpoint?.enabled ?? fallback.enabled,
    refreshInterval: Number(endpoint?.refreshInterval ?? fallback.refreshInterval),
    maxItems: Number(endpoint?.maxItems ?? fallback.maxItems)
  };
}

export function ensureNewsSourceSettings(settings: Partial<NewsSourceSettings> | null | undefined): NewsSourceSettings {
  const rawSources = Array.isArray(settings?.sources) && settings?.sources.length ? settings.sources : defaultNewsSourceSettings.sources;
  return {
    ...defaultNewsSourceSettings,
    ...(settings ?? {}),
    sources: rawSources.map((source, index) => ensureNewsSourceEndpoint(source, index))
  };
}

export function enabledNewsSources(settings: NewsSourceSettings) {
  return settings.sources.filter((source) => source.enabled);
}

export function validateNewsSourceEndpoint(source: NewsSourceEndpoint) {
  const errors: string[] = [];
  if (!source.name.trim()) errors.push("新闻源名称不能为空");
  if (!source.provider.trim()) errors.push("新闻源类型不能为空");
  if (source.provider !== "本地舆情样本" && !/^https?:\/\/.+/i.test(source.baseUrl.trim())) {
    errors.push("新闻源接口地址必须以 http:// 或 https:// 开头");
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
      ok: true,
      checkedAt,
      message: "新闻源检测通过",
      details: "本地舆情样本可用，可直接参与事件雷达和舆情选股"
    };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(source.refreshInterval, 1) * 1000);
  const baseUrl = source.baseUrl.replace(/\/$/, "");
  const headers = source.apiToken ? { Authorization: `Bearer ${source.apiToken}` } : undefined;
  try {
    const url =
      source.provider === "GDELT 2.1"
        ? `${baseUrl}/doc/doc?query=${encodeURIComponent(source.query || "stock")}&mode=ArtList&format=json&maxrecords=1`
        : source.provider === "NewsAPI"
          ? `${baseUrl}/v2/everything?q=${encodeURIComponent(source.query || "stock")}&pageSize=1`
          : source.provider === "自定义 RSS"
            ? baseUrl
            : `${baseUrl}/health`;
    const response = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, checkedAt, message: "新闻源检测失败", details: `接口返回 HTTP ${response.status}` };
    }
    return { ok: true, checkedAt, message: "新闻源检测通过", details: `${source.name} 已响应，可作为新闻事件输入源` };
  } catch (error) {
    const details = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, checkedAt, message: "新闻源检测失败", details };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
