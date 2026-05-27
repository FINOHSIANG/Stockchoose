import { describe, expect, it, vi } from "vitest";
import {
  AKSHARE_AKTOOLS_PROVIDER,
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

    expect(validateInfoSourceSettings(settings)).toEqual(expect.arrayContaining(["接口地址必须以 http:// 或 https:// 开头", "至少启用一个数据模块"]));
  });

  it("checks the built-in local provider without network access", async () => {
    const result = await testInfoSourceConnection(defaultInfoSourceSettings);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("连接检测通过");
    expect(result.details).toContain("本地样本数据可用");
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
