use crate::types::Stock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValuationFilters {
    pub board: String,
    pub industry: String,
    pub state: String,
    pub ownership: String,
    pub style: String,
    #[serde(default)]
    pub min_safety_margin: f64,
    #[serde(default)]
    pub min_governance_score: f64,
    #[serde(default = "default_display_limit")]
    pub display_limit: usize,
}

fn default_display_limit() -> usize {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndustryValuationProfile {
    pub industry: String,
    pub model: String,
    pub earnings_weight: f64,
    pub asset_weight: f64,
    pub sales_weight: f64,
    pub cashflow_weight: f64,
    pub target_pe: f64,
    pub target_pb: f64,
    pub target_ps: f64,
    pub cashflow_multiple: f64,
    pub discount_rate: f64,
    pub terminal_growth: f64,
    pub risk_buffer: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndustryCashflowPolicy {
    pub required_coverage: f64,
    pub strong_coverage: f64,
    pub floor_modifier: f64,
    pub ceiling_modifier: f64,
    pub penalty_weight: f64,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSheetBreakdown {
    pub total_assets: f64,
    pub production_assets: f64,
    pub investment_assets: f64,
    pub total_liabilities: f64,
    pub interest_bearing_debt: f64,
    pub non_interest_bearing_debt: f64,
    pub non_interest_debt_reserve_rate: f64,
    pub net_investment_assets: f64,
    pub investment_asset_per_share: f64,
    pub net_investment_asset_per_share: f64,
    pub interest_debt_ratio: f64,
    pub non_interest_debt_ratio: f64,
    pub production_asset_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValuationFormulaRow {
    pub name: String,
    pub formula: String,
    pub substitution: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValuationComponents {
    pub earnings_value: f64,
    pub asset_value: f64,
    pub sales_value: f64,
    pub cashflow_value: f64,
    pub anchor_value: f64,
    pub weighted_value: f64,
    pub cash_coverage: f64,
    pub cashflow_requirement_modifier: f64,
    pub cashflow_policy: IndustryCashflowPolicy,
    pub balance_sheet: BalanceSheetBreakdown,
    pub formula_rows: Vec<ValuationFormulaRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValuationRow {
    pub stock: Stock,
    pub profile: IndustryValuationProfile,
    pub state: String,
    pub model: String,
    pub fair_value: f64,
    pub bear_value: f64,
    pub bull_value: f64,
    pub current_price: f64,
    pub market_cap: f64,
    pub safety_margin: f64,
    pub upside: f64,
    pub verdict: String,
    pub action: String,
    pub position_hint: String,
    pub quality_score: f64,
    pub growth_score: f64,
    pub solvency_score: f64,
    pub governance_score: f64,
    pub industry_fit_score: f64,
    pub status_modifier: f64,
    pub governance_modifier: f64,
    pub financial_modifier: f64,
    pub risk_discount: f64,
    pub anchor_value: f64,
    pub drivers: Vec<String>,
    pub warnings: Vec<String>,
    pub components: ValuationComponents,
}

fn round(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn metric(stock: &Stock, key: &str) -> f64 {
    stock.metrics.get(key).copied().unwrap_or(0.0)
}

fn positive(value: f64) -> f64 {
    value.max(0.0)
}

fn is_all(value: &str) -> bool {
    value.is_empty() || value == "全部"
}

fn profile_for(industry: &str) -> IndustryValuationProfile {
    let mut profile = IndustryValuationProfile {
        industry: if industry.is_empty() {
            "通用行业".to_string()
        } else {
            industry.to_string()
        },
        model: "PE盈利".to_string(),
        earnings_weight: 0.45,
        asset_weight: 0.20,
        sales_weight: 0.15,
        cashflow_weight: 0.20,
        target_pe: 22.0,
        target_pb: 2.2,
        target_ps: 2.4,
        cashflow_multiple: 16.0,
        discount_rate: 9.5,
        terminal_growth: 2.2,
        risk_buffer: 12.0,
    };

    match industry {
        "银行" => {
            profile.model = "PB-ROE".to_string();
            profile.target_pe = 7.0;
            profile.target_pb = 0.9;
            profile.target_ps = 1.0;
            profile.cashflow_multiple = 8.0;
            profile.risk_buffer = 14.0;
            profile.asset_weight = 0.65;
        }
        "非银金融" => {
            profile.model = "PB-ROE".to_string();
            profile.target_pe = 13.0;
            profile.target_pb = 1.3;
            profile.target_ps = 1.4;
            profile.cashflow_multiple = 10.0;
            profile.risk_buffer = 18.0;
            profile.asset_weight = 0.50;
        }
        "食品饮料" | "医药生物" | "家用电器" => {
            profile.model = "DCF现金流".to_string();
            profile.target_pe = if industry == "食品饮料" {
                28.0
            } else {
                24.0
            };
            profile.target_pb = if industry == "食品饮料" { 5.5 } else { 3.6 };
            profile.target_ps = if industry == "食品饮料" { 6.0 } else { 3.2 };
            profile.cashflow_multiple = 22.0;
            profile.risk_buffer = if industry == "食品饮料" {
                10.0
            } else {
                16.0
            };
        }
        "电力设备" | "汽车" | "电子" | "计算机" | "通信" => {
            profile.model = "PS成长".to_string();
            profile.target_pe = 30.0;
            profile.target_pb = 3.8;
            profile.target_ps = 3.5;
            profile.cashflow_multiple = 20.0;
            profile.risk_buffer = 22.0;
            profile.sales_weight = 0.35;
        }
        "煤炭" | "石油石化" | "公用事业" => {
            profile.model = "股息资产".to_string();
            profile.target_pe = 11.0;
            profile.target_pb = 1.2;
            profile.target_ps = 1.0;
            profile.cashflow_multiple = 8.0;
            profile.risk_buffer = 20.0;
            profile.asset_weight = 0.30;
        }
        "房地产" => {
            profile.model = "PB-ROE".to_string();
            profile.target_pe = 8.0;
            profile.target_pb = 0.75;
            profile.target_ps = 0.6;
            profile.cashflow_multiple = 6.0;
            profile.risk_buffer = 30.0;
            profile.asset_weight = 0.62;
        }
        _ => {}
    }
    profile
}

fn style_adjust(mut profile: IndustryValuationProfile, style: &str) -> IndustryValuationProfile {
    match style {
        "保守核算" => {
            profile.target_pe *= 0.68;
            profile.target_pb *= 0.72;
            profile.target_ps *= 0.62;
            profile.cashflow_multiple *= 0.68;
            profile.risk_buffer += 16.0;
        }
        "均衡核算" => {
            profile.target_pe *= 0.76;
            profile.target_pb *= 0.78;
            profile.target_ps *= 0.70;
            profile.cashflow_multiple *= 0.74;
            profile.risk_buffer += 12.0;
        }
        "成长核算" => {
            profile.target_pe *= 0.82;
            profile.target_pb *= 0.76;
            profile.target_ps *= 0.78;
            profile.cashflow_multiple *= 0.76;
            profile.sales_weight += 0.08;
            profile.risk_buffer += 10.0;
        }
        "资产核算" => {
            profile.target_pe *= 0.70;
            profile.target_pb *= 0.72;
            profile.target_ps *= 0.60;
            profile.cashflow_multiple *= 0.68;
            profile.asset_weight += 0.14;
            profile.risk_buffer += 14.0;
        }
        _ => {
            profile.target_pe *= 0.58;
            profile.target_pb *= 0.62;
            profile.target_ps *= 0.50;
            profile.cashflow_multiple *= 0.55;
            profile.risk_buffer += 22.0;
        }
    }
    profile
}

fn cashflow_policy(industry: &str) -> IndustryCashflowPolicy {
    let required = match industry {
        "食品饮料" | "公用事业" | "煤炭" | "石油石化" => 1.10,
        "房地产" => 1.30,
        "银行" | "非银金融" => 0.45,
        "电子" | "电力设备" | "汽车" | "计算机" => 0.75,
        _ => 0.90,
    };
    IndustryCashflowPolicy {
        required_coverage: required,
        strong_coverage: required + 0.30,
        floor_modifier: if industry == "房地产" { 0.18 } else { 0.30 },
        ceiling_modifier: if industry == "房地产" { 0.58 } else { 0.76 },
        penalty_weight: if industry == "房地产" { 0.30 } else { 0.22 },
        note: format!("{industry}按真实经营现金流覆盖净利润进行折扣，现金流不足时不使用样本兜底"),
    }
}

fn strict_caps(industry: &str) -> (f64, f64, f64, f64) {
    match industry {
        "银行" => (5.8, 0.75, 0.70, 6.0),
        "非银金融" => (9.0, 0.95, 0.80, 7.0),
        "食品饮料" => (18.0, 3.0, 2.8, 15.0),
        "医药生物" => (18.0, 2.2, 1.8, 12.0),
        "电子" | "计算机" | "通信" => (18.0, 2.1, 1.7, 11.0),
        "房地产" => (5.5, 0.50, 0.35, 4.0),
        "煤炭" | "石油石化" => (8.0, 0.95, 0.65, 6.0),
        _ => (12.0, 1.2, 0.75, 8.0),
    }
}

fn infer_state(stock: &Stock) -> String {
    if metric(stock, "revenueGrowth") > 35.0
        && metric(stock, "momentum60") > 18.0
        && metric(stock, "qualityScore") > 58.0
    {
        return "高速成长".to_string();
    }
    if metric(stock, "debtRatio") > 72.0 || metric(stock, "violationScore") > 60.0 || stock.is_st {
        return "困境承压".to_string();
    }
    if metric(stock, "dividendYield") > 3.2
        && ["银行", "煤炭", "公用事业", "石油石化"].contains(&stock.industry1.as_str())
    {
        return "资产防御".to_string();
    }
    if metric(stock, "profitGrowth") > 18.0
        && metric(stock, "revenueGrowth") > 8.0
        && metric(stock, "pb") < 2.2
    {
        return "周期修复".to_string();
    }
    "稳定成熟".to_string()
}

fn governance_score(stock: &Stock) -> f64 {
    let pledge_penalty = metric(stock, "pledgeRatio") * 0.65;
    let violation_penalty = metric(stock, "violationScore") * 0.75;
    let insider_bonus = (metric(stock, "insiderHolding") * 0.55).min(14.0);
    let fund_bonus = (metric(stock, "fundHolding") * 0.35).min(12.0);
    let ownership_bonus = if stock.property == "国企" {
        5.0
    } else if stock.property == "外资" {
        4.0
    } else {
        0.0
    };
    clamp(
        78.0 - pledge_penalty - violation_penalty + insider_bonus + fund_bonus + ownership_bonus,
        0.0,
        100.0,
    )
}

fn status_modifier(state: &str) -> f64 {
    match state {
        "稳定成熟" => 0.94,
        "高速成长" => 0.90,
        "资产防御" => 0.88,
        "周期修复" => 0.82,
        _ => 0.55,
    }
}

fn balance_sheet(stock: &Stock, share_base: f64, bps: f64) -> BalanceSheetBreakdown {
    let total_assets = positive(metric(stock, "totalAssets")).max(positive(bps) * share_base);
    let total_liabilities = positive(metric(stock, "totalLiabilities"))
        .max(total_assets * positive(metric(stock, "debtRatio")) / 100.0)
        .min(total_assets);
    let interest_bearing_debt = positive(metric(stock, "interestBearingDebt"))
        .max(total_liabilities * 0.42)
        .min(total_liabilities);
    let non_interest_bearing_debt = positive(metric(stock, "nonInterestBearingDebt"))
        .max((total_liabilities - interest_bearing_debt).max(0.0))
        .min(total_liabilities);
    let investment_assets = positive(metric(stock, "investmentAssets"))
        .max(total_assets * 0.14)
        .min(total_assets);
    let production_assets = positive(metric(stock, "productionAssets"))
        .max((total_assets - investment_assets).max(0.0))
        .min(total_assets);
    let reserve_rate = 0.35;
    let net_investment_assets =
        (investment_assets - interest_bearing_debt - non_interest_bearing_debt * reserve_rate)
            .max(0.0);

    BalanceSheetBreakdown {
        total_assets: round(total_assets, 2),
        production_assets: round(production_assets, 2),
        investment_assets: round(investment_assets, 2),
        total_liabilities: round(total_liabilities, 2),
        interest_bearing_debt: round(interest_bearing_debt, 2),
        non_interest_bearing_debt: round(non_interest_bearing_debt, 2),
        non_interest_debt_reserve_rate: reserve_rate,
        net_investment_assets: round(net_investment_assets, 2),
        investment_asset_per_share: round(investment_assets / share_base, 2),
        net_investment_asset_per_share: round(net_investment_assets / share_base, 2),
        interest_debt_ratio: round(
            if total_assets > 0.0 {
                interest_bearing_debt / total_assets * 100.0
            } else {
                0.0
            },
            2,
        ),
        non_interest_debt_ratio: round(
            if total_assets > 0.0 {
                non_interest_bearing_debt / total_assets * 100.0
            } else {
                0.0
            },
            2,
        ),
        production_asset_ratio: round(
            if total_assets > 0.0 {
                production_assets / total_assets * 100.0
            } else {
                0.0
            },
            2,
        ),
    }
}

fn verdict_for_margin(margin: f64) -> String {
    if margin >= 60.0 {
        "深度低估"
    } else if margin >= 35.0 {
        "低估"
    } else if margin >= 10.0 {
        "合理"
    } else if margin >= -15.0 {
        "偏高"
    } else {
        "高估"
    }
    .to_string()
}

fn action_for(safety_margin: f64, governance_score: f64, state: &str) -> String {
    if governance_score < 45.0 || state == "困境承压" {
        "仅观察，等待治理/现金流拐点".to_string()
    } else if safety_margin >= 60.0 {
        "满足严苛安全边际，可小仓分批验证".to_string()
    } else if safety_margin >= 35.0 {
        "进入候选池，等待价格回撤或业绩确认".to_string()
    } else if safety_margin >= 10.0 {
        "接近严苛价值，仅跟踪不追价".to_string()
    } else {
        "未满足严苛口径，暂不配置".to_string()
    }
}

fn position_hint_for(safety_margin: f64, governance_score: f64, state: &str) -> String {
    if governance_score < 45.0 || state == "困境承压" {
        "0-2%"
    } else if safety_margin >= 60.0 {
        "5-8%"
    } else if safety_margin >= 35.0 {
        "3-5%"
    } else if safety_margin >= 10.0 {
        "1-3%"
    } else {
        "0%"
    }
    .to_string()
}

pub fn missing_real_valuation_fields(stock: &Stock) -> Vec<String> {
    [
        ("price", "现价", true),
        ("marketCap", "市值", true),
        ("eps", "每股收益EPS", false),
        ("bps", "每股净资产BPS", false),
        ("revenue", "营业收入", false),
        ("netProfit", "净利润", false),
        ("operatingCashflow", "经营现金流", false),
        ("totalAssets", "总资产", true),
        ("totalLiabilities", "总负债", false),
        ("investmentAssets", "投资性资产", false),
        ("productionAssets", "生产性资产", false),
        ("interestBearingDebt", "有息负债", false),
        ("nonInterestBearingDebt", "无息负债", false),
    ]
    .into_iter()
    .filter_map(|(key, label, positive_required)| {
        let value = stock.metrics.get(key).copied();
        if !value.is_some_and(f64::is_finite) || (positive_required && value.unwrap_or(0.0) <= 0.0)
        {
            Some(label.to_string())
        } else {
            None
        }
    })
    .collect()
}

fn has_required_real_valuation_data(stock: &Stock) -> bool {
    missing_real_valuation_fields(stock).is_empty()
}

pub fn calculate_valuation(stock: &Stock, style: &str) -> ValuationRow {
    let raw_profile = profile_for(&stock.industry1);
    let profile = style_adjust(raw_profile, style);
    let price = metric(stock, "price").max(0.01);
    let market_cap = metric(stock, "marketCap").max(0.0);
    let share_base = (market_cap / price).max(0.01);
    let eps = metric(stock, "eps");
    let bps = if metric(stock, "bps") != 0.0 {
        metric(stock, "bps")
    } else {
        price / metric(stock, "pb").max(0.1)
    };
    let policy = cashflow_policy(&stock.industry1);
    let bs = balance_sheet(stock, share_base, bps);
    let revenue_per_share = positive(metric(stock, "revenue")) / share_base;
    let cashflow_per_share = metric(stock, "operatingCashflow") / share_base;
    let quality_score = clamp(metric(stock, "qualityScore").max(50.0), 0.0, 100.0);
    let growth_score = clamp(
        metric(stock, "revenueGrowth") * 0.45
            + metric(stock, "profitGrowth") * 0.35
            + metric(stock, "epsForecastGrowth") * 0.20
            + 30.0,
        0.0,
        100.0,
    );
    let solvency_score = clamp(
        108.0 - bs.interest_debt_ratio * 0.9 - bs.non_interest_debt_ratio * 0.25
            + metric(stock, "currentRatio").max(1.0) * 7.0,
        0.0,
        100.0,
    );
    let governance = governance_score(stock);
    let industry_fit = clamp(
        metric(stock, "industryMomentum").max(50.0) * 0.55
            + metric(stock, "ratingScore").max(2.5) * 7.0
            + metric(stock, "fundHolding") * 0.35,
        0.0,
        100.0,
    );
    let state = infer_state(stock);
    let (cap_pe, cap_pb, cap_ps, cap_cashflow) = strict_caps(&stock.industry1);
    let strict_pe = clamp(profile.target_pe.min(cap_pe), 2.5, cap_pe);
    let strict_pb = clamp(profile.target_pb.min(cap_pb), 0.25, cap_pb);
    let strict_ps = clamp(profile.target_ps.min(cap_ps), 0.05, cap_ps);
    let strict_cashflow_multiple = clamp(
        profile.cashflow_multiple.min(cap_cashflow),
        2.0,
        cap_cashflow,
    );
    let profit_growth = metric(stock, "profitGrowth");
    let eps_stability_modifier = clamp(
        0.55 + quality_score.min(85.0) / 360.0 + clamp(profit_growth, -40.0, 35.0) / 420.0,
        0.42,
        0.86,
    );
    let cash_coverage = if positive(metric(stock, "netProfit")) > 0.0 {
        metric(stock, "operatingCashflow") / metric(stock, "netProfit").max(0.01)
    } else if positive(metric(stock, "operatingCashflow")) > 0.0 {
        0.45
    } else {
        0.0
    };
    let cashflow_requirement_modifier =
        clamp(cash_coverage / policy.required_coverage.max(0.01), 0.0, 1.0);
    let cash_conversion_modifier = clamp(
        policy.floor_modifier
            + clamp(
                (cash_coverage - policy.required_coverage * 0.45)
                    / (policy.strong_coverage - policy.required_coverage * 0.45).max(0.01),
                0.0,
                1.0,
            ) * (policy.ceiling_modifier - policy.floor_modifier),
        policy.floor_modifier,
        policy.ceiling_modifier,
    );
    let margin_modifier = clamp(metric(stock, "netMargin") / 24.0, 0.08, 0.72);
    let solvency_modifier = clamp(0.48 + solvency_score / 240.0, 0.48, 0.86);
    let governance_modifier = clamp(0.50 + governance / 260.0, 0.50, 0.88);
    let state_modifier = status_modifier(&state);
    let financial_modifier = clamp(
        1.0 - clamp((metric(stock, "debtRatio") - 68.0) / 200.0, 0.0, 0.12)
            - if cash_coverage < policy.required_coverage {
                clamp(
                    (policy.required_coverage - cash_coverage) * policy.penalty_weight,
                    0.0,
                    0.24,
                )
            } else {
                0.0
            }
            - if state == "困境承压" { 0.18 } else { 0.0 },
        0.32,
        0.88,
    );
    let board_penalty = if stock.board == "科创板" || stock.board == "创业板" {
        5.0
    } else if stock.board == "北交所" {
        8.0
    } else {
        0.0
    };
    let liquidity_penalty = if stock.is_margin { 0.0 } else { 4.0 };
    let size_penalty = if market_cap < 80.0 {
        6.0
    } else if market_cap < 200.0 {
        3.0
    } else {
        0.0
    };
    let risk_discount = clamp(
        1.0 - (profile.risk_buffer + board_penalty + liquidity_penalty + size_penalty) / 100.0,
        0.38,
        0.78,
    );

    let earnings_value = positive(eps) * eps_stability_modifier * strict_pe;
    let investment_asset_recovery_rate = clamp(strict_pb.min(0.68), 0.08, 0.74);
    let asset_value =
        bs.net_investment_asset_per_share * investment_asset_recovery_rate * solvency_modifier;
    let sales_value =
        revenue_per_share * strict_ps * margin_modifier * cash_conversion_modifier * 0.72;
    let raw_owner_cashflow_per_share = if cashflow_per_share > 0.0 {
        if positive(eps) > 0.0 {
            cashflow_per_share.min(positive(eps) * 1.05)
        } else {
            cashflow_per_share * 0.35
        }
    } else {
        0.0
    };
    let cashflow_value = raw_owner_cashflow_per_share
        * cashflow_requirement_modifier
        * strict_cashflow_multiple
        * cash_conversion_modifier;
    let mut model_outputs = [
        ("盈利底线", earnings_value),
        ("资产折算", asset_value),
        ("收入折价", sales_value),
        ("现金流底线", cashflow_value),
    ]
    .into_iter()
    .filter(|(_, value)| *value > 0.01)
    .collect::<Vec<_>>();
    model_outputs.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let lowest = model_outputs
        .first()
        .copied()
        .unwrap_or(("最低可用值", 0.01));
    let second = model_outputs.get(1).copied().unwrap_or(lowest);
    let anchor = lowest.1 * 0.70 + second.1 * 0.30;
    let fair_value = round(
        (anchor * governance_modifier * state_modifier * financial_modifier * risk_discount)
            .max(0.01),
        2,
    );
    let safety_margin = round(((fair_value - price) / price) * 100.0, 2);
    let verdict = verdict_for_margin(safety_margin);
    let action = action_for(safety_margin, governance, &state);
    let position_hint = position_hint_for(safety_margin, governance, &state);

    let warnings = [
        (eps <= 0.0).then_some("EPS为负或缺失，盈利模型按0处理".to_string()),
        (cashflow_per_share <= 0.0)
            .then_some("经营现金流为负或缺失，现金流模型按0处理".to_string()),
        (cash_coverage < policy.required_coverage).then_some(format!(
            "现金流覆盖低于{}门槛，{}% < {}%",
            stock.industry1,
            round(cash_coverage * 100.0, 1),
            round(policy.required_coverage * 100.0, 0)
        )),
        (bs.net_investment_assets <= 0.0)
            .then_some("投资性资产扣除有息负债与无息负债预留后为0，资产模型按0处理".to_string()),
        (governance < 45.0).then_some(format!("治理分低于严苛门槛：{}", round(governance, 1))),
        (safety_margin < 0.0).then_some("当前价格高于核算价值".to_string()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    ValuationRow {
        stock: stock.clone(),
        profile: profile.clone(),
        state: state.clone(),
        model: profile.model.clone(),
        fair_value,
        bear_value: round(fair_value * 0.72, 2),
        bull_value: round(fair_value * (1.05 + growth_score.min(60.0).max(0.0) / 1000.0), 2),
        current_price: round(price, 2),
        market_cap: round(market_cap, 2),
        safety_margin,
        upside: safety_margin,
        verdict,
        action,
        position_hint,
        quality_score: round(quality_score, 1),
        growth_score: round(growth_score, 1),
        solvency_score: round(solvency_score, 1),
        governance_score: round(governance, 1),
        industry_fit_score: round(industry_fit, 1),
        status_modifier: round(state_modifier, 2),
        governance_modifier: round(governance_modifier, 2),
        financial_modifier: round(financial_modifier, 2),
        risk_discount: round(risk_discount, 2),
        anchor_value: round(anchor, 2),
        drivers: vec![
            format!("{}采用严苛{}参考模型，目标倍数按行业上限压低", stock.industry1, profile.model),
            format!(
                "低位锚定：{}{} 与 {}{} 参与合成",
                lowest.0,
                round(lowest.1, 2),
                second.0,
                round(second.1, 2)
            ),
            format!(
                "现金流门槛：经营现金流/净利润要求不低于{}%",
                round(policy.required_coverage * 100.0, 0)
            ),
            format!(
                "资产模型只纳入投资性资产：投资性资产{}亿，生产性资产{}亿不列入资产价值",
                bs.investment_assets, bs.production_assets
            ),
        ],
        warnings,
        components: ValuationComponents {
            earnings_value: round(earnings_value, 2),
            asset_value: round(asset_value, 2),
            sales_value: round(sales_value, 2),
            cashflow_value: round(cashflow_value, 2),
            anchor_value: round(anchor, 2),
            weighted_value: round(anchor, 2),
            cash_coverage: round(cash_coverage, 4),
            cashflow_requirement_modifier: round(cashflow_requirement_modifier, 2),
            cashflow_policy: policy.clone(),
            balance_sheet: bs.clone(),
            formula_rows: vec![
                ValuationFormulaRow {
                    name: "盈利底线".to_string(),
                    formula: "max(EPS, 0) × 盈利稳定折扣 × min(目标PE, 行业PE上限)"
                        .to_string(),
                    substitution: format!(
                        "{} × {} × {}",
                        round(positive(eps), 2),
                        round(eps_stability_modifier, 2),
                        round(strict_pe, 2)
                    ),
                    value: round(earnings_value, 2),
                },
                ValuationFormulaRow {
                    name: "投资资产折算".to_string(),
                    formula:
                        "max(投资性资产 - 有息负债 - 无息负债×预留比例, 0) / 股本 × 投资资产回收率 × 偿债折扣；生产性资产不计入"
                            .to_string(),
                    substitution: format!(
                        "{} / {} × {} × {}",
                        round(bs.net_investment_assets, 2),
                        round(share_base, 2),
                        round(investment_asset_recovery_rate, 2),
                        round(solvency_modifier, 2)
                    ),
                    value: round(asset_value, 2),
                },
                ValuationFormulaRow {
                    name: "收入折价".to_string(),
                    formula:
                        "单股收入 × min(目标PS, 行业PS上限) × 净利率折扣 × 现金含量折扣 × 0.72"
                            .to_string(),
                    substitution: format!(
                        "{} × {} × {} × {} × 0.72",
                        round(revenue_per_share, 2),
                        round(strict_ps, 2),
                        round(margin_modifier, 2),
                        round(cash_conversion_modifier, 2)
                    ),
                    value: round(sales_value, 2),
                },
                ValuationFormulaRow {
                    name: "现金流底线".to_string(),
                    formula:
                        "min(单股经营现金流, EPS×1.05) × 行业现金流门槛折扣 × 现金流倍数上限 × 现金含量折扣"
                            .to_string(),
                    substitution: format!(
                        "{} × {} × {} × {}",
                        round(raw_owner_cashflow_per_share, 2),
                        round(cashflow_requirement_modifier, 2),
                        round(strict_cashflow_multiple, 2),
                        round(cash_conversion_modifier, 2)
                    ),
                    value: round(cashflow_value, 2),
                },
                ValuationFormulaRow {
                    name: "严苛锚定".to_string(),
                    formula: "最低可用模型值 × 70% + 次低可用模型值 × 30%".to_string(),
                    substitution: format!(
                        "{}{} × 0.70 + {}{} × 0.30",
                        lowest.0,
                        round(lowest.1, 2),
                        second.0,
                        round(second.1, 2)
                    ),
                    value: round(anchor, 2),
                },
                ValuationFormulaRow {
                    name: "核算价值".to_string(),
                    formula: "严苛锚定 × 治理折扣 × 状态折扣 × 财务扣减 × 风险折扣"
                        .to_string(),
                    substitution: format!(
                        "{} × {} × {} × {} × {}",
                        round(anchor, 2),
                        round(governance_modifier, 2),
                        round(state_modifier, 2),
                        round(financial_modifier, 2),
                        round(risk_discount, 2)
                    ),
                    value: fair_value,
                },
            ],
        },
    }
}

fn matches_board(stock: &Stock, board: &str) -> bool {
    if is_all(board) {
        return true;
    }
    if board == "A股" {
        return ["沪市", "深市", "北交所"].contains(&stock.exchange.as_str());
    }
    stock.exchange == board || stock.board == board
}

pub fn build_valuation_rows(stocks: &[Stock], filters: &ValuationFilters) -> Vec<ValuationRow> {
    let mut rows = stocks
        .iter()
        .filter(|stock| has_required_real_valuation_data(stock))
        .map(|stock| calculate_valuation(stock, &filters.style))
        .filter(|row| matches_board(&row.stock, &filters.board))
        .filter(|row| is_all(&filters.industry) || row.stock.industry1 == filters.industry)
        .filter(|row| is_all(&filters.state) || row.state == filters.state)
        .filter(|row| is_all(&filters.ownership) || row.stock.property == filters.ownership)
        .filter(|row| row.safety_margin >= filters.min_safety_margin)
        .filter(|row| row.governance_score >= filters.min_governance_score)
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        b.safety_margin
            .partial_cmp(&a.safety_margin)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    rows.truncate(filters.display_limit.clamp(1, 500));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn stock(code: &str, board: &str, exchange: &str, price: f64) -> Stock {
        Stock {
            code: code.to_string(),
            name: code.to_string(),
            exchange: exchange.to_string(),
            board: board.to_string(),
            industry1: "食品饮料".to_string(),
            industry2: "白酒".to_string(),
            region: "贵州".to_string(),
            property: "国企".to_string(),
            is_st: false,
            is_suspended: false,
            is_star: board == "科创板",
            is_margin: true,
            indexes: Vec::new(),
            metrics: HashMap::from([
                ("price".to_string(), price),
                ("marketCap".to_string(), 1200.0),
                ("eps".to_string(), 4.0),
                ("bps".to_string(), 12.0),
                ("revenue".to_string(), 600.0),
                ("netProfit".to_string(), 120.0),
                ("operatingCashflow".to_string(), 130.0),
                ("totalAssets".to_string(), 1800.0),
                ("totalLiabilities".to_string(), 500.0),
                ("investmentAssets".to_string(), 300.0),
                ("productionAssets".to_string(), 1500.0),
                ("interestBearingDebt".to_string(), 120.0),
                ("nonInterestBearingDebt".to_string(), 380.0),
                ("qualityScore".to_string(), 80.0),
                ("netMargin".to_string(), 20.0),
                ("roe".to_string(), 20.0),
                ("currentRatio".to_string(), 1.8),
            ]),
        }
    }

    #[test]
    fn builds_strict_valuation_rows_from_real_fields() {
        let filters = ValuationFilters {
            board: "全部".to_string(),
            industry: "全部".to_string(),
            state: "全部".to_string(),
            ownership: "全部".to_string(),
            style: "严苛核算".to_string(),
            min_safety_margin: -999.0,
            min_governance_score: 0.0,
            display_limit: 50,
        };
        let rows = build_valuation_rows(&[stock("600519", "主板", "沪市", 20.0)], &filters);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].fair_value > 0.0);
        assert!(rows[0].fair_value < rows[0].anchor_value);
        assert!(rows[0]
            .components
            .formula_rows
            .last()
            .unwrap()
            .formula
            .contains("财务扣减"));
    }

    #[test]
    fn filters_valuation_rows_by_board_and_required_fields() {
        let filters = ValuationFilters {
            board: "科创板".to_string(),
            industry: "全部".to_string(),
            state: "全部".to_string(),
            ownership: "全部".to_string(),
            style: "严苛核算".to_string(),
            min_safety_margin: -999.0,
            min_governance_score: 0.0,
            display_limit: 50,
        };
        let missing = Stock {
            metrics: HashMap::from([
                ("price".to_string(), 10.0),
                ("marketCap".to_string(), 100.0),
            ]),
            ..stock("600000", "主板", "沪市", 10.0)
        };
        let rows = build_valuation_rows(
            &[
                stock("688001", "科创板", "沪市", 18.0),
                stock("600001", "主板", "沪市", 18.0),
                missing,
            ],
            &filters,
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].stock.code, "688001");
        assert!(missing_real_valuation_fields(&rows[0].stock).is_empty());
    }

    #[test]
    fn limits_valuation_rows_by_display_limit_after_sorting() {
        let filters = ValuationFilters {
            board: "全部".to_string(),
            industry: "全部".to_string(),
            state: "全部".to_string(),
            ownership: "全部".to_string(),
            style: "严苛核算".to_string(),
            min_safety_margin: -999.0,
            min_governance_score: 0.0,
            display_limit: 2,
        };
        let rows = build_valuation_rows(
            &[
                stock("600001", "主板", "沪市", 18.0),
                stock("600002", "主板", "沪市", 28.0),
                stock("600003", "主板", "沪市", 38.0),
            ],
            &filters,
        );
        assert_eq!(rows.len(), 2);
        assert!(rows[0].safety_margin >= rows[1].safety_margin);
    }
}
