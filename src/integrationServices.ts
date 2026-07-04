export type SourceModuleKey = "market" | "finance" | "filing" | "news";

export interface InfoSourceSettings {
  provider: string;
  baseUrl: string;
  apiToken: string;
  timeoutSeconds: number;
  refreshInterval: number;
  modules: Record<SourceModuleKey, boolean>;
  lastTestAt?: string;
  lastSavedAt?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  details: string;
}

export const LOCAL_SAMPLE_PROVIDER = "本地模拟数据";
export const AKSHARE_AKTOOLS_PROVIDER = "AKShare / AKTools 免费开源数据";
export const ASHAREHUB_PROVIDER = "AShareHub";

export const AKTOOLS_DEFAULT_BASE_URL = "/aktools/api/public";
export const ASHAREHUB_DEFAULT_BASE_URL = "https://asharehub.com";
const DIRECT_AKTOOLS_DEFAULT_BASE_URL = "http://127.0.0.1:18080/api/public";
const LEGACY_AKTOOLS_DEFAULT_BASE_URL = "http://127.0.0.1:8080/api/public";
const BUN_INFO_SOURCE_TEST_URL = "/api/integration/source-test";

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
    throw new Error(`Bun info source test API returned invalid JSON: ${errorMessage(error)}`);
  }
}

function invalidInfoSourcePayloadResult(checkedAt: string): ConnectionTestResult {
  return {
    ok: false,
    checkedAt,
    message: "连接检测失败",
    details: "Bun info source test API returned invalid payload: ok must be a boolean"
  };
}

export const infoSourceProviderOptions = [
  { label: AKSHARE_AKTOOLS_PROVIDER, value: AKSHARE_AKTOOLS_PROVIDER, defaultBaseUrl: AKTOOLS_DEFAULT_BASE_URL },
  { label: ASHAREHUB_PROVIDER, value: ASHAREHUB_PROVIDER, defaultBaseUrl: ASHAREHUB_DEFAULT_BASE_URL },
  { label: "聚宽 JQData", value: "聚宽 JQData", defaultBaseUrl: "https://api.example.com/jqdata" },
  { label: "Tushare Pro", value: "Tushare Pro", defaultBaseUrl: "https://api.example.com/tushare" },
  { label: "Wind 数据服务", value: "Wind 数据服务", defaultBaseUrl: "https://api.example.com/wind" },
  { label: "自定义 REST 接口", value: "自定义 REST 接口", defaultBaseUrl: "https://api.example.com/v1" }
] as const;

export const sourceModuleLabels: Array<{ key: SourceModuleKey; label: string; description: string }> = [
  { key: "market", label: "行情数据接口", description: "股票价格、成交额、换手率、分钟行情。" },
  { key: "finance", label: "财务指标接口", description: "财报条目、估值、盈利质量、成长指标。" },
  { key: "filing", label: "公告研报接口", description: "上市公司公告、定期报告、分析师评级。" },
  { key: "news", label: "资讯舆情接口", description: "新闻、资金流、主题热度与事件标签。" }
];

export const defaultInfoSourceSettings: InfoSourceSettings = {
  provider: AKSHARE_AKTOOLS_PROVIDER,
  baseUrl: AKTOOLS_DEFAULT_BASE_URL,
  apiToken: "",
  timeoutSeconds: 60,
  refreshInterval: 5,
  modules: {
    market: true,
    finance: true,
    filing: false,
    news: false
  }
};

export function ensureInfoSourceSettings(settings: Partial<InfoSourceSettings> | null | undefined): InfoSourceSettings {
  const migratedSettings =
    !settings || settings.provider === LOCAL_SAMPLE_PROVIDER
      ? defaultInfoSourceSettings
      : settings;
  const mergedSettings = {
    ...defaultInfoSourceSettings,
    ...migratedSettings
  };
  const shouldUseCurrentAkToolsBaseUrl =
    mergedSettings.provider === AKSHARE_AKTOOLS_PROVIDER &&
    (!mergedSettings.baseUrl ||
      mergedSettings.baseUrl === DIRECT_AKTOOLS_DEFAULT_BASE_URL ||
      mergedSettings.baseUrl === LEGACY_AKTOOLS_DEFAULT_BASE_URL);
  return {
    ...mergedSettings,
    baseUrl: shouldUseCurrentAkToolsBaseUrl ? AKTOOLS_DEFAULT_BASE_URL : mergedSettings.baseUrl,
    modules: {
      ...defaultInfoSourceSettings.modules,
      ...(migratedSettings?.modules ?? {})
    }
  };
}

export function enabledSourceModules(settings: InfoSourceSettings) {
  return sourceModuleLabels.filter((item) => settings.modules[item.key]);
}

export function defaultBaseUrlForProvider(provider: string) {
  return infoSourceProviderOptions.find((item) => item.value === provider)?.defaultBaseUrl ?? "https://api.example.com/v1";
}

export function isLocalProvider(settings: InfoSourceSettings) {
  return settings.provider === LOCAL_SAMPLE_PROVIDER;
}

export function isAkShareProvider(settings: InfoSourceSettings) {
  return settings.provider === AKSHARE_AKTOOLS_PROVIDER;
}

export function isAshareHubProvider(settings: InfoSourceSettings) {
  return settings.provider === ASHAREHUB_PROVIDER;
}

export function validateInfoSourceSettings(settings: InfoSourceSettings) {
  const errors: string[] = [];
  if (!settings.provider.trim()) errors.push("接口来源不能为空");
  if (settings.provider === ASHAREHUB_PROVIDER && !settings.apiToken.trim()) errors.push("AShareHub 需要填写 API Key");
  if (!/^https?:\/\/.+/i.test(settings.baseUrl.trim()) && !settings.baseUrl.trim().startsWith("/")) {
    errors.push("接口地址必须以 http://、https:// 或本地代理 / 开头");
  }
  if (!enabledSourceModules(settings).length) errors.push("至少启用一个数据模块");
  if (!Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds < 3) errors.push("超时时间不能小于 3 秒");
  if (!Number.isFinite(settings.refreshInterval) || settings.refreshInterval < 1) errors.push("刷新周期不能小于 1 分钟");
  return errors;
}

export async function testInfoSourceConnection(
  settings: InfoSourceSettings,
  fetchImpl: typeof fetch = fetch
): Promise<ConnectionTestResult> {
  const checkedAt = new Date().toISOString();
  const errors = validateInfoSourceSettings(settings);
  if (errors.length) {
    return { ok: false, checkedAt, message: "连接检测失败", details: errors.join("；") };
  }

  if (isLocalProvider(settings)) {
    return {
      ok: false,
      checkedAt,
      message: "连接检测失败",
      details: "本地模拟数据已停用，请接入 AKShare/AKTools 或真实数据接口"
    };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(settings.timeoutSeconds, 3) * 1000);
  try {
    const response = await fetchImpl(BUN_INFO_SOURCE_TEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, checkedAt, message: "连接检测失败", details: `Bun 信息源代理返回 HTTP ${response.status}` };
    }
    const payload = await responseJson(response) as Partial<ConnectionTestResult> & { engine?: string; provider?: string; rowCount?: number };
    if (!isRecord(payload) || typeof payload.ok !== "boolean") {
      return invalidInfoSourcePayloadResult(checkedAt);
    }
    return {
      ok: payload.ok,
      checkedAt,
      message: payload.message ?? (payload.ok ? "连接检测通过" : "连接检测失败"),
      details: payload.details ?? "Bun 信息源代理未返回检测详情"
    };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, checkedAt, message: "连接检测失败", details: detail };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
