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

export const AKTOOLS_DEFAULT_BASE_URL = "/aktools/api/public";
const DIRECT_AKTOOLS_DEFAULT_BASE_URL = "http://127.0.0.1:18080/api/public";
const LEGACY_AKTOOLS_DEFAULT_BASE_URL = "http://127.0.0.1:8080/api/public";

export const infoSourceProviderOptions = [
  { label: AKSHARE_AKTOOLS_PROVIDER, value: AKSHARE_AKTOOLS_PROVIDER, defaultBaseUrl: AKTOOLS_DEFAULT_BASE_URL },
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
  timeoutSeconds: 15,
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

export function validateInfoSourceSettings(settings: InfoSourceSettings) {
  const errors: string[] = [];
  if (!settings.provider.trim()) errors.push("接口来源不能为空");
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

  if (isAkShareProvider(settings)) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(settings.timeoutSeconds, 3) * 1000);
    const baseUrl = settings.baseUrl.replace(/\/$/, "");
    const query = new URLSearchParams({
      symbol: "000001",
      period: "daily",
      start_date: "20240501",
      end_date: "20240531",
      adjust: "qfq"
    });
    try {
      const response = await fetchImpl(`${baseUrl}/stock_zh_a_hist?${query.toString()}`, {
        method: "GET",
        signal: controller.signal
      });
      if (!response.ok) {
        return { ok: false, checkedAt, message: "连接检测失败", details: `AKTools 返回 HTTP ${response.status}` };
      }
      const data = await response.json();
      const rows = Array.isArray(data) ? data.length : 0;
      if (!rows) {
        return { ok: false, checkedAt, message: "连接检测失败", details: "AKTools 已响应，但没有返回 A 股历史行情" };
      }
      return { ok: true, checkedAt, message: "连接检测通过", details: `AKShare/AKTools 已返回 ${rows} 条 A 股历史行情` };
    } catch (error) {
      const detail = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
      return { ok: false, checkedAt, message: "连接检测失败", details: detail };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(settings.timeoutSeconds, 3) * 1000);
  try {
    const response = await fetchImpl(`${settings.baseUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers: settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, checkedAt, message: "连接检测失败", details: `接口返回 HTTP ${response.status}` };
    }
    return { ok: true, checkedAt, message: "连接检测通过", details: "远程 /health 接口响应正常" };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, checkedAt, message: "连接检测失败", details: detail };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
