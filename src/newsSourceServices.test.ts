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

    expect(settings.sources.length).toBeGreaterThan(1);
    expect(enabledNewsSources(settings).map((source) => source.provider)).toEqual(expect.arrayContaining(["本地舆情样本", "GDELT 2.1"]));
    expect(enabledNewsSources(settings).some((source) => source.provider === "腾讯证券公告")).toBe(false);
  });

  it("migrates legacy EastMoney news settings to a non-announcement source", () => {
    const settings = ensureNewsSourceSettings({
      sources: [
        {
          ...defaultNewsSourceSettings.sources[0],
          id: "news-eastmoney-finance",
          provider: "东方财富财经新闻" as never,
          baseUrl: "/eastmoney-news/comm/web/getNewsByColumns"
        }
      ]
    });

    expect(settings.sources[0].provider).toBe("GDELT 2.1");
    expect(settings.sources[0].baseUrl).toBe("/gdelt-news");
  });

  it("deduplicates persisted news source ids before rendering settings", () => {
    const duplicatedGdelt = defaultNewsSourceSettings.sources.find((source) => source.id === "news-gdelt-global")!;
    const settings = ensureNewsSourceSettings({
      sources: [...defaultNewsSourceSettings.sources, { ...duplicatedGdelt, name: "Duplicated GDELT" }]
    });
    const ids = settings.sources.map((source) => source.id);

    expect(ids.filter((id) => id === "news-gdelt-global")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("validates custom endpoint contracts", () => {
    const source = createDefaultNewsSourceEndpoint("news-test");
    const errors = validateNewsSourceEndpoint({ ...source, name: "", baseUrl: "ftp://example.com", refreshInterval: 0, maxItems: 0 });

    expect(errors).toEqual(
      expect.arrayContaining(["新闻源名称不能为空", "新闻源接口地址必须以 http://、https:// 或本地代理 / 开头", "刷新周期不能小于 1 分钟", "单次拉取数量不能小于 1"])
    );
  });

  it("checks the local news source without network access", async () => {
    const result = await testNewsSourceConnection(defaultNewsSourceSettings.sources[0]);

    expect(result.ok).toBe(true);
    expect(result.details).toContain("本地舆情样本可用");
  });

  it("does not test or enable Tencent notice sources", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, data: { data: [] } }), { status: 200 }));
    const source = {
      id: "news-tencent-notice",
      name: "腾讯证券公告",
      provider: "腾讯证券公告" as const,
      baseUrl: "/tencent-news/ifzqgtimg/appstock/news/noticeList/searchByType",
      apiToken: "",
      enabled: true,
      language: "zh-CN" as const,
      refreshInterval: 15,
      maxItems: 100,
      query: "A股 公告 新闻"
    };

    const settings = ensureNewsSourceSettings({ sources: [source] });
    const result = await testNewsSourceConnection(source, fetchMock);

    expect(settings.sources[0].provider).toBe("GDELT 2.1");
    expect(enabledNewsSources({ sources: [source] })).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("公告源已按产品规则停用");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks remote news source through the provider endpoint contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ articles: [] }), { status: 200 }));
    const gdeltSource = defaultNewsSourceSettings.sources.find((item) => item.provider === "GDELT 2.1");
    const source = ensureNewsSourceSettings({
      sources: [
        {
          ...gdeltSource!,
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
