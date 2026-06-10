import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ensureRustApiRunning, rustApiBaseUrl, stopRustApiSidecar } = require("../electron/rust-api.cjs");

const AKTOOLS_PROVIDER = "AKShare / AKTools \u514d\u8d39\u5f00\u6e90\u6570\u636e";
const GDELT_PROVIDER = "GDELT 2.1";
const TENCENT_NOTICE_PROVIDER = "\u817e\u8baf\u8bc1\u5238\u516c\u544a";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    includeSlow: false,
    json: false,
    keepSidecar: false,
    selfTest: false,
    strictSource: false,
    timeoutMs: 20000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--include-slow") args.includeSlow = true;
    else if (item === "--json") args.json = true;
    else if (item === "--keep-sidecar") args.keepSidecar = true;
    else if (item === "--self-test") args.selfTest = true;
    else if (item === "--strict-source") args.strictSource = true;
    else if (item === "--timeout-ms") {
      const next = Number(argv[index + 1]);
      if (Number.isFinite(next) && next > 0) args.timeoutMs = Math.floor(next);
      index += 1;
    } else if (item === "--help" || item === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: npm.cmd run rust:live-smoke -- [options]",
    "",
    "Options:",
    "  --timeout-ms <ms>   Per-probe timeout, default 20000.",
    "  --include-slow      Include full A-share quote scan.",
    "  --json              Emit machine-readable JSON only.",
    "  --keep-sidecar      Keep a sidecar process started by this script alive.",
    "  --self-test         Run script helper checks without touching the network.",
    "  --strict-source     Fail probes that return rows from a real-source fallback.",
    "",
    "Environment:",
    "  ASHAREHUB_API_KEY   Enables the optional AShareHub probe.",
    "  ASHAREHUB_BASE_URL  Optional, defaults to https://asharehub.com.",
    "  STOCKCHOOSE_RUST_API_URL / STOCKCHOOSE_RUST_PORT are honored by the sidecar bridge."
  ].join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function rowCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return 0;
  for (const key of ["rowCount", "rows", "data", "articles", "announcements", "stocks", "events", "linkedStocks"]) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.length;
  }
  if (payload.plan && typeof payload.plan === "object" && Array.isArray(payload.plan.orders)) {
    return payload.plan.orders.length;
  }
  if (payload.result && typeof payload.result === "object" && Array.isArray(payload.result.rows)) {
    return payload.result.rows.length;
  }
  if (Array.isArray(payload.fills)) return payload.fills.length;
  if (Array.isArray(payload.curve)) return payload.curve.length;
  if (typeof payload.clientText === "string" && payload.clientText.trim()) {
    return payload.clientText.trim().split(/\r?\n/).filter(Boolean).length;
  }
  if (typeof payload.taskCount === "number" && Number.isFinite(payload.taskCount)) return payload.taskCount;
  if (payload.ok === true && payload.provider && payload.model) return 1;
  if (payload.ok === true && (payload.asset || payload.accountAsset || payload.strategyAsset)) return 1;
  return 0;
}

function pathValue(payload, path) {
  return path.split(".").reduce((value, part) => {
    if (value === undefined || value === null) return undefined;
    if (/^\d+$/.test(part)) return Array.isArray(value) ? value[Number(part)] : undefined;
    return typeof value === "object" ? value[part] : undefined;
  }, payload);
}

function validateProbePayload(probe, payload) {
  if (!payload || typeof payload !== "object") {
    return probe.requireFields || probe.requireClientText || probe.requireArrayAt ? "payload must be an object" : "";
  }
  for (const fieldPath of probe.requireFields ?? []) {
    const value = pathValue(payload, fieldPath);
    if (typeof value !== "string" || !value.trim()) return `missing non-empty field ${fieldPath}`;
  }
  for (const fieldPath of probe.requireArrayAt ?? []) {
    const value = pathValue(payload, fieldPath);
    if (!Array.isArray(value) || !value.length) return `missing non-empty array ${fieldPath}`;
  }
  if (probe.requireOk && payload.ok !== true) return "ok must be true";
  if (probe.requireClientText) {
    const text = String(payload.clientText ?? "").trim();
    if (!text) return "clientText is empty";
    const invalidLine = text.split(/\r?\n/).find((line) => line.split("\t").length !== 4);
    if (invalidLine) return `clientText line is not code<TAB>side<TAB>price<TAB>shares: ${invalidLine}`;
  }
  return "";
}

function summarizePayload(payload, text) {
  if (payload && typeof payload === "object") {
    const keys = Object.keys(payload).slice(0, 8);
    const details = [];
    if (typeof payload.message === "string") details.push(payload.message);
    if (typeof payload.details === "string") details.push(payload.details);
    if (keys.length) details.push(`keys=${keys.join(",")}`);
    return details.join(" | ").slice(0, 320);
  }
  return text.trim().slice(0, 320);
}

function fallbackDiagnostics(payload) {
  if (!payload || typeof payload !== "object") return [];
  const diagnostics = [];
  if (typeof payload.fallbackSource === "string" && payload.fallbackSource.trim()) {
    diagnostics.push({
      source: payload.fallbackSource.trim(),
      reason: typeof payload.fallbackReason === "string" ? payload.fallbackReason.trim() : ""
    });
  }
  if (Array.isArray(payload.sourceDiagnostics)) {
    for (const item of payload.sourceDiagnostics) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.fallbackSource === "string" && item.fallbackSource.trim()) {
        diagnostics.push({
          source: item.fallbackSource.trim(),
          reason: typeof item.fallbackReason === "string" ? item.fallbackReason.trim() : "",
          provider: typeof item.provider === "string" ? item.provider.trim() : "",
          sourceName: typeof item.sourceName === "string" ? item.sourceName.trim() : ""
        });
      }
    }
  }
  return diagnostics;
}

function fallbackSummary(diagnostics) {
  return diagnostics
    .map((item) => {
      const from = item.provider || item.sourceName ? `${item.provider || item.sourceName} -> ` : "";
      const reason = item.reason ? ` (${item.reason})` : "";
      return `${from}${item.source}${reason}`;
    })
    .join("; ");
}

function smokeStock(code, name, metrics = {}) {
  return {
    code,
    name,
    exchange: "",
    board: "",
    industry1: "",
    industry2: "",
    region: "",
    property: "",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: true,
    indexes: [],
    metrics
  };
}

function workflowStocks() {
  return [
    smokeStock("600519", "Kweichow Moutai", {
      price: 1500,
      pe: 24,
      roe: 31,
      amount: 25,
      marketCap: 19000,
      floatMarketCap: 19000
    }),
    smokeStock("000001", "Ping An Bank", {
      price: 12,
      pe: 6,
      roe: 11,
      amount: 18,
      marketCap: 2400,
      floatMarketCap: 2400
    }),
    smokeStock("000858", "Wuliangye", {
      price: 140,
      pe: 21,
      roe: 25,
      amount: 20,
      marketCap: 5400,
      floatMarketCap: 5400
    }),
    smokeStock("600000", "SPDB", {
      price: 8,
      pe: 5,
      roe: 9,
      amount: 14,
      marketCap: 2300,
      floatMarketCap: 2300
    })
  ];
}

function workflowFactors() {
  return [
    { key: "pe", name: "PE", group: "valuation", description: "Price earnings ratio", defaultOrder: "asc", precision: 2 },
    { key: "roe", name: "ROE", group: "quality", description: "Return on equity", defaultOrder: "desc", precision: 2 },
    { key: "amount", name: "Amount", group: "liquidity", description: "Trading amount", defaultOrder: "desc", precision: 2 }
  ];
}

function workflowPools() {
  return [{ id: "all", name: "All A-share", type: "static", codes: [], description: "Live smoke all-stock pool" }];
}

function workflowStrategy() {
  return {
    id: "live-smoke-daily",
    name: "Live smoke daily selection",
    description: "Rust live smoke strategy workflow",
    poolId: "all",
    hotPoolId: "all",
    poolLimit: 3,
    screenPeriod: 1,
    industryStandard: "test",
    indexMember: "",
    board: "",
    industry1: "",
    industry2: "",
    stMode: "",
    exchange: "",
    region: "",
    property: "",
    marginFlag: "",
    starMode: "",
    filterSuspended: true,
    filters: [
      { id: "filter-pe-lte-30", factorKey: "pe", operator: "lte", value: 30, range: "", enabled: true }
    ],
    ranks: [
      { id: "rank-roe", factorKey: "roe", order: "desc", range: "", weight: 70, enabled: true },
      { id: "rank-pe", factorKey: "pe", order: "asc", range: "", weight: 30, enabled: true }
    ],
    trading: {
      maxHoldings: 2,
      maxBuyPosition: 100,
      weightMethod: "equal"
    },
    timing: {},
    hedge: {},
    assets: []
  };
}

function workflowStrategyBody(extra = {}) {
  return {
    strategy: workflowStrategy(),
    stocks: workflowStocks(),
    pools: workflowPools(),
    factors: workflowFactors(),
    ...extra
  };
}

function valuationSmokeStock() {
  return smokeStock("600519", "Kweichow Moutai", {
    realAnnualReportDate: 20251231
  });
}

function sampleSelectionRows() {
  const [first, second] = workflowStocks();
  return [
    { stock: first, score: 96.5, weight: 60, passedFilters: 1 },
    { stock: second, score: 88.2, weight: 40, passedFilters: 1 }
  ];
}

function sampleTradePlan() {
  return {
    id: "plan-live-smoke",
    strategyId: "live-smoke-daily",
    strategyName: "Live smoke daily selection",
    accountId: "PAPER-0001",
    mode: "manual",
    generatedAt: "2026-06-10T00:00:00Z",
    status: "draft",
    orders: [
      {
        clientOrderId: "live-smoke-0",
        code: "SH600519",
        name: "Kweichow Moutai",
        side: "BUY",
        shares: 100,
        price: 1500,
        amount: 150000,
        status: "pending"
      },
      {
        clientOrderId: "live-smoke-1",
        code: "SZ000001",
        name: "Ping An Bank",
        side: "BUY",
        shares: 1000,
        price: 12,
        amount: 12000,
        status: "pending"
      }
    ]
  };
}

function sentimentSmokeArticle() {
  return {
    id: "live-smoke-news-600519",
    title: "Kweichow Moutai completed share repurchase and market sentiment improved",
    summary: "A real-source announcement style article links directly to 600519 and the food beverage industry.",
    content: "The company announcement shows the repurchase implementation was completed. Investors should still verify the original filing.",
    source: "Tencent Securities Announcement",
    sourceIcon: "T",
    category: "Company Announcement",
    sentiment: "Positive",
    importance: "Important",
    status: "unread",
    publishedAt: "2026-06-09 18:42:12",
    fetchedAt: "2026-06-09T18:45:00.000Z",
    url: "https://proxy.finance.qq.com/notice/live-smoke",
    imageUrl: "",
    author: "Tencent Securities Announcement",
    readTime: 1,
    linkedCodes: ["600519"],
    linkedStocks: [{ code: "600519", name: "Kweichow Moutai" }],
    industries: ["Food & Beverage", "Baijiu"],
    tags: ["announcement", "repurchase", "600519"],
    viewCount: 0,
    commentCount: 0
  };
}

function sentimentSmokeEvent() {
  return {
    id: "real-news-live-smoke-news-600519",
    title: "Kweichow Moutai completed share repurchase and market sentiment improved",
    summary: "A real-source announcement style event links directly to 600519.",
    category: "Capital Market",
    direction: "Positive",
    horizon: "Short Term",
    severity: "Major",
    occurredAt: "2026-06-09 18:42:12",
    source: "Tencent Securities Announcement",
    sourceWeight: 88,
    impact: 86,
    relevance: 88,
    confidence: 88,
    novelty: 58,
    persistence: 58,
    riskPenalty: 4,
    industries: ["Food & Beverage", "Baijiu"],
    keywords: ["announcement", "repurchase", "600519"],
    linkedCodes: ["600519"]
  };
}

function newsAnalysisModelSmokeBody() {
  return {
    enabled: true,
    provider: "\u672c\u5730\u89c4\u5219\u6a21\u578b",
    baseUrl: "local://news-rule-engine",
    apiKey: "",
    model: "local-news-rule-v1",
    timeoutSeconds: 20,
    maxTokens: 1200,
    temperature: 0.2,
    systemPrompt: "Analyze A-share news sentiment using local Rust rules.",
    tasks: ["sentiment", "eventExtraction", "stockMapping", "riskSummary"]
  };
}

async function requestProbe(baseUrl, probe, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${probe.path}`, {
      method: probe.method ?? "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
        ...(probe.body ? { "content-type": "application/json" } : {}),
        ...(probe.headers ?? {})
      },
      body: probe.body ? JSON.stringify(probe.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = safeJsonParse(text);
    const rows = rowCount(payload);
    const fallbacks = fallbackDiagnostics(payload);
    const fallback = fallbacks.length > 0;
    const fallbackAllowed = fallback && !options.strictSource;
    const validationError = validateProbePayload(probe, payload);
    const ok = response.ok && (!probe.requireRows || rows > 0) && !validationError && (!fallback || fallbackAllowed);
    const details = summarizePayload(payload, text);
    const fallbackDetails = fallback ? `fallback=${fallbackSummary(fallbacks)}` : "";
    const validationDetails = validationError ? `validation=${validationError}` : "";
    return {
      name: probe.name,
      category: probe.category,
      required: probe.required !== false,
      ok,
      status: response.status,
      rows,
      fallback,
      fallbackDiagnostics: fallbacks,
      durationMs: Date.now() - started,
      details: [details, validationDetails, fallbackDetails].filter(Boolean).join(" | ")
    };
  } catch (error) {
    return {
      name: probe.name,
      category: probe.category,
      required: probe.required !== false,
      ok: false,
      status: 0,
      rows: 0,
      fallback: false,
      fallbackDiagnostics: [],
      durationMs: Date.now() - started,
      details: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeDefinitions({ includeSlow }) {
  const probes = [
    {
      name: "health",
      category: "sidecar",
      path: "/health"
    },
    {
      name: "native AKTools source test",
      category: "integration",
      method: "POST",
      path: "/api/integration/source-test",
      requireRows: true,
      body: {
        provider: AKTOOLS_PROVIDER,
        baseUrl: "/aktools/api/public",
        modules: { market: true, finance: true, news: false, filing: false }
      }
    },
    {
      name: "Eastmoney A-share spot",
      category: "market",
      path: "/api/market/ashare/spot",
      requireRows: true
    },
    {
      name: "Tencent quote rows",
      category: "market",
      path: "/api/market/tencent/quote-rows?q=sh600519",
      requireRows: true
    },
    {
      name: "Tencent kline points",
      category: "market",
      path: "/api/market/tencent/kline-points?symbol=sh600519&period=day&limit=90",
      requireRows: true
    },
    {
      name: "technical indicators",
      category: "market",
      path: "/api/market/technical-indicators?codes=600519&limit=90",
      requireRows: true
    },
    {
      name: "Eastmoney annual financial metrics",
      category: "finance",
      path: "/api/finance/metrics/2025-12-31",
      requireRows: true
    },
    {
      name: "Eastmoney analyst forecasts",
      category: "finance",
      path: "/api/finance/analyst-forecasts",
      requireRows: true
    },
    {
      name: "Eastmoney margin balances",
      category: "finance",
      path: "/api/finance/margin-balances",
      requireRows: true
    },
    {
      name: "filing announcements",
      category: "filing",
      method: "POST",
      path: "/api/filing/announcements",
      requireRows: true,
      body: { codes: ["600519"], maxItems: 3 }
    },
    {
      name: "GDELT news",
      category: "news",
      path: "/api/news/gdelt?query=China%20A-shares%20stock%20market&max_records=3",
      requireRows: true,
      delayAfterMs: 5500
    },
    {
      name: "news articles through source contract",
      category: "news",
      method: "POST",
      path: "/api/news/articles",
      requireRows: true,
      body: {
        mode: "fast",
        stocks: [],
        sources: [
          {
            id: "live-smoke-gdelt",
            name: "GDELT live smoke",
            provider: GDELT_PROVIDER,
            baseUrl: "https://api.gdeltproject.org/api/v2/doc/doc",
            apiToken: "",
            language: "zh-CN",
            enabled: true,
            maxItems: 3,
            query: "China A-shares stock market"
          }
        ]
      }
    },
    {
      name: "announcement news source contract",
      category: "news",
      method: "POST",
      path: "/api/news/articles",
      requireRows: true,
      body: {
        mode: "fast",
        stocks: [{ code: "600519", name: "600519", exchange: "\u6caa\u5e02", board: "\u4e3b\u677f", industry1: "", industry2: "", region: "", property: "\u56fd\u4f01", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: [], metrics: {} }],
        sources: [
          {
            id: "live-smoke-announcement",
            name: "Announcement live smoke",
            provider: TENCENT_NOTICE_PROVIDER,
            baseUrl: "https://proxy.finance.qq.com/notice",
            apiToken: "",
            language: "zh-CN",
            enabled: true,
            maxItems: 3,
            query: "600519"
          }
        ]
      }
    },
    {
      name: "news source test workflow",
      category: "news-workflow",
      method: "POST",
      path: "/api/news/source-test",
      requireRows: true,
      requireOk: true,
      body: {
        source: {
          id: "live-smoke-source-test-announcement",
          name: "Announcement source test",
          provider: TENCENT_NOTICE_PROVIDER,
          baseUrl: "https://proxy.finance.qq.com/notice",
          apiToken: "",
          language: "zh-CN",
          enabled: true,
          maxItems: 1,
          query: "600519"
        }
      }
    },
    {
      name: "sentiment event generation workflow",
      category: "sentiment-workflow",
      method: "POST",
      path: "/api/sentiment/events",
      requireRows: true,
      body: {
        articles: [sentimentSmokeArticle()],
        stocks: workflowStocks()
      }
    },
    {
      name: "sentiment linked-stock analysis workflow",
      category: "sentiment-workflow",
      method: "POST",
      path: "/api/sentiment/analysis",
      requireRows: true,
      requireFields: ["report.conclusion"],
      requireArrayAt: ["report.validationPoints"],
      body: {
        events: [sentimentSmokeEvent()],
        stocks: workflowStocks(),
        analysisModel: newsAnalysisModelSmokeBody()
      }
    },
    {
      name: "news analysis local rule test workflow",
      category: "sentiment-workflow",
      method: "POST",
      path: "/api/news-analysis/local-test",
      requireRows: true,
      requireOk: true,
      body: {
        tasks: ["sentiment", "eventExtraction", "stockMapping", "riskSummary"]
      }
    },
    {
      name: "news analysis model test workflow",
      category: "sentiment-workflow",
      method: "POST",
      path: "/api/news-analysis/model-test",
      requireRows: true,
      requireOk: true,
      requireFields: ["details"],
      body: newsAnalysisModelSmokeBody()
    },
    {
      name: "annual report real fetch",
      category: "finance-workflow",
      method: "POST",
      path: "/api/finance/annual-reports",
      requireRows: true,
      requireFields: ["0.sourceCsv"],
      body: { stock: valuationSmokeStock() }
    },
    {
      name: "valuation real-data enrichment",
      category: "valuation-workflow",
      method: "POST",
      path: "/api/valuation/rows",
      requireRows: true,
      body: {
        stocks: [valuationSmokeStock()],
        filters: {
          board: "",
          industry: "",
          state: "",
          ownership: "",
          style: "balanced",
          minSafetyMargin: -999,
          minGovernanceScore: 0
        }
      }
    },
    {
      name: "strategy daily selection workflow",
      category: "strategy-workflow",
      method: "POST",
      path: "/api/strategy/screen",
      requireRows: true,
      body: workflowStrategyBody({ resultLimit: 3, weightLimit: 2 })
    },
    {
      name: "strategy ranking workflow",
      category: "strategy-workflow",
      method: "POST",
      path: "/api/strategy/rank",
      requireRows: true,
      body: workflowStrategyBody()
    },
    {
      name: "strategy real-kline backtest workflow",
      category: "strategy-workflow",
      method: "POST",
      path: "/api/strategy/backtest",
      requireRows: true,
      requireArrayAt: ["curve", "trades"],
      body: workflowStrategyBody({
        config: {
          startDate: "2025-01-02",
          endDate: "2025-03-31",
          benchmark: "HS300",
          cost: 0.3,
          excludeTimeRange: false
        }
      })
    },
    {
      name: "strategy real-kline optimize workflow",
      category: "strategy-workflow",
      method: "POST",
      path: "/api/strategy/optimize",
      requireRows: true,
      requireArrayAt: ["result.curve"],
      body: workflowStrategyBody({
        config: {
          startDate: "2025-01-02",
          endDate: "2025-03-31",
          benchmark: "HS300",
          cost: 0.3,
          excludeTimeRange: false
        }
      })
    },
    {
      name: "trade plan generation workflow",
      category: "trade-workflow",
      method: "POST",
      path: "/api/trade/plan",
      requireRows: true,
      requireClientText: true,
      body: {
        strategy: workflowStrategy(),
        rows: sampleSelectionRows(),
        mode: "manual",
        accountId: "PAPER-0001",
        accountAsset: 500000,
        minimumAmount: 1000
      }
    },
    {
      name: "trade export client-copy workflow",
      category: "trade-workflow",
      method: "POST",
      path: "/api/trade/export",
      requireRows: true,
      requireClientText: true,
      body: { plan: sampleTradePlan() }
    },
    {
      name: "paper trade submit workflow",
      category: "trade-workflow",
      method: "POST",
      path: "/api/trade/paper/submit",
      requireRows: true,
      body: {
        state: { plans: [], fills: [] },
        plan: sampleTradePlan()
      }
    },
    {
      name: "manual asset sync workflow",
      category: "trade-workflow",
      method: "POST",
      path: "/api/trade/assets/sync",
      requireRows: true,
      body: {
        asset: {
          netValue: 1.025,
          holdingValue: 320000,
          strategyCash: 180000,
          outsideAsset: 500000
        }
      }
    }
  ];

  if (includeSlow) {
    probes.push({
      name: "Tencent all A-share quote scan",
      category: "market",
      path: "/api/market/tencent/ashare/quotes",
      requireRows: true
    });
  }

  const asharehubKey = process.env.ASHAREHUB_API_KEY || "";
  if (asharehubKey.trim()) {
    probes.push({
      name: "AShareHub reference stocks",
      category: "integration",
      method: "POST",
      path: "/api/integration/asharehub/rows",
      requireRows: true,
      body: {
        baseUrl: process.env.ASHAREHUB_BASE_URL || "https://asharehub.com",
        endpoint: "reference/stocks",
        params: { limit: "2" },
        apiToken: asharehubKey
      }
    });
  } else {
    probes.push({
      name: "AShareHub reference stocks",
      category: "integration",
      required: false,
      skip: true,
      details: "skipped: set ASHAREHUB_API_KEY to probe AShareHub"
    });
  }

  return probes;
}

function renderText(result) {
  const lines = [
    `Rust live data smoke: ${result.ok ? "PASS" : "FAIL"}${result.warningCount ? ` (warnings: ${result.warningCount})` : ""}`,
    `Base URL: ${result.baseUrl}`,
    `Duration: ${result.durationMs} ms`,
    ""
  ];
  for (const probe of result.probes) {
    if (probe.skip) {
      lines.push(`SKIP ${probe.category} / ${probe.name}: ${probe.details}`);
      continue;
    }
    const status = probe.ok ? (probe.fallback ? "WARN" : "OK  ") : probe.required ? "FAIL" : "WARN";
    lines.push(`${status} ${probe.category} / ${probe.name}: HTTP ${probe.status}, rows=${probe.rows}, ${probe.durationMs} ms`);
    if (!probe.ok || probe.details) lines.push(`     ${probe.details || "no details"}`);
  }
  return lines.join("\n");
}

function runSelfTest() {
  const fallbackPayload = { articles: [{}], fallbackSource: "eastmoney", fallbackReason: "GDELT timeout" };
  const diagnosticsPayload = {
    articles: [{}],
    sourceDiagnostics: [
      { provider: "GDELT 2.1", fallbackSource: "eastmoney", fallbackReason: "timeout" }
    ]
  };
  const planPayload = { plan: { orders: [{ code: "600519" }, { code: "000001" }] } };
  const optimizePayload = { result: { rows: [{ stock: { code: "600519" } }] } };
  const clientTextPayload = { clientText: "600519\tBUY\t1500.000\t100\n000001\tBUY\t12.000\t1000" };
  const taskPayload = { ok: true, taskCount: 4 };
  const modelPayload = { ok: true, provider: "\u672c\u5730\u89c4\u5219\u6a21\u578b", model: "local-news-rule-v1" };
  const checks = [
    rowCount([{ id: 1 }]) === 1,
    rowCount({ articles: [{ id: 1 }, { id: 2 }] }) === 2,
    rowCount(planPayload) === 2,
    rowCount(optimizePayload) === 1,
    rowCount(taskPayload) === 4,
    rowCount(modelPayload) === 1,
    pathValue({ a: [{ b: "ok" }] }, "a.0.b") === "ok",
    validateProbePayload({ requireOk: true }, modelPayload) === "",
    validateProbePayload({ requireClientText: true }, clientTextPayload) === "",
    validateProbePayload({ requireFields: ["a.0.b"] }, { a: [{ b: "ok" }] }) === "",
    fallbackDiagnostics({ articles: [] }).length === 0,
    fallbackDiagnostics(fallbackPayload)[0]?.source === "eastmoney",
    fallbackDiagnostics(diagnosticsPayload)[0]?.provider === "GDELT 2.1",
    fallbackSummary(fallbackDiagnostics(fallbackPayload)).includes("GDELT timeout")
  ];
  if (checks.some((ok) => !ok)) {
    throw new Error("rust-live-smoke self-test failed");
  }
  console.log("rust-live-smoke self-test passed");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  if (typeof fetch !== "function") {
    throw new Error("Node.js fetch is not available; use Node.js 18+.");
  }

  const started = Date.now();
  const running = await ensureRustApiRunning();
  if (!running) {
    throw new Error("Rust API is unavailable. Run `npm.cmd run rust:build` first or set STOCKCHOOSE_RUST_API_URL.");
  }
  const baseUrl = rustApiBaseUrl();
  const probes = [];
  for (const probe of probeDefinitions(args)) {
    if (probe.skip) {
      probes.push(probe);
      continue;
    }
    probes.push(await requestProbe(baseUrl, probe, args.timeoutMs, { strictSource: args.strictSource }));
    if (probe.delayAfterMs) await delay(probe.delayAfterMs);
  }

  const requiredProbes = probes.filter((probe) => probe.required !== false && !probe.skip);
  const ok = requiredProbes.every((probe) => probe.ok);
  const warningCount = probes.filter((probe) => probe.fallback).length;
  const result = {
    ok,
    baseUrl,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    strictSource: args.strictSource,
    warningCount,
    probes
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderText(result));
  }
  process.exitCode = ok ? 0 : 1;

  if (!args.keepSidecar) {
    stopRustApiSidecar();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
