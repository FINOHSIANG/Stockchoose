import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
import { STOCKS } from "./fixtures/testStockFixtures";
import { defaultScheduleConfig } from "../src/syncSchedulerService";

test("annual report distinguishes missing values and survives profile refresh without refetching", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const stock = { ...STOCKS[0], metrics: { price: 100, realQuoteSource: 1 } };
  await page.addInitScript((seed) => {
    localStorage.setItem("stockchoose:localFakeDataClearedV1", JSON.stringify(true));
    localStorage.setItem("stockchoose:openSourceStocks", JSON.stringify([seed]));
    localStorage.setItem("stockchoose:openSourceDataSummary", JSON.stringify({
      provider: "test", stockCount: 1, lastSyncAt: new Date().toISOString()
    }));
  }, stock);
  await page.route("**/api/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sync/status", (route) => route.fulfill({ json: {
    config: defaultScheduleConfig, running: false, lastFullSync: null, runs: [], cacheFiles: []
  } }));
  await page.route("**/api/dashboard/market-overview", (route) => route.fulfill({ json: {
    score: 58, label: "中性", avgChange: 0, advancers: 1, decliners: 0,
    limitUp: 0, limitDown: 0, totalAmount: 0
  } }));
  let releaseProfile!: () => void;
  const profileGate = new Promise<void>((resolve) => { releaseProfile = resolve; });
  await page.route("**/api/market/stock/**/profile**", async (route) => {
    await profileGate;
    await route.fulfill({ json: { code: stock.code, name: stock.name, source: "test-profile", industryTags: ["profile-loaded"] } });
  });
  let annualRequests = 0;
  await page.route("**/api/finance/annual-reports", async (route) => {
    annualRequests += 1;
    expect(route.request().postDataJSON().stock).toEqual({
      code: stock.code, name: stock.name, exchange: stock.exchange
    });
    await route.fulfill({ json: [{
      code: stock.code, name: stock.name, year: "2025", periodEnd: "2025-12-31",
      disclosureDate: "2026-04-30", reportType: "年度报告", currencyUnit: "人民币亿元",
      auditOpinion: "未提供", sourceProvider: "test", sourceFileName: "600519-2025.csv",
      sourceFileType: "CSV", sourceNote: "test fixture",
      details: {
        performance: [
          { key: "revenue", label: "营业收入", value: 100, unit: "亿元" },
          { key: "eps", label: "基本每股收益", value: 5.25, unit: "元" }
        ],
        income: [
          { key: "totalOperatingRevenue", label: "营业总收入", value: 100, unit: "亿元" },
          { key: "operatingCost", label: "营业成本", value: 20, unit: "亿元" }
        ],
        balance: [
          { key: "totalAssets", label: "资产总计", value: 500, unit: "亿元" },
          { key: "totalLiabilities", label: "负债合计", unit: "亿元" }
        ],
        cashFlow: [
          { key: "operatingNetCash", label: "经营活动现金流量净额", value: 0, unit: "亿元" }
        ]
      },
      metrics: { revenue: 100, netProfit: -1.25, operatingCashflow: 0 }
    }] });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "搜索个股代码或名称" }).fill(stock.code);
  await page.getByRole("option").first().click();
  const report = page.locator(".annual-report-section");
  const metric = (name: string) => report.locator(".stock-info-detail-grid > div").filter({
    has: page.locator("span").filter({ hasText: new RegExp(`^${name}$`) })
  }).locator("strong");
  await expect(metric("员工人数")).toHaveText("未提供");
  await expect(metric("经营现金流")).toHaveText("0 亿");
  await expect(metric("归母净利润")).toHaveText("-1.25 亿");
  await page.getByRole("button", { name: "查看详细财报" }).click();
  const detailDialog = page.getByRole("dialog").last();
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole("heading", { name: "详细财报 · 贵州茅台 2025" })).toBeVisible();
  await expect(detailDialog.getByText("贵州茅台 600519", { exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("cell", { name: "100 亿元", exact: true })).toBeVisible();
  await detailDialog.getByRole("tab", { name: "利润表" }).click();
  await expect(detailDialog.getByRole("cell", { name: "营业成本", exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("cell", { name: "20 亿元", exact: true })).toBeVisible();
  await detailDialog.getByRole("tab", { name: "资产负债表" }).click();
  await expect(detailDialog.getByRole("cell", { name: "未提供", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(tmpdir(), "stockchoose-annual-detail-1280.png") });
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(detailDialog.getByRole("tab", { name: "现金流量表" })).toBeVisible();
  await detailDialog.getByRole("tab", { name: "现金流量表" }).click();
  await expect(detailDialog.getByRole("cell", { name: "0 亿元", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(tmpdir(), "stockchoose-annual-detail-390.png") });
  await detailDialog.getByRole("button", { name: "关闭" }).click();
  releaseProfile();
  await expect(page.getByText("profile-loaded", { exact: true })).toBeVisible();
  await expect(metric("员工人数")).toHaveText("未提供");
  expect(annualRequests).toBe(1);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await report.scrollIntoViewIfNeeded();
    await expect(metric("经营现金流")).toBeVisible();
    await page.screenshot({ path: path.join(tmpdir(), `stockchoose-annual-${width}.png`) });
  }
  expect(annualRequests).toBe(1);
  expect(errors).toEqual([]);
});
