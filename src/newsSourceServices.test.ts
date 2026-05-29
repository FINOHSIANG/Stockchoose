import { describe, expect, it, vi } from "vitest";
import {
  createDefaultNewsSourceEndpoint,
  defaultNewsSourceSettings,
  enabledNewsSources,
  ensureNewsSourceSettings,
  testNewsSourceConnection,
  validateNewsSourceEndpoint
} from "./newsSourceServices";

describe("newsSourceServices", () => {
  it("migrates missing news source settings with defaults", () => {
    const settings = ensureNewsSourceSettings(null);

    expect(settings.sources.length).toBeGreaterThan(0);
    expect(enabledNewsSources(settings)[0].provider).toBe("本地舆情样本");
  });

  it("validates custom endpoint contracts", () => {
    const source = createDefaultNewsSourceEndpoint("news-test");
    const errors = validateNewsSourceEndpoint({ ...source, name: "", baseUrl: "ftp://example.com", refreshInterval: 0, maxItems: 0 });

    expect(errors).toEqual(
      expect.arrayContaining(["新闻源名称不能为空", "新闻源接口地址必须以 http:// 或 https:// 开头", "刷新周期不能小于 1 分钟", "单次拉取数量不能小于 1"])
    );
  });

  it("checks the local news source without network access", async () => {
    const result = await testNewsSourceConnection(defaultNewsSourceSettings.sources[0]);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("本地舆情样本可用");
  });

  it("checks remote news source through the provider endpoint contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ articles: [] }), { status: 200 }));
    const source = ensureNewsSourceSettings({
      sources: [
        {
          ...defaultNewsSourceSettings.sources[1],
          enabled: true,
          query: "A股"
        }
      ]
    }).sources[0];

    const result = await testNewsSourceConnection(source, fetchMock);

    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/doc/doc?");
  });
});
