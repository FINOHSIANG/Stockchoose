import { describe, expect, it, vi } from "vitest";
import {
  defaultNewsAnalysisModelSettings,
  enabledNewsAnalysisTasks,
  ensureNewsAnalysisModelSettings,
  testNewsAnalysisModelConnection,
  validateNewsAnalysisModelSettings
} from "./newsAnalysisModelServices";

describe("newsAnalysisModelServices", () => {
  it("migrates missing settings with local model defaults", () => {
    const settings = ensureNewsAnalysisModelSettings(null);

    expect(settings.provider).toBe("本地规则模型");
    expect(settings.model).toBe("local-news-rule-v1");
    expect(enabledNewsAnalysisTasks(settings).length).toBe(4);
  });

  it("validates remote model interface settings", () => {
    const settings = ensureNewsAnalysisModelSettings({
      provider: "OpenAI Compatible",
      baseUrl: "ftp://example.com",
      apiKey: "",
      model: "",
      timeoutSeconds: 1,
      maxTokens: 100,
      temperature: 2,
      systemPrompt: "",
      tasks: {
        sentiment: false,
        eventExtraction: false,
        stockMapping: false,
        riskSummary: false
      }
    });

    const errors = validateNewsAnalysisModelSettings(settings);

    expect(errors).toEqual(
      expect.arrayContaining([
        "模型名称不能为空",
        "模型接口地址必须以 http:// 或 https:// 开头",
        "远程模型必须填写 API Key",
        "至少启用一个新闻分析任务",
        "超时时间不能小于 3 秒",
        "最大输出 Token 不能小于 256",
        "温度参数必须在 0 到 1 之间",
        "系统提示词不能为空"
      ])
    );
  });

  it("checks the local analysis model through the Bun model test endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", ok: true, provider: "本地规则模型", model: "local-news-rule-v1", message: "分析模型检测通过", details: "Bun 本地新闻规则模型已启用 4 个分析任务" }), { status: 200 })
    );

    const result = await testNewsAnalysisModelConnection(defaultNewsAnalysisModelSettings, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("Bun 本地新闻规则模型");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news-analysis/model-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      provider: "本地规则模型",
      model: "local-news-rule-v1",
      tasks: ["sentiment", "eventExtraction", "stockMapping", "riskSummary"]
    });
  });

  it("checks OpenAI-compatible models through the Bun model test endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", ok: true, message: "分析模型检测通过", details: "OpenAI Compatible / news-model 已由 Bun 代理完成响应" }), { status: 200 })
    );
    const settings = ensureNewsAnalysisModelSettings({
      provider: "OpenAI Compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "news-model"
    });

    const result = await testNewsAnalysisModelConnection(settings, fetchMock);

    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news-analysis/model-test");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      provider: "OpenAI Compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "news-model"
    });
  });

  it("reports invalid Bun analysis model JSON explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));

    const result = await testNewsAnalysisModelConnection(defaultNewsAnalysisModelSettings, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid JSON");
  });

  it("reports invalid Bun analysis model payloads explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ engine: "bun" }), { status: 200 }));

    const result = await testNewsAnalysisModelConnection(defaultNewsAnalysisModelSettings, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid payload");
  });
});
