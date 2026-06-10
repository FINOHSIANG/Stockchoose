use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    net::SocketAddr,
    time::Duration,
};
use stockchoose_collectors::tencent::{TencentKlinePoint, TencentQuoteRow};
use stockchoose_collectors::{
    AnnouncementRow, CollectorError, EastmoneyClient, FinancialMetricRow, GdeltClient,
    TencentClient,
};
use stockchoose_core::{
    build_annual_financial_reports, build_valuation_rows, create_trade_plan,
    missing_real_valuation_fields, ranking_analysis, run_backtest, screen_stocks,
    submit_paper_trade_plan, sync_trade_assets, trade_plan_to_client_text, trade_plan_to_csv,
    AnnualFinancialReport, BacktestConfig, BacktestMetrics, BacktestResult, BacktestTrade,
    CurvePoint, Factor, PaperTradeState, RankingRow, ScreenStocksOptions, SelectionRow, Stock,
    StockPool, StrategyConfig, StrategyOptimizationResult, TradeAssetInput, TradeAssetSyncResult,
    TradePlan, ValuationFilters, ValuationRow, YearlyReturn,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

const MAX_JSON_BODY_BYTES: usize = 64 * 1024 * 1024;
const TECHNICAL_INDICATOR_CODE_LIMIT: usize = 200;
const TECHNICAL_INDICATOR_CONCURRENCY: usize = 12;

#[derive(Clone)]
struct AppState {
    eastmoney: EastmoneyClient,
    tencent: TencentClient,
    gdelt: GdeltClient,
    http: reqwest::Client,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    message: String,
    details: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
    details: String,
}

impl ApiError {
    fn not_found(details: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "接口不存在".to_string(),
            details: details.into(),
        }
    }

    fn internal(details: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: "Rust 数据接口请求失败".to_string(),
            details: details.into(),
        }
    }

    fn bad_request(details: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: "Rust 数据接口请求失败".to_string(),
            details: details.into(),
        }
    }
}

impl From<CollectorError> for ApiError {
    fn from(error: CollectorError) -> Self {
        Self::internal(error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                message: self.message,
                details: self.details,
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    version: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationSourceTestRequest {
    #[serde(default)]
    provider: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_token: String,
    #[serde(default = "default_source_timeout_seconds")]
    timeout_seconds: u64,
    #[serde(default)]
    modules: HashMap<String, bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AktoolsRowsRequest {
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    endpoint: String,
    #[serde(default)]
    params: HashMap<String, String>,
    #[serde(default = "default_source_timeout_seconds")]
    timeout_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsharehubRowsRequest {
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    endpoint: String,
    #[serde(default)]
    params: HashMap<String, String>,
    #[serde(default)]
    api_token: String,
    #[serde(default = "default_source_timeout_seconds")]
    timeout_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationSourceTestResponse {
    engine: &'static str,
    provider: String,
    ok: bool,
    row_count: usize,
    message: String,
    details: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreenRequest {
    strategy: StrategyConfig,
    stocks: Vec<Stock>,
    pools: Vec<StockPool>,
    factors: Vec<Factor>,
    #[serde(default)]
    result_limit: Option<usize>,
    #[serde(default)]
    weight_limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankRequest {
    strategy: StrategyConfig,
    stocks: Vec<Stock>,
    pools: Vec<StockPool>,
    factors: Vec<Factor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BacktestRequest {
    strategy: StrategyConfig,
    stocks: Vec<Stock>,
    pools: Vec<StockPool>,
    factors: Vec<Factor>,
    config: BacktestConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeRequest {
    strategy: StrategyConfig,
    stocks: Vec<Stock>,
    pools: Vec<StockPool>,
    factors: Vec<Factor>,
    config: BacktestConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValuationRowsRequest {
    stocks: Vec<Stock>,
    filters: ValuationFilters,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnualReportsRequest {
    stock: Stock,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilingAnnouncementsRequest {
    #[serde(default)]
    stocks: Vec<Stock>,
    #[serde(default)]
    codes: Vec<String>,
    #[serde(default)]
    max_items: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilingAnnouncementsStats {
    scanned_stocks: usize,
    request_codes: usize,
    returned_rows: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilingAnnouncementsResponse {
    engine: &'static str,
    announcements: Vec<AnnouncementRow>,
    stats: FilingAnnouncementsStats,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TradePlanRequest {
    strategy: StrategyConfig,
    rows: Vec<SelectionRow>,
    #[serde(default = "manual_mode")]
    mode: String,
    #[serde(default = "default_account")]
    account_id: String,
    #[serde(default = "default_account_asset")]
    account_asset: f64,
    #[serde(default)]
    minimum_amount: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TradePlanResponse {
    plan: TradePlan,
    client_text: String,
    csv: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TradeExportRequest {
    plan: TradePlan,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TradeExportResponse {
    client_text: String,
    csv: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TradeAssetSyncRequest {
    asset: TradeAssetInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperTradeSubmitRequest {
    state: PaperTradeState,
    plan: TradePlan,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GdeltQuery {
    query: Option<String>,
    #[serde(default, alias = "maxrecords", alias = "max_records")]
    max_records: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsArticleRequest {
    sources: Vec<NewsSourceInput>,
    #[serde(default)]
    stocks: Vec<Stock>,
    #[serde(default = "default_news_mode")]
    mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsSourceTestRequest {
    source: NewsSourceInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsSourceInput {
    id: String,
    name: String,
    provider: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_token: String,
    #[serde(default)]
    language: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    max_items: Option<usize>,
    #[serde(default)]
    query: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LinkedStock {
    code: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NewsArticle {
    id: String,
    title: String,
    summary: String,
    content: String,
    source: String,
    source_icon: String,
    category: String,
    sentiment: String,
    importance: String,
    status: String,
    published_at: String,
    fetched_at: String,
    url: String,
    image_url: String,
    author: String,
    read_time: u32,
    linked_codes: Vec<String>,
    linked_stocks: Vec<LinkedStock>,
    industries: Vec<String>,
    tags: Vec<String>,
    view_count: u32,
    comment_count: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NewsFetchStats {
    mode: String,
    scanned_stocks: usize,
    request_count: usize,
    returned_rows: usize,
    valid_articles: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NewsSourceDiagnostic {
    source_id: String,
    source_name: String,
    provider: String,
    fallback_source: Option<String>,
    fallback_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsArticleResponse {
    articles: Vec<NewsArticle>,
    stats: NewsFetchStats,
    source_diagnostics: Vec<NewsSourceDiagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsSourceTestResponse {
    engine: &'static str,
    provider: String,
    ok: bool,
    row_count: usize,
    message: String,
    details: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentimentEventsRequest {
    articles: Vec<NewsArticle>,
    stocks: Vec<Stock>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SentimentEventsResponse {
    engine: &'static str,
    events: Vec<SentimentEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentimentAnalysisRequest {
    events: Vec<SentimentEvent>,
    stocks: Vec<Stock>,
    #[serde(default)]
    analysis_model: Option<NewsAnalysisModelTestRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SentimentAnalysisResponse {
    engine: &'static str,
    linked_stocks: Vec<SentimentLinkedStock>,
    report: SentimentInsightReport,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsAnalysisLocalTestRequest {
    #[serde(default)]
    tasks: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsAnalysisLocalTestResponse {
    engine: &'static str,
    ok: bool,
    task_count: usize,
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsAnalysisModelTestRequest {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
    #[serde(default = "default_model_timeout_seconds")]
    timeout_seconds: u64,
    #[serde(default = "default_model_max_tokens")]
    max_tokens: u32,
    #[serde(default = "default_model_temperature")]
    temperature: f64,
    #[serde(default)]
    system_prompt: String,
    #[serde(default)]
    tasks: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsAnalysisModelTestResponse {
    engine: &'static str,
    ok: bool,
    provider: String,
    model: String,
    message: String,
    details: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SentimentEvent {
    id: String,
    title: String,
    summary: String,
    category: String,
    direction: String,
    horizon: String,
    severity: String,
    occurred_at: String,
    source: String,
    source_weight: f64,
    impact: f64,
    relevance: f64,
    confidence: f64,
    novelty: f64,
    persistence: f64,
    risk_penalty: f64,
    industries: Vec<String>,
    keywords: Vec<String>,
    linked_codes: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SentimentLinkedStock {
    stock: Stock,
    events: Vec<SentimentEvent>,
    direction: String,
    relation_score: f64,
    relation_level: String,
    reason: String,
    evidence: Vec<String>,
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SentimentCount {
    category: String,
    count: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SentimentIndustryCount {
    industry: String,
    count: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SentimentInsightReport {
    title: String,
    conclusion: String,
    event_count: usize,
    top_categories: Vec<SentimentCount>,
    top_industries: Vec<SentimentIndustryCount>,
    linked_stocks: Vec<SentimentLinkedStock>,
    risk_events: Vec<SentimentEvent>,
    validation_points: Vec<String>,
}

#[derive(Debug, Clone)]
struct EventStockMatch {
    event: SentimentEvent,
    match_score: f64,
    evidence: Vec<String>,
    direct: bool,
}

#[derive(Debug)]
struct ArticleSignals {
    source_weight: f64,
    impact: f64,
    relevance: f64,
    confidence: f64,
    novelty: f64,
    persistence: f64,
    risk_penalty: f64,
}

#[derive(Debug, Deserialize)]
struct TencentQuoteQuery {
    q: Option<String>,
    symbols: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TencentKlineQuery {
    param: Option<String>,
    symbol: Option<String>,
    period: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct TechnicalIndicatorQuery {
    codes: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StockUniverseQuery {
    #[serde(default = "default_true_bool")]
    finance: bool,
    #[serde(default = "default_true_bool")]
    analyst: bool,
    #[serde(default = "default_true_bool")]
    margin: bool,
    #[serde(default = "default_true_bool")]
    north: bool,
    #[serde(default = "default_true_bool")]
    technical: bool,
    #[serde(default = "default_stock_universe_technical_limit")]
    technical_limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockUniverseSummary {
    provider: String,
    last_sync_at: String,
    matched_rows: usize,
    source_rows: usize,
    stock_count: usize,
    finance_matched_rows: usize,
    finance_source_rows: usize,
    analyst_matched_rows: usize,
    analyst_source_rows: usize,
    margin_matched_rows: usize,
    margin_source_rows: usize,
    north_hold_matched_rows: usize,
    north_hold_source_rows: usize,
    technical_matched_rows: usize,
    technical_source_rows: usize,
    valuation_ready_rows: usize,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockUniverseResponse {
    engine: &'static str,
    checked_at: String,
    stocks: Vec<Stock>,
    summary: StockUniverseSummary,
}

fn manual_mode() -> String {
    "manual".to_string()
}

fn default_account() -> String {
    "PAPER-0001".to_string()
}

fn default_account_asset() -> f64 {
    500_000.0
}

fn default_news_mode() -> String {
    "fast".to_string()
}

fn default_source_timeout_seconds() -> u64 {
    60
}

fn default_model_timeout_seconds() -> u64 {
    20
}

fn default_model_max_tokens() -> u32 {
    1200
}

fn default_model_temperature() -> f64 {
    0.2
}

fn default_true_bool() -> bool {
    true
}

fn default_stock_universe_technical_limit() -> usize {
    200
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("stockchoose_api=info,tower_http=info")
            }),
        )
        .init();

    let state = AppState {
        eastmoney: EastmoneyClient::new()?,
        tencent: TencentClient::new()?,
        gdelt: GdeltClient::new()?,
        http: reqwest::Client::builder()
            .user_agent("StockChoose-Rust/0.1")
            .build()?,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/aktools/*path", get(aktools_endpoint))
        .route(
            "/api/integration/source-test",
            post(integration_source_test),
        )
        .route("/api/integration/aktools/rows", post(aktools_rows))
        .route("/api/integration/asharehub/rows", post(asharehub_rows))
        .route("/api/data/stock-universe", get(stock_universe))
        .route("/api/market/ashare/spot", get(market_spot))
        .route("/api/market/north-holdings", get(market_north_holdings))
        .route(
            "/api/market/technical-indicators",
            get(market_technical_indicators),
        )
        .route("/api/market/tencent/quote", get(tencent_quote))
        .route("/api/market/tencent/quote-rows", get(tencent_quote_rows))
        .route(
            "/api/market/tencent/ashare/quotes",
            get(tencent_ashare_quote_rows),
        )
        .route("/api/market/tencent/kline", get(tencent_kline))
        .route(
            "/api/market/tencent/kline-points",
            get(tencent_kline_points),
        )
        .route("/api/market/stock/:code/kline", get(market_kline))
        .route(
            "/api/market/stock/:code/kline-points",
            get(market_kline_points),
        )
        .route("/api/finance/statements/:date", get(finance_statements))
        .route("/api/finance/metrics/:date", get(finance_metrics))
        .route(
            "/api/finance/analyst-forecasts",
            get(finance_analyst_forecasts),
        )
        .route("/api/finance/margin-balances", get(finance_margin_balances))
        .route("/api/finance/annual-reports", post(annual_reports))
        .route("/api/filing/announcements", post(filing_announcements))
        .route("/api/news/gdelt", get(gdelt_news))
        .route("/api/news/articles", post(news_articles))
        .route("/api/news/source-test", post(news_source_test))
        .route("/api/sentiment/events", post(sentiment_events))
        .route("/api/sentiment/analysis", post(sentiment_analysis))
        .route(
            "/api/news-analysis/local-test",
            post(news_analysis_local_test),
        )
        .route(
            "/api/news-analysis/model-test",
            post(news_analysis_model_test),
        )
        .route("/api/strategy/screen", post(strategy_screen))
        .route("/api/strategy/rank", post(strategy_rank))
        .route("/api/strategy/backtest", post(strategy_backtest))
        .route("/api/strategy/optimize", post(strategy_optimize))
        .route("/api/valuation/rows", post(valuation_rows))
        .route("/api/trade/plan", post(trade_plan))
        .route("/api/trade/export", post(trade_export))
        .route("/api/trade/paper/submit", post(trade_paper_submit))
        .route("/api/trade/assets/sync", post(trade_assets_sync))
        .layer(DefaultBodyLimit::max(MAX_JSON_BODY_BYTES))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("STOCKCHOOSE_RUST_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(18081);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("stockchoose rust api listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "stockchoose-api",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn integration_source_test(
    State(state): State<AppState>,
    Json(request): Json<IntegrationSourceTestRequest>,
) -> Json<IntegrationSourceTestResponse> {
    Json(build_integration_source_test_response(&state, request).await)
}

async fn build_integration_source_test_response(
    state: &AppState,
    request: IntegrationSourceTestRequest,
) -> IntegrationSourceTestResponse {
    let provider = request.provider.trim().to_string();
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();
    if provider.is_empty() {
        return failed_integration_source_test(provider, "接口来源不能为空");
    }
    if !request.modules.values().any(|enabled| *enabled) {
        return failed_integration_source_test(provider, "至少启用一个数据模块");
    }
    if provider == "本地模拟数据" {
        return failed_integration_source_test(
            provider,
            "本地模拟数据已停用，请接入 AKShare/AKTools 或真实数据接口",
        );
    }
    if !base_url.starts_with("http://")
        && !base_url.starts_with("https://")
        && !base_url.starts_with('/')
    {
        return failed_integration_source_test(
            provider,
            "接口地址必须以 http://、https:// 或本地代理 / 开头",
        );
    }

    if provider.eq_ignore_ascii_case("AShareHub") {
        if request.api_token.trim().is_empty() {
            return failed_integration_source_test(provider, "AShareHub API Key is required");
        }
        if let Some(unknown_module) = first_unknown_enabled_source_module(&request.modules) {
            return failed_integration_source_test(
                provider,
                format!("unsupported info source module: {unknown_module}"),
            );
        }
        let enabled_modules = enabled_source_module_keys(&request.modules);
        return test_asharehub_info_source_modules(
            state,
            provider,
            &base_url,
            &request.api_token,
            &enabled_modules,
            request.timeout_seconds,
        )
        .await;
    }

    if provider == "AKShare / AKTools 免费开源数据" {
        if let Some(unknown_module) = first_unknown_enabled_source_module(&request.modules) {
            return failed_integration_source_test(
                provider,
                format!("unsupported info source module: {unknown_module}"),
            );
        }
        let enabled_modules = enabled_source_module_keys(&request.modules);
        if is_rust_native_info_source_base_url(&base_url) {
            return test_rust_native_info_source_modules(state, provider, &enabled_modules).await;
        }

        return test_external_aktools_info_source_modules(
            state,
            provider,
            &base_url,
            &enabled_modules,
            request.timeout_seconds,
        )
        .await;
    }

    let health_url = match health_check_url(&base_url) {
        Ok(url) => url,
        Err(error) => return failed_integration_source_test(provider, error),
    };
    let mut builder = state
        .http
        .get(health_url)
        .timeout(Duration::from_secs(request.timeout_seconds.clamp(3, 120)));
    if !request.api_token.trim().is_empty() {
        builder = builder.bearer_auth(request.api_token.trim());
    }

    match builder.send().await {
        Ok(response) if response.status().is_success() => IntegrationSourceTestResponse {
            engine: "rust",
            provider,
            ok: true,
            row_count: 0,
            message: "连接检测通过".to_string(),
            details: "远程 /health 接口已由 Rust 代理响应正常".to_string(),
        },
        Ok(response) => failed_integration_source_test(
            provider,
            format!("接口返回 HTTP {}", response.status().as_u16()),
        ),
        Err(error) => {
            let details = if error.is_timeout() {
                "请求超时".to_string()
            } else {
                format!("Rust 信息源代理请求失败：{error}")
            };
            failed_integration_source_test(provider, details)
        }
    }
}

async fn aktools_endpoint(
    State(state): State<AppState>,
    Path(path): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let endpoint = endpoint_from_aktools_path(&path);
    let Some(payload) = state.eastmoney.aktools_payload(&endpoint, &query).await? else {
        return Err(ApiError::not_found(format!(
            "unsupported aktools endpoint: {endpoint}"
        )));
    };
    Ok(Json(payload))
}

async fn aktools_rows(
    State(state): State<AppState>,
    Json(request): Json<AktoolsRowsRequest>,
) -> Result<Json<Value>, ApiError> {
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();
    let endpoint = normalize_aktools_endpoint(&request.endpoint).map_err(ApiError::bad_request)?;
    if base_url.is_empty() {
        return Err(ApiError::bad_request("AKTools baseUrl cannot be empty"));
    }

    if is_rust_native_info_source_base_url(&base_url) {
        let Some(payload) = state
            .eastmoney
            .aktools_payload(&endpoint, &request.params)
            .await?
        else {
            return Err(ApiError::not_found(format!(
                "unsupported aktools endpoint: {endpoint}"
            )));
        };
        return Ok(Json(payload));
    }

    let url =
        aktools_rows_url(&base_url, &endpoint, &request.params).map_err(ApiError::bad_request)?;
    let response = state
        .http
        .get(url)
        .timeout(Duration::from_secs(request.timeout_seconds.clamp(3, 120)))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                ApiError::internal("AKTools request timeout")
            } else {
                ApiError::internal(format!("AKTools proxy request failed: {error}"))
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ApiError::internal(format!(
            "AKTools upstream HTTP {}",
            status.as_u16()
        )));
    }
    let payload = response.json::<Value>().await.map_err(|error| {
        ApiError::internal(format!("AKTools upstream returned invalid JSON: {error}"))
    })?;
    Ok(Json(payload))
}

async fn asharehub_rows(
    State(state): State<AppState>,
    Json(request): Json<AsharehubRowsRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.api_token.trim().is_empty() {
        return Err(ApiError::bad_request("AShareHub API Key is required"));
    }
    let base_url = if request.base_url.trim().is_empty() {
        "https://asharehub.com"
    } else {
        request.base_url.trim()
    };
    let url = asharehub_url(base_url, &request.endpoint, &request.params)
        .map_err(ApiError::bad_request)?;
    let response = state
        .http
        .get(url)
        .header("X-API-Key", request.api_token.trim())
        .header("accept", "application/json")
        .timeout(Duration::from_secs(request.timeout_seconds.clamp(3, 120)))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                ApiError::internal("AShareHub request timeout")
            } else {
                ApiError::internal(format!("AShareHub proxy request failed: {error}"))
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ApiError::internal(format!(
            "AShareHub upstream HTTP {}",
            status.as_u16()
        )));
    }
    let payload = response.json::<Value>().await.map_err(|error| {
        ApiError::internal(format!("AShareHub upstream returned invalid JSON: {error}"))
    })?;
    Ok(Json(payload))
}

async fn market_spot(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(Value::Array(state.eastmoney.fetch_spot_rows().await?)))
}

async fn stock_universe(
    State(state): State<AppState>,
    Query(query): Query<StockUniverseQuery>,
) -> Result<Json<StockUniverseResponse>, ApiError> {
    let checked_at = Utc::now().to_rfc3339();
    let spot_rows = state.eastmoney.fetch_spot_rows().await?;
    let mut stocks = spot_rows
        .iter()
        .filter_map(stock_from_eastmoney_spot_row)
        .collect::<Vec<_>>();
    stocks.sort_by(|left, right| {
        left.exchange
            .cmp(&right.exchange)
            .then(left.code.cmp(&right.code))
    });

    if stocks.is_empty() {
        return Err(ApiError::internal(
            "Rust stock universe collector returned no usable A-share rows",
        ));
    }

    let mut details = vec![format!(
        "market: Eastmoney spot returned {} rows, normalized {} stocks",
        spot_rows.len(),
        stocks.len()
    )];
    let mut finance_matched_rows = 0_usize;
    let mut finance_source_rows = 0_usize;
    let mut analyst_matched_rows = 0_usize;
    let mut analyst_source_rows = 0_usize;
    let mut margin_matched_rows = 0_usize;
    let mut margin_source_rows = 0_usize;
    let mut north_hold_matched_rows = 0_usize;
    let mut north_hold_source_rows = 0_usize;
    let mut technical_matched_rows = 0_usize;
    let mut technical_source_rows = 0_usize;

    if query.finance {
        match stock_universe_latest_financial_metric_rows(&state).await {
            Ok(rows) => {
                finance_source_rows = metric_source_rows(&rows);
                finance_matched_rows =
                    merge_financial_metric_rows_into_stocks(&mut stocks, &rows, false);
                details.push(format!(
                    "finance: matched {finance_matched_rows}/{finance_source_rows} source rows"
                ));
            }
            Err(error) => details.push(format!("finance unfinished: {}", error.details)),
        }
    }

    if query.analyst {
        match state.eastmoney.fetch_analyst_forecast_metrics().await {
            Ok(rows) => {
                analyst_source_rows = metric_source_rows(&rows);
                analyst_matched_rows =
                    merge_financial_metric_rows_into_stocks(&mut stocks, &rows, false);
                enrich_target_upside(&mut stocks);
                details.push(format!(
                    "analyst: matched {analyst_matched_rows}/{analyst_source_rows} source rows"
                ));
            }
            Err(error) => details.push(format!("analyst unfinished: {error}")),
        }
    }

    if query.margin {
        match state.eastmoney.fetch_margin_balance_metrics().await {
            Ok(rows) => {
                margin_source_rows = metric_source_rows(&rows);
                margin_matched_rows =
                    merge_financial_metric_rows_into_stocks(&mut stocks, &rows, true);
                details.push(format!(
                    "margin: matched {margin_matched_rows}/{margin_source_rows} source rows"
                ));
            }
            Err(error) => details.push(format!("margin unfinished: {error}")),
        }
    }

    if query.north {
        match state.eastmoney.fetch_north_holding_metrics().await {
            Ok(rows) => {
                north_hold_source_rows = metric_source_rows(&rows);
                north_hold_matched_rows =
                    merge_financial_metric_rows_into_stocks(&mut stocks, &rows, false);
                details.push(format!(
                    "north holdings: matched {north_hold_matched_rows}/{north_hold_source_rows} source rows"
                ));
            }
            Err(error) => details.push(format!("north holdings unfinished: {error}")),
        }
    }

    if query.technical {
        let codes = stock_universe_technical_codes(&stocks, query.technical_limit);
        if codes.is_empty() {
            details.push("technical indicators unfinished: no listed A-share codes".to_string());
        } else {
            match fetch_technical_indicator_metrics(
                &state,
                TechnicalIndicatorQuery {
                    codes: Some(codes.join(",")),
                    limit: Some(120),
                },
            )
            .await
            {
                Ok(rows) => {
                    technical_source_rows = metric_source_rows(&rows);
                    technical_matched_rows =
                        merge_financial_metric_rows_into_stocks(&mut stocks, &rows, false);
                    details.push(format!(
                        "technical: matched {technical_matched_rows}/{technical_source_rows} source rows"
                    ));
                }
                Err(error) => details.push(format!(
                    "technical indicators unfinished: {}",
                    error.details
                )),
            }
        }
    }

    let valuation_ready_rows = stocks
        .iter()
        .filter(|stock| missing_real_valuation_fields(stock).is_empty())
        .count();
    let summary = StockUniverseSummary {
        provider: "Rust native Eastmoney/Tencent".to_string(),
        last_sync_at: checked_at.clone(),
        matched_rows: stocks.len(),
        source_rows: spot_rows.len(),
        stock_count: stocks.len(),
        finance_matched_rows,
        finance_source_rows,
        analyst_matched_rows,
        analyst_source_rows,
        margin_matched_rows,
        margin_source_rows,
        north_hold_matched_rows,
        north_hold_source_rows,
        technical_matched_rows,
        technical_source_rows,
        valuation_ready_rows,
        details: details.join("; "),
    };

    Ok(Json(StockUniverseResponse {
        engine: "rust",
        checked_at,
        stocks,
        summary,
    }))
}

async fn stock_universe_latest_financial_metric_rows(
    state: &AppState,
) -> Result<Vec<FinancialMetricRow>, ApiError> {
    let mut errors = Vec::new();
    for report_date in stock_universe_financial_report_date_candidates() {
        match state
            .eastmoney
            .fetch_financial_metrics(Some(&report_date))
            .await
        {
            Ok(rows) if !rows.is_empty() => return Ok(rows),
            Ok(_) => errors.push(format!("{report_date}: 0 rows")),
            Err(error) => errors.push(format!("{report_date}: {error}")),
        }
    }
    Err(ApiError::internal(format!(
        "Rust financial metrics collector returned no usable rows ({})",
        errors.join("; ")
    )))
}

fn stock_universe_financial_report_date_candidates() -> Vec<String> {
    let today = Utc::now().date_naive();
    let year = today.year();
    let latest_annual_year = if today.month() >= 5 {
        year - 1
    } else {
        year - 2
    };
    let mut candidates = vec![
        format!("{latest_annual_year}-12-31"),
        format!("{}-09-30", year - 1),
        format!("{}-06-30", year - 1),
        format!("{}-12-31", latest_annual_year - 1),
    ];
    if today.month() >= 5 {
        candidates.insert(1, format!("{year}-03-31"));
    }
    candidates.sort();
    candidates.dedup();
    candidates.reverse();
    candidates
}

fn stock_from_eastmoney_spot_row(row: &Value) -> Option<Stock> {
    let code = normalize_six_digit_code(&row_string_any(row, &["code"])?);
    if code.is_empty() {
        return None;
    }
    let name = row_string_any(row, &["name"]).unwrap_or_else(|| code.clone());
    let exchange = stock_exchange_for_code(&code);
    let board = stock_board_for_code(&code);
    let mut metrics = HashMap::new();

    insert_metric_if_finite(&mut metrics, "price", row_number_any(row, &["price"]), 2);
    insert_metric_if_finite(
        &mut metrics,
        "pctChange",
        row_number_any(row, &["pctChange"]),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "relativeChange",
        row_number_any(row, &["pctChange"]).map(|value| value - 0.25),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "volume",
        row_number_any(row, &["volume"]).map(volume_to_wan_shou),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "amount",
        row_number_any(row, &["amount"]).map(amount_to_yi),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "turnover",
        row_number_any(row, &["turnover"]),
        2,
    );
    insert_metric_if_finite(&mut metrics, "pe", row_number_any(row, &["pe"]), 2);
    insert_metric_if_finite(&mut metrics, "pb", row_number_any(row, &["pb"]), 2);
    insert_metric_if_finite(
        &mut metrics,
        "priceAmplitude",
        row_number_any(row, &["amplitude"]),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "marketCap",
        row_number_any(row, &["marketCap"]).map(amount_to_yi),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "floatMarketCap",
        row_number_any(row, &["floatMarketCap"]).map(amount_to_yi),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "momentum60",
        row_number_any(row, &["momentum60"]),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "netInflow",
        row_number_any(row, &["netInflow"]).map(amount_to_yi),
        2,
    );
    insert_metric_if_finite(
        &mut metrics,
        "netInflowRatio",
        row_number_any(row, &["netInflowRatio"]),
        2,
    );
    let listing_date = row_number_any(row, &["listingDate"]);
    insert_metric_if_finite(&mut metrics, "listingDate", listing_date, 0);
    let listing_days = listing_date.and_then(listing_days_from_compact_date);
    insert_metric_if_finite(&mut metrics, "listingDays", listing_days, 0);
    insert_metric_if_finite(
        &mut metrics,
        "newStockScore",
        new_stock_score(
            listing_days,
            row_number_any(row, &["turnover"]),
            row_number_any(row, &["pctChange"]),
            row_number_any(row, &["amount"]).map(amount_to_yi),
        ),
        2,
    );
    insert_metric_if_finite(&mut metrics, "realQuoteSource", Some(1.0), 0);
    insert_metric_if_finite(&mut metrics, "openSourceMarketSource", Some(1.0), 0);
    insert_metric_if_finite(
        &mut metrics,
        "limitFlag",
        row_number_any(row, &["pctChange"]).map(|value| {
            if value >= 9.8 {
                1.0
            } else if value <= -9.8 {
                -1.0
            } else {
                0.0
            }
        }),
        0,
    );

    Some(Stock {
        code,
        name: name.clone(),
        exchange,
        board: board.clone(),
        industry1: "未分类".to_string(),
        industry2: "东方财富行情".to_string(),
        region: "未披露".to_string(),
        property: "民企".to_string(),
        is_st: name.contains("ST"),
        is_suspended: false,
        is_star: board == "科创板",
        is_margin: false,
        indexes: Vec::new(),
        metrics,
    })
}

fn row_string_any(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| match row.get(*key) {
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    })
}

fn row_number_any(row: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| match row.get(*key) {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.replace(',', "").parse::<f64>().ok(),
        _ => None,
    })
}

fn stock_exchange_for_code(code: &str) -> String {
    if code.starts_with('6') {
        "沪市".to_string()
    } else if code.starts_with('4') || code.starts_with('8') || code.starts_with("920") {
        "北交所".to_string()
    } else {
        "深市".to_string()
    }
}

fn stock_board_for_code(code: &str) -> String {
    if code.starts_with("688") || code.starts_with("689") {
        "科创板".to_string()
    } else if code.starts_with("300") || code.starts_with("301") || code.starts_with("302") {
        "创业板".to_string()
    } else if code.starts_with('4') || code.starts_with('8') || code.starts_with("920") {
        "北交所".to_string()
    } else {
        "主板".to_string()
    }
}

fn volume_to_wan_shou(value: f64) -> f64 {
    if value.abs() > 10_000.0 {
        value / 10_000.0
    } else {
        value
    }
}

fn amount_to_yi(value: f64) -> f64 {
    if value.abs() > 100_000.0 {
        value / 100_000_000.0
    } else {
        value
    }
}

fn listing_days_from_compact_date(value: f64) -> Option<f64> {
    let text = format!("{:08}", value.trunc() as i64);
    let year = text.get(0..4)?.parse::<i32>().ok()?;
    let month = text.get(4..6)?.parse::<u32>().ok()?;
    let day = text.get(6..8)?.parse::<u32>().ok()?;
    let listed_at = NaiveDate::from_ymd_opt(year, month, day)?;
    let days = Utc::now()
        .date_naive()
        .signed_duration_since(listed_at)
        .num_days()
        + 1;
    Some(days.max(1) as f64)
}

fn new_stock_score(
    listing_days: Option<f64>,
    turnover: Option<f64>,
    pct_change: Option<f64>,
    amount_yi: Option<f64>,
) -> Option<f64> {
    let listing_days = listing_days?;
    let age_score = (100.0 - (listing_days - 1.0).max(0.0) / 3.0).clamp(0.0, 100.0);
    let turnover_score = turnover.unwrap_or(0.0).clamp(0.0, 50.0) * 0.8;
    let heat_score = pct_change.unwrap_or(0.0).clamp(-20.0, 30.0) * 0.45;
    let amount_score = amount_yi.unwrap_or(0.0).clamp(0.0, 100.0) * 0.12;
    Some((age_score + turnover_score + heat_score + amount_score).clamp(0.0, 100.0))
}

fn metric_source_rows(rows: &[FinancialMetricRow]) -> usize {
    rows.iter().map(|row| row.source_rows).sum()
}

fn merge_financial_metric_rows_into_stocks(
    stocks: &mut [Stock],
    rows: &[FinancialMetricRow],
    mark_margin: bool,
) -> usize {
    let row_by_code = rows
        .iter()
        .map(|row| (six_digit_stock_code(&row.code), row))
        .collect::<HashMap<_, _>>();
    let mut matched = 0_usize;
    for stock in stocks {
        let Some(row) = row_by_code.get(&six_digit_stock_code(&stock.code)).copied() else {
            continue;
        };
        matched += 1;
        if stock.name.trim().is_empty() || stock.name == stock.code {
            stock.name = row.name.clone();
        }
        for (key, value) in &row.metrics {
            insert_metric_if_finite(
                &mut stock.metrics,
                key,
                Some(*value),
                stock_metric_precision(key),
            );
        }
        if mark_margin && stock.metrics.get("realMarginSource") == Some(&1.0) {
            stock.is_margin = true;
        }
    }
    matched
}

fn enrich_target_upside(stocks: &mut [Stock]) {
    for stock in stocks {
        let target = ["targetPriceMid", "targetPriceHigh", "targetPriceLow"]
            .iter()
            .find_map(|key| stock.metrics.get(*key).copied())
            .filter(|value| value.is_finite() && *value > 0.0);
        let price = stock
            .metrics
            .get("price")
            .copied()
            .filter(|value| value.is_finite() && *value > 0.0);
        if let (Some(target), Some(price)) = (target, price) {
            insert_metric_if_finite(
                &mut stock.metrics,
                "targetUpside",
                Some((target / price - 1.0) * 100.0),
                2,
            );
        }
    }
}

fn stock_metric_precision(key: &str) -> i32 {
    if key.starts_with("real")
        || key.ends_with("Date")
        || key.ends_with("Source")
        || key.ends_with("Count")
        || key.ends_with("Shares")
        || key.ends_with("Days")
    {
        0
    } else {
        2
    }
}

fn stock_universe_technical_codes(stocks: &[Stock], limit: usize) -> Vec<String> {
    let mut rows = stocks
        .iter()
        .filter_map(|stock| {
            let code = six_digit_stock_code(&stock.code);
            if !listed_ashare_code(&code) {
                return None;
            }
            let amount = stock.metrics.get("amount").copied().unwrap_or(0.0);
            let market_cap = stock
                .metrics
                .get("floatMarketCap")
                .or_else(|| stock.metrics.get("marketCap"))
                .copied()
                .unwrap_or(0.0);
            let turnover = stock.metrics.get("turnover").copied().unwrap_or(0.0);
            Some((code, amount * 1_000_000.0 + market_cap + turnover))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| right.1.total_cmp(&left.1).then(left.0.cmp(&right.0)));
    rows.into_iter()
        .map(|(code, _)| code)
        .take(limit.clamp(1, TECHNICAL_INDICATOR_CODE_LIMIT))
        .collect()
}

fn listed_ashare_code(code: &str) -> bool {
    code.len() == 6
        && (code.starts_with("600")
            || code.starts_with("601")
            || code.starts_with("603")
            || code.starts_with("605")
            || code.starts_with("688")
            || code.starts_with("689")
            || code.starts_with("000")
            || code.starts_with("001")
            || code.starts_with("002")
            || code.starts_with("003")
            || code.starts_with("300")
            || code.starts_with("301")
            || code.starts_with("302")
            || code.starts_with("920"))
}

async fn market_north_holdings(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(
        state.eastmoney.fetch_north_holding_metrics().await?
    )))
}

async fn market_technical_indicators(
    State(state): State<AppState>,
    Query(query): Query<TechnicalIndicatorQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(
        fetch_technical_indicator_metrics(&state, query).await?
    )))
}

async fn tencent_quote(
    State(state): State<AppState>,
    Query(query): Query<TencentQuoteQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let symbols = tencent_symbols_from_query(query)?;
    let body = state.tencent.quote_bytes(&symbols).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/plain; charset=gb18030"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    ))
}

async fn tencent_quote_rows(
    State(state): State<AppState>,
    Query(query): Query<TencentQuoteQuery>,
) -> Result<Json<Value>, ApiError> {
    let symbols = tencent_symbols_from_query(query)?;
    Ok(Json(json!(state.tencent.quote_rows(&symbols).await?)))
}

async fn tencent_ashare_quote_rows(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(state.tencent.all_ashare_quote_rows().await?)))
}

async fn tencent_kline(
    State(state): State<AppState>,
    Query(query): Query<TencentKlineQuery>,
) -> Result<Json<Value>, ApiError> {
    let (symbol, period, limit) = parse_tencent_kline_query(query)?;
    Ok(Json(
        state.tencent.kline_payload(&symbol, &period, limit).await?,
    ))
}

async fn tencent_kline_points(
    State(state): State<AppState>,
    Query(query): Query<TencentKlineQuery>,
) -> Result<Json<Value>, ApiError> {
    let (symbol, period, limit) = parse_tencent_kline_query(query)?;
    Ok(Json(json!(
        state.tencent.kline_points(&symbol, &period, limit).await?
    )))
}

fn tencent_symbols_from_query(query: TencentQuoteQuery) -> Result<Vec<String>, ApiError> {
    let symbols: Vec<String> = query
        .symbols
        .or(query.q)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|symbol| !symbol.is_empty())
        .map(ToString::to_string)
        .collect();
    if symbols.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Tencent quote query is empty".to_string(),
            details: "Pass q=sh600000,sz000001 or symbols=...".to_string(),
        });
    }
    Ok(symbols)
}

async fn market_kline(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let symbol = tencent_symbol_for_code(&code);
    let period = query.get("period").map(String::as_str).unwrap_or("day");
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(120);
    Ok(Json(
        state.tencent.kline_payload(&symbol, period, limit).await?,
    ))
}

async fn market_kline_points(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let symbol = tencent_symbol_for_code(&code);
    let period = query.get("period").map(String::as_str).unwrap_or("day");
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(120);
    Ok(Json(json!(
        state.tencent.kline_points(&symbol, period, limit).await?
    )))
}

async fn fetch_technical_indicator_metrics(
    state: &AppState,
    query: TechnicalIndicatorQuery,
) -> Result<Vec<FinancialMetricRow>, ApiError> {
    let codes = parse_technical_indicator_codes(query.codes.as_deref())?;
    let limit = query.limit.unwrap_or(120).clamp(80, 250);
    let mut rows = Vec::new();
    let mut errors = Vec::new();

    for chunk in codes.chunks(TECHNICAL_INDICATOR_CONCURRENCY) {
        let mut tasks = tokio::task::JoinSet::new();
        for code in chunk {
            let client = state.tencent.clone();
            let code = code.clone();
            tasks.spawn(async move {
                let symbol = tencent_symbol_for_code(&code);
                let result = async {
                    let points = client.kline_points(&symbol, "day", limit).await?;
                    technical_indicator_row_from_points(&code, points)
                }
                .await;
                (code, result)
            });
        }

        while let Some(task_result) = tasks.join_next().await {
            match task_result {
                Ok((_, Ok(row))) => rows.push(row),
                Ok((code, Err(error))) => errors.push(format!("{code}: {error}")),
                Err(error) => errors.push(format!("technical indicator task failed: {error}")),
            }
        }
    }

    rows.sort_by(|left, right| left.code.cmp(&right.code));
    if rows.is_empty() {
        return Err(ApiError::internal(format!(
            "Tencent technical indicator collector returned no rows ({})",
            errors.join("; ")
        )));
    }
    Ok(rows)
}

fn parse_technical_indicator_codes(codes: Option<&str>) -> Result<Vec<String>, ApiError> {
    let mut seen = HashSet::new();
    let result: Vec<String> = codes
        .unwrap_or_default()
        .split(',')
        .filter_map(|raw| {
            let digits: String = raw.chars().filter(|ch| ch.is_ascii_digit()).collect();
            if digits.is_empty() {
                return None;
            }
            let code = if digits.len() >= 6 {
                digits[digits.len() - 6..].to_string()
            } else {
                format!("{digits:0>6}")
            };
            if seen.insert(code.clone()) {
                Some(code)
            } else {
                None
            }
        })
        .take(TECHNICAL_INDICATOR_CODE_LIMIT)
        .collect();

    if result.is_empty() {
        return Err(ApiError::bad_request(
            "Pass at least one stock code in codes=600519,000858",
        ));
    }
    Ok(result)
}

fn technical_indicator_row_from_points(
    code: &str,
    mut points: Vec<TencentKlinePoint>,
) -> Result<FinancialMetricRow, CollectorError> {
    points.sort_by(|left, right| left.date.cmp(&right.date));
    if points.len() < 35 {
        return Err(CollectorError::InvalidPayload(format!(
            "technical indicators require at least 35 daily kline points, got {}",
            points.len()
        )));
    }

    let closes: Vec<f64> = points.iter().map(|point| point.close).collect();
    let highs: Vec<f64> = points.iter().map(|point| point.high).collect();
    let lows: Vec<f64> = points.iter().map(|point| point.low).collect();
    let latest = points.last().ok_or_else(|| {
        CollectorError::InvalidPayload("technical indicators missing latest kline".to_string())
    })?;
    let close = latest.close;

    let ma20 = sma(&closes, 20);
    let ma60 = sma(&closes, 60);
    let volatility20 = annualized_volatility(&closes, 20);
    let mut metrics = HashMap::new();
    insert_technical_metric(
        &mut metrics,
        "ma20Distance",
        ma20.and_then(|value| ratio_percent(close, value)),
    );
    insert_technical_metric(
        &mut metrics,
        "ma60Distance",
        ma60.and_then(|value| ratio_percent(close, value)),
    );
    insert_technical_metric(&mut metrics, "momentum60", momentum(&closes, 60));
    insert_technical_metric(&mut metrics, "volatility20", volatility20);
    insert_technical_metric(&mut metrics, "macd", macd_histogram(&closes));
    insert_technical_metric(&mut metrics, "kdj", kdj_j(&highs, &lows, &closes, 9));
    insert_technical_metric(&mut metrics, "rsi", rsi(&closes, 14));
    insert_technical_metric(
        &mut metrics,
        "bias",
        ma20.and_then(|value| ratio_percent(close, value)),
    );
    insert_technical_metric(&mut metrics, "bollWidth", boll_width(&closes, 20));
    insert_technical_metric(&mut metrics, "tradingDays", Some(points.len() as f64));
    insert_technical_metric(
        &mut metrics,
        "technicalTradeDate",
        parse_compact_date_number(&latest.date),
    );
    insert_technical_metric(&mut metrics, "realTechnicalSource", Some(1.0));

    Ok(FinancialMetricRow {
        code: normalize_six_digit_code(code),
        name: normalize_six_digit_code(code),
        report_date: latest.date.clone(),
        source_rows: points.len(),
        metrics,
    })
}

fn normalize_six_digit_code(code: &str) -> String {
    let digits: String = code.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() >= 6 {
        digits[digits.len() - 6..].to_string()
    } else {
        format!("{digits:0>6}")
    }
}

fn insert_technical_metric(metrics: &mut HashMap<String, f64>, key: &str, value: Option<f64>) {
    if let Some(value) = value.filter(|item| item.is_finite()) {
        let precision = if key.ends_with("Date")
            || key.ends_with("Source")
            || key.ends_with("Days")
            || key.ends_with("Count")
        {
            0
        } else {
            2
        };
        metrics.insert(key.to_string(), round_metric(value, precision));
    }
}

fn round_metric(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

fn sma(values: &[f64], window: usize) -> Option<f64> {
    if values.len() < window || window == 0 {
        return None;
    }
    let slice = &values[values.len() - window..];
    Some(slice.iter().sum::<f64>() / window as f64)
}

fn ratio_percent(value: f64, base: f64) -> Option<f64> {
    if base.abs() < 0.000001 {
        None
    } else {
        Some((value / base - 1.0) * 100.0)
    }
}

fn momentum(values: &[f64], days: usize) -> Option<f64> {
    if values.len() <= days {
        return None;
    }
    let latest = *values.last()?;
    let previous = values[values.len() - days - 1];
    ratio_percent(latest, previous)
}

fn annualized_volatility(closes: &[f64], returns: usize) -> Option<f64> {
    if closes.len() <= returns || returns == 0 {
        return None;
    }
    let start = closes.len() - returns - 1;
    let mut daily_returns = Vec::with_capacity(returns);
    for index in start + 1..closes.len() {
        let previous = closes[index - 1];
        if previous.abs() < 0.000001 {
            return None;
        }
        daily_returns.push(closes[index] / previous - 1.0);
    }
    let mean = daily_returns.iter().sum::<f64>() / daily_returns.len() as f64;
    let variance = daily_returns
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / daily_returns.len() as f64;
    Some(variance.sqrt() * 252.0_f64.sqrt() * 100.0)
}

fn ema_series(values: &[f64], period: usize) -> Option<Vec<f64>> {
    let first = *values.first()?;
    let alpha = 2.0 / (period as f64 + 1.0);
    let mut ema = first;
    let mut series = Vec::with_capacity(values.len());
    for value in values {
        ema = alpha * *value + (1.0 - alpha) * ema;
        series.push(ema);
    }
    Some(series)
}

fn macd_histogram(closes: &[f64]) -> Option<f64> {
    if closes.len() < 35 {
        return None;
    }
    let ema12 = ema_series(closes, 12)?;
    let ema26 = ema_series(closes, 26)?;
    let dif: Vec<f64> = ema12
        .iter()
        .zip(ema26.iter())
        .map(|(fast, slow)| fast - slow)
        .collect();
    let dea = ema_series(&dif, 9)?;
    Some((dif.last()? - dea.last()?) * 2.0)
}

fn kdj_j(highs: &[f64], lows: &[f64], closes: &[f64], window: usize) -> Option<f64> {
    if highs.len() != lows.len() || lows.len() != closes.len() || closes.len() < window {
        return None;
    }
    let mut k = 50.0;
    let mut d = 50.0;
    for index in window - 1..closes.len() {
        let low = lows[index + 1 - window..=index]
            .iter()
            .fold(f64::INFINITY, |acc, value| acc.min(*value));
        let high = highs[index + 1 - window..=index]
            .iter()
            .fold(f64::NEG_INFINITY, |acc, value| acc.max(*value));
        let rsv = if (high - low).abs() < 0.000001 {
            50.0
        } else {
            (closes[index] - low) / (high - low) * 100.0
        };
        k = k * 2.0 / 3.0 + rsv / 3.0;
        d = d * 2.0 / 3.0 + k / 3.0;
    }
    Some((3.0 * k - 2.0 * d).clamp(0.0, 100.0))
}

fn rsi(closes: &[f64], window: usize) -> Option<f64> {
    if closes.len() <= window || window == 0 {
        return None;
    }
    let start = closes.len() - window;
    let mut gains = 0.0;
    let mut losses = 0.0;
    for index in start..closes.len() {
        let change = closes[index] - closes[index - 1];
        if change >= 0.0 {
            gains += change;
        } else {
            losses += change.abs();
        }
    }
    if losses.abs() < 0.000001 {
        return Some(100.0);
    }
    Some(100.0 - 100.0 / (1.0 + gains / losses))
}

fn boll_width(closes: &[f64], window: usize) -> Option<f64> {
    if closes.len() < window || window == 0 {
        return None;
    }
    let slice = &closes[closes.len() - window..];
    let mean = slice.iter().sum::<f64>() / window as f64;
    if mean.abs() < 0.000001 {
        return None;
    }
    let variance = slice
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / window as f64;
    Some(4.0 * variance.sqrt() / mean * 100.0)
}

fn parse_compact_date_number(value: &str) -> Option<f64> {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() < 8 {
        return None;
    }
    digits.get(0..8)?.parse::<f64>().ok()
}

async fn finance_statements(
    State(state): State<AppState>,
    Path(date): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let rows = state
        .eastmoney
        .fetch_financial_statements(Some(&date))
        .await?;
    Ok(Json(json!(rows)))
}

async fn finance_metrics(
    State(state): State<AppState>,
    Path(date): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(
        state.eastmoney.fetch_financial_metrics(Some(&date)).await?
    )))
}

async fn finance_analyst_forecasts(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(
        state.eastmoney.fetch_analyst_forecast_metrics().await?
    )))
}

async fn finance_margin_balances(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(
        state.eastmoney.fetch_margin_balance_metrics().await?
    )))
}

async fn gdelt_news(
    State(state): State<AppState>,
    Query(query): Query<GdeltQuery>,
) -> Result<Json<Value>, ApiError> {
    let query_text = query
        .query
        .unwrap_or_else(|| "China stock market OR A-shares OR listed companies".to_string());
    Ok(Json(
        state
            .gdelt
            .article_list(&query_text, query.max_records.unwrap_or(100))
            .await?,
    ))
}

async fn news_articles(
    State(state): State<AppState>,
    Json(request): Json<NewsArticleRequest>,
) -> Result<Json<NewsArticleResponse>, ApiError> {
    let real_sources: Vec<_> = request
        .sources
        .iter()
        .filter(|source| source.enabled && is_supported_rust_news_provider(&source.provider))
        .collect();
    let mut articles = Vec::new();
    let mut request_count = 0_usize;
    let mut returned_rows = 0_usize;
    let mut source_diagnostics = Vec::new();

    for source in real_sources {
        request_count += 1;
        let query = source
            .query
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("A股 OR 中国上市公司");
        let payload = if is_announcement_news_provider(&source.provider) {
            announcement_articles_payload(&state.eastmoney, source, &request.stocks).await?
        } else {
            state
                .gdelt
                .source_article_list(
                    &source.provider,
                    &source.base_url,
                    query,
                    source.max_items.unwrap_or(50),
                    &source.api_token,
                    &source.language,
                )
                .await?
        };
        if let Some(diagnostic) = news_source_diagnostic_from_payload(source, &payload) {
            source_diagnostics.push(diagnostic);
        }
        let rows = payload
            .get("articles")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                ApiError::internal(format!(
                    "news source {} returned invalid payload: articles must be an array",
                    source.name
                ))
            })?;
        returned_rows += rows.len();
        for (index, row) in rows.iter().enumerate() {
            let article =
                build_news_article(row, source, &request.stocks, index).map_err(|error| {
                    ApiError::internal(format!(
                        "news source {} returned invalid article row {index}: {error}",
                        source.name
                    ))
                })?;
            articles.push(article);
        }
    }

    let mut seen_urls = HashSet::new();
    let mut deduped = Vec::new();
    for article in articles {
        let key = if article.url.is_empty() {
            article.id.clone()
        } else {
            article.url.clone()
        };
        if seen_urls.insert(key) {
            deduped.push(article);
        }
    }
    deduped.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    let stats = NewsFetchStats {
        mode: request.mode,
        scanned_stocks: request.stocks.len(),
        request_count,
        returned_rows,
        valid_articles: deduped.len(),
    };
    Ok(Json(NewsArticleResponse {
        articles: deduped,
        stats,
        source_diagnostics,
    }))
}

async fn news_source_test(
    State(state): State<AppState>,
    Json(request): Json<NewsSourceTestRequest>,
) -> Json<NewsSourceTestResponse> {
    let mut source = request.source;
    if !source.enabled {
        return Json(NewsSourceTestResponse {
            engine: "rust",
            provider: source.provider,
            ok: false,
            row_count: 0,
            message: "新闻源检测失败".to_string(),
            details: "新闻源未启用".to_string(),
        });
    }
    if !is_supported_rust_news_provider(&source.provider) {
        return Json(NewsSourceTestResponse {
            engine: "rust",
            provider: source.provider,
            ok: false,
            row_count: 0,
            message: "新闻源检测失败".to_string(),
            details: "Rust 新闻采集器暂不支持该新闻源类型".to_string(),
        });
    }

    let query = source
        .query
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("stock");
    let payload_result: Result<Value, String> = if is_announcement_news_provider(&source.provider) {
        announcement_articles_payload(&state.eastmoney, &source, &[])
            .await
            .map_err(|error| error.to_string())
    } else {
        state
            .gdelt
            .source_article_list(
                &source.provider,
                &source.base_url,
                query,
                1,
                &source.api_token,
                &source.language,
            )
            .await
            .map_err(|error| error.to_string())
    };
    match payload_result {
        Ok(payload) => {
            let row_count = match news_payload_article_count(&payload) {
                Ok(row_count) => row_count,
                Err(error) => {
                    return Json(NewsSourceTestResponse {
                        engine: "rust",
                        provider: source.provider.clone(),
                        ok: false,
                        row_count: 0,
                        message: "news source test failed".to_string(),
                        details: format!(
                            "{} returned invalid Rust news collector payload: {error}",
                            source.name
                        ),
                    })
                }
            };
            let fallback_suffix = news_source_test_fallback_suffix(&payload);
            if row_count == 0 {
                return Json(NewsSourceTestResponse {
                    engine: "rust",
                    provider: source.provider.clone(),
                    ok: false,
                    row_count,
                    message: "新闻源检测失败".to_string(),
                    details: format!(
                        "{} returned 0 usable test news rows from Rust news collector{}",
                        source.name, fallback_suffix
                    ),
                });
            }
            source.name.push_str(&fallback_suffix);
            Json(NewsSourceTestResponse {
                engine: "rust",
                provider: source.provider.clone(),
                ok: true,
                row_count,
                message: "新闻源检测通过".to_string(),
                details: format!(
                    "{} 已由 Rust 新闻采集器响应，返回 {} 条测试新闻",
                    source.name, row_count
                ),
            })
        }
        Err(error) => Json(NewsSourceTestResponse {
            engine: "rust",
            provider: source.provider,
            ok: false,
            row_count: 0,
            message: "新闻源检测失败".to_string(),
            details: format!("Rust 新闻采集器请求失败：{error}"),
        }),
    }
}

fn is_supported_rust_news_provider(provider: &str) -> bool {
    matches!(
        provider,
        "GDELT 2.1" | "NewsAPI" | "自定义 REST" | "自定义 RSS" | "腾讯证券公告"
    )
}

fn is_announcement_news_provider(provider: &str) -> bool {
    provider == "腾讯证券公告"
}

async fn announcement_articles_payload(
    eastmoney: &EastmoneyClient,
    source: &NewsSourceInput,
    stocks: &[Stock],
) -> Result<Value, CollectorError> {
    let codes = stocks
        .iter()
        .map(|stock| six_digit_stock_code(&stock.code))
        .filter(|code| !code.is_empty())
        .collect::<Vec<_>>();
    let announcements = eastmoney
        .fetch_announcement_rows(&codes, source.max_items.unwrap_or(50))
        .await?;
    let articles = announcements
        .into_iter()
        .map(|row| {
            let title = row.title.clone();
            let source_name = row.source.clone();
            let category = row.category.clone();
            json!({
                "url": row.url,
                "title": title,
                "seendate": row.published_at,
                "domain": source_name,
                "summary": format!("{} {}", category, row.stock_names.join(" ")).trim().to_string(),
                "content": row.title,
                "author": row.source,
                "sourceCountry": "CN",
                "sourceCollection": "eastmoney-announcement",
                "linkedCodes": row.stock_codes,
                "industries": [],
                "tags": ["公司公告", row.category]
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "articles": articles }))
}

async fn sentiment_events(
    Json(request): Json<SentimentEventsRequest>,
) -> Json<SentimentEventsResponse> {
    Json(SentimentEventsResponse {
        engine: "rust",
        events: build_sentiment_events(&request.articles, &request.stocks),
    })
}

async fn sentiment_analysis(
    State(state): State<AppState>,
    Json(request): Json<SentimentAnalysisRequest>,
) -> Json<SentimentAnalysisResponse> {
    let linked_stocks = build_sentiment_linked_stocks(&request.events, &request.stocks);
    let report = enrich_sentiment_report_with_analysis_model(
        &state.http,
        build_sentiment_insight_report(&request.events, &linked_stocks),
        request.analysis_model.as_ref(),
        &request.events,
        &linked_stocks,
    )
    .await;
    Json(SentimentAnalysisResponse {
        engine: "rust",
        linked_stocks,
        report,
    })
}

async fn news_analysis_local_test(
    Json(request): Json<NewsAnalysisLocalTestRequest>,
) -> Json<NewsAnalysisLocalTestResponse> {
    Json(build_news_analysis_local_test_response(&request.tasks))
}

async fn news_analysis_model_test(
    State(state): State<AppState>,
    Json(request): Json<NewsAnalysisModelTestRequest>,
) -> Json<NewsAnalysisModelTestResponse> {
    Json(build_news_analysis_model_test_response(&state.http, request).await)
}

async fn build_news_analysis_model_test_response(
    http: &reqwest::Client,
    request: NewsAnalysisModelTestRequest,
) -> NewsAnalysisModelTestResponse {
    let provider = request.provider.trim().to_string();
    let model = request.model.trim().to_string();
    if provider.is_empty() {
        return failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            "分析模型来源不能为空",
        );
    }
    if model.is_empty() {
        return failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            "模型名称不能为空",
        );
    }

    if provider == "本地规则模型" {
        let local = build_news_analysis_local_test_response(&request.tasks);
        return NewsAnalysisModelTestResponse {
            engine: "rust",
            ok: local.ok,
            provider,
            model,
            message: if local.ok {
                "分析模型检测通过".to_string()
            } else {
                "分析模型检测失败".to_string()
            },
            details: local.message,
        };
    }

    let base_url = request.base_url.trim();
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            "模型接口地址必须以 http:// 或 https:// 开头",
        );
    }
    if request.api_key.trim().is_empty() {
        return failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            "远程模型必须填写 API Key",
        );
    }
    if request.system_prompt.trim().is_empty() {
        return failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            "系统提示词不能为空",
        );
    }

    let endpoint = chat_completions_url(base_url);
    let timeout_seconds = request.timeout_seconds.clamp(3, 120);
    let max_tokens = request.max_tokens.clamp(1, 256);
    let temperature = request.temperature.clamp(0.0, 1.0);
    let response = http
        .post(&endpoint)
        .timeout(Duration::from_secs(timeout_seconds))
        .bearer_auth(request.api_key.trim())
        .json(&json!({
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": [
                { "role": "system", "content": request.system_prompt.trim() },
                { "role": "user", "content": "连接测试：请只返回 JSON，字段 ok=true。" }
            ]
        }))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            let details = if error.is_timeout() {
                "请求超时".to_string()
            } else {
                format!("Rust 模型代理请求失败：{error}")
            };
            return failed_news_analysis_model_test_response(
                provider,
                model,
                "分析模型检测失败",
                details,
            );
        }
    };

    let status = response.status();
    if !status.is_success() {
        let preview = response
            .text()
            .await
            .map(|body| preview_text(&body, 240))
            .unwrap_or_default();
        let details = if preview.is_empty() {
            format!("模型接口返回 HTTP {}", status.as_u16())
        } else {
            format!("模型接口返回 HTTP {}：{}", status.as_u16(), preview)
        };
        return failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            details,
        );
    }

    match response.json::<Value>().await {
        Ok(payload) => {
            let choice_count = payload
                .get("choices")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or_default();
            NewsAnalysisModelTestResponse {
                engine: "rust",
                ok: true,
                provider: provider.clone(),
                model: model.clone(),
                message: "分析模型检测通过".to_string(),
                details: if choice_count > 0 {
                    format!("{provider} / {model} 已由 Rust 代理完成响应，返回 {choice_count} 条模型候选")
                } else {
                    format!("{provider} / {model} 已由 Rust 代理完成 JSON 响应")
                },
            }
        }
        Err(error) => failed_news_analysis_model_test_response(
            provider,
            model,
            "分析模型检测失败",
            format!("模型接口返回成功，但响应不是 JSON：{error}"),
        ),
    }
}

async fn strategy_screen(Json(request): Json<ScreenRequest>) -> Json<Vec<SelectionRow>> {
    Json(screen_stocks(
        &request.strategy,
        &request.stocks,
        &request.pools,
        &request.factors,
        ScreenStocksOptions {
            result_limit: request.result_limit,
            weight_limit: request.weight_limit,
        },
    ))
}

async fn strategy_rank(Json(request): Json<RankRequest>) -> Json<Vec<RankingRow>> {
    Json(ranking_analysis(
        &request.strategy,
        &request.stocks,
        &request.pools,
        &request.factors,
    ))
}

#[derive(Debug, Clone)]
struct RealBacktestSeries {
    row: SelectionRow,
    points: Vec<TencentKlinePoint>,
}

#[derive(Debug, Clone, Copy)]
struct RealBacktestYearAccumulator {
    start_strategy: f64,
    end_strategy: f64,
    start_benchmark: f64,
    end_benchmark: f64,
}

async fn run_backtest_with_real_kline(
    state: &AppState,
    request: &BacktestRequest,
) -> Result<BacktestResult, ApiError> {
    let base = run_backtest(
        &request.strategy,
        &request.stocks,
        &request.pools,
        &request.factors,
        &request.config,
    );
    if base.rows.is_empty() {
        return Ok(base);
    }

    let max_holdings = request.strategy.trading.max_holdings.max(1);
    let mut candidate_rows: Vec<SelectionRow> = base
        .rows
        .iter()
        .filter(|row| row.weight > 0.0)
        .take(max_holdings)
        .cloned()
        .collect();
    if candidate_rows.is_empty() {
        candidate_rows = base.rows.iter().take(max_holdings).cloned().collect();
    }

    let limit = backtest_kline_limit(&request.config);
    let mut series = Vec::new();
    let mut errors = Vec::new();
    for row in candidate_rows {
        let symbol = tencent_symbol_for_code(&row.stock.code);
        match state.tencent.kline_points(&symbol, "day", limit).await {
            Ok(points) => {
                let points = filter_kline_points(points, &request.config);
                if points.len() >= 2 {
                    series.push(RealBacktestSeries { row, points });
                } else {
                    errors.push(format!(
                        "{} {}: 历史K线不足 2 个交易日",
                        row.stock.code, row.stock.name
                    ));
                }
            }
            Err(error) => errors.push(format!("{} {}: {error}", row.stock.code, row.stock.name)),
        }
    }
    if !errors.is_empty() {
        return Err(ApiError::internal(format!(
            "Rust 回测历史行情采集失败：{}",
            errors.join("；")
        )));
    }

    let benchmark_points = if let Some(symbol) = benchmark_symbol(&request.config.benchmark) {
        match state.tencent.kline_points(symbol, "day", limit).await {
            Ok(points) => {
                let points = filter_kline_points(points, &request.config);
                if points.len() < 2 {
                    return Err(ApiError::internal(format!(
                        "Rust 回测基准历史行情采集失败：{} K线不足 2 个交易日",
                        request.config.benchmark
                    )));
                }
                points
            }
            Err(error) => {
                return Err(ApiError::internal(format!(
                    "Rust 回测基准历史行情采集失败：{} {error}",
                    request.config.benchmark
                )))
            }
        }
    } else {
        Vec::new()
    };

    build_real_kline_backtest_result(
        base.clone(),
        &request.strategy,
        &request.config,
        series,
        benchmark_points,
    )
    .ok_or_else(|| ApiError::internal("Rust 回测历史行情采集失败：未形成可计算的真实K线收益曲线"))
}

fn backtest_kline_limit(config: &BacktestConfig) -> usize {
    let start_year = config
        .start_date
        .get(0..4)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let end_year = config
        .end_date
        .get(0..4)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(start_year);
    let years = end_year.saturating_sub(start_year).max(1) + 1;
    (years * 260 + 80).clamp(180, 1200)
}

fn date_in_backtest_range(date: &str, config: &BacktestConfig) -> bool {
    date >= config.start_date.as_str() && date <= config.end_date.as_str()
}

fn filter_kline_points(
    mut points: Vec<TencentKlinePoint>,
    config: &BacktestConfig,
) -> Vec<TencentKlinePoint> {
    points.retain(|point| date_in_backtest_range(&point.date, config));
    points.sort_by(|left, right| left.date.cmp(&right.date));
    points.dedup_by(|left, right| left.date == right.date);
    points
}

fn benchmark_symbol(benchmark: &str) -> Option<&'static str> {
    if benchmark.contains("300") || benchmark.contains("沪深") {
        return Some("sh000300");
    }
    if benchmark.contains("500") || benchmark.contains("中证") {
        return Some("sh000905");
    }
    if benchmark.contains("创业") {
        return Some("sz399006");
    }
    if benchmark.contains("科创") || benchmark.contains("50") {
        return Some("sh000688");
    }
    None
}

fn close_map(points: &[TencentKlinePoint]) -> HashMap<String, f64> {
    points
        .iter()
        .filter(|point| point.close.is_finite() && point.close > 0.0)
        .map(|point| (point.date.clone(), point.close))
        .collect()
}

fn build_real_kline_backtest_result(
    base: BacktestResult,
    strategy: &StrategyConfig,
    config: &BacktestConfig,
    series: Vec<RealBacktestSeries>,
    benchmark_points: Vec<TencentKlinePoint>,
) -> Option<BacktestResult> {
    if series.is_empty() {
        return None;
    }

    let mut dates: Vec<String> = series
        .iter()
        .flat_map(|item| item.points.iter().map(|point| point.date.clone()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    dates.sort();
    dates.retain(|date| date_in_backtest_range(date, config));
    if dates.len() < 2 {
        return None;
    }

    let series_maps: Vec<HashMap<String, f64>> =
        series.iter().map(|item| close_map(&item.points)).collect();
    let benchmark_map = close_map(&benchmark_points);
    let positive_weight_total: f64 = series.iter().map(|item| item.row.weight.max(0.0)).sum();

    let mut strategy_net = 1.0;
    let mut benchmark_net = 1.0;
    let mut hedge_net = 1.0;
    let mut high = 1.0;
    let mut max_drawdown: f64 = 0.0;
    let mut wins = 0_usize;
    let mut returns = Vec::new();
    let mut curve = vec![CurvePoint {
        date: dates[0].clone(),
        strategy: 1.0,
        benchmark: 1.0,
        hedge: 1.0,
    }];

    for (index, window) in dates.windows(2).enumerate() {
        let previous_date = &window[0];
        let current_date = &window[1];
        let mut weighted_return = 0.0;
        let mut weight_sum = 0.0;
        let mut equal_return = 0.0;
        let mut equal_count = 0_usize;

        for (item, map) in series.iter().zip(series_maps.iter()) {
            let (Some(previous_close), Some(current_close)) =
                (map.get(previous_date), map.get(current_date))
            else {
                continue;
            };
            if *previous_close <= 0.0 {
                continue;
            }
            let stock_return = (current_close / previous_close - 1.0) * 100.0;
            if positive_weight_total > 0.0 {
                let weight = item.row.weight.max(0.0);
                if weight > 0.0 {
                    weighted_return += stock_return * weight;
                    weight_sum += weight;
                }
            } else {
                equal_return += stock_return;
                equal_count += 1;
            }
        }

        let raw_stock_return = if positive_weight_total > 0.0 && weight_sum > 0.0 {
            weighted_return / weight_sum
        } else if equal_count > 0 {
            equal_return / equal_count as f64
        } else {
            continue;
        };

        let benchmark_return = match (
            benchmark_map.get(previous_date),
            benchmark_map.get(current_date),
        ) {
            (Some(previous_close), Some(current_close)) if *previous_close > 0.0 => {
                (current_close / previous_close - 1.0) * 100.0
            }
            _ => 0.0,
        };
        let hedge_impact = if strategy.hedge.enabled {
            -benchmark_return * (strategy.hedge.ratio / 100.0) - strategy.hedge.cost / 100.0
        } else {
            0.0
        };
        let cost_drag = (config.cost / 1000.0) * if index == 0 { 1.0 } else { 0.35 };
        let period_return = raw_stock_return + hedge_impact - cost_drag * 100.0;

        strategy_net *= 1.0 + period_return / 100.0;
        benchmark_net *= 1.0 + benchmark_return / 100.0;
        hedge_net *= 1.0 + (period_return - hedge_impact) / 100.0;
        high = f64::max(high, strategy_net);
        max_drawdown = f64::min(max_drawdown, strategy_net / high - 1.0);
        if period_return > benchmark_return {
            wins += 1;
        }
        returns.push(period_return / 100.0);
        curve.push(CurvePoint {
            date: current_date.clone(),
            strategy: round_real(strategy_net, 4),
            benchmark: round_real(benchmark_net, 4),
            hedge: round_real(hedge_net, 4),
        });
    }

    if returns.is_empty() || curve.len() < 2 {
        return None;
    }

    let return_count = returns.len() as f64;
    let avg = returns.iter().sum::<f64>() / return_count;
    let volatility = (returns.iter().map(|item| (item - avg).powi(2)).sum::<f64>() / return_count)
        .sqrt()
        * 252.0_f64.sqrt();
    let cumulative_return = strategy_net - 1.0;
    let years = (return_count / 252.0).max(0.1);
    let yearly = real_kline_yearly_returns(&curve);
    let trades = real_kline_trades(&series, &series_maps, &dates);

    Some(BacktestResult {
        rows: base.rows,
        curve,
        metrics: BacktestMetrics {
            cumulative_return: round_real(cumulative_return * 100.0, 2),
            annual_return: round_real(
                ((1.0 + cumulative_return).powf(1.0 / years) - 1.0) * 100.0,
                2,
            ),
            max_drawdown: round_real(max_drawdown * 100.0, 2),
            sharpe: round_real(
                if volatility > 0.0 {
                    (avg * 252.0) / volatility
                } else {
                    0.0
                },
                2,
            ),
            volatility: round_real(volatility * 100.0, 2),
            win_rate: round_real((wins as f64 / return_count) * 100.0, 2),
            turnover: round_real(
                f64::min(
                    220.0,
                    strategy.trading.max_holdings as f64 * 9.0
                        + strategy.trading.backup_count as f64 * 5.0
                        + config.cost * 8.0,
                ),
                2,
            ),
        },
        yearly,
        trades,
    })
}

fn real_kline_yearly_returns(curve: &[CurvePoint]) -> Vec<YearlyReturn> {
    let mut yearly_map: BTreeMap<String, RealBacktestYearAccumulator> = BTreeMap::new();
    for point in curve {
        let year = point.date.chars().take(4).collect::<String>();
        yearly_map
            .entry(year)
            .and_modify(|item| {
                item.end_strategy = point.strategy;
                item.end_benchmark = point.benchmark;
            })
            .or_insert(RealBacktestYearAccumulator {
                start_strategy: point.strategy,
                end_strategy: point.strategy,
                start_benchmark: point.benchmark,
                end_benchmark: point.benchmark,
            });
    }
    yearly_map
        .into_iter()
        .map(|(year, item)| YearlyReturn {
            year,
            strategy: round_real((item.end_strategy / item.start_strategy - 1.0) * 100.0, 2),
            benchmark: round_real((item.end_benchmark / item.start_benchmark - 1.0) * 100.0, 2),
            excess: round_real(
                (item.end_strategy / item.start_strategy
                    - item.end_benchmark / item.start_benchmark)
                    * 100.0,
                2,
            ),
        })
        .collect()
}

fn real_kline_trades(
    series: &[RealBacktestSeries],
    series_maps: &[HashMap<String, f64>],
    dates: &[String],
) -> Vec<BacktestTrade> {
    let first_date = dates.first().cloned().unwrap_or_default();
    let last_date = dates.last().cloned().unwrap_or_else(|| first_date.clone());
    series
        .iter()
        .enumerate()
        .flat_map(|(index, item)| {
            let row = &item.row;
            let map = series_maps.get(index);
            let first_price = map
                .and_then(|values| values.get(&first_date))
                .copied()
                .or_else(|| row.stock.metrics.get("price").copied())
                .unwrap_or(0.0);
            let last_price = map
                .and_then(|values| values.get(&last_date))
                .copied()
                .unwrap_or(first_price);
            [
                BacktestTrade {
                    date: first_date.clone(),
                    action: "\u{4e70}\u{5165}".to_string(),
                    code: row.stock.code.clone(),
                    name: row.stock.name.clone(),
                    weight: row.weight,
                    price: round_real(first_price, 2),
                },
                BacktestTrade {
                    date: last_date.clone(),
                    action: "\u{8c03}\u{4ed3}".to_string(),
                    code: row.stock.code.clone(),
                    name: row.stock.name.clone(),
                    weight: row.weight,
                    price: round_real(last_price, 2),
                },
            ]
        })
        .collect()
}

fn round_real(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

async fn strategy_backtest(
    State(state): State<AppState>,
    Json(request): Json<BacktestRequest>,
) -> Result<Json<BacktestResult>, ApiError> {
    Ok(Json(run_backtest_with_real_kline(&state, &request).await?))
}

fn optimization_candidate_holdings(strategy: &StrategyConfig) -> Vec<usize> {
    let mut values = vec![strategy.trading.max_holdings.max(1), 6, 8, 10, 12, 15];
    values.sort_unstable();
    values.dedup();
    values
}

fn better_optimization_result(
    current: Option<StrategyOptimizationResult>,
    next: StrategyOptimizationResult,
) -> StrategyOptimizationResult {
    match current {
        Some(best)
            if best
                .result
                .metrics
                .sharpe
                .partial_cmp(&next.result.metrics.sharpe)
                .unwrap_or(std::cmp::Ordering::Equal)
                != std::cmp::Ordering::Less =>
        {
            best
        }
        _ => next,
    }
}

async fn optimize_strategy_with_real_kline(
    state: &AppState,
    request: &OptimizeRequest,
) -> Result<StrategyOptimizationResult, ApiError> {
    let mut best: Option<StrategyOptimizationResult> = None;
    let mut errors = Vec::new();
    for max_holdings in optimization_candidate_holdings(&request.strategy) {
        let mut candidate = request.strategy.clone();
        candidate.trading.max_holdings = max_holdings;
        let backtest_request = BacktestRequest {
            strategy: candidate.clone(),
            stocks: request.stocks.clone(),
            pools: request.pools.clone(),
            factors: request.factors.clone(),
            config: request.config.clone(),
        };
        match run_backtest_with_real_kline(state, &backtest_request).await {
            Ok(result) => {
                best = Some(better_optimization_result(
                    best,
                    StrategyOptimizationResult { candidate, result },
                ));
            }
            Err(error) => errors.push(format!("持仓数 {max_holdings}: {}", error.details)),
        }
    }

    best.ok_or_else(|| {
        ApiError::internal(format!(
            "Rust 优化回测历史行情采集失败：{}",
            errors.join("；")
        ))
    })
}

async fn strategy_optimize(
    State(state): State<AppState>,
    Json(request): Json<OptimizeRequest>,
) -> Result<Json<StrategyOptimizationResult>, ApiError> {
    Ok(Json(
        optimize_strategy_with_real_kline(&state, &request).await?,
    ))
}

async fn valuation_rows(
    State(state): State<AppState>,
    Json(request): Json<ValuationRowsRequest>,
) -> Result<Json<Vec<ValuationRow>>, ApiError> {
    let stocks = enrich_valuation_stocks_with_real_data(&state, request.stocks).await?;
    Ok(Json(build_valuation_rows(&stocks, &request.filters)))
}

async fn enrich_valuation_stocks_with_real_data(
    state: &AppState,
    stocks: Vec<Stock>,
) -> Result<Vec<Stock>, ApiError> {
    if stocks.is_empty()
        || stocks
            .iter()
            .all(|stock| missing_real_valuation_fields(stock).is_empty())
    {
        return Ok(stocks);
    }

    let symbols = valuation_quote_symbols(&stocks);
    let quote_rows = if symbols.is_empty() {
        Vec::new()
    } else {
        state.tencent.quote_rows(&symbols).await?
    };
    let mut enriched = merge_valuation_quote_rows(stocks, &quote_rows);

    if enriched
        .iter()
        .all(|stock| missing_real_valuation_fields(stock).is_empty())
    {
        return Ok(enriched);
    }

    for report_date in valuation_report_date_candidates(&enriched) {
        let rows = state
            .eastmoney
            .fetch_financial_metrics(Some(&report_date))
            .await?;
        enriched = merge_valuation_financial_metric_rows(enriched, &rows);
        if enriched
            .iter()
            .all(|stock| missing_real_valuation_fields(stock).is_empty())
        {
            break;
        }
    }

    Ok(enriched)
}

fn valuation_quote_symbols(stocks: &[Stock]) -> Vec<String> {
    let mut seen = HashSet::new();
    stocks
        .iter()
        .filter_map(|stock| {
            let code = six_digit_stock_code(&stock.code);
            if code.is_empty() {
                return None;
            }
            let symbol = tencent_symbol_for_code(&code);
            seen.insert(symbol.clone()).then_some(symbol)
        })
        .collect()
}

fn merge_valuation_quote_rows(stocks: Vec<Stock>, quote_rows: &[TencentQuoteRow]) -> Vec<Stock> {
    let quote_by_code = quote_rows
        .iter()
        .map(|row| (six_digit_stock_code(&row.code), row))
        .collect::<HashMap<_, _>>();
    stocks
        .into_iter()
        .map(|mut stock| {
            let Some(row) = quote_by_code
                .get(&six_digit_stock_code(&stock.code))
                .copied()
            else {
                return stock;
            };
            insert_metric_if_finite(&mut stock.metrics, "price", row.price, 2);
            insert_metric_if_finite(&mut stock.metrics, "pctChange", row.pct_change, 2);
            insert_metric_if_finite(&mut stock.metrics, "amount", row.amount_yi, 2);
            insert_metric_if_finite(&mut stock.metrics, "turnover", row.turnover, 2);
            insert_metric_if_finite(&mut stock.metrics, "pe", row.pe, 2);
            insert_metric_if_finite(&mut stock.metrics, "pb", row.pb, 2);
            insert_metric_if_finite(&mut stock.metrics, "marketCap", row.market_cap_yi, 2);
            insert_metric_if_finite(
                &mut stock.metrics,
                "floatMarketCap",
                row.float_market_cap_yi,
                2,
            );
            if row
                .price
                .is_some_and(|value| value.is_finite() && value > 0.0)
                && row
                    .market_cap_yi
                    .is_some_and(|value| value.is_finite() && value > 0.0)
            {
                stock.metrics.insert("realQuoteSource".to_string(), 1.0);
            }
            if stock.name.trim().is_empty() || stock.name == stock.code {
                stock.name = row.name.clone();
            }
            stock
        })
        .collect()
}

fn merge_valuation_financial_metric_rows(
    stocks: Vec<Stock>,
    rows: &[FinancialMetricRow],
) -> Vec<Stock> {
    let row_by_code = rows
        .iter()
        .map(|row| (six_digit_stock_code(&row.code), row))
        .collect::<HashMap<_, _>>();
    stocks
        .into_iter()
        .map(|mut stock| {
            let Some(row) = row_by_code.get(&six_digit_stock_code(&stock.code)).copied() else {
                return stock;
            };
            if stock.name.trim().is_empty() || stock.name == stock.code {
                stock.name = row.name.clone();
            }
            for (key, value) in &row.metrics {
                if value.is_finite() {
                    stock.metrics.insert(key.clone(), *value);
                }
            }
            stock
        })
        .collect()
}

fn valuation_report_date_candidates(stocks: &[Stock]) -> Vec<String> {
    let mut candidates = Vec::new();
    for stock in stocks {
        for date in annual_report_date_candidates(stock) {
            if !candidates.contains(&date) {
                candidates.push(date);
            }
        }
    }
    candidates
}

fn insert_metric_if_finite(
    metrics: &mut HashMap<String, f64>,
    key: &str,
    value: Option<f64>,
    precision: i32,
) {
    if let Some(value) = value.filter(|value| value.is_finite()) {
        metrics.insert(key.to_string(), round_metric(value, precision));
    }
}

async fn annual_reports(
    State(state): State<AppState>,
    Json(request): Json<AnnualReportsRequest>,
) -> Result<Json<Vec<AnnualFinancialReport>>, ApiError> {
    Ok(Json(
        build_annual_financial_reports_with_real_fetch(&state, request.stock).await?,
    ))
}

async fn filing_announcements(
    State(state): State<AppState>,
    Json(request): Json<FilingAnnouncementsRequest>,
) -> Result<Json<FilingAnnouncementsResponse>, ApiError> {
    let codes = filing_request_codes(&request);
    let announcements = state
        .eastmoney
        .fetch_announcement_rows(&codes, request.max_items.unwrap_or(50))
        .await?;
    let stats = FilingAnnouncementsStats {
        scanned_stocks: request.stocks.len(),
        request_codes: codes.len(),
        returned_rows: announcements.len(),
    };
    Ok(Json(FilingAnnouncementsResponse {
        engine: "rust",
        announcements,
        stats,
    }))
}

fn filing_request_codes(request: &FilingAnnouncementsRequest) -> Vec<String> {
    let mut codes = request
        .codes
        .iter()
        .chain(request.stocks.iter().map(|stock| &stock.code))
        .map(|code| six_digit_stock_code(code))
        .filter(|code| !code.is_empty())
        .collect::<Vec<_>>();
    codes.sort();
    codes.dedup();
    codes
}

async fn build_annual_financial_reports_with_real_fetch(
    state: &AppState,
    stock: Stock,
) -> Result<Vec<AnnualFinancialReport>, ApiError> {
    let existing_reports = build_annual_financial_reports(&stock);
    if !existing_reports.is_empty() {
        return Ok(existing_reports);
    }

    let code_key = six_digit_stock_code(&stock.code);
    if code_key.is_empty() {
        return Err(ApiError::bad_request("annual report stock code is empty"));
    }

    let mut errors = Vec::new();
    for report_date in annual_report_date_candidates(&stock) {
        match state
            .eastmoney
            .fetch_financial_metrics(Some(&report_date))
            .await
        {
            Ok(rows) => {
                if rows.is_empty() {
                    errors.push(format!("{report_date}: financial metrics returned no rows"));
                    continue;
                }
                if let Some(row) = rows
                    .iter()
                    .find(|row| six_digit_stock_code(&row.code) == code_key)
                {
                    let reports = build_annual_reports_from_financial_metric_row(&stock, row);
                    if reports.is_empty() {
                        errors.push(format!(
                            "{report_date}: matched {} but row did not contain annual report fields",
                            stock.code
                        ));
                        continue;
                    }
                    return Ok(reports);
                }
                errors.push(format!(
                    "{report_date}: financial metrics returned {} rows but no match for {}",
                    rows.len(),
                    stock.code
                ));
            }
            Err(error) => errors.push(format!("{report_date}: {error}")),
        }
    }

    Err(ApiError::internal(format!(
        "Rust annual report API could not fetch real annual report for {} {}. {}",
        stock.code,
        stock.name,
        errors.join("; ")
    )))
}

fn build_annual_reports_from_financial_metric_row(
    stock: &Stock,
    row: &FinancialMetricRow,
) -> Vec<AnnualFinancialReport> {
    let mut merged = stock.clone();
    if merged.name.trim().is_empty() || merged.name == merged.code {
        merged.name = row.name.clone();
    }
    for (key, value) in &row.metrics {
        if value.is_finite() {
            merged.metrics.insert(key.clone(), *value);
        }
    }
    build_annual_financial_reports(&merged)
}

fn six_digit_stock_code(value: &str) -> String {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() >= 6 {
        digits[digits.len() - 6..].to_string()
    } else {
        digits
    }
}

fn annual_report_date_candidates(stock: &Stock) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(value) = stock_metric_date_number(stock, "realAnnualReportDate") {
        push_annual_report_date_candidate(&mut candidates, value);
    }
    if let Some(value) = stock_metric_date_number(stock, "realFinancialReportDate") {
        let year = value / 10000;
        if value % 10000 == 1231 {
            push_annual_report_date_candidate(&mut candidates, value);
        } else if year > 1900 {
            push_annual_report_date_candidate(&mut candidates, (year - 1) * 10000 + 1231);
        }
    }
    for year in [2025_i64, 2024, 2023, 2022] {
        push_annual_report_date_candidate(&mut candidates, year * 10000 + 1231);
    }
    candidates
}

fn stock_metric_date_number(stock: &Stock, key: &str) -> Option<i64> {
    let value = stock.metrics.get(key).copied()?;
    if !value.is_finite() {
        return None;
    }
    let rounded = value.trunc() as i64;
    if (19000101..=29991231).contains(&rounded) {
        Some(rounded)
    } else {
        None
    }
}

fn push_annual_report_date_candidate(candidates: &mut Vec<String>, value: i64) {
    if value % 10000 != 1231 {
        return;
    }
    let text = format!("{value:08}");
    let formatted = format!("{}-{}-{}", &text[0..4], &text[4..6], &text[6..8]);
    if !candidates.contains(&formatted) {
        candidates.push(formatted);
    }
}

async fn trade_plan(Json(request): Json<TradePlanRequest>) -> Json<TradePlanResponse> {
    let mut plan = create_trade_plan(
        &request.strategy,
        &request.rows,
        &request.mode,
        &request.account_id,
        request.account_asset,
    );
    if let Some(minimum_amount) = request.minimum_amount {
        plan.orders
            .retain(|order| order.amount >= minimum_amount.max(0.0));
    }
    let client_text = trade_plan_to_client_text(&plan);
    let csv = trade_plan_to_csv(&plan);
    Json(TradePlanResponse {
        plan,
        client_text,
        csv,
    })
}

async fn trade_export(Json(request): Json<TradeExportRequest>) -> Json<TradeExportResponse> {
    Json(TradeExportResponse {
        client_text: trade_plan_to_client_text(&request.plan),
        csv: trade_plan_to_csv(&request.plan),
    })
}

async fn trade_paper_submit(Json(request): Json<PaperTradeSubmitRequest>) -> Json<PaperTradeState> {
    Json(submit_paper_trade_plan(&request.state, &request.plan))
}

async fn trade_assets_sync(
    Json(request): Json<TradeAssetSyncRequest>,
) -> Json<TradeAssetSyncResult> {
    Json(sync_trade_assets(&request.asset))
}

fn build_sentiment_events(articles: &[NewsArticle], stocks: &[Stock]) -> Vec<SentimentEvent> {
    let mut events = articles
        .iter()
        .enumerate()
        .filter(|(_, article)| !article.title.trim().is_empty())
        .map(|(index, article)| {
            let signals = score_article_signals(article);
            let text = article_text(article);
            let has_severe_risk = text_has_any(&text, SEVERE_NEGATIVE_WORDS);
            let event_id = if article.id.trim().is_empty() {
                index.to_string()
            } else {
                article.id.clone()
            };
            SentimentEvent {
                id: format!("real-news-{event_id}"),
                title: article.title.clone(),
                summary: if article.summary.trim().is_empty() {
                    article.title.clone()
                } else {
                    article.summary.clone()
                },
                category: if has_severe_risk {
                    "风险负面".to_string()
                } else {
                    news_category_to_sentiment_category(&article.category)
                },
                direction: news_sentiment_to_direction(&article.sentiment),
                horizon: infer_event_horizon(article),
                severity: if has_severe_risk {
                    "重大".to_string()
                } else {
                    news_importance_to_severity(&article.importance)
                },
                occurred_at: article.published_at.clone(),
                source: article.source.clone(),
                source_weight: signals.source_weight,
                impact: signals.impact,
                relevance: signals.relevance,
                confidence: signals.confidence,
                novelty: signals.novelty,
                persistence: signals.persistence,
                risk_penalty: signals.risk_penalty,
                industries: resolve_article_industries(article, stocks),
                keywords: unique_article_keywords(article),
                linked_codes: unique_texts(article.linked_codes.clone()),
            }
        })
        .filter(|event| !event.linked_codes.is_empty() || !event.industries.is_empty())
        .collect::<Vec<_>>();

    events.sort_by(|a, b| {
        score_sentiment_event(b)
            .partial_cmp(&score_sentiment_event(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    events
}

fn build_sentiment_linked_stocks(
    events: &[SentimentEvent],
    stocks: &[Stock],
) -> Vec<SentimentLinkedStock> {
    let mut by_code: HashMap<String, Vec<EventStockMatch>> = HashMap::new();
    for event in events {
        for stock in stocks {
            let stock_match = calculate_event_stock_match(event, stock);
            if should_keep_stock_match(&stock_match) {
                by_code
                    .entry(stock.code.clone())
                    .or_default()
                    .push(stock_match);
            }
        }
    }

    let mut linked_stocks = by_code
        .into_iter()
        .filter_map(|(code, matches)| {
            let stock = stocks.iter().find(|item| item.code == code)?;
            let linked_events = matches
                .iter()
                .map(|stock_match| stock_match.event.clone())
                .collect::<Vec<_>>();
            let relation_score = round_to(
                matches
                    .iter()
                    .map(|stock_match| stock_match.match_score)
                    .sum::<f64>()
                    / matches.len().max(1) as f64,
                1,
            );
            let top_match = matches.iter().max_by(|a, b| {
                sentiment_match_rank(a)
                    .partial_cmp(&sentiment_match_rank(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })?;
            let top_event = &top_match.event;
            let mut evidence = unique_texts(
                matches
                    .iter()
                    .flat_map(|stock_match| stock_match.evidence.clone())
                    .collect(),
            );
            evidence.truncate(5);
            let mut tags = unique_texts(
                linked_events
                    .iter()
                    .flat_map(|event| {
                        std::iter::once(event.category.clone())
                            .chain(event.keywords.iter().take(2).cloned())
                    })
                    .collect(),
            );
            tags.truncate(4);

            Some(SentimentLinkedStock {
                stock: stock.clone(),
                events: linked_events.clone(),
                direction: merge_sentiment_direction(&linked_events),
                relation_score,
                relation_level: relation_match_level(
                    relation_score,
                    matches.iter().any(|stock_match| stock_match.direct),
                ),
                reason: format!("{}：{}", top_event.category, top_event.summary),
                evidence,
                tags,
            })
        })
        .collect::<Vec<_>>();

    linked_stocks.sort_by(|a, b| {
        let relation_order = b
            .relation_score
            .partial_cmp(&a.relation_score)
            .unwrap_or(std::cmp::Ordering::Equal);
        if relation_order != std::cmp::Ordering::Equal {
            return relation_order;
        }
        let b_event_score = b.events.first().map(score_sentiment_event).unwrap_or(0.0);
        let a_event_score = a.events.first().map(score_sentiment_event).unwrap_or(0.0);
        b_event_score
            .partial_cmp(&a_event_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    linked_stocks
}

fn build_sentiment_insight_report(
    events: &[SentimentEvent],
    linked_stocks: &[SentimentLinkedStock],
) -> SentimentInsightReport {
    let top_categories = top_sentiment_counts(
        events.iter().map(|event| event.category.clone()).collect(),
        3,
    )
    .into_iter()
    .map(|(category, count)| SentimentCount { category, count })
    .collect::<Vec<_>>();
    let top_industries = top_sentiment_counts(
        events
            .iter()
            .flat_map(|event| event.industries.clone())
            .collect(),
        5,
    )
    .into_iter()
    .map(|(industry, count)| SentimentIndustryCount { industry, count })
    .collect::<Vec<_>>();
    let top_linked_stocks = linked_stocks.iter().take(5).cloned().collect::<Vec<_>>();
    let risk_events = events
        .iter()
        .filter(|event| event.direction == "利空" || event.category == "风险负面")
        .cloned()
        .collect::<Vec<_>>();
    let conclusion = if let Some(strongest) = top_linked_stocks.first() {
        format!(
            "当前高价值事件集中在{}，{}与{}事件存在{}关联。",
            top_industries
                .first()
                .map(|item| item.industry.as_str())
                .unwrap_or("核心行业"),
            strongest.stock.name,
            strongest
                .events
                .first()
                .map(|event| event.category.as_str())
                .unwrap_or("舆情"),
            strongest.relation_level
        )
    } else {
        "当前筛选条件下没有形成明确的股票关联关系。".to_string()
    };

    SentimentInsightReport {
        title: "舆情关联股票洞察".to_string(),
        conclusion,
        event_count: events.len(),
        top_categories,
        top_industries,
        linked_stocks: top_linked_stocks,
        risk_events,
        validation_points: vec![
            "核对事件是否来自公告、政策原文或多家权威媒体交叉确认。".to_string(),
            "观察事件后 1-3 个交易日成交额、换手率和相对强弱是否同步放大。".to_string(),
            "当前列表只表达新闻与股票的关联关系，不构成买入、卖出或持仓建议。".to_string(),
            "对利空事件单独核查公告原文，避免把短期风险误判为机会。".to_string(),
        ],
    }
}

#[derive(Debug, Default)]
struct NewsAnalysisModelInsight {
    conclusion: Option<String>,
    validation_points: Vec<String>,
}

async fn enrich_sentiment_report_with_analysis_model(
    http: &reqwest::Client,
    mut report: SentimentInsightReport,
    analysis_model: Option<&NewsAnalysisModelTestRequest>,
    events: &[SentimentEvent],
    linked_stocks: &[SentimentLinkedStock],
) -> SentimentInsightReport {
    let Some(model) = analysis_model else {
        return report;
    };
    if !model.enabled {
        report.validation_points.push(
            "News analysis model disabled; Rust rule engine generated the report.".to_string(),
        );
        return report;
    }
    if is_local_news_analysis_model(model) {
        let task_count = unique_non_empty_count(&model.tasks);
        report.validation_points.push(format!(
            "Rust local news rule model {} participated in sentiment analysis with {task_count} enabled tasks.",
            model.model.trim()
        ));
        return report;
    }

    match request_remote_news_analysis_model(http, model, events, linked_stocks).await {
        Ok(insight) => {
            if let Some(conclusion) = insight.conclusion {
                report.conclusion = conclusion;
            }
            report.validation_points.push(format!(
                "Remote news analysis model {} / {} participated through the Rust proxy.",
                model.provider.trim(),
                model.model.trim()
            ));
            report.validation_points.extend(insight.validation_points);
        }
        Err(error) => {
            report.validation_points.push(format!(
                "Remote news analysis model was not applied: {error}. Rust rule engine result is shown."
            ));
        }
    }

    report
}

fn unique_non_empty_count(items: &[String]) -> usize {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>()
        .len()
}

fn is_local_news_analysis_model(model: &NewsAnalysisModelTestRequest) -> bool {
    model.base_url.trim().starts_with("local://")
        || model.model.trim().starts_with("local-news-rule")
}

async fn request_remote_news_analysis_model(
    http: &reqwest::Client,
    model: &NewsAnalysisModelTestRequest,
    events: &[SentimentEvent],
    linked_stocks: &[SentimentLinkedStock],
) -> Result<NewsAnalysisModelInsight, String> {
    let provider = model.provider.trim();
    let model_name = model.model.trim();
    let base_url = model.base_url.trim();
    if provider.is_empty() {
        return Err("analysis model provider is empty".to_string());
    }
    if model_name.is_empty() {
        return Err("analysis model name is empty".to_string());
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("analysis model baseUrl must start with http:// or https://".to_string());
    }
    if model.api_key.trim().is_empty() {
        return Err("remote analysis model API key is empty".to_string());
    }
    if model.system_prompt.trim().is_empty() {
        return Err("analysis model system prompt is empty".to_string());
    }

    let response = http
        .post(chat_completions_url(base_url))
        .timeout(Duration::from_secs(model.timeout_seconds.clamp(3, 120)))
        .bearer_auth(model.api_key.trim())
        .json(&json!({
            "model": model_name,
            "temperature": model.temperature.clamp(0.0, 1.0),
            "max_tokens": model.max_tokens.clamp(128, 2048),
            "messages": [
                { "role": "system", "content": model.system_prompt.trim() },
                { "role": "user", "content": sentiment_model_prompt(events, linked_stocks) }
            ]
        }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "request timeout".to_string()
            } else {
                format!("Rust model proxy request failed: {error}")
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let preview = response
            .text()
            .await
            .map(|body| preview_text(&body, 240))
            .unwrap_or_default();
        return Err(if preview.is_empty() {
            format!("model API returned HTTP {}", status.as_u16())
        } else {
            format!("model API returned HTTP {}: {preview}", status.as_u16())
        });
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("model API returned non-JSON payload: {error}"))?;
    let content = chat_completion_content(&payload)
        .ok_or_else(|| "model API returned no assistant message content".to_string())?;
    Ok(news_analysis_model_insight_from_content(&content))
}

fn sentiment_model_prompt(
    events: &[SentimentEvent],
    linked_stocks: &[SentimentLinkedStock],
) -> String {
    let event_lines = events
        .iter()
        .take(8)
        .map(|event| {
            format!(
                "- {} | {} | {} | {} | industries={} | stocks={} | summary={}",
                event.title,
                event.category,
                event.direction,
                event.severity,
                event.industries.join("/"),
                event.linked_codes.join("/"),
                preview_text(&event.summary, 160)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let stock_lines = linked_stocks
        .iter()
        .take(8)
        .map(|row| {
            format!(
                "- {} {} | relation={} | direction={} | reason={}",
                row.stock.code,
                row.stock.name,
                row.relation_level,
                row.direction,
                preview_text(&row.reason, 160)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Analyze these A-share news sentiment events and linked stocks. Return JSON only with fields conclusion:string and validationPoints:string[]. Do not invent source facts.\nEvents:\n{event_lines}\nLinked stocks:\n{stock_lines}"
    )
}

fn chat_completion_content(payload: &Value) -> Option<String> {
    payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(ToString::to_string)
}

fn news_analysis_model_insight_from_content(content: &str) -> NewsAnalysisModelInsight {
    let cleaned = strip_json_code_fence(content);
    if let Ok(payload) = serde_json::from_str::<Value>(&cleaned) {
        let conclusion = string_at(&payload, "conclusion")
            .or_else(|| string_at(&payload, "summary"))
            .or_else(|| string_at(&payload, "insight"));
        let validation_points = payload
            .get("validationPoints")
            .or_else(|| payload.get("validation_points"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(ToString::to_string)
                    .take(5)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return NewsAnalysisModelInsight {
            conclusion,
            validation_points,
        };
    }

    NewsAnalysisModelInsight {
        conclusion: Some(preview_text(content, 320)),
        validation_points: Vec::new(),
    }
}

fn strip_json_code_fence(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let without_opening = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
    without_opening
        .trim()
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn sentiment_match_rank(stock_match: &EventStockMatch) -> f64 {
    stock_match.match_score + score_sentiment_event(&stock_match.event) / 10.0
}

fn event_search_text(event: &SentimentEvent) -> String {
    format!(
        "{} {} {} {}",
        event.title,
        event.summary,
        event.industries.join(" "),
        event.keywords.join(" ")
    )
    .to_lowercase()
}

fn matched_terms(text: &str, terms: &[String]) -> Vec<String> {
    unique_texts(terms.to_vec())
        .into_iter()
        .filter(|term| text.contains(&term.to_lowercase()))
        .collect()
}

fn stock_match_keywords(stock: &Stock) -> (Vec<String>, Vec<String>) {
    let mut precise = vec![
        stock.name.clone(),
        stock.code.clone(),
        stock.industry2.clone(),
    ];
    precise.extend(
        industry2_keyword_profile(&stock.industry2)
            .iter()
            .map(|item| item.to_string()),
    );

    let mut broad = industry_keyword_profile(&stock.industry1)
        .iter()
        .map(|item| item.to_string())
        .collect::<Vec<_>>();
    broad.push(stock.industry1.clone());
    broad.push(stock.industry2.clone());

    (
        unique_texts(precise),
        unique_texts(broad)
            .into_iter()
            .filter(|item| is_specific_sentiment_industry(item))
            .collect(),
    )
}

fn calculate_event_stock_match(event: &SentimentEvent, stock: &Stock) -> EventStockMatch {
    let text = event_search_text(event);
    let mut evidence = Vec::new();
    let mut match_score = 0.0;
    let model_linked = event.linked_codes.iter().any(|code| code == &stock.code);
    let strict_source_linked =
        event.source.contains("腾讯证券公告") && !event.linked_codes.is_empty();
    let text_direct = !strict_source_linked
        && (text.contains(&stock.name.to_lowercase()) || text.contains(&stock.code.to_lowercase()));

    if model_linked {
        match_score += if strict_source_linked { 56.0 } else { 48.0 };
        evidence.push("真实新闻源代码直接关联".to_string());
    } else if text_direct {
        match_score += 50.0;
        evidence.push("正文直接出现公司或代码".to_string());
    }

    if is_specific_sentiment_industry(&stock.industry1)
        && event
            .industries
            .iter()
            .any(|industry| industry == &stock.industry1)
    {
        match_score += 16.0;
        evidence.push(format!("一级行业匹配：{}", stock.industry1));
    }

    if is_specific_sentiment_industry(&stock.industry2)
        && text.contains(&stock.industry2.to_lowercase())
    {
        match_score += 18.0;
        evidence.push(format!("二级行业命中：{}", stock.industry2));
    }

    let (precise, broad) = stock_match_keywords(stock);
    let precise_hits = matched_terms(&text, &precise);
    if !precise_hits.is_empty() {
        match_score += (precise_hits.len() as f64 * 9.0).min(28.0);
        evidence.push(format!(
            "业务关键词：{}",
            precise_hits
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }

    let broad_terms = broad
        .into_iter()
        .filter(|term| !precise_hits.contains(term))
        .collect::<Vec<_>>();
    let broad_hits = matched_terms(&text, &broad_terms);
    if !broad_hits.is_empty() {
        match_score += (broad_hits.len() as f64 * 4.0).min(12.0);
        evidence.push(format!(
            "行业关键词：{}",
            broad_hits
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }

    if (event.direction == "利空" || event.category == "风险负面") && !text_direct && !model_linked
    {
        match_score -= 22.0;
        evidence.push("负面事件仅保留直接关联标的".to_string());
    }

    if stock.is_st || stock.is_suspended {
        match_score -= 16.0;
        evidence.push(if stock.is_st {
            "ST 风险降权".to_string()
        } else {
            "停牌风险降权".to_string()
        });
    }

    EventStockMatch {
        event: event.clone(),
        match_score: round_to(match_score.clamp(0.0, 100.0), 1),
        evidence: {
            let mut unique = unique_texts(evidence);
            unique.truncate(5);
            unique
        },
        direct: text_direct || model_linked,
    }
}

fn should_keep_stock_match(stock_match: &EventStockMatch) -> bool {
    if stock_match.event.direction == "利空" || stock_match.event.category == "风险负面" {
        return stock_match.direct && stock_match.match_score >= 38.0;
    }
    if stock_match.direct && stock_match.match_score >= 45.0 {
        return true;
    }
    stock_match.match_score >= 42.0 && stock_match.evidence.len() >= 2
}

fn relation_match_level(match_score: f64, direct: bool) -> String {
    if direct && match_score >= 60.0 {
        "直接命中"
    } else if match_score >= 62.0 {
        "强相关"
    } else if match_score >= 48.0 {
        "中相关"
    } else {
        "弱相关"
    }
    .to_string()
}

fn merge_sentiment_direction(events: &[SentimentEvent]) -> String {
    let positive = events
        .iter()
        .filter(|event| event.direction == "利好")
        .count();
    let negative = events
        .iter()
        .filter(|event| event.direction == "利空")
        .count();
    if positive > negative {
        "利好".to_string()
    } else if negative > positive {
        "利空".to_string()
    } else {
        events
            .first()
            .map(|event| event.direction.clone())
            .unwrap_or_else(|| "不确定".to_string())
    }
}

fn top_sentiment_counts(items: Vec<String>, limit: usize) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, (usize, usize)> = HashMap::new();
    for (index, item) in items.into_iter().enumerate() {
        let entry = counts.entry(item).or_insert((0, index));
        entry.0 += 1;
    }
    let mut rows = counts
        .into_iter()
        .map(|(item, (count, first_index))| (item, count, first_index))
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
    rows.truncate(limit);
    rows.into_iter()
        .map(|(item, count, _)| (item, count))
        .collect()
}

fn industry_keyword_profile(industry: &str) -> &'static [&'static str] {
    match industry {
        "汽车" => &["新能源汽车", "汽车", "整车", "乘用车", "充电", "县域消费"],
        "电力设备" => &["电池", "储能", "光伏", "特高压", "电网", "充电"],
        "电子" => &["半导体", "芯片", "先进封装", "国产替代", "算力", "设备"],
        "食品饮料" => &["白酒", "批价", "渠道", "库存", "消费"],
        "银行" => &["银行", "低估值", "回购", "增持", "分红"],
        "家用电器" => &["家电", "白色家电", "回购", "增持", "消费"],
        "非银金融" => &["保险", "证券", "低估值", "回购", "增持"],
        "公用事业" => &["电网", "电力", "绿电", "水电", "特高压", "储能"],
        "计算机" => &["软件", "人工智能", "AI", "算力", "信创", "数据"],
        "医药生物" => &["创新药", "医疗", "生物", "临床", "获批", "出海"],
        _ => &[],
    }
}

fn industry2_keyword_profile(industry: &str) -> &'static [&'static str] {
    match industry {
        "乘用车" => &["新能源汽车", "整车", "乘用车", "汽车", "县域消费"],
        "电池" => &["动力电池", "电池", "储能", "新能源汽车"],
        "光伏设备" => &["光伏", "硅片", "组件", "绿电"],
        "半导体" => &["半导体", "芯片", "先进封装", "国产替代", "设备"],
        "白酒" => &["白酒", "批价", "渠道库存", "动销"],
        "股份行" => &["银行", "低估值", "分红", "回购", "增持"],
        "白色家电" => &["家电", "白色家电", "回购", "增持"],
        "保险" => &["保险", "低估值", "回购", "增持"],
        "水电" => &["水电", "电力", "公用事业", "绿电"],
        "软件开发" => &["软件", "信创", "人工智能", "数据"],
        "通信设备" => &["通信", "算力", "设备", "国产替代"],
        "生物制品" => &["生物", "疫苗", "创新药", "临床"],
        "化学制药" => &["创新药", "药品", "临床", "出海"],
        _ => &[],
    }
}

const SEVERE_POSITIVE_WORDS: &[&str] = &[
    "重大",
    "中标",
    "回购",
    "增持",
    "获批",
    "签约",
    "高增长",
    "分红",
    "突破",
    "创新高",
];

const SEVERE_NEGATIVE_WORDS: &[&str] = &[
    "退市",
    "处罚",
    "调查",
    "减持",
    "亏损",
    "违约",
    "终止",
    "立案",
    "风险警示",
    "下修",
];

fn article_text(article: &NewsArticle) -> String {
    format!(
        "{} {} {} {} {}",
        article.title,
        article.summary,
        article.content,
        article.tags.join(" "),
        article.industries.join(" ")
    )
}

fn news_category_to_sentiment_category(category: &str) -> String {
    match category {
        "宏观政策" => "政策监管",
        "行业动态" => "产业链事件",
        "公司公告" => "资金市场",
        "财报业绩" => "财报业绩",
        "市场评论" => "资金市场",
        "国际财经" => "资金市场",
        "产业链" => "产业链事件",
        "基金持仓" => "资金市场",
        _ => "资金市场",
    }
    .to_string()
}

fn news_sentiment_to_direction(sentiment: &str) -> String {
    match sentiment {
        "利好" => "利好",
        "利空" => "利空",
        "中性" => "中性",
        _ => "不确定",
    }
    .to_string()
}

fn news_importance_to_severity(importance: &str) -> String {
    match importance {
        "头条" => "特别重大",
        "重要" => "重大",
        _ => "一般",
    }
    .to_string()
}

fn infer_event_horizon(article: &NewsArticle) -> String {
    match article.category.as_str() {
        "公司公告" | "市场评论" | "国际财经" => "短期",
        "宏观政策" | "产业链" | "财报业绩" | "基金持仓" => "中期",
        _ => "中期",
    }
    .to_string()
}

fn unique_article_keywords(article: &NewsArticle) -> Vec<String> {
    let mut raw = vec![article.category.clone(), article.sentiment.clone()];
    raw.extend(article.tags.clone());
    raw.extend(article.industries.clone());
    raw.extend(article.linked_stocks.iter().map(|stock| stock.name.clone()));
    let mut keywords = unique_texts(raw);
    keywords.truncate(8);
    keywords
}

fn resolve_article_industries(article: &NewsArticle, stocks: &[Stock]) -> Vec<String> {
    let linked_codes: HashSet<&str> = article.linked_codes.iter().map(String::as_str).collect();
    let stock_industries = stocks
        .iter()
        .filter(|stock| linked_codes.contains(stock.code.as_str()))
        .flat_map(|stock| [stock.industry1.clone(), stock.industry2.clone()]);
    let mut industries = unique_texts(
        article
            .industries
            .clone()
            .into_iter()
            .chain(stock_industries)
            .collect(),
    )
    .into_iter()
    .filter(|industry| is_specific_sentiment_industry(industry))
    .collect::<Vec<_>>();
    industries.truncate(6);
    industries
}

fn is_specific_sentiment_industry(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed != "未分类"
        && trimmed != "腾讯行情"
        && trimmed != "其他"
        && trimmed != "--"
}

fn score_article_signals(article: &NewsArticle) -> ArticleSignals {
    let text = article_text(article);
    let positive_hit = text_has_any(&text, SEVERE_POSITIVE_WORDS);
    let negative_hit = text_has_any(&text, SEVERE_NEGATIVE_WORDS);
    let linked_bonus = article.linked_codes.len().min(5) as f64 * 4.0;
    let source_weight = if article.source.contains("公告") || article.source.contains("腾讯") {
        88.0
    } else if article.source.contains("GDELT") {
        70.0
    } else {
        76.0
    };
    let base_importance = match article.importance.as_str() {
        "头条" => 88.0,
        "重要" => 76.0,
        _ => 62.0,
    };
    let impact = clamp_score(
        base_importance
            + linked_bonus
            + if positive_hit || negative_hit {
                6.0
            } else {
                0.0
            },
    );
    let relevance = clamp_score(
        52.0 + linked_bonus * 2.0
            + if article.industries.is_empty() {
                0.0
            } else {
                12.0
            }
            + if article.linked_stocks.is_empty() {
                0.0
            } else {
                16.0
            },
    );
    let confidence = clamp_score(
        source_weight
            - if article.linked_codes.is_empty() {
                12.0
            } else {
                0.0
            },
    );
    let novelty = clamp_score(if article.importance == "头条" {
        72.0
    } else {
        58.0
    });
    let persistence = clamp_score(
        if article.category == "宏观政策" || article.category == "产业链" {
            76.0
        } else {
            58.0
        },
    );
    let risk_penalty = if article.sentiment == "利空" {
        8.0
    } else if negative_hit {
        12.0
    } else {
        4.0
    };

    ArticleSignals {
        source_weight,
        impact,
        relevance,
        confidence,
        novelty,
        persistence,
        risk_penalty,
    }
}

fn score_sentiment_event(event: &SentimentEvent) -> f64 {
    let raw = event.impact * 0.24
        + event.relevance * 0.2
        + event.confidence * 0.18
        + event.novelty * 0.12
        + event.persistence * 0.14
        + event.source_weight * 0.12
        - event.risk_penalty;
    round_to(raw.clamp(0.0, 100.0), 2)
}

fn clamp_score(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

fn round_to(value: f64, precision: u32) -> f64 {
    let scale = 10_f64.powi(precision as i32);
    (value * scale).round() / scale
}

fn build_news_analysis_local_test_response(tasks: &[String]) -> NewsAnalysisLocalTestResponse {
    let task_count = tasks
        .iter()
        .filter(|task| !task.trim().is_empty())
        .collect::<HashSet<_>>()
        .len();
    NewsAnalysisLocalTestResponse {
        engine: "rust",
        ok: task_count > 0,
        task_count,
        message: if task_count > 0 {
            format!("Rust 本地新闻规则模型已启用 {task_count} 个分析任务")
        } else {
            "Rust 本地新闻规则模型未启用分析任务".to_string()
        },
    }
}

fn failed_news_analysis_model_test_response(
    provider: String,
    model: String,
    message: impl Into<String>,
    details: impl Into<String>,
) -> NewsAnalysisModelTestResponse {
    NewsAnalysisModelTestResponse {
        engine: "rust",
        ok: false,
        provider,
        model,
        message: message.into(),
        details: details.into(),
    }
}

fn chat_completions_url(base_url: &str) -> String {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.ends_with("/chat/completions") {
        normalized.to_string()
    } else {
        format!("{normalized}/chat/completions")
    }
}

fn preview_text(value: &str, limit: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(limit).collect()
}

fn failed_integration_source_test(
    provider: String,
    details: impl Into<String>,
) -> IntegrationSourceTestResponse {
    IntegrationSourceTestResponse {
        engine: "rust",
        provider,
        ok: false,
        row_count: 0,
        message: "连接检测失败".to_string(),
        details: details.into(),
    }
}

const INFO_SOURCE_MODULE_ORDER: [&str; 4] = ["market", "finance", "filing", "news"];

fn enabled_source_module_keys(modules: &HashMap<String, bool>) -> Vec<&'static str> {
    INFO_SOURCE_MODULE_ORDER
        .iter()
        .copied()
        .filter(|key| modules.get(*key).copied().unwrap_or(false))
        .collect()
}

fn first_unknown_enabled_source_module(modules: &HashMap<String, bool>) -> Option<String> {
    modules
        .iter()
        .find(|(key, enabled)| **enabled && !INFO_SOURCE_MODULE_ORDER.contains(&key.as_str()))
        .map(|(key, _)| key.clone())
}

async fn test_rust_native_info_source_modules(
    state: &AppState,
    provider: String,
    modules: &[&str],
) -> IntegrationSourceTestResponse {
    let mut row_count = 0_usize;
    let mut details = Vec::new();
    let mut errors = Vec::new();

    for module in modules {
        match *module {
            "market" => match rust_native_market_probe(state).await {
                Ok(rows) => {
                    row_count += rows;
                    details.push(format!(
                        "market: Eastmoney spot, north holdings and Tencent kline returned {rows} rows"
                    ));
                }
                Err(error) => errors.push(format!("market: {error}")),
            },
            "finance" => match rust_native_finance_metric_probe(state).await {
                Ok(rows) => {
                    row_count += rows;
                    details.push(format!(
                        "finance: Eastmoney metrics, analyst forecasts and margin balances returned {rows} rows"
                    ));
                }
                Err(error) => errors.push(format!("finance: {error}")),
            },
            "filing" => match rust_native_filing_probe(state).await {
                Ok(rows) => {
                    row_count += rows;
                    details.push(format!(
                        "filing: Eastmoney announcements returned {rows} rows"
                    ));
                }
                Err(error) => errors.push(format!("filing: {error}")),
            },
            "news" => match rust_native_news_probe(state).await {
                Ok(rows) => {
                    row_count += rows;
                    details.push(format!("news: Rust news collector returned {rows} rows"));
                }
                Err(error) => errors.push(format!("news: {error}")),
            },
            other => errors.push(format!("{other}: unsupported info source module")),
        }
    }

    integration_source_module_response(provider, row_count, details, errors)
}

async fn rust_native_market_probe(state: &AppState) -> Result<usize, String> {
    let kline_points = state
        .tencent
        .kline_points("sz000001", "day", 5)
        .await
        .map_err(|error| format!("Tencent kline request failed: {error}"))?
        .len();
    if kline_points == 0 {
        return Err("Tencent kline returned 0 rows".to_string());
    }

    let spot_rows = state
        .eastmoney
        .fetch_spot_rows()
        .await
        .map_err(|error| format!("Eastmoney spot probe failed: {error}"))?
        .len();
    if spot_rows == 0 {
        return Err("Eastmoney spot probe returned 0 rows".to_string());
    }

    let north_rows = state
        .eastmoney
        .fetch_north_holding_metrics()
        .await
        .map_err(|error| format!("Eastmoney north holdings probe failed: {error}"))?
        .len();
    if north_rows == 0 {
        return Err("Eastmoney north holdings probe returned 0 rows".to_string());
    }

    Ok(kline_points + spot_rows + north_rows)
}

async fn rust_native_finance_metric_probe(state: &AppState) -> Result<usize, String> {
    let mut errors = Vec::new();
    let mut financial_rows = 0_usize;
    for report_date in ["2025-12-31", "2024-12-31"] {
        match state
            .eastmoney
            .fetch_financial_metrics(Some(report_date))
            .await
        {
            Ok(rows) if !rows.is_empty() => {
                financial_rows = rows.len();
                break;
            }
            Ok(_) => errors.push(format!("{report_date}: 0 rows")),
            Err(error) => errors.push(format!("{report_date}: {error}")),
        }
    }
    if financial_rows == 0 {
        return Err(format!(
            "Eastmoney financial metrics probe failed ({})",
            errors.join("; ")
        ));
    }

    let analyst_rows = state
        .eastmoney
        .fetch_analyst_forecast_metrics()
        .await
        .map_err(|error| format!("Eastmoney analyst forecast probe failed: {error}"))?
        .len();
    if analyst_rows == 0 {
        return Err("Eastmoney analyst forecast probe returned 0 rows".to_string());
    }

    let margin_rows = state
        .eastmoney
        .fetch_margin_balance_metrics()
        .await
        .map_err(|error| format!("Eastmoney margin balance probe failed: {error}"))?
        .len();
    if margin_rows == 0 {
        return Err("Eastmoney margin balance probe returned 0 rows".to_string());
    }

    Ok(financial_rows + analyst_rows + margin_rows)
}

async fn rust_native_filing_probe(state: &AppState) -> Result<usize, String> {
    state
        .eastmoney
        .fetch_announcement_rows(&["600519".to_string()], 5)
        .await
        .map(|rows| rows.len())
        .map_err(|error| error.to_string())
        .and_then(|rows| {
            if rows > 0 {
                Ok(rows)
            } else {
                Err("Eastmoney announcement collector returned 0 rows".to_string())
            }
        })
}

async fn rust_native_news_probe(state: &AppState) -> Result<usize, String> {
    let payload = state
        .gdelt
        .article_list("China stock market OR A-shares", 1)
        .await
        .map_err(|error| error.to_string())?;
    let rows = news_payload_article_count(&payload)?;
    if rows > 0 {
        Ok(rows)
    } else {
        Err("Rust news collector returned 0 rows".to_string())
    }
}

async fn test_external_aktools_info_source_modules(
    state: &AppState,
    provider: String,
    base_url: &str,
    modules: &[&str],
    timeout_seconds: u64,
) -> IntegrationSourceTestResponse {
    let mut row_count = 0_usize;
    let mut details = Vec::new();
    let mut errors = Vec::new();

    for module in modules {
        match *module {
            "filing" => match rust_native_filing_probe(state).await {
                Ok(rows) => {
                    row_count += rows;
                    details.push(format!(
                        "filing: Eastmoney announcements returned {rows} rows"
                    ));
                }
                Err(error) => errors.push(format!("filing: {error}")),
            },
            "news" => match rust_native_news_probe(state).await {
                Ok(rows) => {
                    row_count += rows;
                    details.push(format!("news: Rust news collector returned {rows} rows"));
                }
                Err(error) => errors.push(format!("news: {error}")),
            },
            _ => match external_aktools_source_test_url(base_url, module) {
                Ok(Some(url)) => {
                    match fetch_aktools_test_row_count(state, url, timeout_seconds).await {
                        Ok(rows) if rows > 0 => {
                            row_count += rows;
                            details.push(format!("{module}: AKTools returned {rows} rows"));
                        }
                        Ok(_) => errors.push(format!("{module}: AKTools returned 0 rows")),
                        Err(error) => errors.push(format!("{module}: {error}")),
                    }
                }
                Ok(None) => errors.push(format!(
                    "{module}: AKShare/AKTools source test does not support this module"
                )),
                Err(error) => errors.push(format!("{module}: {error}")),
            },
        }
    }

    integration_source_module_response(provider, row_count, details, errors)
}

async fn test_asharehub_info_source_modules(
    state: &AppState,
    provider: String,
    base_url: &str,
    api_token: &str,
    modules: &[&str],
    timeout_seconds: u64,
) -> IntegrationSourceTestResponse {
    let mut row_count = 0_usize;
    let mut details = Vec::new();
    let mut errors = Vec::new();

    for module in modules {
        match *module {
            "market" => {
                let endpoints = [
                    ("market/daily", "market daily"),
                    ("market/fundamentals", "market fundamentals"),
                    ("reference/stocks", "stock reference"),
                ];
                match probe_asharehub_endpoint_group(
                    state,
                    base_url,
                    api_token,
                    &endpoints,
                    timeout_seconds,
                )
                .await
                {
                    Ok(rows) => {
                        row_count += rows;
                        details.push(format!("market: AShareHub returned {rows} rows"));
                    }
                    Err(error) => errors.push(format!("market: {error}")),
                }
            }
            "finance" => {
                let endpoints = [
                    ("financials/indicators", "financial indicators"),
                    ("financials/income", "income statement"),
                    ("financials/balance-sheet", "balance sheet"),
                    ("financials/cash-flow", "cash flow"),
                ];
                match probe_asharehub_endpoint_group(
                    state,
                    base_url,
                    api_token,
                    &endpoints,
                    timeout_seconds,
                )
                .await
                {
                    Ok(rows) => {
                        row_count += rows;
                        details.push(format!("finance: AShareHub returned {rows} rows"));
                    }
                    Err(error) => errors.push(format!("finance: {error}")),
                }
            }
            "filing" => errors.push(
                "filing: AShareHub filing endpoint is not mapped in this connector yet".to_string(),
            ),
            "news" => errors.push(
                "news: AShareHub news endpoint is not mapped in this connector yet".to_string(),
            ),
            other => errors.push(format!("{other}: unsupported info source module")),
        }
    }

    integration_source_module_response(provider, row_count, details, errors)
}

async fn probe_asharehub_endpoint_group(
    state: &AppState,
    base_url: &str,
    api_token: &str,
    endpoints: &[(&str, &str)],
    timeout_seconds: u64,
) -> Result<usize, String> {
    let mut row_count = 0_usize;
    let mut errors = Vec::new();
    for (endpoint, label) in endpoints {
        let rows = match fetch_asharehub_test_row_count(
            state,
            base_url,
            endpoint,
            api_token,
            timeout_seconds,
        )
        .await
        {
            Ok(rows) => rows,
            Err(error) => {
                errors.push(format!("{label}: {error}"));
                continue;
            }
        };
        if rows == 0 {
            errors.push(format!("{label}: AShareHub returned 0 rows"));
        } else {
            row_count += rows;
        }
    }
    if errors.is_empty() {
        Ok(row_count)
    } else {
        Err(errors.join("; "))
    }
}

async fn fetch_asharehub_test_row_count(
    state: &AppState,
    base_url: &str,
    endpoint: &str,
    api_token: &str,
    timeout_seconds: u64,
) -> Result<usize, String> {
    let params = HashMap::from([
        ("ts_code".to_string(), "000001.SZ".to_string()),
        ("limit".to_string(), "1".to_string()),
    ]);
    let url = asharehub_url(base_url, endpoint, &params)?;
    let response = state
        .http
        .get(url)
        .header("X-API-Key", api_token.trim())
        .header("accept", "application/json")
        .timeout(Duration::from_secs(timeout_seconds.clamp(3, 120)))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "request timeout".to_string()
            } else {
                format!("AShareHub proxy request failed: {error}")
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("AShareHub returned HTTP {}", status.as_u16()));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AShareHub returned non-JSON payload: {error}"))?;
    payload_row_count(&payload)
        .map_err(|error| format!("AShareHub returned invalid payload: {error}"))
}

fn integration_source_module_response(
    provider: String,
    row_count: usize,
    details: Vec<String>,
    errors: Vec<String>,
) -> IntegrationSourceTestResponse {
    if !errors.is_empty() {
        return failed_integration_source_test(provider, errors.join("; "));
    }

    IntegrationSourceTestResponse {
        engine: "rust",
        provider,
        ok: true,
        row_count,
        message: "连接检测通过".to_string(),
        details: format!("Rust module probes passed: {}", details.join("; ")),
    }
}

async fn fetch_aktools_test_row_count(
    state: &AppState,
    url: reqwest::Url,
    timeout_seconds: u64,
) -> Result<usize, String> {
    let response = state
        .http
        .get(url)
        .timeout(Duration::from_secs(timeout_seconds.clamp(3, 120)))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "request timeout".to_string()
            } else {
                format!("Rust info source proxy request failed: {error}")
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("AKTools returned HTTP {}", status.as_u16()));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("AKTools returned non-JSON payload: {error}"))?;
    payload_row_count(&payload)
        .map_err(|error| format!("AKTools returned invalid payload: {error}"))
}

fn is_rust_native_info_source_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().trim_end_matches('/');
    normalized == "/aktools/api/public" || normalized.starts_with("/aktools/")
}

fn normalize_aktools_endpoint(endpoint: &str) -> Result<String, String> {
    let cleaned = endpoint
        .trim()
        .trim_matches('/')
        .strip_prefix("api/public/")
        .unwrap_or_else(|| endpoint.trim().trim_matches('/'))
        .to_string();
    if matches!(
        cleaned.as_str(),
        "stock_zh_a_spot_em"
            | "stock_zh_a_spot"
            | "stock_zh_a_hist"
            | "stock_yjbb_em"
            | "stock_lrb_em"
            | "stock_zcfz_em"
            | "stock_xjll_em"
    ) {
        Ok(cleaned)
    } else {
        Err(format!("unsupported aktools endpoint: {cleaned}"))
    }
}

fn aktools_rows_url(
    base_url: &str,
    endpoint: &str,
    params: &HashMap<String, String>,
) -> Result<reqwest::Url, String> {
    if base_url.starts_with('/') {
        return Err("external AKTools baseUrl must start with http:// or https://".to_string());
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("external AKTools baseUrl must start with http:// or https://".to_string());
    }
    let endpoint = normalize_aktools_endpoint(endpoint)?;
    let normalized = base_url.trim_end_matches('/');
    let mut url = reqwest::Url::parse(&format!("{normalized}/{endpoint}"))
        .map_err(|error| format!("AKTools endpoint URL is invalid: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    Ok(url)
}

fn aktools_hist_test_url(base_url: &str) -> Result<reqwest::Url, String> {
    if base_url.starts_with('/') {
        return Err("外部 AKTools 地址必须以 http:// 或 https:// 开头".to_string());
    }
    let endpoint = format!("{}/stock_zh_a_hist", base_url.trim_end_matches('/'));
    let mut url =
        reqwest::Url::parse(&endpoint).map_err(|error| format!("AKTools 接口地址无效：{error}"))?;
    url.query_pairs_mut()
        .append_pair("symbol", "000001")
        .append_pair("period", "daily")
        .append_pair("start_date", "20240501")
        .append_pair("end_date", "20240531")
        .append_pair("adjust", "qfq");
    Ok(url)
}

fn external_aktools_source_test_url(
    base_url: &str,
    module: &str,
) -> Result<Option<reqwest::Url>, String> {
    match module {
        "market" => aktools_hist_test_url(base_url).map(Some),
        "finance" => {
            let mut params = HashMap::new();
            params.insert("date".to_string(), "20251231".to_string());
            aktools_rows_url(base_url, "stock_yjbb_em", &params).map(Some)
        }
        "filing" | "news" => Ok(None),
        other => Err(format!("unsupported info source module: {other}")),
    }
}

fn normalize_asharehub_endpoint(endpoint: &str) -> Result<String, String> {
    let cleaned = endpoint
        .trim()
        .trim_matches('/')
        .strip_prefix("v1/")
        .unwrap_or_else(|| endpoint.trim().trim_matches('/'))
        .to_string();
    if matches!(
        cleaned.as_str(),
        "market/daily"
            | "market/fundamentals"
            | "market/technical-factors"
            | "market/margin"
            | "financials/indicators"
            | "financials/income"
            | "financials/balance-sheet"
            | "financials/cash-flow"
            | "reference/stocks"
            | "reference/industries"
            | "flows/northbound-holdings"
    ) {
        Ok(cleaned)
    } else {
        Err(format!("unsupported AShareHub endpoint: {cleaned}"))
    }
}

fn asharehub_url(
    base_url: &str,
    endpoint: &str,
    params: &HashMap<String, String>,
) -> Result<reqwest::Url, String> {
    if base_url.starts_with('/') {
        return Err("AShareHub baseUrl must start with http:// or https://".to_string());
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("AShareHub baseUrl must start with http:// or https://".to_string());
    }
    let endpoint = normalize_asharehub_endpoint(endpoint)?;
    let normalized = base_url.trim_end_matches('/');
    let root = if normalized.ends_with("/v1") {
        normalized.to_string()
    } else {
        format!("{normalized}/v1")
    };
    let mut url = reqwest::Url::parse(&format!("{root}/{endpoint}"))
        .map_err(|error| format!("AShareHub endpoint URL is invalid: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    Ok(url)
}

fn health_check_url(base_url: &str) -> Result<reqwest::Url, String> {
    if base_url.starts_with('/') {
        return Err("远程接口地址必须以 http:// 或 https:// 开头".to_string());
    }
    let normalized = base_url.trim_end_matches('/');
    let endpoint = if normalized.ends_with("/health") {
        normalized.to_string()
    } else {
        format!("{normalized}/health")
    };
    reqwest::Url::parse(&endpoint).map_err(|error| format!("远程接口地址无效：{error}"))
}

fn payload_row_count(payload: &Value) -> Result<usize, String> {
    if let Some(rows) = payload.as_array() {
        return Ok(rows.len());
    }
    if let Some(rows) = payload.get("data").and_then(Value::as_array) {
        return Ok(rows.len());
    }
    Err("expected an array or { data: [] }".to_string())
}

fn endpoint_from_aktools_path(path: &str) -> String {
    let cleaned = path.trim_start_matches('/');
    let without_api_prefix = cleaned.strip_prefix("api/public/").unwrap_or(cleaned);
    without_api_prefix
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

fn build_news_article(
    row: &Value,
    source: &NewsSourceInput,
    stocks: &[Stock],
    index: usize,
) -> Result<NewsArticle, String> {
    let title = strip_html(
        &string_at(row, "title").ok_or_else(|| "title must be a non-empty string".to_string())?,
    );
    if title.is_empty() {
        return Err("title must not be empty after stripping html".to_string());
    }
    let url = string_at(row, "url").ok_or_else(|| "url must be a non-empty string".to_string())?;
    let domain = string_at(row, "domain").unwrap_or_else(|| source.name.clone());
    let summary = first_string_at(row, &["summary", "description"])
        .map(|value| strip_html(&value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| title.clone());
    let content = first_string_at(row, &["content", "body"])
        .map(|value| strip_html(&value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| summary.clone());
    let image_url = first_string_at(row, &["imageUrl", "urlToImage", "image"]).unwrap_or_default();
    let author = first_string_at(row, &["author", "byline"]).unwrap_or_else(|| domain.clone());
    let published_at = string_at(row, "seendate").unwrap_or_default();
    let search_text = format!("{title} {summary} {content}");
    let link_text = format!(
        "{} {}",
        search_text,
        source.query.as_deref().unwrap_or_default()
    );
    let linked_stocks = match_linked_stocks(&link_text, stocks);
    let linked_codes = linked_stocks
        .iter()
        .map(|stock| stock.code.clone())
        .collect::<Vec<_>>();
    let industries = infer_industries(&link_text, stocks, &linked_stocks);
    let category = infer_news_category(&search_text);
    let sentiment = infer_news_sentiment(&search_text);
    let mut tags = unique_texts(
        [
            vec![category.clone(), sentiment.clone()],
            industries.clone(),
        ]
        .concat(),
    );
    tags.truncate(6);
    Ok(NewsArticle {
        id: format!("{}-{index}-{url}", source.id),
        title: title.clone(),
        summary,
        content,
        source: domain.clone(),
        source_icon: first_icon(&domain),
        category: category.clone(),
        sentiment: sentiment.clone(),
        importance: infer_news_importance(&category, &sentiment, index),
        status: "unread".to_string(),
        published_at: if published_at.is_empty() {
            "1970-01-01T00:00:00Z".to_string()
        } else {
            published_at.clone()
        },
        fetched_at: if published_at.is_empty() {
            "1970-01-01T00:00:00Z".to_string()
        } else {
            published_at
        },
        url,
        image_url,
        author,
        read_time: 1,
        linked_codes,
        linked_stocks,
        industries,
        tags,
        view_count: 0,
        comment_count: 0,
    })
}

fn news_source_diagnostic_from_payload(
    source: &NewsSourceInput,
    payload: &Value,
) -> Option<NewsSourceDiagnostic> {
    let fallback_source = string_at(payload, "fallbackSource");
    let fallback_reason = string_at(payload, "fallbackReason");
    if fallback_source.is_none() && fallback_reason.is_none() {
        return None;
    }
    Some(NewsSourceDiagnostic {
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        provider: source.provider.clone(),
        fallback_source,
        fallback_reason,
    })
}

fn news_fallback_source_label(source: &str) -> &str {
    if source.eq_ignore_ascii_case("eastmoney") {
        "东方财富"
    } else {
        source
    }
}

fn news_source_test_fallback_suffix(payload: &Value) -> String {
    let Some(fallback_source) = string_at(payload, "fallbackSource") else {
        return String::new();
    };
    let reason = string_at(payload, "fallbackReason")
        .map(|value| format!("，原因：{value}"))
        .unwrap_or_default();
    format!(
        "（Rust 已切换 {} 真实新闻源{}）",
        news_fallback_source_label(&fallback_source),
        reason
    )
}

fn news_payload_article_count(payload: &Value) -> Result<usize, String> {
    payload
        .get("articles")
        .and_then(Value::as_array)
        .map(Vec::len)
        .ok_or_else(|| "expected articles array".to_string())
}

fn string_at(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn first_string_at(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_at(row, key))
}

fn strip_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn text_has_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| text.contains(word))
}

fn infer_news_category(text: &str) -> String {
    if text_has_any(
        text,
        &["公告", "回购", "增持", "减持", "股东", "董事会", "分红"],
    ) {
        "公司公告"
    } else if text_has_any(text, &["财报", "业绩", "净利润", "营收", "利润", "预告"]) {
        "财报业绩"
    } else if text_has_any(
        text,
        &[
            "国务院",
            "央行",
            "证监会",
            "发改委",
            "政策",
            "通知",
            "规划",
            "会议",
        ],
    ) {
        "宏观政策"
    } else if text_has_any(text, &["美联储", "美元", "美国", "欧洲", "全球", "海外"]) {
        "国际财经"
    } else if text_has_any(text, &["基金", "ETF", "持仓", "北向", "外资"]) {
        "基金持仓"
    } else if text_has_any(text, &["产业链", "订单", "招标", "供需", "价格", "产能"]) {
        "产业链"
    } else {
        "市场评论"
    }
    .to_string()
}

fn infer_news_sentiment(text: &str) -> String {
    let positive = text_has_any(
        text,
        &[
            "利好",
            "增长",
            "创新高",
            "中标",
            "回购",
            "增持",
            "支持",
            "突破",
            "上涨",
            "扩产",
            "获批",
            "签约",
        ],
    );
    let negative = text_has_any(
        text,
        &[
            "利空", "下跌", "承压", "风险", "处罚", "调查", "亏损", "减持", "违约", "退市", "下修",
            "终止",
        ],
    );
    match (positive, negative) {
        (true, false) => "利好",
        (false, true) => "利空",
        _ => "中性",
    }
    .to_string()
}

fn infer_news_importance(category: &str, sentiment: &str, index: usize) -> String {
    if index < 3
        || category == "宏观政策"
        || ["重大", "突发", "国务院", "央行", "证监会"]
            .iter()
            .any(|word| category.contains(word))
    {
        "头条"
    } else if index < 10 || category == "公司公告" || category == "财报业绩" || sentiment == "利空"
    {
        "重要"
    } else {
        "一般"
    }
    .to_string()
}

fn match_linked_stocks(text: &str, stocks: &[Stock]) -> Vec<LinkedStock> {
    let upper_text = text.to_uppercase();
    stocks
        .iter()
        .filter(|stock| {
            upper_text.contains(&stock.name.to_uppercase())
                || upper_text.contains(&stock.code)
                || upper_text.contains(&display_stock_code(stock))
        })
        .take(8)
        .map(|stock| LinkedStock {
            code: stock.code.clone(),
            name: stock.name.clone(),
        })
        .collect()
}

fn display_stock_code(stock: &Stock) -> String {
    let prefix = if stock.exchange == "沪市" {
        "SH"
    } else if stock.exchange == "北交所" {
        "BJ"
    } else {
        "SZ"
    };
    format!("{prefix}{}", stock.code)
}

fn infer_industries(text: &str, stocks: &[Stock], linked_stocks: &[LinkedStock]) -> Vec<String> {
    let linked_codes: HashSet<&str> = linked_stocks
        .iter()
        .map(|stock| stock.code.as_str())
        .collect();
    let mut industries = Vec::new();
    for stock in stocks {
        if linked_codes.contains(stock.code.as_str()) || text.contains(&stock.industry1) {
            if is_specific_industry(&stock.industry1) {
                industries.push(stock.industry1.clone());
            }
        }
    }
    let mut unique = unique_texts(industries);
    unique.truncate(6);
    unique
}

fn is_specific_industry(value: &str) -> bool {
    !value.trim().is_empty() && value != "全部" && value != "未分类"
}

fn unique_texts(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        if !value.trim().is_empty() && seen.insert(value.clone()) {
            result.push(value);
        }
    }
    result
}

fn first_icon(value: &str) -> String {
    value
        .chars()
        .next()
        .map(|ch| ch.to_uppercase().collect::<String>())
        .unwrap_or_else(|| "N".to_string())
}

fn tencent_symbol_for_code(code: &str) -> String {
    let digits: String = code.chars().filter(|ch| ch.is_ascii_digit()).collect();
    let normalized = if digits.len() >= 6 {
        digits[digits.len() - 6..].to_string()
    } else {
        format!("{digits:0>6}")
    };
    if normalized.starts_with('6') || normalized.starts_with('9') {
        format!("sh{normalized}")
    } else if normalized.starts_with('8') || normalized.starts_with('4') {
        format!("bj{normalized}")
    } else {
        format!("sz{normalized}")
    }
}

fn parse_tencent_kline_query(
    query: TencentKlineQuery,
) -> Result<(String, String, usize), ApiError> {
    if let Some(param) = query.param {
        let parts: Vec<&str> = param.split(',').collect();
        let symbol = parts.first().copied().unwrap_or("").trim().to_string();
        let period = parts.get(1).copied().unwrap_or("day").trim().to_string();
        let limit = parts
            .get(4)
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(120);
        if !symbol.is_empty() {
            return Ok((symbol, period, limit));
        }
    }

    let symbol = query.symbol.unwrap_or_default();
    if symbol.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Tencent kline query is empty".to_string(),
            details: "Pass param=sh600000,day,,,120,qfq or symbol=sh600000".to_string(),
        });
    }
    Ok((
        symbol,
        query.period.unwrap_or_else(|| "day".to_string()),
        query.limit.unwrap_or(120),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_stock() -> Stock {
        Stock {
            code: "600519".to_string(),
            name: "贵州茅台".to_string(),
            exchange: "沪市".to_string(),
            board: "主板".to_string(),
            industry1: "食品饮料".to_string(),
            industry2: "白酒".to_string(),
            region: "贵州".to_string(),
            property: "国企".to_string(),
            is_st: false,
            is_suspended: false,
            is_star: false,
            is_margin: true,
            indexes: vec![],
            metrics: HashMap::new(),
        }
    }

    fn test_article() -> NewsArticle {
        NewsArticle {
            id: "rust-news-001".to_string(),
            title: "贵州茅台完成回购，食品饮料板块走强".to_string(),
            summary: "贵州茅台公告完成回购，市场情绪改善。".to_string(),
            content: "公司公告显示回购实施完毕。".to_string(),
            source: "腾讯证券公告".to_string(),
            source_icon: "T".to_string(),
            category: "公司公告".to_string(),
            sentiment: "利好".to_string(),
            importance: "重要".to_string(),
            status: "unread".to_string(),
            published_at: "2026-05-27 18:42:12".to_string(),
            fetched_at: "2026-05-27T18:45:00.000Z".to_string(),
            url: "https://proxy.finance.qq.com/notice/test".to_string(),
            image_url: String::new(),
            author: "腾讯证券公告".to_string(),
            read_time: 1,
            linked_codes: vec!["600519".to_string()],
            linked_stocks: vec![LinkedStock {
                code: "600519".to_string(),
                name: "贵州茅台".to_string(),
            }],
            industries: vec!["食品饮料".to_string(), "白酒".to_string()],
            tags: vec![
                "公司公告".to_string(),
                "回购".to_string(),
                "腾讯".to_string(),
            ],
            view_count: 0,
            comment_count: 0,
        }
    }

    fn test_news_source(provider: &str) -> NewsSourceInput {
        NewsSourceInput {
            id: "news-test".to_string(),
            name: "Example News".to_string(),
            provider: provider.to_string(),
            base_url: "https://example.com/news".to_string(),
            api_token: String::new(),
            language: "zh-CN".to_string(),
            enabled: true,
            max_items: Some(10),
            query: Some("贵州茅台".to_string()),
        }
    }

    fn test_kline_points(count: usize) -> Vec<TencentKlinePoint> {
        (0..count)
            .map(|index| {
                let close = 100.0 + index as f64;
                let month = index / 28 + 1;
                let day = index % 28 + 1;
                TencentKlinePoint {
                    date: format!("2024-{month:02}-{day:02}"),
                    open: close - 0.5,
                    high: close + 1.0,
                    low: close - 1.0,
                    close,
                    volume: 1_000_000.0 + index as f64,
                }
            })
            .collect()
    }

    #[test]
    fn annual_report_date_candidates_use_prior_annual_period_for_quarterly_metrics() {
        let mut stock = test_stock();
        stock
            .metrics
            .insert("realFinancialReportDate".to_string(), 20260331.0);

        let candidates = annual_report_date_candidates(&stock);

        assert_eq!(candidates[0], "2025-12-31");
        assert_eq!(
            candidates
                .iter()
                .filter(|date| *date == "2025-12-31")
                .count(),
            1
        );
    }

    #[test]
    fn builds_annual_report_from_real_financial_metric_row() {
        let stock = test_stock();
        let row = FinancialMetricRow {
            code: "SH600519".to_string(),
            name: "Kweichow Moutai".to_string(),
            report_date: "2025-12-31".to_string(),
            source_rows: 4,
            metrics: HashMap::from([
                ("realAnnualReportSource".to_string(), 1.0),
                ("realAnnualReportDate".to_string(), 20251231.0),
                ("realAnnualReportDisclosureDate".to_string(), 20260430.0),
                ("revenue".to_string(), 1275.0),
                ("netProfit".to_string(), 747.0),
                ("operatingCashflow".to_string(), 650.0),
                ("totalAssets".to_string(), 2550.0),
                ("totalLiabilities".to_string(), 420.0),
            ]),
        };

        let reports = build_annual_reports_from_financial_metric_row(&stock, &row);

        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].code, "600519");
        assert_eq!(reports[0].year, "2025");
        assert_eq!(reports[0].period_end, "2025-12-31");
        assert_eq!(reports[0].metrics.revenue, 1275.0);
        assert!(reports[0].source_csv.contains("600519"));
    }

    #[test]
    fn technical_indicator_codes_normalize_dedupe_and_cap_inputs() {
        let codes = parse_technical_indicator_codes(Some("SH600519,600519,sz000858,abc,123"))
            .expect("technical indicator codes");

        assert_eq!(codes, vec!["600519", "000858", "000123"]);

        let many_codes = (0..250)
            .map(|index| format!("{index:06}"))
            .collect::<Vec<_>>()
            .join(",");
        let capped = parse_technical_indicator_codes(Some(&many_codes)).expect("capped codes");

        assert_eq!(capped.len(), TECHNICAL_INDICATOR_CODE_LIMIT);
        assert_eq!(capped.first().map(String::as_str), Some("000000"));
        assert_eq!(capped.last().map(String::as_str), Some("000199"));
    }

    #[test]
    fn technical_indicator_row_from_kline_points_emits_selection_factors() {
        let row = technical_indicator_row_from_points("SH600519", test_kline_points(70))
            .expect("technical indicator row");

        assert_eq!(row.code, "600519");
        assert_eq!(row.name, "600519");
        assert_eq!(row.report_date, "2024-03-14");
        assert_eq!(row.source_rows, 70);
        assert_eq!(row.metrics.get("realTechnicalSource"), Some(&1.0));
        assert_eq!(row.metrics.get("technicalTradeDate"), Some(&20240314.0));
        assert_eq!(row.metrics.get("tradingDays"), Some(&70.0));
        for key in [
            "ma20Distance",
            "ma60Distance",
            "momentum60",
            "volatility20",
            "macd",
            "kdj",
            "rsi",
            "bias",
            "bollWidth",
        ] {
            assert!(
                row.metrics.get(key).is_some_and(|value| value.is_finite()),
                "{key}"
            );
        }
    }

    #[test]
    fn filing_request_codes_normalizes_and_deduplicates_inputs() {
        let request = FilingAnnouncementsRequest {
            codes: vec![
                "SH600519".to_string(),
                "600519".to_string(),
                "sz000001".to_string(),
            ],
            stocks: vec![test_stock()],
            max_items: Some(5),
        };

        let codes = filing_request_codes(&request);

        assert_eq!(codes, vec!["000001".to_string(), "600519".to_string()]);
    }

    #[test]
    fn news_article_request_accepts_missing_stocks() {
        let request: NewsArticleRequest = serde_json::from_value(serde_json::json!({
            "sources": [{
                "id": "gdelt",
                "name": "GDELT global news",
                "provider": "GDELT 2.1",
                "baseUrl": "/api/news/gdelt",
                "enabled": true,
                "maxItems": 5
            }],
            "mode": "fast"
        }))
        .expect("news article request");

        assert!(request.stocks.is_empty());
        assert_eq!(request.sources.len(), 1);
        assert_eq!(request.mode, "fast");
    }

    #[test]
    fn builds_sentiment_events_from_real_news_articles() {
        let events = build_sentiment_events(&[test_article()], &[test_stock()]);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "real-news-rust-news-001");
        assert_eq!(events[0].category, "资金市场");
        assert_eq!(events[0].direction, "利好");
        assert_eq!(events[0].horizon, "短期");
        assert_eq!(events[0].severity, "重大");
        assert_eq!(events[0].linked_codes, vec!["600519"]);
        assert!(events[0].industries.contains(&"食品饮料".to_string()));
        assert!(score_sentiment_event(&events[0]) > 60.0);
    }

    #[test]
    fn builds_news_article_from_normalized_remote_source_row() {
        let row = serde_json::json!({
            "title": "贵州茅台完成回购",
            "url": "https://example.com/news/maotai",
            "domain": "Example News",
            "seendate": "2026-06-09T09:00:00Z",
            "summary": "公司公告回购完成，食品饮料板块走强",
            "content": "贵州茅台公告显示回购完成，市场情绪改善",
            "imageUrl": "https://example.com/a.jpg",
            "author": "Reporter"
        });
        let article = build_news_article(&row, &test_news_source("NewsAPI"), &[test_stock()], 0)
            .expect("news article");

        assert_eq!(article.title, "贵州茅台完成回购");
        assert_eq!(article.summary, "公司公告回购完成，食品饮料板块走强");
        assert_eq!(article.content, "贵州茅台公告显示回购完成，市场情绪改善");
        assert_eq!(article.image_url, "https://example.com/a.jpg");
        assert_eq!(article.author, "Reporter");
        assert_eq!(article.linked_codes, vec!["600519"]);
        assert!(article.industries.contains(&"食品饮料".to_string()));
    }

    #[test]
    fn news_article_links_stock_from_source_query_when_remote_row_is_generic() {
        let row = serde_json::json!({
            "title": "Market liquidity remains active",
            "url": "https://example.com/news/market",
            "domain": "Example News",
            "seendate": "2026-06-09T09:00:00Z",
            "summary": "Broad market update",
            "content": "Funds increased exposure to financial names"
        });
        let article = build_news_article(&row, &test_news_source("GDELT 2.1"), &[test_stock()], 0)
            .expect("news article");

        assert_eq!(article.linked_codes, vec!["600519"]);
        assert!(!article.industries.is_empty());
    }

    #[test]
    fn rejects_news_article_rows_without_url() {
        let row = serde_json::json!({
            "title": "Market liquidity remains active",
            "domain": "Example News"
        });
        let error = build_news_article(&row, &test_news_source("GDELT 2.1"), &[test_stock()], 0)
            .expect_err("missing url should fail");

        assert!(error.contains("url must be a non-empty string"));
    }

    #[test]
    fn builds_news_source_diagnostic_when_real_source_fallback_is_used() {
        let payload = serde_json::json!({
            "articles": [],
            "fallbackSource": "eastmoney",
            "fallbackReason": "GDELT request timed out"
        });
        let diagnostic =
            news_source_diagnostic_from_payload(&test_news_source("GDELT 2.1"), &payload)
                .expect("news source diagnostic");

        assert_eq!(diagnostic.provider, "GDELT 2.1");
        assert_eq!(diagnostic.fallback_source.as_deref(), Some("eastmoney"));
        assert_eq!(
            diagnostic.fallback_reason.as_deref(),
            Some("GDELT request timed out")
        );
    }

    #[test]
    fn builds_news_source_test_fallback_suffix() {
        let payload = serde_json::json!({
            "articles": [],
            "fallbackSource": "eastmoney",
            "fallbackReason": "GDELT request timed out"
        });
        let suffix = news_source_test_fallback_suffix(&payload);

        assert!(suffix.contains("东方财富"));
        assert!(suffix.contains("GDELT request timed out"));
    }

    #[test]
    fn news_payload_article_count_rejects_missing_articles_array() {
        assert_eq!(
            news_payload_article_count(&serde_json::json!({ "articles": [{}] })),
            Ok(1)
        );
        assert!(news_payload_article_count(&serde_json::json!({ "data": [] })).is_err());
    }

    #[test]
    fn rust_news_source_test_supports_remote_collectors() {
        assert!(is_supported_rust_news_provider("GDELT 2.1"));
        assert!(is_supported_rust_news_provider("NewsAPI"));
        assert!(is_supported_rust_news_provider("自定义 REST"));
        assert!(is_supported_rust_news_provider("自定义 RSS"));
        assert!(is_supported_rust_news_provider("腾讯证券公告"));
        assert!(!is_supported_rust_news_provider("本地舆情样本"));
    }

    #[test]
    fn builds_sentiment_analysis_with_linked_stocks_and_report() {
        let stocks = vec![test_stock()];
        let events = build_sentiment_events(&[test_article()], &stocks);
        let linked_stocks = build_sentiment_linked_stocks(&events, &stocks);
        let report = build_sentiment_insight_report(&events, &linked_stocks);

        assert_eq!(linked_stocks.len(), 1);
        assert_eq!(linked_stocks[0].stock.code, "600519");
        assert!(linked_stocks[0].relation_score >= 45.0);
        assert!(!linked_stocks[0].evidence.is_empty());
        assert_eq!(report.title, "舆情关联股票洞察");
        assert_eq!(report.event_count, 1);
        assert_eq!(report.linked_stocks.len(), 1);
        assert!(report.conclusion.contains("贵州茅台"));
    }

    #[test]
    fn validates_local_news_analysis_rule_tasks() {
        let response = build_news_analysis_local_test_response(&[
            "sentiment".to_string(),
            "stockMapping".to_string(),
            "sentiment".to_string(),
            "".to_string(),
        ]);

        assert!(response.ok);
        assert_eq!(response.engine, "rust");
        assert_eq!(response.task_count, 2);

        let empty = build_news_analysis_local_test_response(&[]);
        assert!(!empty.ok);
        assert_eq!(empty.task_count, 0);
    }

    #[tokio::test]
    async fn sentiment_report_marks_enabled_local_news_analysis_model() {
        let stocks = vec![test_stock()];
        let events = build_sentiment_events(&[test_article()], &stocks);
        let linked_stocks = build_sentiment_linked_stocks(&events, &stocks);
        let report = enrich_sentiment_report_with_analysis_model(
            &reqwest::Client::new(),
            build_sentiment_insight_report(&events, &linked_stocks),
            Some(&NewsAnalysisModelTestRequest {
                enabled: true,
                provider: "local".to_string(),
                base_url: "local://news-rule-engine".to_string(),
                api_key: String::new(),
                model: "local-news-rule-v1".to_string(),
                timeout_seconds: 20,
                max_tokens: 1200,
                temperature: 0.2,
                system_prompt: "test".to_string(),
                tasks: vec!["sentiment".to_string(), "stockMapping".to_string()],
            }),
            &events,
            &linked_stocks,
        )
        .await;

        assert!(report
            .validation_points
            .iter()
            .any(|item| item.contains("local-news-rule-v1") && item.contains("2")));
    }

    #[test]
    fn parses_news_analysis_model_json_content() {
        let insight = news_analysis_model_insight_from_content(
            "```json\n{\"conclusion\":\"model conclusion\",\"validationPoints\":[\"source checked\",\"risk checked\"]}\n```",
        );

        assert_eq!(insight.conclusion.as_deref(), Some("model conclusion"));
        assert_eq!(insight.validation_points.len(), 2);
    }

    #[test]
    fn builds_openai_compatible_chat_completions_url() {
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn real_kline_backtest_uses_close_price_returns() {
        let mut stock = test_stock();
        stock.metrics.insert("price".to_string(), 10.0);
        let row = SelectionRow {
            stock,
            score: 90.0,
            weight: 100.0,
            passed_filters: 1,
            failed_reason: None,
        };
        let base = BacktestResult {
            rows: vec![row.clone()],
            curve: Vec::new(),
            metrics: BacktestMetrics {
                cumulative_return: 0.0,
                annual_return: 0.0,
                max_drawdown: 0.0,
                sharpe: 0.0,
                volatility: 0.0,
                win_rate: 0.0,
                turnover: 0.0,
            },
            yearly: Vec::new(),
            trades: Vec::new(),
        };
        let strategy = StrategyConfig::default();
        let config = BacktestConfig {
            start_date: "2024-01-02".to_string(),
            end_date: "2024-01-04".to_string(),
            benchmark: "沪深300".to_string(),
            cost: 0.0,
            exclude_time_range: false,
        };
        let series = vec![RealBacktestSeries {
            row,
            points: vec![
                TencentKlinePoint {
                    date: "2024-01-02".to_string(),
                    open: 10.0,
                    high: 10.0,
                    low: 10.0,
                    close: 10.0,
                    volume: 1.0,
                },
                TencentKlinePoint {
                    date: "2024-01-03".to_string(),
                    open: 11.0,
                    high: 11.0,
                    low: 11.0,
                    close: 11.0,
                    volume: 1.0,
                },
                TencentKlinePoint {
                    date: "2024-01-04".to_string(),
                    open: 12.0,
                    high: 12.0,
                    low: 12.0,
                    close: 12.0,
                    volume: 1.0,
                },
            ],
        }];
        let benchmark_points = vec![
            TencentKlinePoint {
                date: "2024-01-02".to_string(),
                open: 100.0,
                high: 100.0,
                low: 100.0,
                close: 100.0,
                volume: 1.0,
            },
            TencentKlinePoint {
                date: "2024-01-03".to_string(),
                open: 101.0,
                high: 101.0,
                low: 101.0,
                close: 101.0,
                volume: 1.0,
            },
            TencentKlinePoint {
                date: "2024-01-04".to_string(),
                open: 99.0,
                high: 99.0,
                low: 99.0,
                close: 99.0,
                volume: 1.0,
            },
        ];

        let result =
            build_real_kline_backtest_result(base, &strategy, &config, series, benchmark_points)
                .expect("real kline result");

        assert_eq!(result.curve.len(), 3);
        assert_eq!(result.curve.last().expect("last point").strategy, 1.2);
        assert_eq!(result.metrics.cumulative_return, 20.0);
        assert_eq!(result.yearly[0].strategy, 20.0);
        assert_eq!(result.trades[0].price, 10.0);
        assert_eq!(result.trades[1].price, 12.0);
    }

    #[test]
    fn optimization_candidates_keep_current_holdings_and_choose_best_sharpe() {
        let mut strategy = StrategyConfig::default();
        strategy.trading.max_holdings = 3;

        let candidates = optimization_candidate_holdings(&strategy);

        assert!(candidates.contains(&3));
        assert!(candidates.contains(&6));

        let result = |id: &str, sharpe: f64| StrategyOptimizationResult {
            candidate: StrategyConfig {
                id: id.to_string(),
                ..StrategyConfig::default()
            },
            result: BacktestResult {
                rows: Vec::new(),
                curve: Vec::new(),
                metrics: BacktestMetrics {
                    cumulative_return: 0.0,
                    annual_return: 0.0,
                    max_drawdown: 0.0,
                    sharpe,
                    volatility: 0.0,
                    win_rate: 0.0,
                    turnover: 0.0,
                },
                yearly: Vec::new(),
                trades: Vec::new(),
            },
        };

        let best = better_optimization_result(Some(result("low", 0.5)), result("high", 1.2));

        assert_eq!(best.candidate.id, "high");
        assert_eq!(best.result.metrics.sharpe, 1.2);
    }

    #[tokio::test]
    async fn strategy_screen_applies_filters_rank_and_requested_daily_count() {
        let mut strategy = StrategyConfig {
            id: "daily-screen".to_string(),
            name: "daily-screen".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 3,
            filters: vec![stockchoose_core::FilterCondition {
                id: "filter-value".to_string(),
                factor_key: "valueScore".to_string(),
                operator: "gte".to_string(),
                min: None,
                max: None,
                value: Some(50.0),
                range: "all".to_string(),
                enabled: true,
            }],
            ranks: vec![stockchoose_core::RankCondition {
                id: "rank-value".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..StrategyConfig::default()
        };
        strategy.trading.max_holdings = 2;

        let stocks = [
            ("600001", 90.0),
            ("600002", 75.0),
            ("600003", 60.0),
            ("600004", 40.0),
        ]
        .into_iter()
        .map(|(code, value_score)| {
            let mut stock = test_stock();
            stock.code = code.to_string();
            stock.name = code.to_string();
            stock.metrics.insert("valueScore".to_string(), value_score);
            stock
        })
        .collect::<Vec<_>>();
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|stock| stock.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "valueScore".to_string(),
            name: "value".to_string(),
            group: "custom".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: None,
        }];

        let response = strategy_screen(Json(ScreenRequest {
            strategy,
            stocks,
            pools,
            factors,
            result_limit: Some(3),
            weight_limit: Some(2),
        }))
        .await
        .0;

        assert_eq!(
            response
                .iter()
                .map(|row| row.stock.code.as_str())
                .collect::<Vec<_>>(),
            vec!["600001", "600002", "600003"]
        );
        assert_eq!(response.iter().filter(|row| row.weight > 0.0).count(), 2);
        assert!(response.iter().all(|row| row.passed_filters == 1));
    }

    #[tokio::test]
    async fn trade_plan_filters_minimum_amount_and_returns_export_text() {
        let mut first = test_stock();
        first.code = "600519".to_string();
        first.metrics.insert("price".to_string(), 100.0);
        let mut second = test_stock();
        second.code = "000001".to_string();
        second.metrics.insert("price".to_string(), 100.0);

        let rows = vec![
            SelectionRow {
                stock: first,
                score: 90.0,
                weight: 10.0,
                passed_filters: 1,
                failed_reason: None,
            },
            SelectionRow {
                stock: second,
                score: 80.0,
                weight: 20.0,
                passed_filters: 1,
                failed_reason: None,
            },
        ];

        let response = trade_plan(Json(TradePlanRequest {
            strategy: StrategyConfig::default(),
            rows,
            mode: "manual".to_string(),
            account_id: "PAPER-0001".to_string(),
            account_asset: 100000.0,
            minimum_amount: Some(15000.0),
        }))
        .await
        .0;

        assert_eq!(response.plan.orders.len(), 1);
        assert_eq!(response.plan.orders[0].code, "000001");
        assert!(response.client_text.contains("000001\t"));
        assert!(response.csv.contains("000001"));
    }

    #[tokio::test]
    async fn trade_paper_submit_returns_rust_generated_fills() {
        let mut stock = test_stock();
        stock.code = "600519".to_string();
        stock.metrics.insert("price".to_string(), 100.0);

        let plan = trade_plan(Json(TradePlanRequest {
            strategy: StrategyConfig::default(),
            rows: vec![SelectionRow {
                stock,
                score: 90.0,
                weight: 10.0,
                passed_filters: 1,
                failed_reason: None,
            }],
            mode: "auto".to_string(),
            account_id: "PAPER-0001".to_string(),
            account_asset: 100000.0,
            minimum_amount: None,
        }))
        .await
        .0
        .plan;

        let response = trade_paper_submit(Json(PaperTradeSubmitRequest {
            state: PaperTradeState::default(),
            plan,
        }))
        .await
        .0;

        assert_eq!(response.plans.len(), 1);
        assert_eq!(response.plans[0].status, "filled");
        assert_eq!(response.plans[0].orders[0].status, "已成交");
        assert_eq!(response.fills.len(), 1);
        assert_eq!(response.fills[0].plan_id, response.plans[0].id);
        assert_eq!(response.fills[0].strategy_id, response.plans[0].strategy_id);
    }

    #[tokio::test]
    async fn trade_assets_sync_returns_rust_normalized_account_totals() {
        let response = trade_assets_sync(Json(TradeAssetSyncRequest {
            asset: TradeAssetInput {
                net_value: Some(1.11119),
                holding_value: Some(123_456.789),
                strategy_cash: Some(76_543.211),
                outside_asset: Some(-100.0),
                last_synced_at: None,
            },
        }))
        .await
        .0;

        assert!(response.ok);
        assert_eq!(response.asset.net_value, 1.1112);
        assert_eq!(response.asset.holding_value, 123_456.79);
        assert_eq!(response.asset.strategy_cash, 76_543.21);
        assert_eq!(response.asset.outside_asset, 500_000.0);
        assert_eq!(response.strategy_asset, 200_000.0);
        assert_eq!(response.account_asset, 700_000.0);
        assert!(response.asset.last_synced_at.is_some());
    }

    #[tokio::test]
    async fn news_analysis_model_test_uses_local_rule_engine() {
        let response = build_news_analysis_model_test_response(
            &reqwest::Client::new(),
            NewsAnalysisModelTestRequest {
                enabled: true,
                provider: "本地规则模型".to_string(),
                base_url: "local://news-rule-engine".to_string(),
                api_key: String::new(),
                model: "local-news-rule-v1".to_string(),
                timeout_seconds: 20,
                max_tokens: 1200,
                temperature: 0.2,
                system_prompt: "test".to_string(),
                tasks: vec!["sentiment".to_string(), "stockMapping".to_string()],
            },
        )
        .await;

        assert!(response.ok);
        assert_eq!(response.engine, "rust");
        assert_eq!(response.provider, "本地规则模型");
        assert_eq!(response.model, "local-news-rule-v1");
        assert!(response.details.contains("2"));
    }

    #[test]
    fn builds_integration_source_test_urls() {
        assert!(is_rust_native_info_source_base_url("/aktools/api/public"));
        assert!(is_rust_native_info_source_base_url("/aktools/api/public/"));
        assert!(!is_rust_native_info_source_base_url(
            "https://aktools.example/api/public"
        ));

        let aktools_url = aktools_hist_test_url("https://aktools.example/api/public")
            .expect("aktools url")
            .to_string();
        assert!(aktools_url.starts_with("https://aktools.example/api/public/stock_zh_a_hist?"));
        assert!(aktools_url.contains("symbol=000001"));
        assert!(aktools_url.contains("start_date=20240501"));

        let mut params = HashMap::new();
        params.insert("date".to_string(), "20251231".to_string());
        let rows_url = aktools_rows_url(
            "https://aktools.example/api/public/",
            "stock_yjbb_em",
            &params,
        )
        .expect("aktools rows url")
        .to_string();
        assert!(rows_url.starts_with("https://aktools.example/api/public/stock_yjbb_em?"));
        assert!(rows_url.contains("date=20251231"));
        assert!(
            aktools_rows_url("https://aktools.example/api/public", "proxy_any", &params).is_err()
        );

        let health_url = health_check_url("https://data.example.com/v1")
            .expect("health url")
            .to_string();
        assert_eq!(health_url, "https://data.example.com/v1/health");

        let finance_url =
            external_aktools_source_test_url("https://aktools.example/api/public", "finance")
                .expect("finance test url")
                .expect("finance url")
                .to_string();
        assert!(finance_url.starts_with("https://aktools.example/api/public/stock_yjbb_em?"));
        assert!(finance_url.contains("date=20251231"));
        assert!(
            external_aktools_source_test_url("https://aktools.example/api/public", "filing")
                .expect("filing unsupported")
                .is_none()
        );

        let mut asharehub_params = HashMap::new();
        asharehub_params.insert("ts_code".to_string(), "000001.SZ".to_string());
        asharehub_params.insert("limit".to_string(), "1".to_string());
        let asharehub_finance_url = asharehub_url(
            "https://asharehub.com",
            "financials/indicators",
            &asharehub_params,
        )
        .expect("asharehub url")
        .to_string();
        assert!(
            asharehub_finance_url.starts_with("https://asharehub.com/v1/financials/indicators?")
        );
        assert!(asharehub_finance_url.contains("ts_code=000001.SZ"));
        let asharehub_v1_url = asharehub_url(
            "https://asharehub.com/v1",
            "/v1/market/daily",
            &asharehub_params,
        )
        .expect("asharehub v1 url")
        .to_string();
        assert!(asharehub_v1_url.starts_with("https://asharehub.com/v1/market/daily?"));
        assert!(asharehub_url("https://asharehub.com", "proxy_any", &asharehub_params).is_err());
    }

    #[test]
    fn source_module_probe_order_is_explicit_and_rejects_unknown_enabled_modules() {
        let modules = HashMap::from([
            ("news".to_string(), false),
            ("finance".to_string(), true),
            ("market".to_string(), true),
            ("filing".to_string(), false),
        ]);
        assert_eq!(
            enabled_source_module_keys(&modules),
            vec!["market", "finance"]
        );

        let with_unknown =
            HashMap::from([("market".to_string(), true), ("unknown".to_string(), true)]);
        assert_eq!(
            first_unknown_enabled_source_module(&with_unknown).as_deref(),
            Some("unknown")
        );
    }

    #[test]
    fn payload_row_count_rejects_invalid_row_container() {
        assert_eq!(payload_row_count(&serde_json::json!([{}, {}])), Ok(2));
        assert_eq!(
            payload_row_count(&serde_json::json!({ "data": [{}] })),
            Ok(1)
        );
        assert!(payload_row_count(&serde_json::json!({ "total": 2 })).is_err());
        assert!(payload_row_count(&serde_json::json!({ "data": { "rows": [] } })).is_err());
    }

    #[tokio::test]
    async fn integration_source_test_rejects_disabled_local_provider() {
        let state = AppState {
            eastmoney: EastmoneyClient::new().expect("eastmoney client"),
            tencent: TencentClient::new().expect("tencent client"),
            gdelt: GdeltClient::new().expect("gdelt client"),
            http: reqwest::Client::new(),
        };
        let response = build_integration_source_test_response(
            &state,
            IntegrationSourceTestRequest {
                provider: "本地模拟数据".to_string(),
                base_url: "local://sample".to_string(),
                api_token: String::new(),
                timeout_seconds: 60,
                modules: HashMap::from([("market".to_string(), true)]),
            },
        )
        .await;

        assert!(!response.ok);
        assert_eq!(response.engine, "rust");
        assert_eq!(response.message, "连接检测失败");
        assert!(response.details.contains("本地模拟数据已停用"));
    }
}
