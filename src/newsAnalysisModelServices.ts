export type NewsAnalysisModelProvider = "本地规则模型" | "OpenAI Compatible" | "DeepSeek" | "通义千问" | "智谱 GLM" | "自定义 REST";
export type NewsAnalysisDepth = "快速摘要" | "标准分析" | "深度推理";
export type NewsAnalysisTaskKey = "sentiment" | "eventExtraction" | "stockMapping" | "riskSummary";

export interface NewsAnalysisModelSettings {
  enabled: boolean;
  provider: NewsAnalysisModelProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  maxTokens: number;
  temperature: number;
  depth: NewsAnalysisDepth;
  tasks: Record<NewsAnalysisTaskKey, boolean>;
  systemPrompt: string;
  lastTestAt?: string;
  lastSavedAt?: string;
}

export interface NewsAnalysisModelTestResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
}

export const newsAnalysisModelProviderOptions: Array<{
  label: NewsAnalysisModelProvider;
  value: NewsAnalysisModelProvider;
  defaultBaseUrl: string;
  defaultModel: string;
}> = [
  { label: "本地规则模型", value: "本地规则模型", defaultBaseUrl: "local://news-rule-engine", defaultModel: "local-news-rule-v1" },
  { label: "OpenAI Compatible", value: "OpenAI Compatible", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { label: "DeepSeek", value: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { label: "通义千问", value: "通义千问", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
  { label: "智谱 GLM", value: "智谱 GLM", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" },
  { label: "自定义 REST", value: "自定义 REST", defaultBaseUrl: "https://api.example.com/v1", defaultModel: "news-analysis-model" }
];

export const newsAnalysisDepthOptions: NewsAnalysisDepth[] = ["快速摘要", "标准分析", "深度推理"];

export const newsAnalysisTaskLabels: Array<{ key: NewsAnalysisTaskKey; label: string; description: string }> = [
  { key: "sentiment", label: "情绪方向识别", description: "判断新闻对市场、行业和个股的利好、利空或中性影响。" },
  { key: "eventExtraction", label: "事件要素抽取", description: "提取政策、订单、业绩、并购、风险等结构化事件标签。" },
  { key: "stockMapping", label: "关联股票映射", description: "根据正文、行业和产业链关系识别潜在关联标的。" },
  { key: "riskSummary", label: "风险摘要生成", description: "输出可读的影响路径、风险点和后续跟踪指标。" }
];

export const defaultNewsAnalysisSystemPrompt =
  "你是A股新闻信息分析模型。请严格区分事实、推断和投资观点，输出情绪方向、事件类型、关联行业、关联股票、影响期限和风险提示。";

export const defaultNewsAnalysisModelSettings: NewsAnalysisModelSettings = {
  enabled: true,
  provider: "本地规则模型",
  baseUrl: "local://news-rule-engine",
  apiKey: "",
  model: "local-news-rule-v1",
  timeoutSeconds: 20,
  maxTokens: 1200,
  temperature: 0.2,
  depth: "标准分析",
  tasks: {
    sentiment: true,
    eventExtraction: true,
    stockMapping: true,
    riskSummary: true
  },
  systemPrompt: defaultNewsAnalysisSystemPrompt
};

export function defaultBaseUrlForNewsAnalysisProvider(provider: NewsAnalysisModelProvider) {
  return newsAnalysisModelProviderOptions.find((item) => item.value === provider)?.defaultBaseUrl ?? "https://api.example.com/v1";
}

export function defaultModelForNewsAnalysisProvider(provider: NewsAnalysisModelProvider) {
  return newsAnalysisModelProviderOptions.find((item) => item.value === provider)?.defaultModel ?? "news-analysis-model";
}

export function ensureNewsAnalysisModelSettings(
  settings: Partial<NewsAnalysisModelSettings> | null | undefined
): NewsAnalysisModelSettings {
  const provider = (settings?.provider ?? defaultNewsAnalysisModelSettings.provider) as NewsAnalysisModelProvider;
  return {
    ...defaultNewsAnalysisModelSettings,
    ...(settings ?? {}),
    provider,
    baseUrl: settings?.baseUrl ?? defaultBaseUrlForNewsAnalysisProvider(provider),
    model: settings?.model ?? defaultModelForNewsAnalysisProvider(provider),
    timeoutSeconds: Number(settings?.timeoutSeconds ?? defaultNewsAnalysisModelSettings.timeoutSeconds),
    maxTokens: Number(settings?.maxTokens ?? defaultNewsAnalysisModelSettings.maxTokens),
    temperature: Number(settings?.temperature ?? defaultNewsAnalysisModelSettings.temperature),
    tasks: {
      ...defaultNewsAnalysisModelSettings.tasks,
      ...(settings?.tasks ?? {})
    },
    systemPrompt: settings?.systemPrompt ?? defaultNewsAnalysisSystemPrompt
  };
}

export function enabledNewsAnalysisTasks(settings: NewsAnalysisModelSettings) {
  return newsAnalysisTaskLabels.filter((item) => settings.tasks[item.key]);
}

export function validateNewsAnalysisModelSettings(settings: NewsAnalysisModelSettings) {
  const errors: string[] = [];
  if (!settings.provider.trim()) errors.push("分析模型来源不能为空");
  if (!settings.model.trim()) errors.push("模型名称不能为空");
  if (settings.provider !== "本地规则模型" && !/^https?:\/\/.+/i.test(settings.baseUrl.trim())) {
    errors.push("模型接口地址必须以 http:// 或 https:// 开头");
  }
  if (settings.provider !== "本地规则模型" && !settings.apiKey.trim()) {
    errors.push("远程模型必须填写 API Key");
  }
  if (!enabledNewsAnalysisTasks(settings).length) errors.push("至少启用一个新闻分析任务");
  if (!Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds < 3) errors.push("超时时间不能小于 3 秒");
  if (!Number.isFinite(settings.maxTokens) || settings.maxTokens < 256) errors.push("最大输出 Token 不能小于 256");
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 1) errors.push("温度参数必须在 0 到 1 之间");
  if (!settings.systemPrompt.trim()) errors.push("系统提示词不能为空");
  return errors;
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export async function testNewsAnalysisModelConnection(
  settings: NewsAnalysisModelSettings,
  fetchImpl: typeof fetch = fetch
): Promise<NewsAnalysisModelTestResult> {
  const checkedAt = new Date().toISOString();
  const safeSettings = ensureNewsAnalysisModelSettings(settings);
  const errors = validateNewsAnalysisModelSettings(safeSettings);
  if (errors.length) {
    return { ok: false, checkedAt, message: "分析模型检测失败", details: errors.join("；") };
  }

  if (safeSettings.provider === "本地规则模型") {
    return {
      ok: true,
      checkedAt,
      message: "分析模型检测通过",
      details: `本地规则模型可用，已启用 ${enabledNewsAnalysisTasks(safeSettings).length} 个新闻分析任务`
    };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(safeSettings.timeoutSeconds, 3) * 1000);
  try {
    const response = await fetchImpl(chatCompletionsUrl(safeSettings.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${safeSettings.apiKey}`
      },
      body: JSON.stringify({
        model: safeSettings.model,
        temperature: safeSettings.temperature,
        max_tokens: Math.min(safeSettings.maxTokens, 256),
        messages: [
          { role: "system", content: safeSettings.systemPrompt },
          { role: "user", content: "连接测试：请只返回 JSON，字段 ok=true。" }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, checkedAt, message: "分析模型检测失败", details: `模型接口返回 HTTP ${response.status}` };
    }
    return {
      ok: true,
      checkedAt,
      message: "分析模型检测通过",
      details: `${safeSettings.provider} / ${safeSettings.model} 已响应，可用于新闻情绪、事件和关联股票分析`
    };
  } catch (error) {
    const details = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, checkedAt, message: "分析模型检测失败", details };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
