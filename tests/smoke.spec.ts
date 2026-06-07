import { expect, test } from "@playwright/test";

test("stock strategy workstation core flows", async ({ page }) => {
  const financialReportPayloads: Record<string, unknown[]> = {
    stock_yjbb_em: [
      {
        股票代码: "600519",
        股票简称: "贵州茅台",
        营业收入: 127500000000,
        净利润: 74700000000,
        基本每股收益: 59.49,
        每股净资产: 230.5,
        净资产收益率: 31.2,
        营业收入同比增长: 15.8,
        净利润同比增长: 19.2
      }
    ],
    stock_lrb_em: [
      {
        股票代码: "600519",
        营业总收入: 127500000000,
        营业成本: 11800000000,
        净利润: 74700000000
      }
    ],
    stock_zcfz_em: [
      {
        股票代码: "600519",
        资产总计: 255000000000,
        负债合计: 42000000000,
        存货: 38800000000,
        应收账款: 1200000000,
        流动资产合计: 210000000000,
        流动负债合计: 35000000000,
        货币资金: 120000000000,
        交易性金融资产: 5000000000,
        长期股权投资: 1000000000,
        短期借款: 6000000000,
        长期借款: 4000000000
      }
    ],
    stock_xjll_em: [
      {
        股票代码: "600519",
        经营活动产生的现金流量净额: 65000000000
      }
    ]
  };

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
  await page.route(/\/stock_(yjbb|lrb|zcfz|xjll)_em\?date=/, async (route) => {
    const endpoint = route.request().url().match(/\/(stock_(?:yjbb|lrb|zcfz|xjll)_em)\?date=/)?.[1] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(financialReportPayloads[endpoint] ?? [])
    });
  });
  await page.route(/\/gdelt-news\/doc\/doc\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        articles: [
          {
            url: "https://mock.news/maotai-risk",
            title: "贵州茅台、五粮液高端白酒批价波动，渠道库存风险警示",
            seendate: "2026-05-30T11:00:00Z",
            domain: "mock.news"
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByText("策略管理")).toBeVisible();
  await page.locator(".primary-nav").getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  const bootstrapInfoSourcePanel = page.locator(".settings-panel").filter({ hasText: "信息来源接口" });
  await expect(bootstrapInfoSourcePanel.getByLabel("接口来源")).toHaveValue("AKShare / AKTools 免费开源数据");
  await expect(bootstrapInfoSourcePanel.getByLabel("接口地址")).toHaveValue("/aktools/api/public");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/AKShare\/AKTools/)).toBeVisible();
  await page.getByRole("button", { name: "同步开源数据" }).click();
  await expect(page.getByText(/开源数据同步完成/)).toBeVisible();
  await expect(page.getByText("2 / 2").first()).toBeVisible();
  await page.locator(".primary-nav").getByRole("button", { name: "价值核算", exact: true }).click();
  await expect(page.getByRole("heading", { name: "股票价值核算" })).toBeVisible();
  await expect(page.getByRole("button", { name: "同步真实财报" })).toBeVisible();
  await page.getByRole("button", { name: "同步真实财报" }).click();
  await expect(page.getByText(/真实财报同步完成/)).toBeVisible();
  await expect(page.getByText(/财报匹配 1\/4/)).toBeVisible();
  await expect(page.getByText(/可核算 1\/2/)).toBeVisible();
  await page.locator(".primary-nav").getByRole("button", { name: "策略", exact: true }).click();
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
  await expect(page.locator(".strategy-title").getByRole("button", { name: "新增策略" })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("确认删除策略");
    await dialog.accept();
  });
  await page.locator(".strategy-title").getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("草稿").first()).toBeVisible();
  await page.locator(".strategy-title").getByRole("button", { name: "新增策略" }).click();
  await expect(page.getByText("草稿").first()).toBeVisible();
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

  await page.locator(".primary-nav").getByRole("button", { name: "舆情", exact: true }).click();
  await expect(page.getByRole("heading", { name: "舆情选股" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "事件雷达" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "关联股票" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "深度洞察报告" })).toBeVisible();
  await page.getByRole("button", { name: "手动刷新" }).click();
  await expect(page.getByText("高端白酒批价波动").first()).toBeVisible();
  await page.getByLabel("事件类型").selectOption("风险负面");
  await page.getByLabel("重大程度").selectOption("重大");
  await expect(page.getByText("重大事件")).toBeVisible();
  await expect(page.getByText("高端白酒批价波动").first()).toBeVisible();
  await page.locator(".primary-nav").getByRole("button", { name: "策略", exact: true }).click();

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
  await expect(page.getByLabel("当前绑定策略")).toContainText("当前绑定策略");
  await expect(page.getByLabel("当前绑定策略")).toContainText("交易计划");
  await expect(page.getByText("持仓总结")).toBeVisible();
  await expect(page.getByRole("heading", { name: "持仓策略" })).toBeVisible();
  await expect(page.getByText("暂无持仓策略，请先导入当前选股策略。")).toBeVisible();
  await page.getByRole("button", { name: "导入策略" }).click();
  let importDialog = page.locator(".modal-panel").filter({ hasText: "导入持仓策略" });
  await expect(importDialog).toBeVisible();
  await expect(importDialog.getByLabel("选择持仓策略 股票策略")).toBeChecked();
  await importDialog.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("当前选股策略")).toBeVisible();
  await page.getByLabel("手动当前净值").fill("1.125");
  await page.getByLabel("手动持仓市值").fill("260000");
  await page.getByLabel("手动策略现金").fill("140000");
  await page.getByLabel("手动策略外资产").fill("500000");
  await page.getByRole("button", { name: "资产同步" }).click();
  await expect(page.getByText("1.1250")).toBeVisible();
  await expect(page.getByText("900,000.00").first()).toBeVisible();
  await expect(page.getByText("260,000.00").first()).toBeVisible();
  await expect(page.getByText("640,000.00").first()).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("确认从持仓策略中移除");
    await dialog.accept();
  });
  await page.getByRole("button", { name: /删除持仓策略/ }).click();
  await expect(page.getByText("暂无持仓策略，请先导入当前选股策略。")).toBeVisible();
  await page.getByRole("button", { name: "导入策略" }).click();
  importDialog = page.locator(".modal-panel").filter({ hasText: "导入持仓策略" });
  await expect(importDialog).toBeVisible();
  await importDialog.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("当前选股策略")).toBeVisible();

  await page.getByRole("button", { name: /调仓/ }).click();
  await expect(page.getByRole("button", { name: "生成手动交易指令" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出交易指令" })).toBeVisible();
  await page.getByRole("button", { name: "生成手动交易指令" }).click();
  await expect(page.getByText(/已生成 \d+ 条手动交易指令/)).toBeVisible();
  await expect(page.getByLabel("交易客户端复制文本")).toBeVisible();
  await expect(page.getByLabel("交易客户端复制文本")).toHaveValue(/^\d{6}\t买入\t\d+\.\d{3}\t\d+/);
  await page.getByRole("button", { name: "切换到高级操作" }).click();
  await expect(page.getByRole("button", { name: "切换到普通操作" })).toBeVisible();
  await expect(page.locator(".rebalance-advanced-panel")).toContainText("高级操作");
  await expect(page.getByLabel(/实际股数/).first()).toBeVisible();
  await page.getByLabel("最小买卖金额").fill("5000");
  await page.locator(".rebalance-toolbar").getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("最小买卖金额已保存为 5,000.00")).toBeVisible();
  await page.getByRole("button", { name: "复制到交易客户端" }).click();
  await expect(page.getByText(/已复制 \d+ 条交易客户端指令|浏览器未允许自动复制/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出交易指令" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("交易客户端指令");
  await expect(page.getByText(/已导出.*交易客户端指令/)).toBeVisible();
  const statusDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "生成交易状态表" }).click();
  const statusDownload = await statusDownloadPromise;
  expect(statusDownload.suggestedFilename()).toContain("交易状态表");
  await page.getByRole("button", { name: "解除指令" }).click();
  await expect(page.getByText(/已解除|已清空当前页面指令草稿/)).toBeVisible();
  await page.getByRole("button", { name: "自动模式" }).click();
  await expect(page.getByLabel("交易接口")).toHaveValue("本地纸面交易接口");
  await expect(page.getByRole("button", { name: "确认自动交易计划" })).toBeVisible();
  await expect(page.getByRole("button", { name: "绑定交易接口" }).first()).toBeVisible();
  await page.locator(".instruction-mode-panel").getByRole("button", { name: "绑定交易接口" }).click();
  await expect(page.getByText("交易接口已绑定").first()).toBeVisible();
  await page.getByRole("button", { name: "确认自动交易计划" }).click();
  await expect(page.getByText(/纸面交易已成交/)).toBeVisible();
  await expect(page.getByLabel("当前绑定策略")).toContainText(/当前策略成交\s*\d+笔/);

  await page.getByRole("button", { name: "日志" }).click();
  await expect(page.getByRole("button", { name: "查看日志" })).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("button", { name: "查看历史记录" })).toBeVisible();
  await expect(page.getByText(/当前策略成交：\d+笔/)).toBeVisible();

  await page.getByRole("button", { name: "条件单交易" }).click();
  await expect(page.getByText("条件单设置")).toBeVisible();
  await expect(page.getByText("我的条件单")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "执行模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存条件单" })).toBeVisible();
  const conditionEditorBox = await page.locator(".condition-editor").boundingBox();
  const conditionListBox = await page.locator(".condition-list").boundingBox();
  expect(conditionEditorBox && conditionListBox ? conditionEditorBox.x + conditionEditorBox.width : 0).toBeLessThanOrEqual(conditionListBox ? conditionListBox.x : 0);

  await page.locator(".primary-nav").getByRole("button", { name: "设置", exact: true }).click();
  const navBox = await page.locator(".primary-nav").boundingBox();
  const settingsNavBox = await page.locator(".primary-nav").getByRole("button", { name: "设置", exact: true }).boundingBox();
  expect(settingsNavBox && navBox ? settingsNavBox.x + settingsNavBox.width : 0).toBeGreaterThan(navBox ? navBox.x + navBox.width - 160 : 0);
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "信息来源接口" })).toBeVisible();
  const infoSourcePanel = page.locator(".settings-panel").filter({ hasText: "信息来源接口" });
  await expect(infoSourcePanel.getByLabel("接口来源")).toBeVisible();
  await expect(infoSourcePanel.getByLabel("接口地址")).toBeVisible();
  await expect(page.getByRole("button", { name: "测试连接" })).toBeVisible();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/连接检测通过/)).toBeVisible();
  await infoSourcePanel.getByLabel("接口来源").selectOption("AKShare / AKTools 免费开源数据");
  await expect(infoSourcePanel.getByLabel("接口地址")).toHaveValue("/aktools/api/public");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/AKShare\/AKTools/)).toBeVisible();
  await page.getByRole("button", { name: "同步开源数据" }).click();
  await expect(page.getByText(/开源数据同步完成/)).toBeVisible();
  await expect(page.getByText("2 / 2").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "新闻源接口管理" })).toBeVisible();
  await expect(page.getByText("GDELT 全球新闻").first()).toBeVisible();
  await page.locator(".news-source-card").first().getByRole("button", { name: "测试接口" }).click();
  await expect(page.getByText(/新闻源检测通过/).first()).toBeVisible();
  await page.getByRole("button", { name: "新增新闻源" }).click();
  await expect(page.getByText("自定义新闻源").first()).toBeVisible();
  await page.getByRole("button", { name: "保存新闻源" }).click();
  await expect(page.getByText(/已保存新闻源接口配置/)).toBeVisible();
});
