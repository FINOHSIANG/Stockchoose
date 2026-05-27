import { expect, test } from "@playwright/test";

test("stock strategy workstation core flows", async ({ page }) => {
  await page.route(/\/stock_zh_a_hist\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify([{ 日期: "2024-05-06", 收盘: 10.12 }])
    });
  });
  await page.route(/\/stock_zh_a_spot_em$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify([
        { 代码: "600519", 名称: "贵州茅台", 最新价: 1688.88, 涨跌幅: 2.34, 成交量: 123456, 成交额: 987654321, 换手率: 1.23, 总市值: 2100000000000, 流通市值: 2090000000000, "市盈率-动态": 28.6, 市净率: 8.2, 振幅: 3.45 },
        { 代码: "000858", 名称: "五粮液", 最新价: 138.12, 涨跌幅: -1.2, 成交量: 223456, 成交额: 345678901, 换手率: 0.95, 总市值: 520000000000, 流通市值: 510000000000, "市盈率-动态": 18.3, 市净率: 4.1, 振幅: 2.6 }
      ])
    });
  });

  await page.goto("/");
  await expect(page.getByText("策略管理")).toBeVisible();
  await page.getByTitle("收起策略管理").click();
  await expect(page.getByTitle("展开策略管理")).toBeVisible();
  await page.getByTitle("展开策略管理").click();
  await expect(page.getByRole("button", { name: "策略编辑" })).toBeVisible();
  await expect(page.getByRole("button", { name: "择股设置" })).toBeVisible();
  await expect(page.getByText("股票策略").first()).toBeVisible();
  await expect(page.getByText(/最新更新时间/).first()).toBeVisible();
  await page.locator(".strategy-title").getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存").first()).toBeVisible();

  await page.getByRole("button", { name: "财务指标" }).click();
  await page.getByRole("button", { name: /市盈率PE/ }).click();
  await expect(page.getByText("市盈率PE").last()).toBeVisible();

  await page.getByRole("button", { name: /开始回测/ }).click();
  await expect(page.getByText("累计收益")).toBeVisible();
  await expect(page.getByRole("heading", { name: "策略净值曲线" })).toBeVisible();

  await page.getByRole("button", { name: /每日选股/ }).click();
  await expect(page.getByText("每日选股结果")).toBeVisible();

  await page.getByRole("button", { name: /排名分析/ }).click();
  await expect(page.getByText("排名分析").last()).toBeVisible();

  await page.getByRole("button", { name: /因子相关性/ }).click();
  await expect(page.getByText("因子IC概览")).toBeVisible();
  await expect(page.getByText("因子相关性矩阵")).toBeVisible();

  await page.getByRole("button", { name: "交易模型" }).click();
  await expect(page.getByText("模型Ⅰ--定期轮动")).toBeVisible();

  await page.getByRole("button", { name: "大盘择时" }).click();
  await expect(page.locator("span", { hasText: "自定义择时公式" })).toBeVisible();

  await page.getByRole("button", { name: "股指对冲" }).click();
  await expect(page.getByText("启用股指期货对冲")).toBeVisible();

  await page.getByRole("button", { name: "交易", exact: true }).click();
  await expect(page.getByRole("button", { name: "策略交易" })).toBeVisible();
  await expect(page.getByRole("button", { name: "条件单交易" })).toBeVisible();
  await expect(page.getByText("交易指令模式")).toBeVisible();
  await expect(page.getByRole("button", { name: "手动模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "自动模式" })).toBeVisible();
  await expect(page.getByText("持仓总结")).toBeVisible();
  await expect(page.getByText("持仓策略")).toBeVisible();

  await page.getByRole("button", { name: /调仓/ }).click();
  await expect(page.getByRole("button", { name: "生成手动交易指令" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出交易指令" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出交易指令" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("交易指令");
  await page.getByRole("button", { name: "自动模式" }).click();
  await expect(page.getByLabel("交易接口")).toHaveValue("本地纸面交易接口");
  await expect(page.getByRole("button", { name: "确认自动交易计划" })).toBeVisible();
  await expect(page.getByRole("button", { name: "绑定交易接口" }).first()).toBeVisible();
  await page.locator(".instruction-mode-panel").getByRole("button", { name: "绑定交易接口" }).click();
  await expect(page.getByText("交易接口已绑定").first()).toBeVisible();
  await page.getByRole("button", { name: "确认自动交易计划" }).click();
  await expect(page.getByText(/纸面交易已成交/)).toBeVisible();

  await page.getByRole("button", { name: "日志" }).click();
  await expect(page.getByRole("button", { name: "查看日志" })).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("button", { name: "查看历史记录" })).toBeVisible();

  await page.getByRole("button", { name: "条件单交易" }).click();
  await expect(page.getByText("条件单设置")).toBeVisible();
  await expect(page.getByText("我的条件单")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "执行模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存条件单" })).toBeVisible();

  await page.locator(".primary-nav").getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "信息来源接口" })).toBeVisible();
  await expect(page.getByLabel("接口来源")).toBeVisible();
  await expect(page.getByLabel("接口地址")).toBeVisible();
  await expect(page.getByRole("button", { name: "测试连接" })).toBeVisible();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/连接检测通过/)).toBeVisible();
  await page.getByLabel("接口来源").selectOption("AKShare / AKTools 免费开源数据");
  await expect(page.getByLabel("接口地址")).toHaveValue("http://127.0.0.1:8080/api/public");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/AKShare\/AKTools/)).toBeVisible();
  await page.getByRole("button", { name: "同步开源数据" }).click();
  await expect(page.getByText(/开源数据同步完成/)).toBeVisible();
  await expect(page.getByText("2 / 2")).toBeVisible();
});
