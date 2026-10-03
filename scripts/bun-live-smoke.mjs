import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (!process.env.STOCKCHOOSE_BUN_API_URL && !process.env.STOCKCHOOSE_BUN_PORT) {
  process.env.STOCKCHOOSE_BUN_PORT = String(19000 + Math.floor(Math.random() * 1000));
}
const { ensureBunApiRunning, bunApiBaseUrl, bunApiRequestHeaders, stopBunApiSidecar } = require("../electron/bun-api.cjs");

function parseArgs(argv) {
  const args = { json: false, keepSidecar: false, timeoutMs: 30000 };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--json") args.json = true;
    else if (item === "--keep-sidecar") args.keepSidecar = true;
    else if (item === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1]) || args.timeoutMs;
      index += 1;
    } else if (item === "--help" || item === "-h") args.help = true;
    else throw new Error("Unknown argument: " + item);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm.cmd run bun:live-smoke -- [options]",
    "",
    "Options:",
    "  --timeout-ms <ms>   Per-probe timeout, default 30000.",
    "  --json              Emit machine-readable JSON only.",
    "  --keep-sidecar      Keep a sidecar process started by this script alive."
  ].join("\n");
}

function smokeStock(code, name, metrics = {}) {
  return {
    code,
    name,
    exchange: code.startsWith("6") ? "SH" : "SZ",
    board: "main",
    industry1: "finance",
    industry2: "bank",
    region: "unknown",
    property: "private",
    isST: false,
    isSuspended: false,
    isSTAR: false,
    isMargin: true,
    indexes: [],
    metrics
  };
}

function workflowPayload() {
  const stocks = [
    smokeStock("600519", "Kweichow Moutai", { price: 1500, pe: 24, roe: 31, amount: 25, marketCap: 19000, valueScore: 90 }),
    smokeStock("000001", "Ping An Bank", { price: 12, pe: 6, pb: 0.6, roe: 11, amount: 18, marketCap: 2400, valueScore: 75, eps: 2.1, bps: 20, revenue: 1300, netProfit: 420, operatingCashflow: 500, totalAssets: 56000, totalLiabilities: 51000, investmentAssets: 22000, productionAssets: 34000, interestBearingDebt: 5000, nonInterestBearingDebt: 46000 }),
    smokeStock("000858", "Wuliangye", { price: 140, pe: 21, roe: 25, amount: 20, marketCap: 5400, valueScore: 60 })
  ];
  const strategy = {
    id: "bun-smoke",
    name: "Bun smoke strategy",
    description: "Bun smoke strategy",
    poolId: "all",
    hotPoolId: "all",
    poolLimit: 3,
    screenPeriod: 1,
    industryStandard: "test",
    indexMember: "all",
    board: "all",
    industry1: "all",
    industry2: "all",
    stMode: "exclude-st",
    exchange: "all",
    region: "all",
    property: "all",
    marginFlag: "all",
    starMode: "include-star",
    filterSuspended: true,
    filters: [{ id: "value", factorKey: "valueScore", operator: "gte", value: 50, range: "all", enabled: true }],
    ranks: [{ id: "rank", factorKey: "valueScore", order: "desc", range: "all", weight: 100, enabled: true }],
    trading: { mode: "model", period: 1, orderTime: "close", cashAsset: "cash", realtimeBacktest: false, multiPoint: false, maxHoldings: 2, idealPosition: 95, positionDeviation: 5, minPosition: 0, backupCount: 1, maxBuyPosition: 50, weightMethod: "equal", advancedOpen: false, tradeDate: "2026-06-11", sellSuspended: false, shortSelling: "disabled", industryLimitRatio: 100, positionExpression: "", industryNeutralBenchmark: "CSI300", buyRules: [], sellRules: [], holdRules: [] },
    timing: { mode: "", template: "", index: "CSI300", threshold: 0, formula: "", cashWhenTimingOut: "cash" },
    hedge: { enabled: false, contract: "IF", ratio: 0, benchmark: "CSI300", rebalance: 1, cost: 0 },
    assets: []
  };
  return {
    strategy,
    stocks,
    pools: [{ id: "all", name: "all", type: "static", codes: stocks.map((stock) => stock.code) }],
    factors: [{ key: "valueScore", name: "value score", group: "custom", description: "", defaultOrder: "desc" }],
    resultLimit: 3,
    weightLimit: 2,
    config: { startDate: "2026-01-01", endDate: "2026-03-31", benchmark: "CSI300", cost: 0, excludeTimeRange: false }
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function countRows(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.articles)) return payload.articles.length;
  if (Array.isArray(payload?.events)) return payload.events.length;
  if (Array.isArray(payload?.linkedStocks)) return payload.linkedStocks.length;
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (Array.isArray(payload?.announcements)) return payload.announcements.length;
  if (Array.isArray(payload?.stocks)) return payload.stocks.length;
  if (
    Array.isArray(payload?.performanceRows) ||
    Array.isArray(payload?.incomeRows) ||
    Array.isArray(payload?.balanceRows) ||
    Array.isArray(payload?.cashFlowRows)
  ) {
    return [payload.performanceRows, payload.incomeRows, payload.balanceRows, payload.cashFlowRows]
      .reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  }
  if (Array.isArray(payload?.plan?.orders)) return payload.plan.orders.length;
  if (Array.isArray(payload?.fills)) return payload.fills.length;
  if (typeof payload?.clientText === "string" && payload.clientText.trim()) return 1;
  if (payload?.ok === true) return 1;
  if (payload?.report && typeof payload.report === "object") return 1;
  if (payload?.candidate && payload?.result) return 1;
  return 0;
}

function valueAtPath(payload, path) {
  return path.split(".").reduce((current, key) => current?.[key], payload);
}

function hasRequiredFields(payload, fields = []) {
  return fields.every((field) => {
    const value = valueAtPath(payload, field);
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

const realValuationRequiredMetricKeys = [
  "price",
  "marketCap",
  "eps",
  "bps",
  "revenue",
  "netProfit",
  "operatingCashflow",
  "totalAssets",
  "totalLiabilities",
  "investmentAssets",
  "productionAssets",
  "interestBearingDebt",
  "nonInterestBearingDebt"
];

function codeFromValue(value) {
  return String(value ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6);
}

function stockFromQuoteRow(row) {
  const code = codeFromValue(row?.code ?? row?.f12 ?? row?.symbol);
  const exchange = code.startsWith("6") ? "SH" : code.startsWith("4") || code.startsWith("8") || code.startsWith("9") ? "BJ" : "SZ";
  return {
    code,
    name: String(row?.name ?? row?.f14 ?? code),
    exchange,
    board: code.startsWith("688") ? "STAR" : code.startsWith("300") || code.startsWith("301") ? "ChiNext" : exchange === "BJ" ? "BSE" : "main",
    industry1: "all",
    industry2: String(row?.industry2 ?? ""),
    region: "unknown",
    property: "unknown",
    isST: String(row?.name ?? "").includes("ST"),
    isSuspended: false,
    isSTAR: code.startsWith("688"),
    isMargin: true,
    indexes: [],
    metrics: {
      realQuoteSource: 1,
      ...(Number.isFinite(Number(row?.price)) ? { price: Number(row.price) } : {}),
      ...(Number.isFinite(Number(row?.pctChange)) ? { pctChange: Number(row.pctChange) } : {}),
      ...(Number.isFinite(Number(row?.amountYi)) ? { amount: Number(row.amountYi) } : {}),
      ...(Number.isFinite(Number(row?.marketCapYi)) ? { marketCap: Number(row.marketCapYi) } : {}),
      ...(Number.isFinite(Number(row?.floatMarketCapYi)) ? { floatMarketCap: Number(row.floatMarketCapYi) } : {}),
      ...(Number.isFinite(Number(row?.pe)) ? { pe: Number(row.pe) } : {}),
      ...(Number.isFinite(Number(row?.pb)) ? { pb: Number(row.pb) } : {})
    }
  };
}

function hasRealValuationMetrics(stock) {
  return realValuationRequiredMetricKeys.every((key) => Number.isFinite(stock.metrics?.[key]) && (["price", "marketCap", "totalAssets"].includes(key) ? stock.metrics[key] > 0 : true));
}

async function readJsonResponse(baseUrl, path, options, timeoutMs) {
  const response = await fetchWithTimeout(baseUrl + path, {
    ...options,
    headers: bunApiRequestHeaders(options?.headers ?? {})
  }, timeoutMs);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  return { response, payload, text };
}

async function runRealValuationPipelineProbe(baseUrl, timeoutMs) {
  const quotes = await readJsonResponse(baseUrl, "/api/market/tencent/ashare/quotes", undefined, timeoutMs);
  const finance = await readJsonResponse(baseUrl, "/api/finance/metrics/2025-12-31", undefined, timeoutMs);
  const quoteRows = Array.isArray(quotes.payload) ? quotes.payload : [];
  const financeRows = Array.isArray(finance.payload) ? finance.payload : [];
  const financeByCode = new Map(financeRows.map((row) => [codeFromValue(row?.code), row]));
  const stocks = quoteRows
    .map(stockFromQuoteRow)
    .map((stock) => {
      const financeRow = financeByCode.get(stock.code);
      return financeRow?.metrics ? { ...stock, name: financeRow.name || stock.name, metrics: { ...stock.metrics, ...financeRow.metrics } } : stock;
    })
    .filter(hasRealValuationMetrics);
  const valuationBody = {
    stocks,
    filters: { industries: ["all"], minSafetyMargin: -999, minGovernanceScore: 0 }
  };
  const valuation = await readJsonResponse(baseUrl, "/api/valuation/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(valuationBody)
  }, timeoutMs);
  const rows = Array.isArray(valuation.payload) ? valuation.payload : [];
  const quoteOk = quotes.response.ok && quotes.response.headers.get("x-stockchoose-data-engine") === "bun" && quoteRows.length > 0;
  const financeOk = finance.response.ok && finance.response.headers.get("x-stockchoose-data-engine") === "bun" && financeRows.length > 0;
  const valuationOk = valuation.response.ok && valuation.response.headers.get("x-stockchoose-data-engine") === "bun" && rows.length > 0;
  return {
    name: "real valuation pipeline",
    ok: quoteOk && financeOk && valuationOk,
    status: valuation.response.status,
    rowCount: rows.length,
    engine: valuation.response.headers.get("x-stockchoose-data-engine"),
    details: JSON.stringify({
      quoteRows: quoteRows.length,
      financeRows: financeRows.length,
      valuationReadyRows: stocks.length,
      valuationRows: rows.length,
      firstCode: rows[0]?.stock?.code ?? null
    })
  };
}

async function runProbeOnce(baseUrl, item, timeoutMs) {
  if (item.custom === "realValuationPipeline") return await runRealValuationPipelineProbe(baseUrl, timeoutMs);
  const response = await fetchWithTimeout(baseUrl + item.path, {
    method: item.method || "GET",
    headers: bunApiRequestHeaders(item.body ? { "content-type": "application/json" } : {}),
    body: item.body ? JSON.stringify(item.body) : undefined
  }, timeoutMs);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  const rowCount = countRows(payload);
  const engine = response.headers.get("x-stockchoose-data-engine");
  const ok = response.ok && (!item.requireRows || rowCount > 0) && (!item.requireEngine || engine === "bun") && hasRequiredFields(payload, item.requireFields);
  return {
    name: item.name,
    ok,
    status: response.status,
    rowCount,
    engine,
    details: typeof payload?.details === "string" ? payload.details : text.slice(0, 320)
  };
}

async function probe(baseUrl, item, timeoutMs) {
  let lastError;
  let lastResult;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      lastResult = await runProbeOnce(baseUrl, item, timeoutMs);
      if (lastResult.ok || lastResult.status < 500) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }
  if (lastResult) return lastResult;
  throw lastError;
}

function probesFor(workflow) {
  const tradePlanProbeBody = { strategy: workflow.strategy, rows: [{ stock: workflow.stocks[1], score: 80, weight: 50, passedFilters: 1 }], mode: "manual", accountId: "PAPER-0001", accountAsset: 100000 };
  const smokePlan = {
    id: "plan-bun-smoke",
    strategyId: workflow.strategy.id,
    strategyName: workflow.strategy.name,
    accountId: "PAPER-0001",
    mode: "manual",
    generatedAt: new Date().toISOString(),
    orders: [{ clientOrderId: "bun-smoke-order-1", code: "000001", name: workflow.stocks[1].name, side: "buy", shares: 100, price: 12, amount: 1200, status: "draft" }],
    status: "draft"
  };
  const smokeAsset = { netValue: 1, holdingValue: 320000, strategyCash: 180000, outsideAsset: 500000 };
  const smokeArticle = { id: "bun-smoke-news-1", title: workflow.stocks[1].name + " earnings growth", summary: workflow.stocks[1].code + " operating result growth", content: workflow.stocks[1].name + " published operating information", source: "Bun smoke", publishedAt: new Date().toISOString(), url: "https://example.com/bun-smoke-news-1", linkedCodes: [workflow.stocks[1].code], linkedStocks: [{ code: workflow.stocks[1].code, name: workflow.stocks[1].name }], industries: [workflow.stocks[1].industry1], tags: ["smoke"] };
  const smokeEvent = { id: "bun-smoke-event-1", title: smokeArticle.title, summary: smokeArticle.summary, category: "earnings", direction: "positive", horizon: "short", severity: "normal", occurredAt: smokeArticle.publishedAt, source: smokeArticle.source, sourceWeight: 76, impact: 70, relevance: 80, confidence: 70, novelty: 58, persistence: 58, riskPenalty: 4, industries: smokeArticle.industries, keywords: smokeArticle.tags, linkedCodes: smokeArticle.linkedCodes };
  const newsSource = { id: "eastmoney", name: "Eastmoney real news", provider: "Eastmoney", baseUrl: "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns", maxItems: 5 };
  return [
    { name: "health", path: "/health", requireEngine: true },
    { name: "integration source test", path: "/api/integration/source-test", method: "POST", body: { provider: "AKShare / AKTools", baseUrl: "/aktools/api/public", modules: { market: true, finance: true, filing: false, news: false } }, requireRows: true, requireEngine: true },
    { name: "aktools rows", path: "/api/integration/aktools/rows", method: "POST", body: { baseUrl: "/aktools/api/public", endpoint: "stock_zh_a_hist", params: { symbol: "000001", start_date: "20240501", end_date: "20240531" } }, requireRows: true, requireEngine: true },
    { name: "eastmoney spot", path: "/api/market/ashare/spot", requireRows: true, requireEngine: true },
    { name: "stock universe", path: "/api/data/stock-universe", requireRows: true, requireEngine: true },
    { name: "tencent quote", path: "/api/market/tencent/quote-rows?q=sh600519", requireRows: true, requireEngine: true },
    { name: "tencent all ashare quotes", path: "/api/market/tencent/ashare/quotes", requireRows: true, requireEngine: true },
    { name: "tencent kline", path: "/api/market/tencent/kline-points?symbol=sh600519&period=day&limit=20", requireRows: true, requireEngine: true },
    { name: "stock kline alias", path: "/api/market/stock/600519/kline-points?period=day&limit=20", requireRows: true, requireEngine: true },
    { name: "technical indicators", path: "/api/market/technical-indicators?codes=600519,000001&limit=40", requireRows: true, requireEngine: true },
    { name: "stock profile", path: "/api/market/stock/600519/profile?name=Kweichow%20Moutai", requireRows: false, requireEngine: true, requireFields: ["code", "name", "source"] },
    { name: "north holdings", path: "/api/market/north-holdings", requireRows: true, requireEngine: true },
    { name: "finance statements", path: "/api/finance/statements/2025-12-31", requireRows: true, requireEngine: true },
    { name: "finance metrics", path: "/api/finance/metrics/2025-12-31", requireRows: true, requireEngine: true },
    { name: "annual reports", path: "/api/finance/annual-reports", method: "POST", body: { stock: workflow.stocks[1] }, requireRows: true, requireEngine: true },
    { name: "analyst forecasts", path: "/api/finance/analyst-forecasts", requireRows: true, requireEngine: true },
    { name: "margin balances", path: "/api/finance/margin-balances", requireRows: true, requireEngine: true },
    { name: "filing announcements", path: "/api/filing/announcements", method: "POST", body: { codes: ["600519"], maxItems: 5 }, requireRows: true, requireEngine: true },
    { name: "gdelt news", path: "/api/news/gdelt?query=China%20A-shares%20stock%20market&max_records=3", requireRows: true, requireEngine: true },
    { name: "news articles", path: "/api/news/articles", method: "POST", body: { sources: [newsSource], stocks: workflow.stocks, mode: "fast" }, requireRows: true, requireEngine: true },
    { name: "news source test", path: "/api/news/source-test", method: "POST", body: { source: { ...newsSource, maxItems: 3 } }, requireRows: true, requireEngine: true },
    { name: "sentiment events", path: "/api/sentiment/events", method: "POST", body: { articles: [smokeArticle], stocks: workflow.stocks }, requireRows: true, requireEngine: true },
    { name: "sentiment analysis", path: "/api/sentiment/analysis", method: "POST", body: { events: [smokeEvent], stocks: workflow.stocks }, requireRows: true, requireEngine: true },
    { name: "news analysis local test", path: "/api/news-analysis/local-test", method: "POST", body: { tasks: ["sentiment", "link"] }, requireRows: true, requireEngine: true },
    { name: "news analysis model test", path: "/api/news-analysis/model-test", method: "POST", body: { settings: { provider: "local", model: "bun-news-rule-v1" } }, requireRows: true, requireEngine: true },
    { name: "strategy screen", path: "/api/strategy/screen", method: "POST", body: workflow, requireRows: true, requireEngine: true },
    { name: "strategy rank", path: "/api/strategy/rank", method: "POST", body: workflow, requireRows: true, requireEngine: true },
    { name: "strategy backtest", path: "/api/strategy/backtest", method: "POST", body: workflow, requireRows: true, requireEngine: true },
    { name: "strategy optimize", path: "/api/strategy/optimize", method: "POST", body: workflow, requireRows: true, requireEngine: true },
    { name: "trade plan", path: "/api/trade/plan", method: "POST", body: tradePlanProbeBody, requireRows: true, requireEngine: true },
    { name: "trade export", path: "/api/trade/export", method: "POST", body: { plan: smokePlan }, requireRows: true, requireEngine: true },
    { name: "paper trade submit", path: "/api/trade/paper/submit", method: "POST", body: { state: { plans: [], fills: [] }, plan: smokePlan }, requireRows: true, requireEngine: true },
    { name: "trade assets sync", path: "/api/trade/assets/sync", method: "POST", body: { asset: smokeAsset }, requireRows: true, requireEngine: true },
    { name: "valuation rows", path: "/api/valuation/rows", method: "POST", body: { stocks: [workflow.stocks[1]], filters: { minSafetyMargin: -999, minGovernanceScore: 0, industries: ["all"] } }, requireRows: true, requireEngine: true },
    { name: "real valuation pipeline", custom: "realValuationPipeline" }
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const running = await ensureBunApiRunning();
  if (!running) throw new Error("Bun API is unavailable. Ensure bun --version works or set STOCKCHOOSE_BUN_API_URL.");
  const baseUrl = bunApiBaseUrl();
  const results = [];
  for (const item of probesFor(workflowPayload())) {
    try {
      results.push(await probe(baseUrl, item, args.timeoutMs));
    } catch (error) {
      results.push({
        name: item.name,
        ok: false,
        status: 0,
        rowCount: 0,
        engine: null,
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const result = { ok: results.every((item) => item.ok), baseUrl, results };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("Bun live data smoke: " + (result.ok ? "PASS" : "FAIL"));
    for (const item of results) console.log((item.ok ? "PASS" : "FAIL") + " " + item.name + ": status=" + item.status + " rows=" + item.rowCount + " engine=" + item.engine);
  }
  if (!args.keepSidecar) stopBunApiSidecar();
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  stopBunApiSidecar();
  process.exitCode = 1;
});
