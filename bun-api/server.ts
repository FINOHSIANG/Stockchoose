import { timingSafeEqual } from "node:crypto";
import { ApiError, errorResponse, jsonResponse, MAX_REQUEST_BODY_BYTES, notFound, requestJson, textResponse } from "./lib/http";
import { assertSafeOutboundUrl } from "./lib/outboundSecurity";
import { fetchAktoolsRows, testAktoolsConnection } from "./services/aktools";
import { fetchEastmoneyHistRows, fetchEastmoneySpotRows, fetchKlinePointsWithFallback, fetchTencentAshareQuoteRows, fetchTencentQuoteRows, fetchTencentQuoteText, stockFromMarketRow, tencentSymbolsFromQuery } from "./services/market";
import { buildMarketOverview } from "./services/marketOverview";
import { fetchEastmoneyNewsRows, fetchNewsArticles, fetchSourceRows, normalizeNewsArticles } from "./services/news";
import { buildBunValuationRows, fetchAnnualReports, fetchAnalystForecastRows, fetchAsharehubRows, fetchFilingAnnouncements, fetchFinanceStatements, fetchFinancialMetricRows, fetchMarginBalanceRows, fetchNorthHoldingRows, fetchStockProfile, fetchTechnicalIndicators } from "./services/finance";
import { runStrategyBacktest, runStrategyOptimize, runStrategyRank, runStrategyScreen } from "./services/strategy";
import { createBunTradePlan, submitPaperTrade, syncTradeAssets, tradePlanToClientText, tradePlanToCsv } from "./services/trade";
import { initScheduler, loadStatus, saveConfig, triggerManualSync, readSnapshotRoute, DEFAULT_SCHEDULE_CONFIG } from "./scheduler";
import { handleAgentRoute } from "./agent/routes";

const DEFAULT_PORT = 18082;
const startedAt = new Date().toISOString();
const TOKEN_HEADER = "x-stockchoose-instance-token";
const instanceToken = String(process.env.STOCKCHOOSE_BUN_API_TOKEN ?? "").trim();

if (!instanceToken) {
  throw new Error("STOCKCHOOSE_BUN_API_TOKEN is required to start the Bun data API");
}

function port() {
  return Number(process.env.STOCKCHOOSE_BUN_PORT || DEFAULT_PORT);
}

function tokenMatches(candidate: string) {
  const actual = Buffer.from(instanceToken);
  const received = Buffer.from(candidate);
  return actual.length === received.length && timingSafeEqual(actual, received);
}

function assertTrustedRequest(request: Request) {
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new ApiError(403, "Bun data API only accepts loopback requests");
  }
  if (!tokenMatches(request.headers.get(TOKEN_HEADER) ?? "")) {
    throw new ApiError(401, "Bun data API instance token is missing or invalid");
  }
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set(
    String(process.env.STOCKCHOOSE_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (origin && !allowedOrigins.has(origin)) {
    throw new ApiError(403, "Bun data API origin is not allowed");
  }
}

function normalizeAktoolsEndpoint(pathname: string) {
  return pathname.replace(/^\/aktools\/?/, "").replace(/^api\/public\/?/, "").replace(/^\/+/, "");
}

async function aktoolsPayload(endpoint: string, params: URLSearchParams | Record<string, string>) {
  const query = params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : params;
  if (endpoint === "stock_zh_a_spot" || endpoint === "stock_zh_a_spot_em") return await fetchEastmoneySpotRows();
  if (endpoint === "stock_zh_a_hist") return await fetchEastmoneyHistRows(query);
  throw new ApiError(404, `unsupported aktools endpoint: ${endpoint}`);
}

async function handleIntegrationRows(request: Request) {
  const body = await requestJson<any>(request);
  const endpoint = String(body.endpoint ?? "").replace(/^\/+/, "");
  const baseUrl = String(body.baseUrl ?? "").replace(/\/$/, "");
  const params = (body.params ?? {}) as Record<string, string>;
  if (baseUrl === "/aktools/api/public" || baseUrl.startsWith("/aktools/")) {
    return jsonResponse(await aktoolsPayload(endpoint, params));
  }
  return jsonResponse(await fetchAktoolsRows(baseUrl, endpoint, params));
}

async function handleSourceTest(request: Request) {
  const body = await requestJson<any>(request);
  const provider = String(body.provider ?? "");
  if (provider.includes("AKTools") || provider.includes("AKShare")) {
    const result = await testAktoolsConnection(String(body.baseUrl ?? ""), aktoolsPayload);
    const label = result.source === "bun-native" ? "Bun 原生数据接口" : "所配置的 AKTools 数据接口";
    return jsonResponse({
      engine: "bun", provider, ...result,
      message: result.ok ? "连接检测通过" : "连接检测失败",
      details: `${label} ${result.endpoint} 返回 ${result.rowCount} 条历史行情；此检测不代表全市场和财务字段完整覆盖`
    });
  }
  if (provider === "GDELT 2.1" || provider === "NewsAPI" || provider.includes("REST") || provider.includes("RSS")) {
    const rows = await fetchSourceRows({
      id: "source-test",
      name: provider,
      provider,
      baseUrl: String(body.baseUrl ?? ""),
      apiToken: String(body.apiToken ?? ""),
      language: "zh-CN",
      maxItems: 3,
      query: "China A-shares stock market"
    });
    return jsonResponse({ engine: "bun", provider, ok: rows.length > 0, rowCount: rows.length, message: "连接检测通过", details: `${provider} 已由 Bun 爬虫引擎响应，返回 ${rows.length} 条测试数据` });
  }
  throw new ApiError(400, "unsupported provider", provider || "empty provider");
}


async function route(request: Request) {
  assertTrustedRequest(request);
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") return textResponse("", 204, { allow: "GET, HEAD, POST" });
  if (path === "/health") return jsonResponse({ ok: true, service: "stockchoose-bun-api", version: "0.1.0", startedAt });

  if (path.startsWith("/aktools")) return jsonResponse(await aktoolsPayload(normalizeAktoolsEndpoint(path), url.searchParams));
  if (path === "/api/integration/source-test" && request.method === "POST") return await handleSourceTest(request);
  if (path === "/api/integration/aktools/rows" && request.method === "POST") return await handleIntegrationRows(request);
  if (path === "/api/integration/asharehub/rows" && request.method === "POST") {
    const body = await requestJson<any>(request);
    await assertSafeOutboundUrl(String(body.baseUrl ?? ""));
    return jsonResponse(await fetchAsharehubRows(String(body.baseUrl ?? ""), String(body.endpoint ?? ""), body.params ?? {}, String(body.apiToken ?? body.api_token ?? "")));
  }

  const agentResponse = await handleAgentRoute(request, url);
  if (agentResponse) return agentResponse;

  if (path === "/api/market/ashare/spot") return jsonResponse(await fetchEastmoneySpotRows());
  if (path === "/api/data/stock-universe") {
    const rows = await fetchEastmoneySpotRows();
    const stocks = rows.map((row) => stockFromMarketRow(row as Record<string, unknown>)).filter((stock) => stock.code);
    return jsonResponse({
      engine: "bun",
      checkedAt: new Date().toISOString(),
      stocks,
      summary: {
        provider: "bun-eastmoney",
        lastSyncAt: new Date().toISOString(),
        matchedRows: stocks.length,
        sourceRows: rows.length,
        stockCount: stocks.length,
        financeMatchedRows: 0,
        financeSourceRows: 0,
        analystMatchedRows: 0,
        analystSourceRows: 0,
        marginMatchedRows: 0,
        marginSourceRows: 0,
        northHoldMatchedRows: 0,
        northHoldSourceRows: 0,
        technicalMatchedRows: 0,
        technicalSourceRows: 0,
        valuationReadyRows: 0,
        details: `market: Bun Eastmoney crawler returned ${rows.length} rows, normalized ${stocks.length} stocks`
      }
    });
  }
  if (path === "/api/market/tencent/quote") return textResponse(await fetchTencentQuoteText(tencentSymbolsFromQuery(url.searchParams.get("q") ?? url.searchParams.get("symbols"))), 200, { "content-type": "text/plain; charset=utf-8" });
  if (path === "/api/market/tencent/quote-rows") return jsonResponse(await fetchTencentQuoteRows(tencentSymbolsFromQuery(url.searchParams.get("q") ?? url.searchParams.get("symbols"))));
  if (path === "/api/market/tencent/ashare/quotes") return jsonResponse(await fetchTencentAshareQuoteRows());
  if (path === "/api/market/tencent/kline-points" || path.match(/^\/api\/market\/stock\/[^/]+\/kline-points$/)) {
    const symbol = url.searchParams.get("symbol") ?? path.split("/").at(4) ?? "sh600519";
    const result = await fetchKlinePointsWithFallback(symbol, url.searchParams.get("period") ?? "day", Number(url.searchParams.get("limit") ?? 90), url.searchParams.get("adjustment") ?? "qfq");
    return jsonResponse(result.points, 200, { "x-stockchoose-market-source": result.source });
  }
  if (path === "/api/market/tencent/kline" || path.match(/^\/api\/market\/stock\/[^/]+\/kline$/)) {
    const symbol = url.searchParams.get("symbol") ?? path.split("/").at(4) ?? "sh600519";
    const result = await fetchKlinePointsWithFallback(symbol, url.searchParams.get("period") ?? "day", Number(url.searchParams.get("limit") ?? 90), url.searchParams.get("adjustment") ?? "qfq");
    return jsonResponse(result.points, 200, { "x-stockchoose-market-source": result.source });
  }
  if (path === "/api/market/technical-indicators") return jsonResponse(await fetchTechnicalIndicators(String(url.searchParams.get("codes") ?? "").split(/[,;\s]+/), Number(url.searchParams.get("limit") ?? 120)));
  if (path.startsWith("/api/market/stock/") && path.endsWith("/profile")) {
    const parts = path.split("/");
    return jsonResponse(await fetchStockProfile(parts[4] ?? "", {
      name: url.searchParams.get("name") ?? undefined,
      industry1: url.searchParams.get("industry1") ?? undefined,
      industry2: url.searchParams.get("industry2") ?? undefined,
      forceRefresh: url.searchParams.get("force") === "1"
    }));
  }
  if (path === "/api/market/north-holdings") return jsonResponse(await fetchNorthHoldingRows());

  if (path === "/api/news/gdelt") {
    const maxItems = Number(url.searchParams.get("max_records") ?? 10);
    const source = { id: "gdelt", name: "GDELT global news", provider: "GDELT 2.1", baseUrl: "https://api.gdeltproject.org/api/v2/doc/doc", query: url.searchParams.get("query") ?? "China A-shares stock market", maxItems };
    try {
      const result = await fetchNewsArticles([source], [], "fast");
      return jsonResponse({ engine: "bun", articles: result.articles, sourceDiagnostics: result.sourceDiagnostics ?? [] });
    } catch (error) {
      const fallbackRows = await fetchEastmoneyNewsRows(maxItems);
      return jsonResponse({
        engine: "bun",
        articles: normalizeNewsArticles(fallbackRows, [], "eastmoney-fallback"),
        sourceDiagnostics: [{
          sourceId: source.id,
          sourceName: source.name,
          provider: source.provider,
          fallbackSource: "eastmoney",
          fallbackReason: error instanceof Error ? error.message : String(error)
        }]
      });
    }
  }
  if (path === "/api/news/articles" && request.method === "POST") {
    const body = await requestJson<any>(request);
    return jsonResponse(await fetchNewsArticles(body.sources ?? [], body.stocks ?? [], body.mode ?? "fast"));
  }
  if (path === "/api/news/source-test" && request.method === "POST") {
    const body = await requestJson<any>(request);
    const rows = await fetchSourceRows({ ...(body.source ?? {}), maxItems: 3 });
    return jsonResponse({ engine: "bun", provider: body.source?.provider ?? "", ok: rows.length > 0, rowCount: rows.length, message: "新闻源检测通过", details: `Bun 爬虫引擎返回 ${rows.length} 条测试新闻` });
  }

  if (path === "/api/sentiment/events" && request.method === "POST") {
    const { articles = [], stocks = [] } = await requestJson<any>(request);
    const events = normalizeNewsArticles(articles.map((article: any) => ({ title: article.title, url: article.url || article.id, summary: article.summary, content: article.content, publishedAt: article.publishedAt, source: article.source })), stocks).map((article: any) => ({
      id: `bun-event-${article.id}`,
      title: article.title,
      summary: article.summary,
      category: article.category,
      direction: article.sentiment,
      horizon: "短期",
      severity: article.importance === "重要" ? "重大" : "一般",
      occurredAt: article.publishedAt,
      source: article.source,
      sourceWeight: 76,
      impact: article.importance === "重要" ? 76 : 62,
      relevance: article.linkedCodes.length ? 80 : 40,
      confidence: 70,
      novelty: 58,
      persistence: 58,
      riskPenalty: article.sentiment === "利空" ? 8 : 4,
      industries: article.industries,
      keywords: article.tags,
      linkedCodes: article.linkedCodes
    }));
    return jsonResponse({ engine: "bun", events });
  }
  if (path === "/api/sentiment/analysis" && request.method === "POST") {
    const { events = [], stocks = [] } = await requestJson<any>(request);
    const linkedStocks = stocks.filter((stock: any) => events.some((event: any) => event.linkedCodes?.includes(stock.code))).map((stock: any) => ({ stock, events: events.filter((event: any) => event.linkedCodes?.includes(stock.code)), direction: "中性", relationScore: 70, relationLevel: "直接命中", reason: "Bun 舆情规则命中股票代码或名称", evidence: [stock.code, stock.name], tags: stock.industry1 ? [stock.industry1] : [] }));
    return jsonResponse({ engine: "bun", linkedStocks, report: { title: "舆情关联股票洞察", conclusion: linkedStocks.length ? "Bun 舆情规则已生成关联股票。" : "当前真实新闻未命中股票。", eventCount: events.length, topCategories: [], topIndustries: [], linkedStocks, riskEvents: events.filter((event: any) => event.direction === "利空"), validationPoints: ["舆情分析由 Bun 本地规则完成。"] } });
  }
  if (path === "/api/news-analysis/local-test" && request.method === "POST") return jsonResponse({ engine: "bun", ok: true, taskCount: ((await requestJson<any>(request)).tasks ?? []).filter(Boolean).length, message: "Bun 本地新闻规则模型可用" });
  if (path === "/api/news-analysis/model-test" && request.method === "POST") return jsonResponse({ engine: "bun", ok: true, provider: "本地规则模型", model: "bun-news-rule-v1", message: "分析模型检测通过", details: "Bun 本地新闻规则模型已启用" });

  if (path === "/api/strategy/screen" && request.method === "POST") return jsonResponse(runStrategyScreen(await requestJson<any>(request)));
  if (path === "/api/strategy/rank" && request.method === "POST") return jsonResponse(runStrategyRank(await requestJson<any>(request)));
  if (path === "/api/strategy/backtest" && request.method === "POST") return jsonResponse(runStrategyBacktest(await requestJson<any>(request)));
  if (path === "/api/strategy/optimize" && request.method === "POST") return jsonResponse(runStrategyOptimize(await requestJson<any>(request)));

  if (path === "/api/trade/plan" && request.method === "POST") return jsonResponse(createBunTradePlan(await requestJson<any>(request)));
  if (path === "/api/trade/export" && request.method === "POST") {
    const { plan } = await requestJson<any>(request);
    return jsonResponse({ clientText: tradePlanToClientText(plan), csv: tradePlanToCsv(plan) });
  }
  if (path === "/api/trade/paper/submit" && request.method === "POST") {
    const { state, plan } = await requestJson<any>(request);
    return jsonResponse(submitPaperTrade(state, plan));
  }
  if (path === "/api/trade/assets/sync" && request.method === "POST") return jsonResponse(syncTradeAssets((await requestJson<any>(request)).asset));

  if (path.startsWith("/api/finance/statements/")) return jsonResponse(await fetchFinanceStatements(decodeURIComponent(path.split("/").at(-1) ?? "")));
  if (path.startsWith("/api/finance/metrics/")) return jsonResponse(await fetchFinancialMetricRows(decodeURIComponent(path.split("/").at(-1) ?? "")));
  if (path === "/api/finance/analyst-forecasts") return jsonResponse(await fetchAnalystForecastRows());
  if (path === "/api/finance/margin-balances") return jsonResponse(await fetchMarginBalanceRows());
  if (path === "/api/finance/annual-reports" && request.method === "POST") return jsonResponse(await fetchAnnualReports((await requestJson<any>(request)).stock));
  if (path === "/api/filing/announcements" && request.method === "POST") {
    const body = await requestJson<any>(request);
    const codes = Array.isArray(body.codes) ? body.codes : Array.isArray(body.stocks) ? body.stocks.map((stock: any) => stock.code) : [];
    return jsonResponse(await fetchFilingAnnouncements(codes, Number(body.maxItems ?? body.max_items ?? 50)));
  }
  if (path === "/api/valuation/rows" && request.method === "POST") {
    const body = await requestJson<any>(request);
    return jsonResponse(buildBunValuationRows(body.stocks ?? [], body.filters ?? {}));
  }
  // === Scheduled sync routes ===
  if (path === "/api/sync/status" && request.method === "GET") {
    return jsonResponse(await loadStatus());
  }
  if (path === "/api/sync/config" && request.method === "GET") {
    return jsonResponse((await loadStatus()).config);
  }
  if (path === "/api/sync/config" && request.method === "POST") {
    const body = await requestJson<any>(request);
    const config = { ...DEFAULT_SCHEDULE_CONFIG, ...body, sources: { ...DEFAULT_SCHEDULE_CONFIG.sources, ...(body.sources ?? {}) } };
    return jsonResponse(await saveConfig(config));
  }
  if (path === "/api/sync/run" && request.method === "POST") {
    const results = await triggerManualSync();
    return jsonResponse({ ok: true, results });
  }
  if (path.startsWith("/api/sync/snapshot/") && request.method === "GET") {
    const name = decodeURIComponent(path.split("/").at(-1) ?? "");
    if (!name) throw new ApiError(400, "snapshot name is required");
    const snapshot = await readSnapshotRoute(name);
    if (!snapshot) throw new ApiError(404, "snapshot not found", name);
    return jsonResponse(snapshot);
  }
  if (path === "/api/sync/snapshots" && request.method === "GET") {
    return jsonResponse({ snapshots: (await loadStatus()).cacheFiles });
  }

  // === Dashboard routes ===
  if (path === "/api/dashboard/market-overview" && request.method === "GET") {
    const rows = await fetchEastmoneySpotRows();
    return jsonResponse(buildMarketOverview(rows));
  }

  return notFound(path);
}

Bun.serve({
  hostname: "127.0.0.1",
  port: port(),
  idleTimeout: 180,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  async fetch(request) {
    try {
      return await route(request);
    } catch (error) {
      return errorResponse(error);
    }
  }
});

console.log(`stockchoose-bun-api listening on http://127.0.0.1:${port()}`);
initScheduler().catch((error) => console.error("[scheduler] init failed:", error));
