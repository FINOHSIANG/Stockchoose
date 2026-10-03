import { expect, test } from "@playwright/test";

const stocks = [
  {
    code: "600519",
    name: "贵州茅台",
    exchange: "沪市",
    board: "主板",
    industry1: "食品饮料",
    industry2: "白酒",
    region: "贵州",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: true,
    indexes: [],
    metrics: { price: 1688.88, pctChange: 2.34, marketCap: 21000, floatMarketCap: 20900, realQuoteSource: 1 }
  },
  {
    code: "000001",
    name: "平安银行",
    exchange: "深市",
    board: "主板",
    industry1: "金融业",
    industry2: "银行",
    region: "广东",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: true,
    indexes: [],
    metrics: { price: 10.92, pctChange: 1.3, marketCap: 2119.13, floatMarketCap: 2119.09, realQuoteSource: 1 }
  },
  {
    code: "601318",
    name: "中国平安",
    exchange: "沪市",
    board: "主板",
    industry1: "金融业",
    industry2: "保险",
    region: "上海",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: true,
    indexes: [],
    metrics: { price: 42.5, pctChange: -0.2, marketCap: 8000, floatMarketCap: 7600, realQuoteSource: 1 }
  },
  {
    code: "000003",
    name: "PT金田A",
    exchange: "深市",
    board: "主板",
    industry1: "未分类",
    industry2: "未分类",
    region: "未分类",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: false,
    indexes: [],
    metrics: { price: 0, marketCap: 0, floatMarketCap: 0, realQuoteSource: 1 }
  }
];

test("workbench stock search suggests and opens a valid stock", async ({ page }) => {
  const consoleErrors: string[] = [];
  const requestedAdjustments: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript((seedStocks) => {
    localStorage.setItem("stockchoose:localFakeDataClearedV1", JSON.stringify(true));
    localStorage.setItem("stockchoose:openSourceStocks", JSON.stringify(seedStocks));
    localStorage.setItem("stockchoose:openSourceDataSummary", JSON.stringify({ provider: "测试行情", stockCount: seedStocks.length, lastSyncAt: new Date().toISOString() }));
  }, stocks);
  await page.route("**/api/dashboard/market-overview", async (route) => {
    await route.fulfill({ json: { score: 58, label: "中性", avgChange: 0.42, advancers: 2, decliners: 1, limitUp: 0, limitDown: 0, totalAmount: 88 } });
  });
  await page.route("**/api/market/stock/**/kline-points**", async (route) => {
    await route.fulfill({
      json: [{ date: "2026-09-29", open: 10.02, close: 10.12, high: 10.2, low: 9.98, volume: 12345 }]
    });
  });
  await page.route("**/api/market/tencent/kline-points**", async (route) => {
    requestedAdjustments.push(new URL(route.request().url()).searchParams.get("adjustment") ?? "");
    await route.fulfill({
      json: [{ date: "2026-09-29", open: 10.02, close: 10.12, high: 10.2, low: 9.98, volume: 12345 }]
    });
  });
  await page.route("**/api/market/stock/**/profile**", async (route) => {
    await route.fulfill({ json: { code: "600519", name: "贵州茅台", source: "测试行情", industry: "白酒", industryTags: ["白酒"] } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "市场总览" })).toBeVisible();
  const search = page.getByRole("combobox", { name: "搜索个股代码或名称" });
  await search.fill("平安");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option").first()).toContainText("平安银行");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.screenshot({ path: "C:/Users/1/AppData/Local/Temp/stockchoose-search-desktop.png" });

  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "中国平安", exact: true })).toBeVisible();
  const dialog = page.getByRole("dialog");
  const adjustmentControl = dialog.getByRole("group", { name: "K线复权方式" });
  await expect(adjustmentControl.getByRole("button", { name: "前复权" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requestedAdjustments.at(-1)).toBe("qfq");
  await adjustmentControl.getByRole("button", { name: "不复权" }).click();
  await expect(adjustmentControl.getByRole("button", { name: "不复权" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requestedAdjustments.at(-1)).toBe("none");
  const kline = dialog.locator(".stock-kline-chart");
  await expect(kline).toBeVisible();
  await expect(kline.locator(".kline-body")).toHaveCount(1);
  await expect(dialog.locator(".stock-kline-data-count")).toHaveText("单日数据");
  await expect(dialog.locator(".stock-kline-latest em")).toHaveText("单日");
  await expect(dialog.locator(".stock-kline-single-summary")).toContainText("开盘");
  await expect(dialog.locator(".stock-kline-single-summary")).toContainText("日内涨跌");
  await expect(kline.locator(".kline-axis", { hasText: "09-29" })).toHaveCount(1);
  await expect(dialog.locator(".stock-kline-legend .ma5, .stock-kline-legend .ma20")).toHaveCount(0);
  await expect.poll(async () => Number(await kline.locator(".kline-body").getAttribute("width"))).toBeLessThanOrEqual(28);
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();

  await search.fill("000003");
  await expect(page.getByRole("listbox")).toContainText("未找到匹配股票");
  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill("600519");
  await expect(page.getByRole("option")).toContainText("贵州茅台");
  await page.screenshot({ path: "C:/Users/1/AppData/Local/Temp/stockchoose-search-mobile.png" });
  expect(consoleErrors).toEqual([]);
});

test("workbench automatically bootstraps a usable stock universe when cache is empty", async ({ page }) => {
  await page.route("**/api/dashboard/market-overview", async (route) => {
    await route.fulfill({ json: { score: 58, label: "中性", avgChange: 0.42, advancers: 2, decliners: 1, limitUp: 0, limitDown: 0, totalAmount: 88 } });
  });
  await page.route("**/api/data/stock-universe", async (route) => {
    await route.fulfill({
      json: {
        engine: "bun",
        checkedAt: "2026-08-09T08:00:00.000Z",
        stocks
      },
      headers: { "x-stockchoose-data-engine": "bun" }
    });
  });

  await page.goto("/");
  await expect(page.locator(".dashboard-stock-search-heading em")).toHaveText("3 只股票");
  const search = page.getByRole("combobox", { name: "搜索个股代码或名称" });
  await search.fill("600519");
  await expect(page.getByRole("option")).toContainText("贵州茅台");
  await expect.poll(async () => page.evaluate(() => {
    const cached = JSON.parse(localStorage.getItem("stockchoose:openSourceStocks") ?? "[]") as Array<{ code: string }>;
    return cached.length;
  })).toBe(3);
});

test("dashboard industry rotation keeps strong and weak industries aligned", async ({ page }) => {
  const industryStocks = [
    { ...stocks[0], code: "600101", name: "食品甲", industry1: "食品饮料", industry2: "白酒", metrics: { ...stocks[0].metrics, pctChange: 8 } },
    { ...stocks[0], code: "600102", name: "食品乙", industry1: "食品饮料", industry2: "乳品", metrics: { ...stocks[0].metrics, pctChange: 6 } },
    { ...stocks[0], code: "600103", name: "食品丙", industry1: "食品饮料", industry2: "调味品", metrics: { ...stocks[0].metrics, pctChange: 4 } },
    { ...stocks[1], code: "000101", name: "银行甲", industry1: "银行", industry2: "国有行", metrics: { ...stocks[1].metrics, pctChange: -6 } },
    { ...stocks[1], code: "000102", name: "银行乙", industry1: "银行", industry2: "股份行", metrics: { ...stocks[1].metrics, pctChange: -4 } },
    { ...stocks[1], code: "000103", name: "银行丙", industry1: "银行", industry2: "城商行", metrics: { ...stocks[1].metrics, pctChange: -2 } }
  ];
  await page.addInitScript((seedStocks) => {
    localStorage.setItem("stockchoose:localFakeDataClearedV1", JSON.stringify(true));
    localStorage.setItem("stockchoose:openSourceStocks", JSON.stringify(seedStocks));
    localStorage.setItem("stockchoose:openSourceDataSummary", JSON.stringify({ provider: "测试行情", stockCount: seedStocks.length, lastSyncAt: new Date().toISOString() }));
  }, industryStocks);
  await page.route("**/api/dashboard/market-overview", async (route) => {
    await route.fulfill({ json: { score: 65, label: "强势", avgChange: 1.2, advancers: 4, decliners: 2, limitUp: 0, limitDown: 0, totalAmount: 88 } });
  });

  await page.goto("/");
  const card = page.locator(".dashboard-industry");
  const columns = card.locator(".dashboard-industry-column");
  await expect(columns.nth(0).locator(".dashboard-industry-name")).toHaveText(["食品饮料"]);
  await expect(columns.nth(1).locator(".dashboard-industry-name")).toHaveText(["银行"]);
  await expect(columns.nth(0).locator(".dashboard-industry-top")).toContainText("领涨 食品甲");
  await expect(columns.nth(1).locator(".dashboard-industry-top")).toContainText("领跌 银行甲");
  await expect(columns.nth(0).locator(".dashboard-industry-change")).toHaveText("+6.00%");
  await expect(columns.nth(1).locator(".dashboard-industry-change")).toHaveText("-4.00%");
});

test("valuation industry selector shows the complete list without horizontal clipping", async ({ page }) => {
  await page.addInitScript((seedStocks) => {
    localStorage.setItem("stockchoose:localFakeDataClearedV1", JSON.stringify(true));
    localStorage.setItem("stockchoose:openSourceStocks", JSON.stringify(seedStocks));
    localStorage.setItem("stockchoose:openSourceDataSummary", JSON.stringify({
      provider: "测试行情", stockCount: seedStocks.length, lastSyncAt: new Date().toISOString()
    }));
  }, [stocks[0]]);
  await page.route("**/api/dashboard/market-overview", async (route) => {
    await route.fulfill({ json: { score: 58, label: "中性", avgChange: 0, advancers: 1, decliners: 0, limitUp: 0, limitDown: 0, totalAmount: 0 } });
  });

  await page.goto("/");
  await page.locator(".primary-nav > button").nth(4).click();
  const group = page.locator(".valuation-industry-filter .valuation-option-group");
  await expect(group).toBeVisible();
  await expect(group.getByRole("button")).toHaveCount(32);
  await expect(group.getByRole("button", { name: "农林牧渔", exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "美容护理", exact: true })).toBeVisible();
  await expect.poll(() => group.evaluate((element) => ({
    horizontallyClipped: element.scrollWidth > element.clientWidth,
    flexWrap: getComputedStyle(element).flexWrap
  }))).toEqual({ horizontallyClipped: false, flexWrap: "wrap" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth)).toBe(390);
  await expect(group.getByRole("button", { name: "美容护理", exact: true })).toBeVisible();
});
