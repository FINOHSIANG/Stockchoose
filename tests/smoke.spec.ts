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
  await page.route(/\/api\/market\/stock\/000001\/kline-points\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([{ date: "2024-05-06", open: 10.02, close: 10.12, high: 10.2, low: 9.98, volume: 12345 }])
    });
  });
  await page.route(/\/api\/integration\/source-test$/, async (route) => {
    const requestBody = route.request().postDataJSON() as { provider?: string; baseUrl?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        engine: "rust",
        provider: requestBody.provider ?? "AKShare / AKTools 免费开源数据",
        ok: true,
        rowCount: 5,
        message: "连接检测通过",
        details: requestBody.baseUrl?.startsWith("/aktools")
          ? "Rust 原生数据接口已返回 5 条 A 股历史行情"
          : "AKShare/AKTools 已由 Rust 代理返回 5 条 A 股历史行情"
      })
    });
  });
  await page.route(/\/api\/market\/ashare\/spot$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        { 代码: "600519", 名称: "贵州茅台", 最新价: 1688.88, 涨跌幅: 2.34, 成交量: 123456, 成交额: 987654321, 换手率: 1.23, 总市值: 2100000000000, 流通市值: 2090000000000, "市盈率-动态": 28.6, 市净率: 8.2, 振幅: 3.45 },
        { 代码: "000858", 名称: "五粮液", 最新价: 138.12, 涨跌幅: -1.2, 成交量: 223456, 成交额: 345678901, 换手率: 0.95, 总市值: 520000000000, 流通市值: 510000000000, "市盈率-动态": 18.3, 市净率: 4.1, 振幅: 2.6 }
      ])
    });
  });
  await page.route(/\/api\/market\/north-holdings$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          code: "600519",
          name: "Kweichow Moutai",
          reportDate: "2024-08-16",
          sourceRows: 1,
          metrics: {
            northHold: 6.55,
            northHoldShares: 82354427,
            northHoldMarketCap: 1178.66,
            northHoldDate: 20240816,
            realNorthHoldSource: 1
          }
        }
      ])
    });
  });
  await page.route(/\/api\/market\/technical-indicators\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          code: "600519",
          name: "Kweichow Moutai",
          reportDate: "2026-06-09",
          sourceRows: 120,
          metrics: {
            ma20Distance: 3.21,
            ma60Distance: 8.76,
            momentum60: 12.45,
            volatility20: 18.34,
            macd: 1.23,
            kdj: 72.4,
            rsi: 61.8,
            bias: 3.21,
            bollWidth: 9.87,
            technicalTradeDate: 20260609,
            realTechnicalSource: 1
          }
        }
      ])
    });
  });
  await page.route(/\/api\/finance\/statements\/\d+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        performanceRows: financialReportPayloads.stock_yjbb_em,
        incomeRows: financialReportPayloads.stock_lrb_em,
        balanceRows: financialReportPayloads.stock_zcfz_em,
        cashFlowRows: financialReportPayloads.stock_xjll_em,
        reportDate: "20251231"
      })
    });
  });
  await page.route(/\/api\/finance\/metrics\/\d+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          code: "600519",
          name: "贵州茅台",
          reportDate: "2025-12-31",
          sourceRows: 4,
          metrics: {
            revenue: 1275,
            netProfit: 747,
            operatingCashflow: 650,
            totalAssets: 2550,
            totalLiabilities: 420,
            inventory: 388,
            receivables: 12,
            eps: 59.49,
            bps: 230.5,
            roe: 31.2,
            grossMargin: 90.75,
            netMargin: 58.59,
            revenueGrowth: 15.8,
            profitGrowth: 19.2,
            debtRatio: 16.47,
            currentRatio: 6,
            assetTurnover: 0.5,
            investmentAssets: 1260,
            productionAssets: 1290,
            interestBearingDebt: 100,
            nonInterestBearingDebt: 320,
            realAnnualReportSource: 1,
            realFinancialReportDate: 20251231,
            realAnnualReportDate: 20251231,
            realAnnualReportDisclosureDate: 20260430
          }
        }
      ])
    });
  });
  await page.route(/\/api\/finance\/analyst-forecasts$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          code: "600519",
          name: "Kweichow Moutai",
          reportDate: "2026E",
          sourceRows: 1,
          metrics: {
            recommendationCount: 44,
            ratingScore: 4.84,
            forecastEps: 68.96,
            targetPriceMid: 1777.5,
            realAnalystForecastSource: 1
          }
        }
      ])
    });
  });
  await page.route(/\/api\/finance\/margin-balances$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          code: "600519",
          name: "Kweichow Moutai",
          reportDate: "2026-06-08",
          sourceRows: 1,
          metrics: {
            marginBalance: 196.36,
            financingBalance: 194.99,
            securitiesLendingBalance: 1.38,
            marginTradeDate: 20260608,
            realMarginSource: 1
          }
        }
      ])
    });
  });
  await page.route(/\/api\/finance\/annual-reports$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          code: "600519",
          name: "Kweichow Moutai",
          year: "2025",
          periodEnd: "2025-12-31",
          disclosureDate: "2026-04-30",
          reportType: "年度报告",
          currencyUnit: "人民币亿元",
          auditOpinion: "以真实财报接口返回字段为准",
          sourceProvider: "真实财报接口",
          sourceFileName: "600519-Kweichow Moutai-2025-real-annual-report-source.csv",
          sourceFileType: "CSV",
          sourceNote: "由 Rust 构建，不倒推历史年度。",
          sourceCsv: "股票代码,股票名称\r\n600519,Kweichow Moutai",
          metrics: {
            revenue: 1275,
            netProfit: 747,
            operatingCashflow: 650,
            totalAssets: 2550,
            totalLiabilities: 420,
            inventory: 388,
            receivables: 12,
            eps: 59.49,
            bps: 230.5,
            employeeCount: 0,
            grossMargin: 90.75,
            netMargin: 58.59,
            roe: 31.2,
            roa: 29.29,
            revenueGrowth: 15.8,
            profitGrowth: 19.2,
            debtRatio: 16.47,
            currentRatio: 6,
            assetTurnover: 0.5,
            dividendYield: 0,
            cashProfitRatio: 87.01,
            receivableRevenueRatio: 0.94
          }
        }
      ])
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
  await page.route(/\/api\/news\/gdelt\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
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
  await page.route(/\/api\/news\/source-test$/, async (route) => {
    const requestBody = route.request().postDataJSON() as { source?: { name?: string; provider?: string } };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        engine: "rust",
        provider: requestBody.source?.provider ?? "GDELT 2.1",
        ok: true,
        rowCount: 1,
        message: "新闻源检测通过",
        details: `${requestBody.source?.name ?? "GDELT 全球新闻"} 已由 Rust 新闻采集器响应，返回 1 条测试新闻`
      })
    });
  });
  await page.route(/\/api\/news\/articles$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        articles: [
          {
            id: "news-gdelt-global-0-https://mock.news/maotai-risk",
            title: "贵州茅台、五粮液高端白酒批价波动，渠道库存风险警示",
            summary: "贵州茅台、五粮液高端白酒批价波动，渠道库存风险警示",
            content: "贵州茅台、五粮液高端白酒批价波动，渠道库存风险警示",
            source: "mock.news",
            sourceIcon: "M",
            category: "市场评论",
            sentiment: "利空",
            importance: "头条",
            status: "unread",
            publishedAt: "2026-05-30T11:00:00Z",
            fetchedAt: "2026-05-30T11:00:00Z",
            url: "https://mock.news/maotai-risk",
            imageUrl: "",
            author: "mock.news",
            readTime: 1,
            linkedCodes: ["600519", "000858"],
            linkedStocks: [
              { code: "600519", name: "贵州茅台" },
              { code: "000858", name: "五粮液" }
            ],
            industries: ["食品饮料"],
            tags: ["市场评论", "利空", "食品饮料"],
            viewCount: 0,
            commentCount: 0
          }
        ],
        stats: { mode: "fast", scannedStocks: 2, requestCount: 1, returnedRows: 1, validArticles: 1 }
      })
    });
  });
  await page.route(/\/api\/sentiment\/analysis$/, async (route) => {
    const requestBody = route.request().postDataJSON() as { events?: Array<Record<string, unknown>>; stocks?: Array<Record<string, unknown>> };
    const event = requestBody.events?.[0] ?? {
      id: "mock-sentiment-event",
      title: "高端白酒批价波动",
      summary: "渠道库存风险警示",
      category: "风险负面",
      direction: "利空",
      industries: ["食品饮料"],
      keywords: ["白酒"],
      linkedCodes: ["600519"]
    };
    const stock = requestBody.stocks?.find((item) => item.code === "600519") ?? requestBody.stocks?.[0] ?? {
      code: "600519",
      name: "贵州茅台",
      exchange: "SH",
      board: "Main",
      industry1: "食品饮料",
      industry2: "白酒",
      region: "Guizhou",
      property: "SOE",
      isST: false,
      isSuspended: false,
      isSTAR: false,
      isMargin: true,
      indexes: [],
      metrics: {}
    };
    const linkedStock = {
      stock,
      events: [event],
      direction: event.direction ?? "利空",
      relationScore: 68.5,
      relationLevel: "直接命中",
      reason: `${event.category ?? "风险负面"}：${event.summary ?? event.title ?? "真实新闻关联"}`,
      evidence: ["真实新闻源代码直接关联"],
      tags: [event.category ?? "风险负面"]
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        engine: "rust",
        linkedStocks: [linkedStock],
        report: {
          title: "舆情关联股票洞察",
          conclusion: "Rust smoke mock 已完成关联股票分析。",
          eventCount: requestBody.events?.length ?? 1,
          topCategories: [{ category: event.category ?? "风险负面", count: 1 }],
          topIndustries: [{ industry: "食品饮料", count: 1 }],
          linkedStocks: [linkedStock],
          riskEvents: [event],
          validationPoints: ["Rust sentiment analysis smoke mock"]
        }
      })
    });
  });
  await page.route(/\/api\/news-analysis\/local-test$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({ engine: "rust", ok: true, taskCount: 4, message: "Rust 本地新闻规则模型已启用 4 个分析任务" })
    });
  });
  await page.route(/\/api\/news-analysis\/model-test$/, async (route) => {
    const requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        engine: "rust",
        ok: true,
        provider: requestBody.provider ?? "本地规则模型",
        model: requestBody.model ?? "local-news-rule-v1",
        message: "分析模型检测通过",
        details: "Rust smoke mock 已完成新闻分析模型检测"
      })
    });
  });

  await page.route(/\/api\/strategy\/rank$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          stock: {
            code: "600519",
            name: "Kweichow Moutai",
            exchange: "SH",
            board: "Main",
            industry1: "Food & Beverage",
            industry2: "Baijiu",
            region: "Guizhou",
            property: "SOE",
            isST: false,
            isSuspended: false,
            isSTAR: false,
            isMargin: true,
            indexes: ["CSI300"],
            metrics: { qualityScore: 88, pe: 28.6 }
          },
          score: 100,
          rank: 1,
          values: { qualityScore: 88, pe: 28.6 }
        }
      ])
    });
  });
  await page.route(/\/api\/strategy\/backtest$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        rows: [
          {
            stock: {
              code: "600519",
              name: "Kweichow Moutai",
              exchange: "SH",
              board: "Main",
              industry1: "Food & Beverage",
              industry2: "Baijiu",
              region: "Guizhou",
              property: "SOE",
              isST: false,
              isSuspended: false,
              isSTAR: false,
              isMargin: true,
              indexes: ["CSI300"],
              metrics: { price: 1688.88, qualityScore: 88, pe: 28.6 }
            },
            score: 100,
            weight: 100,
            passedFilters: 0
          }
        ],
        curve: [
          { date: "2024-01-01", strategy: 1, benchmark: 1, hedge: 1 },
          { date: "2024-02-01", strategy: 1.08, benchmark: 1.03, hedge: 1.08 }
        ],
        metrics: {
          cumulativeReturn: 8,
          annualReturn: 10,
          maxDrawdown: -2,
          sharpe: 1.2,
          volatility: 12,
          winRate: 60,
          turnover: 20
        },
        yearly: [{ year: "2024", strategy: 8, benchmark: 3, excess: 5 }],
        trades: [
          { date: "2024-01-01", action: "买入", code: "600519", name: "Kweichow Moutai", weight: 100, price: 1688.88 }
        ]
      })
    });
  });
  await page.route(/\/api\/strategy\/optimize$/, async (route) => {
    const requestBody = route.request().postDataJSON() as { strategy?: Record<string, unknown> };
    const strategy = requestBody.strategy ?? {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify({
        candidate: {
          ...strategy,
          trading: { ...(strategy.trading as Record<string, unknown>), maxHoldings: 6 }
        },
        result: {
          rows: [],
          curve: [{ date: "2024-01-01", strategy: 1.01, benchmark: 1, hedge: 1.01 }],
          metrics: {
            cumulativeReturn: 1,
            annualReturn: 2,
            maxDrawdown: -1,
            sharpe: 1.5,
            volatility: 3,
            winRate: 60,
            turnover: 20
          },
          yearly: [{ year: "2024", strategy: 1, benchmark: 0, excess: 1 }],
          trades: []
        }
      })
    });
  });
  await page.route(/\/api\/valuation\/rows$/, async (route) => {
    const requestBody = route.request().postDataJSON() as { stocks?: Array<Record<string, unknown>> };
    const stock = requestBody.stocks?.[0] ?? {
      code: "600519",
      name: "Kweichow Moutai",
      exchange: "SH",
      board: "Main",
      industry1: "Food & Beverage",
      industry2: "Baijiu",
      region: "Guizhou",
      property: "SOE",
      isST: false,
      isSuspended: false,
      isSTAR: false,
      isMargin: true,
      indexes: [],
      metrics: { price: 1688.88, marketCap: 2100000 }
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "x-stockchoose-data-engine": "rust" },
      body: JSON.stringify([
        {
          stock,
          profile: {
            industry: "Food & Beverage",
            model: "PE",
            earningsWeight: 0.45,
            assetWeight: 0.2,
            salesWeight: 0.15,
            cashflowWeight: 0.2,
            targetPe: 12,
            targetPb: 1.2,
            targetPs: 0.8,
            cashflowMultiple: 8,
            discountRate: 9.5,
            terminalGrowth: 2.2,
            riskBuffer: 34
          },
          state: "Stable",
          model: "PE",
          fairValue: 1800,
          bearValue: 1296,
          bullValue: 1900,
          currentPrice: 1688.88,
          marketCap: 2100000,
          safetyMargin: 6.58,
          upside: 6.58,
          verdict: "Reasonable",
          action: "Track only",
          positionHint: "1-3%",
          qualityScore: 82,
          growthScore: 65,
          solvencyScore: 78,
          governanceScore: 76,
          industryFitScore: 80,
          statusModifier: 0.94,
          governanceModifier: 0.79,
          financialModifier: 0.82,
          riskDiscount: 0.66,
          anchorValue: 3500,
          drivers: ["Rust valuation mock"],
          warnings: [],
          components: {
            earningsValue: 1800,
            assetValue: 300,
            salesValue: 900,
            cashflowValue: 1000,
            anchorValue: 1800,
            weightedValue: 1800,
            cashCoverage: 1.1,
            cashflowRequirementModifier: 1,
            cashflowPolicy: {
              requiredCoverage: 0.9,
              strongCoverage: 1.2,
              floorModifier: 0.3,
              ceilingModifier: 0.76,
              penaltyWeight: 0.22,
              note: "mock"
            },
            balanceSheet: {
              totalAssets: 2550,
              productionAssets: 1290,
              investmentAssets: 1260,
              totalLiabilities: 420,
              interestBearingDebt: 100,
              nonInterestBearingDebt: 320,
              nonInterestDebtReserveRate: 0.35,
              netInvestmentAssets: 1048,
              investmentAssetPerShare: 1,
              netInvestmentAssetPerShare: 0.8,
              interestDebtRatio: 3.92,
              nonInterestDebtRatio: 12.55,
              productionAssetRatio: 50.59
            },
            formulaRows: []
          }
        }
      ])
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
  await expect(page.getByText(/Rust 原生数据接口/)).toBeVisible();
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
  const dailyLimitInput = page.getByLabel("选股数量：");
  await expect(dailyLimitInput).toBeVisible();
  await dailyLimitInput.fill("120");
  await expect(dailyLimitInput).toHaveValue("120");
  await page.getByRole("button", { name: /开始选股/ }).click();
  await expect(page.getByText("每日选股结果")).toBeVisible();
  await expect(page.locator(".selection-table-title")).toContainText(/已选 \d+ \/ 目标 120 只/);

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
  await expect(page.getByLabel("交易客户端复制文本")).toBeHidden();
  await page.getByRole("button", { name: "切换到高级操作" }).click();
  await expect(page.getByRole("button", { name: "切换到普通操作" })).toBeVisible();
  await expect(page.locator(".rebalance-advanced-panel")).toContainText("高级操作");
  await expect(page.getByLabel(/实际股数/).first()).toBeVisible();
  await page.getByLabel("最小买卖金额").fill("5000");
  await page.locator(".rebalance-toolbar").getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("最小买卖金额已保存为 5,000.00")).toBeVisible();
  await page.getByRole("button", { name: "复制到交易客户端" }).click();
  await expect(page.getByText(/已复制 \d+ 条交易客户端指令|浏览器未允许自动复制/)).toBeVisible();
  await expect(page.getByLabel("交易客户端复制文本")).toBeHidden();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出交易指令" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("交易客户端指令");
  await expect(page.getByText(/已导出.*交易客户端指令/)).toBeVisible();
  await expect(page.getByLabel("交易客户端复制文本")).toBeVisible();
  await expect(page.getByLabel("交易客户端复制文本")).toHaveValue(/^\d{6}\t买入\t\d+\.\d{3}\t\d+/);
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
  await page.getByRole("button", { name: "查看日志" }).click();
  await expect(page.getByText(/真实交易日志/)).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("button", { name: "查看历史记录" })).toBeVisible();
  await expect(page.getByText(/当前范围成交：\d+\s*\/\s*\d+笔/)).toBeVisible();
  await page.getByRole("button", { name: "查看历史记录" }).click();
  await expect(page.getByText(/真实成交\/资产记录/)).toBeVisible();

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
  await expect(page.getByText(/Rust 原生数据接口/)).toBeVisible();
  await page.getByRole("button", { name: "同步开源数据" }).click();
  await expect(page.getByText(/开源数据同步完成/)).toBeVisible();
  await expect(page.getByText("2 / 2").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "新闻源接口管理" })).toBeVisible();
  await expect(page.getByText("GDELT 全球新闻").first()).toBeVisible();
  await page.locator(".news-source-card").first().getByRole("button", { name: "测试接口" }).click();
  await expect(page.getByText(/新闻源检测通过/).first()).toBeVisible();
  await page.getByRole("button", { name: "测试模型" }).click();
  await expect(page.getByText(/Rust smoke mock 已完成新闻分析模型检测/)).toBeVisible();
  await page.getByRole("button", { name: "新增新闻源" }).click();
  await expect(page.getByText("自定义新闻源").first()).toBeVisible();
  await page.getByRole("button", { name: "保存新闻源" }).click();
  await expect(page.getByText(/已保存新闻源接口配置/)).toBeVisible();
});
