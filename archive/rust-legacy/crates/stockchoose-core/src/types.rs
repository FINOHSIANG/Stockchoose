use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Factor {
    pub key: String,
    pub name: String,
    pub group: String,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_rank_order")]
    pub default_order: String,
    #[serde(default)]
    pub precision: Option<u8>,
    #[serde(default)]
    pub formula: Option<String>,
}

fn default_rank_order() -> String {
    "desc".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    pub code: String,
    pub name: String,
    pub exchange: String,
    pub board: String,
    pub industry1: String,
    pub industry2: String,
    pub region: String,
    pub property: String,
    #[serde(rename = "isST")]
    #[serde(default)]
    pub is_st: bool,
    #[serde(default)]
    pub is_suspended: bool,
    #[serde(rename = "isSTAR")]
    #[serde(default)]
    pub is_star: bool,
    #[serde(default)]
    pub is_margin: bool,
    #[serde(default)]
    pub indexes: Vec<String>,
    #[serde(default)]
    pub metrics: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockPool {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub pool_type: String,
    #[serde(default)]
    pub codes: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub source_pool_id: Option<String>,
    #[serde(default)]
    pub target_pool_id: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub dynamic_filters: Vec<FilterCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub id: String,
    pub factor_key: String,
    pub operator: String,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub value: Option<f64>,
    #[serde(default = "all_range")]
    pub range: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankCondition {
    pub id: String,
    pub factor_key: String,
    #[serde(default = "default_rank_order")]
    pub order: String,
    #[serde(default = "all_range")]
    pub range: String,
    #[serde(default = "default_rank_weight")]
    pub weight: f64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn all_range() -> String {
    "全部".to_string()
}

fn default_true() -> bool {
    true
}

fn default_rank_weight() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuySellRule {
    pub id: String,
    pub name: String,
    pub factor_key: String,
    pub operator: String,
    pub value: f64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub weight: f64,
    pub start_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrategyConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub description: String,
    pub pool_id: String,
    #[serde(default = "all_pool")]
    pub hot_pool_id: String,
    #[serde(default = "default_pool_limit")]
    pub pool_limit: usize,
    #[serde(default = "default_screen_period")]
    pub screen_period: usize,
    #[serde(default)]
    pub industry_standard: String,
    #[serde(default = "all_range")]
    pub index_member: String,
    #[serde(default = "all_range")]
    pub board: String,
    #[serde(default = "all_range")]
    pub industry1: String,
    #[serde(default = "all_range")]
    pub industry2: String,
    #[serde(default)]
    pub st_mode: String,
    #[serde(default = "all_range")]
    pub exchange: String,
    #[serde(default = "all_range")]
    pub region: String,
    #[serde(default = "all_range")]
    pub property: String,
    #[serde(default = "all_range")]
    pub margin_flag: String,
    #[serde(default)]
    pub star_mode: String,
    #[serde(default)]
    pub filter_suspended: bool,
    #[serde(default)]
    pub filters: Vec<FilterCondition>,
    #[serde(default)]
    pub ranks: Vec<RankCondition>,
    #[serde(default)]
    pub trading: TradingConfig,
    #[serde(default)]
    pub timing: TimingConfig,
    #[serde(default)]
    pub hedge: HedgeConfig,
    #[serde(default)]
    pub assets: Vec<AssetItem>,
}

impl Default for StrategyConfig {
    fn default() -> Self {
        Self {
            id: "strategy-rust-default".to_string(),
            name: "股票策略".to_string(),
            updated_at: None,
            description: String::new(),
            pool_id: "all".to_string(),
            hot_pool_id: all_pool(),
            pool_limit: default_pool_limit(),
            screen_period: default_screen_period(),
            industry_standard: "申万 2021".to_string(),
            index_member: all_range(),
            board: all_range(),
            industry1: all_range(),
            industry2: all_range(),
            st_mode: "排除ST".to_string(),
            exchange: all_range(),
            region: all_range(),
            property: all_range(),
            margin_flag: all_range(),
            star_mode: "排除科创板".to_string(),
            filter_suspended: false,
            filters: Vec::new(),
            ranks: Vec::new(),
            trading: TradingConfig::default(),
            timing: TimingConfig::default(),
            hedge: HedgeConfig::default(),
            assets: Vec::new(),
        }
    }
}

fn all_pool() -> String {
    "all".to_string()
}

fn default_pool_limit() -> usize {
    100
}

fn default_screen_period() -> usize {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradingConfig {
    #[serde(default)]
    pub mode: String,
    #[serde(default = "default_screen_period")]
    pub period: usize,
    #[serde(default)]
    pub order_time: String,
    #[serde(default)]
    pub cash_asset: String,
    #[serde(default)]
    pub realtime_backtest: bool,
    #[serde(default)]
    pub multi_point: bool,
    #[serde(default = "default_max_holdings")]
    pub max_holdings: usize,
    #[serde(default = "default_ideal_position")]
    pub ideal_position: f64,
    #[serde(default)]
    pub position_deviation: f64,
    #[serde(default)]
    pub min_position: f64,
    #[serde(default)]
    pub backup_count: usize,
    #[serde(default = "default_max_buy_position")]
    pub max_buy_position: f64,
    #[serde(default = "equal_weight_method")]
    pub weight_method: String,
    #[serde(default)]
    pub advanced_open: bool,
    #[serde(default)]
    pub trade_date: String,
    #[serde(default)]
    pub sell_suspended: bool,
    #[serde(default)]
    pub short_selling: String,
    #[serde(default)]
    pub industry_limit_ratio: f64,
    #[serde(default)]
    pub position_expression: String,
    #[serde(default)]
    pub industry_neutral_benchmark: String,
    #[serde(default)]
    pub buy_rules: Vec<BuySellRule>,
    #[serde(default)]
    pub sell_rules: Vec<BuySellRule>,
    #[serde(default)]
    pub hold_rules: Vec<BuySellRule>,
}

impl Default for TradingConfig {
    fn default() -> Self {
        Self {
            mode: String::new(),
            period: default_screen_period(),
            order_time: String::new(),
            cash_asset: String::new(),
            realtime_backtest: false,
            multi_point: false,
            max_holdings: default_max_holdings(),
            ideal_position: default_ideal_position(),
            position_deviation: 0.0,
            min_position: 0.0,
            backup_count: 0,
            max_buy_position: default_max_buy_position(),
            weight_method: equal_weight_method(),
            advanced_open: false,
            trade_date: String::new(),
            sell_suspended: false,
            short_selling: String::new(),
            industry_limit_ratio: 0.0,
            position_expression: String::new(),
            industry_neutral_benchmark: String::new(),
            buy_rules: Vec::new(),
            sell_rules: Vec::new(),
            hold_rules: Vec::new(),
        }
    }
}

fn default_max_holdings() -> usize {
    10
}

fn default_ideal_position() -> f64 {
    10.0
}

fn default_max_buy_position() -> f64 {
    100.0
}

fn equal_weight_method() -> String {
    "平权".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimingConfig {
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub template: String,
    #[serde(default)]
    pub index: String,
    #[serde(default)]
    pub threshold: f64,
    #[serde(default)]
    pub formula: String,
    #[serde(default)]
    pub cash_when_timing_out: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HedgeConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub contract: String,
    #[serde(default)]
    pub ratio: f64,
    #[serde(default)]
    pub benchmark: String,
    #[serde(default)]
    pub rebalance: usize,
    #[serde(default)]
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionRow {
    pub stock: Stock,
    pub score: f64,
    pub weight: f64,
    pub passed_filters: usize,
    #[serde(default)]
    pub failed_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankingRow {
    pub stock: Stock,
    pub score: f64,
    pub rank: usize,
    #[serde(default)]
    pub values: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacktestConfig {
    pub start_date: String,
    pub end_date: String,
    pub benchmark: String,
    #[serde(default)]
    pub cost: f64,
    #[serde(default)]
    pub exclude_time_range: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurvePoint {
    pub date: String,
    pub strategy: f64,
    pub benchmark: f64,
    pub hedge: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacktestMetrics {
    pub cumulative_return: f64,
    pub annual_return: f64,
    pub max_drawdown: f64,
    pub sharpe: f64,
    pub volatility: f64,
    pub win_rate: f64,
    pub turnover: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YearlyReturn {
    pub year: String,
    pub strategy: f64,
    pub benchmark: f64,
    pub excess: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacktestTrade {
    pub date: String,
    pub action: String,
    pub code: String,
    pub name: String,
    pub weight: f64,
    pub price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BacktestResult {
    pub rows: Vec<SelectionRow>,
    pub curve: Vec<CurvePoint>,
    pub metrics: BacktestMetrics,
    pub yearly: Vec<YearlyReturn>,
    pub trades: Vec<BacktestTrade>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrategyOptimizationResult {
    pub candidate: StrategyConfig,
    pub result: BacktestResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedOrder {
    pub client_order_id: String,
    pub code: String,
    pub name: String,
    pub side: String,
    pub shares: u64,
    pub price: f64,
    pub amount: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradePlan {
    pub id: String,
    pub strategy_id: String,
    pub strategy_name: String,
    pub account_id: String,
    pub mode: String,
    pub generated_at: String,
    pub orders: Vec<PlannedOrder>,
    pub status: String,
}
