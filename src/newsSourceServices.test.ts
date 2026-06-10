import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultNewsSourceEndpoint,
  defaultNewsSourceSettings,
  enabledNewsSources,
  ensureNewsSourceSettings,
  testNewsSourceConnection,
  validateNewsSourceEndpoint
} from "./newsSourceServices";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newsSourceServices", () => {
  it("migrates missing news source settings with defaults", () => {
    const settings = ensureNewsSourceSettings(null);

    expect(settings.sources.length).toBeGreaterThanOrEqual(3);
    expect(enabledNewsSources(settings).map((source) => source.provider)).toEqual(expect.arrayContaining(["GDELT 2.1"]));
    expect(enabledNewsSources(settings).map((source) => source.name)).toEqual(
      expect.arrayContaining(["GDELT 全球新闻", "国际新闻接口", "热点事件接口"])
    );
    expect(enabledNewsSources(settings).some((source) => source.provider === "本地舆情样本")).toBe(false);
    expect(enabledNewsSources(settings).some((source) => source.provider === "腾讯证券公告")).toBe(false);
  });

  it("adds international news and hot event interfaces to persisted legacy settings", () => {
    const settings = ensureNewsSourceSettings({
      sources: [
        {
          ...defaultNewsSourceSettings.sources[0],
          enabled: true
        }
      ]
    });

    expect(settings.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(["news-gdelt-global", "news-gdelt-international", "news-gdelt-hot-events"])
    );
    expect(enabledNewsSources(settings).map((source) => source.name)).toEqual(
      expect.arrayContaining(["国际新闻接口", "热点事件接口"])
    );
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

  it("migrates disabled local news samples to GDELT", async () => {
    const localSource = {
      ...defaultNewsSourceSettings.sources[0],
      id: "news-local-sample",
      name: "本地舆情样本",
      provider: "本地舆情样本" as const,
      baseUrl: "local://sentiment-sample"
    };
    const settings = ensureNewsSourceSettings({ sources: [localSource] });
    const result = await testNewsSourceConnection(localSource);

    expect(settings.sources[0].provider).toBe("GDELT 2.1");
    expect(enabledNewsSources({ sources: [localSource] })).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("本地舆情样本已清空");
  });

  it("tests and enables Tencent announcement sources through the Rust source test API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        engine: "rust",
        provider: "腾讯证券公告",
        ok: true,
        rowCount: 2,
        message: "新闻源检测通过",
        details: "腾讯证券公告 已由 Rust 公告采集器响应，返回 2 条测试新闻"
      }), { status: 200 })
    );
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
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { source: typeof source };

    expect(settings.sources[0].provider).toBe("腾讯证券公告");
    expect(enabledNewsSources({ sources: [source] }).map((item) => item.provider)).toEqual(["腾讯证券公告"]);
    expect(result.ok).toBe(true);
    expect(result.details).toContain("Rust 公告采集器");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/source-test");
    expect(requestBody.source).toMatchObject({
      provider: "腾讯证券公告",
      maxItems: 100,
      query: "A股 公告 新闻"
    });
  });

  it("checks the default GDELT source through the Rust source test API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        engine: "rust",
        provider: "GDELT 2.1",
        ok: true,
        rowCount: 1,
        message: "新闻源检测通过",
        details: "GDELT 全球新闻 已由 Rust 新闻采集器响应，返回 1 条测试新闻"
      }), { status: 200 })
    );
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
    expect(result.details).toContain("Rust 新闻采集器");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/source-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      source: {
        provider: "GDELT 2.1",
        baseUrl: "/gdelt-news",
        query: "A股"
      }
    });
  });

  it("checks remote news sources through the Rust source test API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/news/source-test") {
        return new Response(JSON.stringify({
          engine: "rust",
          provider: "NewsAPI",
          ok: true,
          rowCount: 1,
          message: "新闻源检测通过",
          details: "NewsAPI 已由 Rust 新闻采集器响应，返回 1 条测试新闻"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    });
    const source = {
      ...createDefaultNewsSourceEndpoint("newsapi-test"),
      name: "NewsAPI",
      provider: "NewsAPI" as const,
      baseUrl: "https://newsapi.org",
      apiToken: "token-001",
      maxItems: 20
    };

    const result = await testNewsSourceConnection(source, fetchMock);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { source: typeof source };

    expect(result.ok).toBe(true);
    expect(result.details).toContain("Rust 新闻采集器");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/source-test");
    expect(requestBody.source).toMatchObject({
      provider: "NewsAPI",
      baseUrl: "https://newsapi.org",
      apiToken: "token-001",
      maxItems: 20
    });
  });

  it("routes custom remote GDELT URLs through the Rust source test API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        engine: "rust",
        provider: "GDELT 2.1",
        ok: true,
        rowCount: 1,
        message: "新闻源检测通过",
        details: "GDELT 已由 Rust 新闻采集器响应"
      }), { status: 200 })
    );
    const source = {
      ...defaultNewsSourceSettings.sources[0],
      baseUrl: "https://api.gdeltproject.org/api/v2"
    };

    const result = await testNewsSourceConnection(source, fetchMock);

    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/news/source-test");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      source: {
        provider: "GDELT 2.1",
        baseUrl: "https://api.gdeltproject.org/api/v2"
      }
    });
  });

  it("reports invalid Rust news source JSON explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 }));
    const source = defaultNewsSourceSettings.sources[0];

    const result = await testNewsSourceConnection(source, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid JSON");
  });

  it("reports invalid Rust news source payloads explicitly", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ engine: "rust" }), { status: 200 }));
    const source = defaultNewsSourceSettings.sources[0];

    const result = await testNewsSourceConnection(source, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.details).toContain("invalid payload");
  });
});
