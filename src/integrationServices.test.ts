import { describe, expect, it, vi } from "vitest";
import {
  AKSHARE_AKTOOLS_PROVIDER,
  ASHAREHUB_DEFAULT_BASE_URL,
  ASHAREHUB_PROVIDER,
  AKTOOLS_DEFAULT_BASE_URL,
  defaultInfoSourceSettings,
  ensureInfoSourceSettings,
  testInfoSourceConnection,
  validateInfoSourceSettings
} from "./integrationServices";

describe("integrationServices", () => {
  it("migrates partial settings with default modules", () => {
    const settings = ensureInfoSourceSettings({ provider: "自定义 REST 接口", baseUrl: "https://example.com/api" });

    expect(settings.provider).toBe("自定义 REST 接口");
    expect(settings.baseUrl).toBe("https://example.com/api");
    expect(settings.modules.market).toBe(true);
    expect(settings.modules.finance).toBe(true);
  });

  it("rejects invalid endpoint and disabled modules", () => {
    const settings = ensureInfoSourceSettings({
      ...defaultInfoSourceSettings,
      baseUrl: "not-a-url",
      modules: { market: false, finance: false, filing: false, news: false }
    });

    expect(validateInfoSourceSettings(settings)).toEqual(expect.arrayContaining(["接口地址必须以 http://、https:// 或本地代理 / 开头", "至少启用一个数据模块"]));
  });

  it("accepts same-origin proxy endpoints", () => {
    const settings = ensureInfoSourceSettings({
      ...defaultInfoSourceSettings,
      baseUrl: "/aktools/api/public"
    });

    expect(validateInfoSourceSettings(settings)).toEqual([]);
  });

  it("uses AKShare/AKTools as the default real data provider", () => {
    expect(defaultInfoSourceSettings.provider).toBe(AKSHARE_AKTOOLS_PROVIDER);
    expect(defaultInfoSourceSettings.baseUrl).toBe(AKTOOLS_DEFAULT_BASE_URL);
  });

  it("requires an AShareHub API key and sends it through the Bun source test contract", async () => {
    const missingKey = ensureInfoSourceSettings({
      provider: ASHAREHUB_PROVIDER,
      baseUrl: ASHAREHUB_DEFAULT_BASE_URL,
      apiToken: ""
    });
    expect(validateInfoSourceSettings(missingKey)).toEqual(expect.arrayContaining(["AShareHub 需要填写 API Key"]));

    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", provider: ASHAREHUB_PROVIDER, ok: true, rowCount: 8, message: "连接检测通过", details: "market: AShareHub returned 3 rows; finance: AShareHub returned 5 rows" }), { status: 200 })
    );
    const settings = ensureInfoSourceSettings({
      provider: ASHAREHUB_PROVIDER,
      baseUrl: ASHAREHUB_DEFAULT_BASE_URL,
      apiToken: "ash_test"
    });

    const result = await testInfoSourceConnection(settings, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("AShareHub");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      provider: ASHAREHUB_PROVIDER,
      baseUrl: ASHAREHUB_DEFAULT_BASE_URL,
      apiToken: "ash_test"
    });
  });

  it("migrates the disabled local provider to AKShare/AKTools", () => {
    const settings = ensureInfoSourceSettings({ provider: "本地模拟数据", baseUrl: "http://127.0.0.1:9000/api" });

    expect(settings.provider).toBe(AKSHARE_AKTOOLS_PROVIDER);
    expect(settings.baseUrl).toBe(AKTOOLS_DEFAULT_BASE_URL);
  });

  it("migrates the legacy AKTools default port away from local port conflicts", () => {
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://127.0.0.1:8080/api/public"
    });

    expect(settings.baseUrl).toBe(AKTOOLS_DEFAULT_BASE_URL);
  });

  it("migrates the direct AKTools default URL to the app proxy", () => {
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://127.0.0.1:18080/api/public"
    });

    expect(settings.baseUrl).toBe(AKTOOLS_DEFAULT_BASE_URL);
  });

  it("checks the default real provider through a network contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", provider: AKSHARE_AKTOOLS_PROVIDER, ok: true, rowCount: 5, message: "连接检测通过", details: "Bun 原生数据接口已返回 5 条 A 股历史行情" }), { status: 200 })
    );
    const failureMock = vi.fn<typeof fetch>(async () => new Response("not found", { status: 404 }));
    const result = await testInfoSourceConnection(defaultInfoSourceSettings, failureMock);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("连接检测失败");

    const mocked = await testInfoSourceConnection(defaultInfoSourceSettings, fetchMock);
    expect(mocked.ok).toBe(true);
    expect(mocked.details).toContain("Bun 原生数据接口");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/integration/source-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: AKTOOLS_DEFAULT_BASE_URL
    });
  });

  it("checks an external AKShare AKTools provider through the Bun proxy contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", provider: AKSHARE_AKTOOLS_PROVIDER, ok: true, rowCount: 1, message: "连接检测通过", details: "AKShare/AKTools 已由 Bun 代理返回 1 条 A 股历史行情" }), { status: 200 })
    );
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://aktools.example/api/public"
    });

    const result = await testInfoSourceConnection(settings, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("AKShare/AKTools");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/integration/source-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://aktools.example/api/public"
    });
  });

  it("checks custom REST providers through the Bun source test endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ engine: "bun", provider: "自定义 REST 接口", ok: true, message: "连接检测通过", details: "远程 /health 接口已由 Bun 代理响应正常" }), { status: 200 })
    );
    const settings = ensureInfoSourceSettings({
      provider: "自定义 REST 接口",
      baseUrl: "https://data.example.com/v1",
      apiToken: "test-token"
    });

    const result = await testInfoSourceConnection(settings, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("Bun 代理");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/integration/source-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      provider: "自定义 REST 接口",
      baseUrl: "https://data.example.com/v1",
      apiToken: "test-token"
    });
  });

  it("reports invalid Bun info source JSON explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));

    const result = await testInfoSourceConnection(defaultInfoSourceSettings, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid JSON");
  });

  it("reports invalid Bun info source payloads explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ engine: "bun" }), { status: 200 }));

    const result = await testInfoSourceConnection(defaultInfoSourceSettings, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid payload");
  });
});
