import { describe, expect, it, vi } from "vitest";
import { createDefaultStrategy } from "./storage";
import {
  optimizeStrategy,
  optimizeStrategyBunFirst,
  rankingAnalysis,
  rankingAnalysisBunFirst,
  runBacktest,
  runBacktestBunFirst,
  screenStocks,
  screenStocksBunFirst
} from "./strategyEngine";
import type { Factor, RankCondition, Stock, StockPool, StrategyConfig } from "./types";

const factors: Factor[] = [
  {
    key: "valueScore",
    name: "价值得分",
    group: "自定义",
    description: "测试用价值指标",
    defaultOrder: "desc"
  }
];

function stock(code: string, industry2: string, valueScore: number): Stock {
  return {
    code,
    name: code,
    exchange: code.startsWith("6") ? "沪市" : "深市",
    board: "主板",
    industry1: "测试行业",
    industry2,
    region: "测试地区",
    property: "民企",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: false,
    indexes: [],
    metrics: { valueScore, amount: 0 }
  };
}

const stocks = [
  stock("600001", "行业A", 100),
  stock("600002", "行业A", 90),
  stock("600003", "行业B", 80),
  stock("600004", "行业B", 10)
];

const pools: StockPool[] = [
  {
    id: "all",
    name: "全部股票",
    type: "static",
    codes: stocks.map((item) => item.code)
  }
];

function strategy(patch: Partial<StrategyConfig>): StrategyConfig {
  const base = createDefaultStrategy();
  return {
    ...base,
    poolId: "all",
    hotPoolId: "all",
    filters: [],
    ranks: [],
    trading: {
      ...base.trading,
      maxHoldings: 10
    },
    ...patch
  };
}

describe("strategyEngine", () => {
  it("screens daily selections locally by strategy rank and limit", () => {
    const rows = screenStocks(
      strategy({
        poolLimit: 2,
        ranks: [
          {
            id: "rank-all",
            factorKey: "valueScore",
            order: "desc",
            range: "\u5168\u90e8",
            weight: 100,
            enabled: true
          }
        ]
      }),
      stocks,
      pools,
      factors,
      { resultLimit: 2 }
    );

    expect(rows.map((row) => row.stock.code)).toEqual(["600001", "600002"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  it("matches industry selectors from normalized industry tags", () => {
    const taggedStocks: Stock[] = [
      {
        ...stock("600519", "\u817e\u8baf\u884c\u60c5", 100),
        industry1: "\u672a\u5206\u7c7b",
        industryTags: ["\u98df\u54c1\u996e\u6599", "\u767d\u9152"]
      },
      {
        ...stock("000001", "\u94f6\u884c", 90),
        industry1: "\u672a\u5206\u7c7b",
        industryTags: ["\u975e\u94f6\u91d1\u878d"]
      }
    ];
    const taggedPools: StockPool[] = [{ id: "all", name: "all", type: "static", codes: taggedStocks.map((item) => item.code) }];

    const rows = screenStocks(
      strategy({
        poolLimit: 10,
        industry1: "\u98df\u54c1\u996e\u6599",
        industry2: "\u767d\u9152",
        ranks: [{ id: "rank-all", factorKey: "valueScore", order: "desc", range: "\u5168\u90e8", weight: 100, enabled: true }]
      }),
      taggedStocks,
      taggedPools,
      factors
    );

    expect(rows.map((row) => row.stock.code)).toEqual(["600519"]);
  });

  it("filters delisted stocks only when the selector is enabled", () => {
    const delistedStocks: Stock[] = [
      { ...stock("600005", "行业A", 100), name: "退市股票" },
      { ...stock("600006", "行业A", 90), name: "股票退" },
      { ...stock("600007", "行业A", 80), name: "正常股票" }
    ];
    const delistedPools: StockPool[] = [{ id: "all", name: "all", type: "static", codes: delistedStocks.map((item) => item.code) }];
    const rank: RankCondition[] = [{ id: "rank-all", factorKey: "valueScore", order: "desc", range: "全部", weight: 100, enabled: true }];

    const defaults = screenStocks(strategy({ poolLimit: 10, ranks: rank }), delistedStocks, delistedPools, factors);
    expect(defaults.map((row) => row.stock.code)).toEqual(["600005", "600006", "600007"]);

    const excluded = screenStocks(
      strategy({ poolLimit: 10, excludeDelisted: true, ranks: rank }),
      delistedStocks,
      delistedPools,
      factors
    );
    expect(excluded.map((row) => row.stock.code)).toEqual(["600007"]);
  });

  it("builds local rank, backtest, and optimization results", () => {
    const baseStrategy = strategy({
      poolLimit: 3,
      ranks: [
        {
          id: "rank-all",
          factorKey: "valueScore",
          order: "desc",
          range: "\u5168\u90e8",
          weight: 100,
          enabled: true
        }
      ]
    });
    const config = {
      startDate: "2024-01-01",
      endDate: "2024-03-01",
      benchmark: "沪深300",
      cost: 0.2,
      excludeTimeRange: false
    };

    const ranked = rankingAnalysis(baseStrategy, stocks, pools, factors);
    const backtest = runBacktest(baseStrategy, stocks, pools, factors, config);
    const noSelectionBacktest = runBacktest(baseStrategy, [], [], factors, config);
    const optimized = optimizeStrategy(baseStrategy, stocks, pools, factors, config);

    expect(ranked[0]).toMatchObject({ rank: 1, stock: { code: "600001" } });
    expect(backtest.rows.map((row) => row.stock.code)).toEqual(["600001", "600002", "600003"]);
    expect(backtest.curve.length).toBeGreaterThan(0);
    expect(backtest.methodology).toEqual({
      mode: "rule-simulation",
      usesHistoricalPrices: false,
      disclaimer: "基于当前股票快照、因子分数和确定性规则生成，不读取逐日历史成交价格，不代表真实历史收益。"
    });
    expect(Object.values(backtest.metrics).every(Number.isFinite)).toBe(true);
    expect(noSelectionBacktest).toMatchObject({
      methodology: backtest.methodology,
      rows: []
    });
    expect(optimized.result.curve.length).toBeGreaterThan(0);
    expect(optimized.result.methodology).toEqual(backtest.methodology);
    expect(optimized.candidate.trading.maxHoldings).toBeGreaterThan(0);
  });

  it("uses the Bun screen endpoint for daily selection rows", async () => {
    const bunRows = [
      {
        stock: stocks[0],
        score: 100,
        weight: 60,
        passedFilters: 1
      },
      {
        stock: stocks[1],
        score: 90,
        weight: 40,
        passedFilters: 1
      }
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(bunRows), { status: 200 }));

    const rows = await screenStocksBunFirst(strategy({ poolLimit: 4 }), stocks, pools, factors, { resultLimit: 4, weightLimit: 2 }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/strategy/screen",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      resultLimit: 4,
      weightLimit: 2
    });
    expect(rows).toEqual(bunRows);
  });

  it("uses the Bun rank endpoint for ranking analysis", async () => {
    const bunRows = [
      {
        stock: stocks[1],
        score: 99,
        rank: 1,
        values: { valueScore: 90 }
      }
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bunRows), { status: 200 }));
    const rows = await rankingAnalysisBunFirst(
      strategy({
        ranks: [
          {
            id: "rank-all",
            factorKey: "valueScore",
            order: "desc",
            range: "全部",
            weight: 100,
            enabled: true
          }
        ]
      }),
      stocks,
      pools,
      factors,
      fetchImpl as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/strategy/rank",
      expect.objectContaining({ method: "POST" })
    );
    expect(rows).toEqual(bunRows);
  });

  it("throws a visible error when the Bun screen endpoint fails", async () => {
    const localRows = screenStocks(
      strategy({
        ranks: [
          {
            id: "rank-all",
            factorKey: "valueScore",
            order: "desc",
            range: "全部",
            weight: 100,
            enabled: true
          }
        ]
      }),
      stocks,
      pools,
      factors
    );
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));

    expect(localRows.map((row) => row.stock.code)).toEqual(["600001", "600002", "600003", "600004"]);
    await expect(screenStocksBunFirst(strategy({}), stocks, pools, factors, {}, fetchImpl as typeof fetch)).rejects.toThrow(
      "Bun strategy screen API HTTP 503"
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/strategy/screen",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws a visible error when the Bun screen endpoint returns invalid rows", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ stock: stocks[0], score: "bad" }]), { status: 200 }));

    await expect(screenStocksBunFirst(strategy({}), stocks, pools, factors, {}, fetchImpl as typeof fetch)).rejects.toThrow(
      "invalid selection row"
    );
  });

  it("throws a visible error when the Bun rank endpoint fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));

    await expect(rankingAnalysisBunFirst(strategy({}), stocks, pools, factors, fetchImpl as typeof fetch)).rejects.toThrow(
      "Bun strategy rank API HTTP 503"
    );
  });

  it("throws a visible error when the Bun rank endpoint returns invalid rows", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ stock: stocks[0], rank: 1, values: {} }]), { status: 200 }));

    await expect(rankingAnalysisBunFirst(strategy({}), stocks, pools, factors, fetchImpl as typeof fetch)).rejects.toThrow(
      "invalid ranking row"
    );
  });

  it("uses the Bun backtest endpoint for backtests", async () => {
    const bunResult = {
      methodology: {
        mode: "rule-simulation" as const,
        usesHistoricalPrices: false as const,
        disclaimer: "基于当前股票快照、因子分数和确定性规则生成，不读取逐日历史成交价格，不代表真实历史收益。" as const
      },
      rows: [],
      curve: [{ date: "2024-01-01", strategy: 1.01, benchmark: 1.02, hedge: 1.01 }],
      metrics: {
        cumulativeReturn: 1,
        annualReturn: 2,
        maxDrawdown: -1,
        sharpe: 0.5,
        volatility: 3,
        winRate: 60,
        turnover: 20
      },
      yearly: [{ year: "2024", strategy: 1, benchmark: 2, excess: -1 }],
      trades: []
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bunResult), { status: 200 }));
    const result = await runBacktestBunFirst(
      strategy({}),
      stocks,
      pools,
      factors,
      {
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        benchmark: "沪深300",
        cost: 0.2,
        excludeTimeRange: false
      },
      fetchImpl as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/strategy/backtest",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual(bunResult);
  });

  it("rejects Bun backtest results without rule-simulation methodology", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          rows: [],
          curve: [],
          metrics: { cumulativeReturn: 0, annualReturn: 0, maxDrawdown: 0, sharpe: 0, volatility: 0, winRate: 0, turnover: 0 },
          yearly: [],
          trades: []
        }),
        { status: 200 }
      )
    );

    await expect(
      runBacktestBunFirst(
        strategy({}),
        stocks,
        pools,
        factors,
        {
          startDate: "2024-01-01",
          endDate: "2024-03-01",
          benchmark: "沪深300",
          cost: 0.2,
          excludeTimeRange: false
        },
        fetchImpl as typeof fetch
      )
    ).rejects.toThrow("Bun strategy backtest API returned invalid backtest methodology");
  });

  it("throws a visible error when the Bun backtest endpoint fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));

    await expect(
      runBacktestBunFirst(
      strategy({}),
      stocks,
      pools,
      factors,
      {
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        benchmark: "娌繁300",
        cost: 0.2,
        excludeTimeRange: false
      },
        fetchImpl as typeof fetch
      )
    ).rejects.toThrow("Bun strategy backtest API HTTP 503");
  });

  it("uses the Bun optimize endpoint for strategy optimization", async () => {
    const bunResult = {
      candidate: strategy({
        trading: {
          ...createDefaultStrategy().trading,
          maxHoldings: 6
        }
      }),
      result: {
        methodology: {
          mode: "rule-simulation" as const,
          usesHistoricalPrices: false as const,
          disclaimer: "基于当前股票快照、因子分数和确定性规则生成，不读取逐日历史成交价格，不代表真实历史收益。" as const
        },
        rows: [],
        curve: [{ date: "2024-01-01", strategy: 1.01, benchmark: 1.02, hedge: 1.01 }],
        metrics: {
          cumulativeReturn: 1,
          annualReturn: 2,
          maxDrawdown: -1,
          sharpe: 1.5,
          volatility: 3,
          winRate: 60,
          turnover: 20
        },
        yearly: [{ year: "2024", strategy: 1, benchmark: 2, excess: -1 }],
        trades: []
      }
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bunResult), { status: 200 }));
    const result = await optimizeStrategyBunFirst(
      strategy({}),
      stocks,
      pools,
      factors,
      {
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        benchmark: "沪深300",
        cost: 0.2,
        excludeTimeRange: false
      },
      fetchImpl as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/strategy/optimize",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual(bunResult);
  });

  it("throws a visible error when the Bun optimize endpoint fails", async () => {
    const baseStrategy = strategy({});
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));

    await expect(
      optimizeStrategyBunFirst(
      baseStrategy,
      stocks,
      pools,
      factors,
      {
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        benchmark: "娌繁300",
        cost: 0.2,
        excludeTimeRange: false
      },
        fetchImpl as typeof fetch
      )
    ).rejects.toThrow("Bun strategy optimize API HTTP 503");
  });
});
