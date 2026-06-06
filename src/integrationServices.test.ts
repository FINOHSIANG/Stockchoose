import { describe, expect, it, vi } from "vitest";
import {
  AKSHARE_AKTOOLS_PROVIDER,
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
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ 日期: "2024-05-06", 收盘: 10.12 }]), { status: 200 }));
    const failureMock = vi.fn<typeof fetch>(async () => new Response("not found", { status: 404 }));
    const result = await testInfoSourceConnection(defaultInfoSourceSettings, failureMock);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("连接检测失败");

    const mocked = await testInfoSourceConnection(defaultInfoSourceSettings, fetchMock);
    expect(mocked.ok).toBe(true);
    expect(mocked.details).toContain("AKShare/AKTools");
  });

  it("checks the AKShare AKTools provider through a real endpoint contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ 日期: "2024-05-06", 收盘: 10.12 }]), { status: 200 }));
    const settings = ensureInfoSourceSettings({
      provider: AKSHARE_AKTOOLS_PROVIDER,
      baseUrl: "http://127.0.0.1:8080/api/public"
    });

    const result = await testInfoSourceConnection(settings, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("AKShare/AKTools");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/stock_zh_a_hist?");
  });
});
