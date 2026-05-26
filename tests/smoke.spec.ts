import { expect, test } from "@playwright/test";

test("stock strategy workstation core flows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("策略管理")).toBeVisible();
  await page.getByTitle("收起策略管理").click();
  await expect(page.getByTitle("展开策略管理")).toBeVisible();
  await page.getByTitle("展开策略管理").click();
  await expect(page.getByRole("button", { name: "策略编辑" })).toBeVisible();
  await expect(page.getByRole("button", { name: "择股设置" })).toBeVisible();
  await expect(page.getByText("股票策略").first()).toBeVisible();
  await expect(page.getByText(/最新更新时间/).first()).toBeVisible();

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
  await page.getByRole("button", { name: "自动模式" }).click();
  await expect(page.getByRole("button", { name: "确认自动交易计划" })).toBeVisible();
  await expect(page.getByRole("button", { name: "绑定交易接口" }).first()).toBeVisible();

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
  await expect(page.getByText("连接检测通过，接口配置格式有效")).toBeVisible();
});
