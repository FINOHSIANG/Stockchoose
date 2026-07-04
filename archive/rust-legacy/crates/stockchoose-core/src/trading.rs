use crate::types::{PlannedOrder, SelectionRow, StrategyConfig, TradePlan};
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradeAssetInput {
    pub net_value: Option<f64>,
    pub holding_value: Option<f64>,
    pub strategy_cash: Option<f64>,
    pub outside_asset: Option<f64>,
    #[serde(default)]
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradeAssetState {
    pub net_value: f64,
    pub holding_value: f64,
    pub strategy_cash: f64,
    pub outside_asset: f64,
    #[serde(default)]
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradeAssetSyncResult {
    pub ok: bool,
    pub asset: TradeAssetState,
    pub account_asset: f64,
    pub strategy_asset: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperTradeFill {
    pub id: String,
    pub plan_id: String,
    pub strategy_id: String,
    pub strategy_name: String,
    pub client_order_id: String,
    pub code: String,
    pub name: String,
    pub side: String,
    pub shares: u64,
    pub price: f64,
    pub amount: f64,
    pub filled_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperTradeState {
    #[serde(default)]
    pub plans: Vec<TradePlan>,
    #[serde(default)]
    pub fills: Vec<PaperTradeFill>,
}

impl Default for TradeAssetState {
    fn default() -> Self {
        Self {
            net_value: 1.0,
            holding_value: 320_000.0,
            strategy_cash: 180_000.0,
            outside_asset: 500_000.0,
            last_synced_at: None,
        }
    }
}

fn round(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

fn csv_cell(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn trade_client_stock_code(code: &str) -> String {
    let digits = code
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.len() >= 6 {
        digits[digits.len() - 6..].to_string()
    } else {
        code.to_string()
    }
}

fn normalized_asset_number(value: Option<f64>, fallback: f64, precision: i32) -> f64 {
    value
        .filter(|item| item.is_finite() && *item >= 0.0)
        .map(|item| round(item, precision))
        .unwrap_or(fallback)
}

pub fn sync_trade_assets(input: &TradeAssetInput) -> TradeAssetSyncResult {
    let defaults = TradeAssetState::default();
    let asset = TradeAssetState {
        net_value: normalized_asset_number(input.net_value, defaults.net_value, 4),
        holding_value: normalized_asset_number(input.holding_value, defaults.holding_value, 2),
        strategy_cash: normalized_asset_number(input.strategy_cash, defaults.strategy_cash, 2),
        outside_asset: normalized_asset_number(input.outside_asset, defaults.outside_asset, 2),
        last_synced_at: Some(Utc::now().to_rfc3339()),
    };
    let strategy_asset = round(asset.holding_value + asset.strategy_cash, 2);
    let account_asset = round(strategy_asset + asset.outside_asset, 2);
    TradeAssetSyncResult {
        ok: true,
        asset,
        account_asset,
        strategy_asset,
        message: "资产已由 Rust 交易接口同步".to_string(),
    }
}

pub fn submit_paper_trade_plan(state: &PaperTradeState, plan: &TradePlan) -> PaperTradeState {
    let submitted_at = Utc::now().to_rfc3339();
    let mut submitted_plan = plan.clone();
    submitted_plan.status = "filled".to_string();
    submitted_plan.orders = submitted_plan
        .orders
        .into_iter()
        .map(|mut order| {
            order.status = "已成交".to_string();
            order
        })
        .collect();

    let new_fills = submitted_plan.orders.iter().map(|order| PaperTradeFill {
        id: format!("fill-{}", order.client_order_id),
        plan_id: submitted_plan.id.clone(),
        strategy_id: submitted_plan.strategy_id.clone(),
        strategy_name: submitted_plan.strategy_name.clone(),
        client_order_id: order.client_order_id.clone(),
        code: order.code.clone(),
        name: order.name.clone(),
        side: order.side.clone(),
        shares: order.shares,
        price: order.price,
        amount: order.amount,
        filled_at: submitted_at.clone(),
    });

    let plans = std::iter::once(submitted_plan.clone())
        .chain(
            state
                .plans
                .iter()
                .filter(|item| item.id != submitted_plan.id)
                .cloned(),
        )
        .take(30)
        .collect();
    let fills = new_fills
        .chain(state.fills.iter().cloned())
        .take(200)
        .collect();

    PaperTradeState { plans, fills }
}

pub fn create_trade_plan(
    strategy: &StrategyConfig,
    rows: &[SelectionRow],
    mode: &str,
    account_id: &str,
    account_asset: f64,
) -> TradePlan {
    let generated_at = Utc::now().to_rfc3339();
    let selected_len = rows.len().min(strategy.trading.max_holdings.max(1));
    let orders = rows
        .iter()
        .take(selected_len)
        .enumerate()
        .map(|(index, row)| {
            let price = row
                .stock
                .metrics
                .get("price")
                .copied()
                .unwrap_or(1.0)
                .max(1.0);
            let target_amount = account_asset * row.weight.max(1.0) / 100.0;
            let shares = ((target_amount / price / 100.0).floor() as u64).max(1) * 100;
            let amount = round(price * shares as f64, 2);
            PlannedOrder {
                client_order_id: format!(
                    "{}-{}-{}-{}",
                    strategy.id, generated_at, index, row.stock.code
                ),
                code: row.stock.code.clone(),
                name: row.stock.name.clone(),
                side: "买入".to_string(),
                shares,
                price: round(price, 3),
                amount,
                status: "待确认".to_string(),
            }
        })
        .collect();

    TradePlan {
        id: format!("plan-{}", Utc::now().timestamp_millis()),
        strategy_id: strategy.id.clone(),
        strategy_name: strategy.name.clone(),
        account_id: account_id.to_string(),
        mode: mode.to_string(),
        generated_at,
        orders,
        status: "draft".to_string(),
    }
}

pub fn trade_plan_to_client_text(plan: &TradePlan) -> String {
    plan.orders
        .iter()
        .map(|order| {
            format!(
                "{}\t{}\t{:.3}\t{}",
                trade_client_stock_code(&order.code),
                order.side,
                order.price,
                order.shares
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn trade_plan_to_csv(plan: &TradePlan) -> String {
    let header = [
        "指令编号",
        "策略",
        "资金账号",
        "模式",
        "股票代码",
        "股票名称",
        "方向",
        "数量",
        "参考价",
        "参考金额",
        "状态",
    ];
    let mut rows = vec![header
        .iter()
        .map(|value| csv_cell(value))
        .collect::<Vec<_>>()
        .join(",")];
    rows.extend(plan.orders.iter().map(|order| {
        [
            order.client_order_id.clone(),
            plan.strategy_name.clone(),
            plan.account_id.clone(),
            if plan.mode == "manual" {
                "手动".to_string()
            } else {
                "自动".to_string()
            },
            order.code.clone(),
            order.name.clone(),
            order.side.clone(),
            order.shares.to_string(),
            order.price.to_string(),
            order.amount.to_string(),
            order.status.clone(),
        ]
        .iter()
        .map(|value| csv_cell(value))
        .collect::<Vec<_>>()
        .join(",")
    }));
    rows.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TradePlan;

    #[test]
    fn client_text_uses_six_digit_stock_codes() {
        let plan = TradePlan {
            id: "plan".to_string(),
            strategy_id: "strategy".to_string(),
            strategy_name: "Strategy".to_string(),
            account_id: "PAPER-0001".to_string(),
            mode: "manual".to_string(),
            generated_at: "2026-06-09T00:00:00Z".to_string(),
            orders: vec![PlannedOrder {
                client_order_id: "order".to_string(),
                code: "SH600519".to_string(),
                name: "Kweichow Moutai".to_string(),
                side: "买入".to_string(),
                shares: 100,
                price: 1688.888,
                amount: 168888.8,
                status: "待确认".to_string(),
            }],
            status: "draft".to_string(),
        };

        assert_eq!(
            trade_plan_to_client_text(&plan),
            "600519\t买入\t1688.888\t100"
        );
    }

    #[test]
    fn sync_trade_assets_normalizes_manual_inputs() {
        let result = sync_trade_assets(&TradeAssetInput {
            net_value: Some(1.23456),
            holding_value: Some(-1.0),
            strategy_cash: Some(88_888.889),
            outside_asset: Some(12_345.678),
            last_synced_at: None,
        });

        assert!(result.ok);
        assert_eq!(result.asset.net_value, 1.2346);
        assert_eq!(
            result.asset.holding_value,
            TradeAssetState::default().holding_value
        );
        assert_eq!(result.asset.strategy_cash, 88_888.89);
        assert_eq!(result.asset.outside_asset, 12_345.68);
        assert_eq!(result.strategy_asset, 408_888.89);
        assert_eq!(result.account_asset, 421_234.57);
        assert!(result.asset.last_synced_at.is_some());
    }

    #[test]
    fn submit_paper_trade_plan_marks_fills_and_caps_history() {
        let plan = TradePlan {
            id: "plan-auto".to_string(),
            strategy_id: "strategy".to_string(),
            strategy_name: "Strategy".to_string(),
            account_id: "PAPER-0001".to_string(),
            mode: "auto".to_string(),
            generated_at: "2026-06-09T00:00:00Z".to_string(),
            orders: vec![PlannedOrder {
                client_order_id: "order-1".to_string(),
                code: "SH600519".to_string(),
                name: "Kweichow Moutai".to_string(),
                side: "买入".to_string(),
                shares: 100,
                price: 1688.888,
                amount: 168888.8,
                status: "待确认".to_string(),
            }],
            status: "draft".to_string(),
        };
        let state = PaperTradeState {
            plans: (0..35)
                .map(|index| TradePlan {
                    id: format!("old-plan-{index}"),
                    ..plan.clone()
                })
                .collect(),
            fills: (0..205)
                .map(|index| PaperTradeFill {
                    id: format!("old-fill-{index}"),
                    plan_id: "old-plan".to_string(),
                    strategy_id: "strategy".to_string(),
                    strategy_name: "Strategy".to_string(),
                    client_order_id: format!("old-order-{index}"),
                    code: "SH600519".to_string(),
                    name: "Kweichow Moutai".to_string(),
                    side: "买入".to_string(),
                    shares: 100,
                    price: 1688.888,
                    amount: 168888.8,
                    filled_at: "2026-06-09T00:00:00Z".to_string(),
                })
                .collect(),
        };

        let next = submit_paper_trade_plan(&state, &plan);

        assert_eq!(next.plans.len(), 30);
        assert_eq!(next.plans[0].id, "plan-auto");
        assert_eq!(next.plans[0].status, "filled");
        assert_eq!(next.plans[0].orders[0].status, "已成交");
        assert_eq!(next.fills.len(), 200);
        assert_eq!(next.fills[0].plan_id, "plan-auto");
        assert_eq!(next.fills[0].strategy_id, "strategy");
        assert!(next.fills[0].filled_at.contains('T'));
    }
}
