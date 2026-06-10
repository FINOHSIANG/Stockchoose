use crate::types::{
    BacktestConfig, BacktestMetrics, BacktestResult, BacktestTrade, CurvePoint, Factor,
    FilterCondition, RankCondition, RankingRow, SelectionRow, Stock, StockPool, StrategyConfig,
    StrategyOptimizationResult, YearlyReturn,
};
use chrono::{Duration, NaiveDate};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, Copy, Default)]
pub struct ScreenStocksOptions {
    pub result_limit: Option<usize>,
    pub weight_limit: Option<usize>,
}

fn round(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

fn normalize_stock_code_key(value: &str) -> String {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() >= 6 {
        digits[digits.len() - 6..].to_string()
    } else {
        digits
    }
}

fn stock_code_candidates(stock: &Stock) -> Vec<String> {
    let mut values = vec![stock.code.clone(), normalize_stock_code_key(&stock.code)];
    if stock.exchange.contains("沪") {
        values.push(format!("SH{}", normalize_stock_code_key(&stock.code)));
    } else if stock.exchange.contains("北") {
        values.push(format!("BJ{}", normalize_stock_code_key(&stock.code)));
    } else {
        values.push(format!("SZ{}", normalize_stock_code_key(&stock.code)));
    }
    values
}

fn pool_code_set(
    pool_id: &str,
    pools: &[StockPool],
    stocks: &[Stock],
    factors: &[Factor],
) -> HashSet<String> {
    let mut visiting = HashSet::new();
    pool_code_set_inner(pool_id, pools, stocks, factors, &mut visiting)
}

fn all_stock_code_set(stocks: &[Stock]) -> HashSet<String> {
    stocks
        .iter()
        .map(|stock| normalize_stock_code_key(&stock.code))
        .collect()
}

fn static_pool_code_set(pool: &StockPool, stocks: &[Stock]) -> HashSet<String> {
    if pool.codes.is_empty() && pool.id == "all" {
        return all_stock_code_set(stocks);
    }
    pool.codes
        .iter()
        .map(|code| normalize_stock_code_key(code))
        .collect()
}

fn dynamic_pool_code_set(
    pool: &StockPool,
    stocks: &[Stock],
    factors: &[Factor],
) -> HashSet<String> {
    let base_codes = static_pool_code_set(pool, stocks);
    let universe: Vec<Stock> = stocks
        .iter()
        .filter(|stock| base_codes.is_empty() || pool_has_stock(&base_codes, stock))
        .cloned()
        .collect();
    if pool.dynamic_filters.is_empty() {
        return universe
            .iter()
            .map(|stock| normalize_stock_code_key(&stock.code))
            .collect();
    }
    let pool_strategy = StrategyConfig {
        filters: pool.dynamic_filters.clone(),
        ..Default::default()
    };
    apply_filters(universe, &pool_strategy, factors)
        .into_iter()
        .map(|(stock, _)| normalize_stock_code_key(&stock.code))
        .collect()
}

fn pool_code_set_inner(
    pool_id: &str,
    pools: &[StockPool],
    stocks: &[Stock],
    factors: &[Factor],
    visiting: &mut HashSet<String>,
) -> HashSet<String> {
    if pool_id == "all" && !pools.iter().any(|item| item.id == "all") {
        return all_stock_code_set(stocks);
    }
    if !visiting.insert(pool_id.to_string()) {
        return HashSet::new();
    }
    let Some(pool) = pools.iter().find(|item| item.id == pool_id) else {
        visiting.remove(pool_id);
        return HashSet::new();
    };

    let codes = match pool.pool_type.as_str() {
        "compound" => {
            let source = pool_code_set_inner(
                pool.source_pool_id.as_deref().unwrap_or("all"),
                pools,
                stocks,
                factors,
                visiting,
            );
            let target = pool_code_set_inner(
                pool.target_pool_id.as_deref().unwrap_or("all"),
                pools,
                stocks,
                factors,
                visiting,
            );
            match pool.operator.as_deref() {
                Some("and") => source.intersection(&target).cloned().collect(),
                Some("sub") => source.difference(&target).cloned().collect(),
                _ => source.union(&target).cloned().collect(),
            }
        }
        "dynamic" => dynamic_pool_code_set(pool, stocks, factors),
        _ => static_pool_code_set(pool, stocks),
    };
    visiting.remove(pool_id);
    codes
}

fn pool_has_stock(code_set: &HashSet<String>, stock: &Stock) -> bool {
    stock_code_candidates(stock)
        .iter()
        .any(|code| code_set.contains(&normalize_stock_code_key(code)))
}

fn factor_by_key<'a>(factors: &'a [Factor], key: &str) -> Option<&'a Factor> {
    factors.iter().find(|factor| factor.key == key)
}

fn factor_metric_value(stock: &Stock, factor: &Factor) -> Option<f64> {
    factor
        .formula
        .as_deref()
        .filter(|formula| !formula.trim().is_empty())
        .and_then(|formula| evaluate_formula(formula, &stock.metrics))
        .or_else(|| stock.metrics.get(&factor.key).copied())
}

fn metric_value(stock: &Stock, factor: Option<&Factor>) -> f64 {
    let Some(factor) = factor else {
        return 0.0;
    };
    factor_metric_value(stock, factor).unwrap_or(0.0)
}

fn positive_valuation_factor(key: &str) -> bool {
    matches!(
        key,
        "pe" | "pb" | "ps" | "pcf" | "peg" | "evEbitda" | "dividendYield"
    )
}

#[derive(Debug, Clone, PartialEq)]
enum FormulaToken {
    Number(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    LParen,
    RParen,
    Comma,
}

fn tokenize_formula(formula: &str) -> Option<Vec<FormulaToken>> {
    let chars: Vec<char> = formula.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0_usize;
    while index < chars.len() {
        let ch = chars[index];
        if ch.is_whitespace() {
            index += 1;
            continue;
        }
        if ch.is_ascii_digit() || ch == '.' {
            let start = index;
            index += 1;
            while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
                index += 1;
            }
            let value = formula[start..index].parse::<f64>().ok()?;
            tokens.push(FormulaToken::Number(value));
            continue;
        }
        if ch.is_ascii_alphabetic() || ch == '_' {
            let start = index;
            index += 1;
            while index < chars.len()
                && (chars[index].is_ascii_alphanumeric() || chars[index] == '_')
            {
                index += 1;
            }
            tokens.push(FormulaToken::Ident(formula[start..index].to_string()));
            continue;
        }
        tokens.push(match ch {
            '+' => FormulaToken::Plus,
            '-' => FormulaToken::Minus,
            '*' => FormulaToken::Star,
            '/' => FormulaToken::Slash,
            '%' => FormulaToken::Percent,
            '(' => FormulaToken::LParen,
            ')' => FormulaToken::RParen,
            ',' => FormulaToken::Comma,
            _ => return None,
        });
        index += 1;
    }
    Some(tokens)
}

struct FormulaParser<'a> {
    tokens: &'a [FormulaToken],
    index: usize,
    metrics: &'a HashMap<String, f64>,
}

impl<'a> FormulaParser<'a> {
    fn new(tokens: &'a [FormulaToken], metrics: &'a HashMap<String, f64>) -> Self {
        Self {
            tokens,
            index: 0,
            metrics,
        }
    }

    fn peek(&self) -> Option<&FormulaToken> {
        self.tokens.get(self.index)
    }

    fn take(&mut self) -> Option<FormulaToken> {
        let token = self.tokens.get(self.index).cloned();
        if token.is_some() {
            self.index += 1;
        }
        token
    }

    fn consume(&mut self, expected: &FormulaToken) -> bool {
        if self.peek() == Some(expected) {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn parse_expression(&mut self) -> Option<f64> {
        self.parse_additive()
    }

    fn parse_additive(&mut self) -> Option<f64> {
        let mut value = self.parse_multiplicative()?;
        loop {
            if self.consume(&FormulaToken::Plus) {
                value += self.parse_multiplicative()?;
            } else if self.consume(&FormulaToken::Minus) {
                value -= self.parse_multiplicative()?;
            } else {
                break;
            }
        }
        Some(value)
    }

    fn parse_multiplicative(&mut self) -> Option<f64> {
        let mut value = self.parse_unary()?;
        loop {
            if self.consume(&FormulaToken::Star) {
                value *= self.parse_unary()?;
            } else if self.consume(&FormulaToken::Slash) {
                value /= self.parse_unary()?;
            } else if self.consume(&FormulaToken::Percent) {
                value %= self.parse_unary()?;
            } else {
                break;
            }
        }
        Some(value)
    }

    fn parse_unary(&mut self) -> Option<f64> {
        if self.consume(&FormulaToken::Plus) {
            return self.parse_unary();
        }
        if self.consume(&FormulaToken::Minus) {
            return self.parse_unary().map(|value| -value);
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Option<f64> {
        match self.take()? {
            FormulaToken::Number(value) => Some(value),
            FormulaToken::Ident(name) => {
                if self.consume(&FormulaToken::LParen) {
                    return self.parse_function_call(&name);
                }
                Some(self.metrics.get(&name).copied().unwrap_or(0.0))
            }
            FormulaToken::LParen => {
                let value = self.parse_expression()?;
                self.consume(&FormulaToken::RParen).then_some(value)
            }
            _ => None,
        }
    }

    fn parse_function_call(&mut self, name: &str) -> Option<f64> {
        let mut args = Vec::new();
        if !self.consume(&FormulaToken::RParen) {
            loop {
                args.push(self.parse_expression()?);
                if self.consume(&FormulaToken::RParen) {
                    break;
                }
                if !self.consume(&FormulaToken::Comma) {
                    return None;
                }
            }
        }
        let value = match name {
            "abs" if args.len() == 1 => args[0].abs(),
            "sqrt" if args.len() == 1 => args[0].sqrt(),
            "log" if args.len() == 1 => args[0].ln(),
            "min" if !args.is_empty() => args.into_iter().fold(f64::INFINITY, f64::min),
            "max" if !args.is_empty() => args.into_iter().fold(f64::NEG_INFINITY, f64::max),
            "pow" if args.len() == 2 => args[0].powf(args[1]),
            "avg" if !args.is_empty() => args.iter().sum::<f64>() / args.len() as f64,
            "zscore" if args.len() == 1 => args[0],
            _ => return None,
        };
        value.is_finite().then_some(value)
    }
}

fn evaluate_formula(formula: &str, metrics: &HashMap<String, f64>) -> Option<f64> {
    let tokens = tokenize_formula(formula.trim())?;
    if tokens.is_empty() {
        return None;
    }
    let mut parser = FormulaParser::new(&tokens, metrics);
    let value = parser.parse_expression()?;
    (parser.index == tokens.len() && value.is_finite()).then_some(value)
}

fn rank_metric_value(stock: &Stock, factor: Option<&Factor>) -> Option<f64> {
    let factor = factor?;
    let value = factor_metric_value(stock, factor)?;
    if !value.is_finite() {
        return None;
    }
    if positive_valuation_factor(&factor.key) && value <= 0.0 {
        return None;
    }
    Some(value)
}

fn filter_metric_value(stock: &Stock, factor: Option<&Factor>) -> Option<f64> {
    rank_metric_value(stock, factor)
}

fn normalized_rank_score(value: Option<f64>, min: f64, max: f64, order: &str) -> f64 {
    if !min.is_finite() || !max.is_finite() {
        return 50.0;
    }
    match value {
        Some(value) => normalize(value, min, max, order),
        None => 0.0,
    }
}

fn normalize(value: f64, min: f64, max: f64, order: &str) -> f64 {
    if (max - min).abs() < f64::EPSILON {
        return 50.0;
    }
    let normalized = (value - min) / (max - min);
    if order == "asc" {
        (1.0 - normalized) * 100.0
    } else {
        normalized * 100.0
    }
}

fn range_scope_key(stock: &Stock, range: &str) -> String {
    if range == "一级行业" {
        return format!("industry1:{}", empty_dash(&stock.industry1));
    }
    if range == "二级行业" {
        return format!(
            "industry2:{}:{}",
            empty_dash(&stock.industry1),
            empty_dash(&stock.industry2)
        );
    }
    "all".to_string()
}

fn empty_dash(value: &str) -> &str {
    if value.is_empty() {
        "-"
    } else {
        value
    }
}

fn is_all(value: &str) -> bool {
    value.is_empty() || value == "全部"
}

fn apply_selector(strategy: &StrategyConfig, stock: &Stock) -> bool {
    if !is_all(&strategy.index_member)
        && !stock
            .indexes
            .iter()
            .any(|item| item == &strategy.index_member)
    {
        return false;
    }
    if !is_all(&strategy.board) && stock.board != strategy.board {
        return false;
    }
    if !is_all(&strategy.industry1) && stock.industry1 != strategy.industry1 {
        return false;
    }
    if !is_all(&strategy.industry2) && stock.industry2 != strategy.industry2 {
        return false;
    }
    if !is_all(&strategy.exchange) && stock.exchange != strategy.exchange {
        return false;
    }
    if !is_all(&strategy.region) && stock.region != strategy.region {
        return false;
    }
    if !is_all(&strategy.property) && stock.property != strategy.property {
        return false;
    }
    if strategy.margin_flag == "融资融券" && !stock.is_margin {
        return false;
    }
    if strategy.margin_flag == "非融资融券" && stock.is_margin {
        return false;
    }
    if strategy.st_mode == "排除ST" && stock.is_st {
        return false;
    }
    if strategy.st_mode == "仅有ST" && !stock.is_st {
        return false;
    }
    if strategy.star_mode == "排除科创板" && stock.is_star {
        return false;
    }
    if strategy.star_mode == "仅有科创板" && !stock.is_star {
        return false;
    }
    if strategy.filter_suspended && stock.is_suspended {
        return false;
    }
    true
}

fn condition_pass(value: f64, condition: &FilterCondition, all_values: &[f64]) -> bool {
    let size = all_values.len().max(1) as f64;
    let rank_max = 1.0 + all_values.iter().filter(|item| **item > value).count() as f64;
    let rank_min = 1.0 + all_values.iter().filter(|item| **item < value).count() as f64;
    let rank_pct_max = rank_max / size * 100.0;
    let rank_pct_min = rank_min / size * 100.0;
    match condition.operator.as_str() {
        "gt" => value > condition.value.or(condition.min).unwrap_or(0.0),
        "lt" => value < condition.value.or(condition.max).unwrap_or(0.0),
        "gte" => value >= condition.value.or(condition.min).unwrap_or(0.0),
        "lte" => value <= condition.value.or(condition.max).unwrap_or(0.0),
        "between" => {
            value >= condition.min.unwrap_or(f64::NEG_INFINITY)
                && value <= condition.max.unwrap_or(f64::INFINITY)
        }
        "eq" => (value - condition.value.unwrap_or(0.0)).abs() < f64::EPSILON,
        "neq" => (value - condition.value.unwrap_or(0.0)).abs() >= f64::EPSILON,
        "top" => rank_pct_max <= condition.value.unwrap_or(20.0),
        "bottom" => rank_pct_min <= condition.value.unwrap_or(20.0),
        "rankMax" => rank_max <= condition.value.unwrap_or(10.0),
        "rankMin" => rank_min <= condition.value.unwrap_or(10.0),
        "rankBetween" => {
            rank_max >= condition.min.unwrap_or(1.0) && rank_max <= condition.max.unwrap_or(size)
        }
        "rankPctMax" => rank_pct_max <= condition.value.unwrap_or(10.0),
        "rankPctMin" => rank_pct_min <= condition.value.unwrap_or(10.0),
        "rankPctBetween" => {
            rank_pct_max >= condition.min.unwrap_or(0.0)
                && rank_pct_max <= condition.max.unwrap_or(100.0)
        }
        _ => true,
    }
}

fn apply_filters(
    stocks: Vec<Stock>,
    strategy: &StrategyConfig,
    factors: &[Factor],
) -> Vec<(Stock, usize)> {
    let enabled: Vec<_> = strategy
        .filters
        .iter()
        .filter(|condition| condition.enabled)
        .collect();
    if enabled.is_empty() {
        return stocks.into_iter().map(|stock| (stock, 0)).collect();
    }

    let mut values_by_condition: HashMap<&str, HashMap<String, Vec<f64>>> = HashMap::new();
    for condition in &enabled {
        let factor = factor_by_key(factors, &condition.factor_key);
        let mut values_by_scope: HashMap<String, Vec<f64>> = HashMap::new();
        for stock in &stocks {
            if let Some(value) = filter_metric_value(stock, factor) {
                values_by_scope
                    .entry(range_scope_key(stock, &condition.range))
                    .or_default()
                    .push(value);
            }
        }
        values_by_condition.insert(&condition.id, values_by_scope);
    }

    stocks
        .into_iter()
        .filter_map(|stock| {
            for (index, condition) in enabled.iter().enumerate() {
                let factor = factor_by_key(factors, &condition.factor_key);
                let Some(value) = filter_metric_value(&stock, factor) else {
                    return None;
                };
                let scope = range_scope_key(&stock, &condition.range);
                let scoped = values_by_condition
                    .get(condition.id.as_str())
                    .and_then(|values| values.get(&scope))
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                if !condition_pass(value, condition, scoped) {
                    return None;
                }
                if index + 1 == enabled.len() {
                    return Some((stock, enabled.len()));
                }
            }
            Some((stock, enabled.len()))
        })
        .collect()
}

fn score_rows(
    rows: Vec<(Stock, usize)>,
    ranks: &[RankCondition],
    factors: &[Factor],
) -> Vec<SelectionRow> {
    let enabled: Vec<_> = ranks
        .iter()
        .filter(|rank| rank.enabled && rank.weight > 0.0)
        .collect();
    if enabled.is_empty() {
        return rows
            .into_iter()
            .map(|(stock, passed_filters)| SelectionRow {
                score: stock.metrics.get("amount").copied().unwrap_or(0.0),
                stock,
                weight: 0.0,
                passed_filters,
                failed_reason: None,
            })
            .collect();
    }

    let mut stats_by_rank: HashMap<&str, HashMap<String, (f64, f64)>> = HashMap::new();
    for rank in &enabled {
        let factor = factor_by_key(factors, &rank.factor_key);
        let mut values_by_scope: HashMap<String, Vec<f64>> = HashMap::new();
        for (stock, _) in &rows {
            if let Some(value) = rank_metric_value(stock, factor) {
                values_by_scope
                    .entry(range_scope_key(stock, &rank.range))
                    .or_default()
                    .push(value);
            }
        }
        stats_by_rank.insert(
            &rank.id,
            values_by_scope
                .into_iter()
                .map(|(scope, values)| {
                    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
                    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                    (scope, (min, max))
                })
                .collect(),
        );
    }

    let total_weight: f64 = enabled.iter().map(|rank| rank.weight).sum();
    rows.into_iter()
        .map(|(stock, passed_filters)| {
            let mut score = 0.0;
            for rank in &enabled {
                let factor = factor_by_key(factors, &rank.factor_key);
                let scope = range_scope_key(&stock, &rank.range);
                let (min, max) = stats_by_rank
                    .get(rank.id.as_str())
                    .and_then(|stats| stats.get(&scope))
                    .copied()
                    .unwrap_or((f64::NAN, f64::NAN));
                score +=
                    normalized_rank_score(rank_metric_value(&stock, factor), min, max, &rank.order)
                        * (rank.weight / total_weight);
            }
            SelectionRow {
                stock,
                score: round(score, 3),
                weight: 0.0,
                passed_filters,
                failed_reason: None,
            }
        })
        .collect()
}

fn apply_weights(
    mut rows: Vec<SelectionRow>,
    strategy: &StrategyConfig,
    weight_limit: usize,
) -> Vec<SelectionRow> {
    let selected_len = rows.len().min(weight_limit.max(1));
    if selected_len == 0 {
        return rows;
    }
    let values: Vec<f64> = rows
        .iter()
        .take(selected_len)
        .map(|row| match strategy.trading.weight_method.as_str() {
            "流通市值" => row
                .stock
                .metrics
                .get("floatMarketCap")
                .copied()
                .unwrap_or(0.0),
            "总市值" => row.stock.metrics.get("marketCap").copied().unwrap_or(0.0),
            "流通市值平方根" => row
                .stock
                .metrics
                .get("floatMarketCap")
                .copied()
                .unwrap_or(0.0)
                .sqrt(),
            "总市值平方根" => row
                .stock
                .metrics
                .get("marketCap")
                .copied()
                .unwrap_or(0.0)
                .sqrt(),
            _ => 1.0,
        })
        .collect();
    let total: f64 = values.iter().sum();
    for (index, row) in rows.iter_mut().enumerate() {
        row.weight = if index < selected_len && total > 0.0 {
            round(
                values[index] / total * strategy.trading.max_buy_position.min(100.0),
                2,
            )
        } else {
            0.0
        };
    }
    rows
}

pub fn screen_stocks(
    strategy: &StrategyConfig,
    stocks: &[Stock],
    pools: &[StockPool],
    factors: &[Factor],
    options: ScreenStocksOptions,
) -> Vec<SelectionRow> {
    let primary_codes = pool_code_set(&strategy.pool_id, pools, stocks, factors);
    let hot_codes: HashSet<String> = if strategy.hot_pool_id == "all" {
        primary_codes.clone()
    } else {
        pool_code_set(&strategy.hot_pool_id, pools, stocks, factors)
    };
    let universe: Vec<Stock> = stocks
        .iter()
        .filter(|stock| pool_has_stock(&primary_codes, stock))
        .filter(|stock| strategy.hot_pool_id == "all" || pool_has_stock(&hot_codes, stock))
        .filter(|stock| apply_selector(strategy, stock))
        .cloned()
        .collect();
    let filtered = apply_filters(universe, strategy, factors);
    let mut scored = score_rows(filtered, &strategy.ranks, factors);
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let result_limit = strategy
        .pool_limit
        .max(1)
        .min(options.result_limit.unwrap_or(strategy.pool_limit.max(1)));
    let weight_limit = options
        .weight_limit
        .unwrap_or(strategy.trading.max_holdings)
        .max(1);
    scored.truncate(result_limit);
    apply_weights(scored, strategy, weight_limit)
}

pub fn ranking_analysis(
    strategy: &StrategyConfig,
    stocks: &[Stock],
    pools: &[StockPool],
    factors: &[Factor],
) -> Vec<RankingRow> {
    let primary_codes = pool_code_set(&strategy.pool_id, pools, stocks, factors);
    let universe: Vec<Stock> = stocks
        .iter()
        .filter(|stock| pool_has_stock(&primary_codes, stock))
        .filter(|stock| apply_selector(strategy, stock))
        .cloned()
        .collect();
    let mut rows = score_rows(
        universe
            .into_iter()
            .map(|stock| (stock, 0))
            .collect::<Vec<_>>(),
        &strategy.ranks,
        factors,
    );
    rows.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    rows.into_iter()
        .enumerate()
        .map(|(index, row)| {
            let values = strategy
                .ranks
                .iter()
                .map(|rank| {
                    (
                        rank.factor_key.clone(),
                        metric_value(&row.stock, factor_by_key(factors, &rank.factor_key)),
                    )
                })
                .collect();
            RankingRow {
                stock: row.stock,
                score: row.score,
                rank: index + 1,
                values,
            }
        })
        .collect()
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn date_range(start_date: &str, end_date: &str, step_days: usize) -> Vec<String> {
    let Ok(start) = NaiveDate::parse_from_str(start_date, "%Y-%m-%d") else {
        return Vec::new();
    };
    let Ok(end) = NaiveDate::parse_from_str(end_date, "%Y-%m-%d") else {
        return Vec::new();
    };
    if start > end {
        return Vec::new();
    }

    let step = step_days.max(1) as i64;
    let mut dates = Vec::new();
    let mut current = start;
    while current <= end {
        dates.push(current.format("%Y-%m-%d").to_string());
        current += Duration::days(step);
    }
    let end_text = end.format("%Y-%m-%d").to_string();
    if dates.last() != Some(&end_text) {
        dates.push(end_text);
    }
    dates
}

fn hash(input: &str) -> u64 {
    input.chars().fold(0_u64, |value, ch| {
        (value * 31 + u64::from(ch as u32)) % 100000
    })
}

fn benchmark_return(benchmark: &str, date: &str, index: usize) -> f64 {
    let base = hash(&format!("{benchmark}-{date}")) % 100;
    let csi500 = "\u{4e2d}\u{8bc1}500";
    ((base as f64 + index as f64 / 3.0).sin() * 0.012
        + 0.004
        + if benchmark == csi500 { 0.001 } else { 0.0 })
        * 100.0
}

fn metric(stock: &Stock, key: &str) -> f64 {
    stock.metrics.get(key).copied().unwrap_or(0.0)
}

fn stock_return(row: &SelectionRow, date: &str, index: usize) -> f64 {
    let style = metric(&row.stock, "momentum60") * 0.002
        + metric(&row.stock, "qualityScore") * 0.0015
        + metric(&row.stock, "revenueGrowth") * 0.001
        - metric(&row.stock, "pe") * 0.0009
        - metric(&row.stock, "volatility20") * 0.0007
        + row.score * 0.002;
    let noise =
        (hash(&format!("{}-{date}", row.stock.code)) as f64 / 30.0 + index as f64).sin() * 1.8;
    clamp(style + noise, -12.0, 14.0)
}

fn timing_exposure(strategy: &StrategyConfig, date: &str, factor_mean: f64) -> f64 {
    if strategy.timing.mode == "\u{4e0d}\u{62e9}\u{65f6}" {
        return 1.0;
    }
    let pulse = 50.0
        + (hash(&format!("{}-{date}", strategy.timing.index)) as f64 / 70.0).sin() * 30.0
        + factor_mean / 5.0;
    if strategy.timing.mode == "\u{4f7f}\u{7528}\u{62e9}\u{65f6}\u{6a21}\u{677f}" {
        if strategy.timing.template.contains("MA60") {
            return if pulse > 50.0 + strategy.timing.threshold {
                1.0
            } else {
                0.15
            };
        }
        if strategy.timing.template.contains("\u{4f30}\u{503c}") {
            return if factor_mean > 45.0 { 1.0 } else { 0.25 };
        }
        return if pulse > strategy.timing.threshold {
            1.0
        } else {
            0.25
        };
    }
    if pulse + factor_mean / 3.0 > 70.0 + strategy.timing.threshold {
        1.0
    } else {
        0.2
    }
}

fn backtest_years(start_date: &str, end_date: &str) -> f64 {
    let Ok(start) = NaiveDate::parse_from_str(start_date, "%Y-%m-%d") else {
        return 0.1;
    };
    let Ok(end) = NaiveDate::parse_from_str(end_date, "%Y-%m-%d") else {
        return 0.1;
    };
    ((end - start).num_days() as f64 / 365.0).max(0.1)
}

#[derive(Debug, Clone, Copy)]
struct YearAccumulator {
    start_s: f64,
    end_s: f64,
    start_b: f64,
    end_b: f64,
}

pub fn run_backtest(
    strategy: &StrategyConfig,
    stocks: &[Stock],
    pools: &[StockPool],
    factors: &[Factor],
    config: &BacktestConfig,
) -> BacktestResult {
    let rows = screen_stocks(
        strategy,
        stocks,
        pools,
        factors,
        ScreenStocksOptions {
            result_limit: Some(strategy.trading.max_holdings.max(1)),
            weight_limit: Some(strategy.trading.max_holdings.max(1)),
        },
    );
    let dates = date_range(
        &config.start_date,
        &config.end_date,
        (strategy.trading.period.max(1) * 4).max(7),
    );
    let mut strategy_net = 1.0;
    let mut benchmark_net = 1.0;
    let mut hedge_net = 1.0;
    let mut high = 1.0;
    let mut max_drawdown: f64 = 0.0;
    let mut wins = 0_usize;
    let mut returns = Vec::new();

    let curve = dates
        .iter()
        .enumerate()
        .map(|(index, date)| {
            let raw_stock_return = if rows.is_empty() {
                0.0
            } else {
                rows.iter()
                    .map(|row| stock_return(row, date, index) * (row.weight / 100.0))
                    .sum()
            };
            let factor_mean = if rows.is_empty() {
                0.0
            } else {
                rows.iter().map(|row| row.score).sum::<f64>() / rows.len() as f64
            };
            let exposure = timing_exposure(strategy, date, factor_mean);
            let bench_ret = benchmark_return(&config.benchmark, date, index);
            let hedge_impact = if strategy.hedge.enabled {
                -bench_ret * (strategy.hedge.ratio / 100.0) - strategy.hedge.cost / 100.0
            } else {
                0.0
            };
            let cost_drag = (config.cost / 1000.0) * if index == 0 { 1.0 } else { 0.35 };
            let period_return = raw_stock_return * exposure + hedge_impact - cost_drag * 100.0;
            strategy_net *= 1.0 + period_return / 100.0;
            benchmark_net *= 1.0 + bench_ret / 100.0;
            hedge_net *= 1.0 + (period_return - hedge_impact) / 100.0;
            high = f64::max(high, strategy_net);
            max_drawdown = f64::min(max_drawdown, strategy_net / high - 1.0);
            if period_return > bench_ret {
                wins += 1;
            }
            returns.push(period_return / 100.0);
            CurvePoint {
                date: date.clone(),
                strategy: round(strategy_net, 4),
                benchmark: round(benchmark_net, 4),
                hedge: round(hedge_net, 4),
            }
        })
        .collect::<Vec<_>>();

    let cumulative_return = strategy_net - 1.0;
    let years = backtest_years(&config.start_date, &config.end_date);
    let return_count = returns.len().max(1) as f64;
    let avg = returns.iter().sum::<f64>() / return_count;
    let volatility = (returns.iter().map(|item| (item - avg).powi(2)).sum::<f64>() / return_count)
        .sqrt()
        * (252.0 / strategy.trading.period.max(1) as f64).sqrt();

    let mut yearly_map: BTreeMap<String, YearAccumulator> = BTreeMap::new();
    for point in &curve {
        let year = point.date.chars().take(4).collect::<String>();
        yearly_map
            .entry(year)
            .and_modify(|item| {
                item.end_s = point.strategy;
                item.end_b = point.benchmark;
            })
            .or_insert(YearAccumulator {
                start_s: 1.0,
                end_s: point.strategy,
                start_b: 1.0,
                end_b: point.benchmark,
            });
    }
    let yearly = yearly_map
        .into_iter()
        .map(|(year, item)| YearlyReturn {
            year,
            strategy: round((item.end_s / item.start_s - 1.0) * 100.0, 2),
            benchmark: round((item.end_b / item.start_b - 1.0) * 100.0, 2),
            excess: round(
                (item.end_s / item.start_s - item.end_b / item.start_b) * 100.0,
                2,
            ),
        })
        .collect();

    let first_date = dates
        .first()
        .cloned()
        .unwrap_or_else(|| config.start_date.clone());
    let last_index = dates.len().saturating_sub(1);
    let trades = rows
        .iter()
        .enumerate()
        .flat_map(|(index, row)| {
            let rebalance_date = dates
                .get((index + 1).min(last_index))
                .cloned()
                .unwrap_or_else(|| config.end_date.clone());
            let price = metric(&row.stock, "price");
            [
                BacktestTrade {
                    date: first_date.clone(),
                    action: "\u{4e70}\u{5165}".to_string(),
                    code: row.stock.code.clone(),
                    name: row.stock.name.clone(),
                    weight: row.weight,
                    price,
                },
                BacktestTrade {
                    date: rebalance_date,
                    action: "\u{8c03}\u{4ed3}".to_string(),
                    code: row.stock.code.clone(),
                    name: row.stock.name.clone(),
                    weight: row.weight,
                    price: round(price * (1.0 + row.score / 8000.0), 2),
                },
            ]
        })
        .collect();

    BacktestResult {
        rows,
        curve,
        metrics: BacktestMetrics {
            cumulative_return: round(cumulative_return * 100.0, 2),
            annual_return: round(
                ((1.0 + cumulative_return).powf(1.0 / years) - 1.0) * 100.0,
                2,
            ),
            max_drawdown: round(max_drawdown * 100.0, 2),
            sharpe: round(
                if volatility > 0.0 {
                    (avg * (252.0 / strategy.trading.period.max(1) as f64)) / volatility
                } else {
                    0.0
                },
                2,
            ),
            volatility: round(volatility * 100.0, 2),
            win_rate: round((wins as f64 / return_count) * 100.0, 2),
            turnover: round(
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
    }
}

pub fn optimize_strategy(
    strategy: &StrategyConfig,
    stocks: &[Stock],
    pools: &[StockPool],
    factors: &[Factor],
    config: &BacktestConfig,
) -> StrategyOptimizationResult {
    [6_usize, 8, 10, 12, 15]
        .into_iter()
        .map(|max_holdings| {
            let mut candidate = strategy.clone();
            candidate.trading.max_holdings = max_holdings;
            let result = run_backtest(&candidate, stocks, pools, factors, config);
            StrategyOptimizationResult { candidate, result }
        })
        .max_by(|a, b| {
            a.result
                .metrics
                .sharpe
                .partial_cmp(&b.result.metrics.sharpe)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or_else(|| StrategyOptimizationResult {
            candidate: strategy.clone(),
            result: run_backtest(strategy, stocks, pools, factors, config),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stock(code: &str, industry2: &str, value: f64) -> Stock {
        Stock {
            code: code.to_string(),
            name: code.to_string(),
            exchange: "沪市".to_string(),
            board: "主板".to_string(),
            industry1: "制造".to_string(),
            industry2: industry2.to_string(),
            region: "全部".to_string(),
            property: "民企".to_string(),
            is_st: false,
            is_suspended: false,
            is_star: false,
            is_margin: false,
            indexes: Vec::new(),
            metrics: HashMap::from([
                ("valueScore".to_string(), value),
                ("price".to_string(), 10.0),
            ]),
        }
    }

    #[test]
    fn daily_result_limit_can_exceed_weight_limit() {
        let strategy = StrategyConfig {
            id: "s".to_string(),
            name: "s".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 4,
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "全部".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            trading: crate::types::TradingConfig {
                max_holdings: 2,
                ..Default::default()
            },
            ..Default::default()
        };
        let stocks = vec![
            stock("600001", "白酒", 4.0),
            stock("600002", "白酒", 3.0),
            stock("600003", "电池", 2.0),
            stock("600004", "电池", 1.0),
        ];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "valueScore".to_string(),
            name: "value".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: None,
        }];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(4),
                weight_limit: Some(2),
            },
        );
        assert_eq!(rows.len(), 4);
        assert_eq!(rows.iter().filter(|row| row.weight > 0.0).count(), 2);
    }

    #[test]
    fn screen_stocks_defaults_result_limit_to_strategy_pool_limit() {
        let strategy = StrategyConfig {
            id: "s".to_string(),
            name: "s".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 3,
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "鍏ㄩ儴".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            trading: crate::types::TradingConfig {
                max_holdings: 1,
                ..Default::default()
            },
            ..Default::default()
        };
        let stocks = vec![
            stock("600001", "鐧介厭", 4.0),
            stock("600002", "鐧介厭", 3.0),
            stock("600003", "鐢垫睜", 2.0),
            stock("600004", "鐢垫睜", 1.0),
        ];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "valueScore".to_string(),
            name: "value".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: None,
        }];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions::default(),
        );

        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows.iter()
                .map(|row| row.stock.code.as_str())
                .collect::<Vec<_>>(),
            vec!["600001", "600002", "600003"]
        );
        assert_eq!(rows.iter().filter(|row| row.weight > 0.0).count(), 1);
    }

    #[test]
    fn ranking_analysis_scores_full_pool_with_factor_values() {
        let strategy = StrategyConfig {
            id: "rank".to_string(),
            name: "rank".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..Default::default()
        };
        let stocks = vec![
            stock("600001", "a", 10.0),
            stock("600002", "a", 30.0),
            stock("600003", "b", 20.0),
        ];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "valueScore".to_string(),
            name: "value".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: None,
        }];

        let rows = ranking_analysis(&strategy, &stocks, &pools, &factors);

        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].stock.code, "600002");
        assert_eq!(rows[0].rank, 1);
        assert_eq!(rows[0].values.get("valueScore").copied(), Some(30.0));
    }

    #[test]
    fn pe_ranking_treats_non_positive_values_as_invalid() {
        let strategy = StrategyConfig {
            id: "rank-pe".to_string(),
            name: "rank-pe".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 2,
            ranks: vec![RankCondition {
                id: "rank-pe".to_string(),
                factor_key: "pe".to_string(),
                order: "asc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..Default::default()
        };
        let mut positive_pe = stock("600001", "a", 0.0);
        positive_pe.metrics.insert("pe".to_string(), 8.0);
        let mut negative_pe = stock("600002", "a", 0.0);
        negative_pe.metrics.insert("pe".to_string(), -12.0);
        let stocks = vec![negative_pe, positive_pe];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "pe".to_string(),
            name: "pe".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "asc".to_string(),
            precision: None,
            formula: None,
        }];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(2),
                weight_limit: Some(1),
            },
        );

        assert_eq!(rows[0].stock.code, "600001");
        assert!(rows[0].score > rows[1].score);
    }

    #[test]
    fn pe_filter_excludes_missing_or_non_positive_values() {
        let strategy = StrategyConfig {
            id: "filter-pe".to_string(),
            name: "filter-pe".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 4,
            filters: vec![FilterCondition {
                id: "pe-lte".to_string(),
                factor_key: "pe".to_string(),
                operator: "lte".to_string(),
                min: None,
                max: None,
                value: Some(20.0),
                range: "all".to_string(),
                enabled: true,
            }],
            ..Default::default()
        };
        let mut fair_pe = stock("600001", "a", 0.0);
        fair_pe.metrics.insert("pe".to_string(), 12.0);
        let mut expensive_pe = stock("600002", "a", 0.0);
        expensive_pe.metrics.insert("pe".to_string(), 35.0);
        let mut zero_pe = stock("600003", "a", 0.0);
        zero_pe.metrics.insert("pe".to_string(), 0.0);
        let missing_pe = stock("600004", "a", 0.0);
        let stocks = vec![fair_pe, expensive_pe, zero_pe, missing_pe];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "pe".to_string(),
            name: "pe".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "asc".to_string(),
            precision: None,
            formula: None,
        }];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(4),
                weight_limit: Some(1),
            },
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].stock.code, "600001");
        assert_eq!(rows[0].passed_filters, 1);
    }

    #[test]
    fn formula_rank_factor_drives_daily_selection_order() {
        let strategy = StrategyConfig {
            id: "formula-rank".to_string(),
            name: "formula-rank".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 2,
            ranks: vec![RankCondition {
                id: "rank-formula".to_string(),
                factor_key: "customFormula".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..Default::default()
        };
        let mut high = stock("600001", "a", 0.0);
        high.metrics.insert("qualityScore".to_string(), 90.0);
        high.metrics.insert("revenueGrowth".to_string(), 30.0);
        high.metrics.insert("pe".to_string(), 10.0);
        let mut low = stock("600002", "a", 0.0);
        low.metrics.insert("qualityScore".to_string(), 45.0);
        low.metrics.insert("revenueGrowth".to_string(), 8.0);
        low.metrics.insert("pe".to_string(), 35.0);
        let stocks = vec![low, high];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "customFormula".to_string(),
            name: "custom".to_string(),
            group: "custom".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: Some("qualityScore * 0.6 + revenueGrowth * 0.4 - pe * 0.2".to_string()),
        }];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(2),
                weight_limit: Some(1),
            },
        );

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].stock.code, "600001");
        assert!(rows[0].score > rows[1].score);
    }

    #[test]
    fn formula_filter_factor_is_applied_before_ranking() {
        let strategy = StrategyConfig {
            id: "formula-filter".to_string(),
            name: "formula-filter".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 3,
            filters: vec![FilterCondition {
                id: "filter-formula".to_string(),
                factor_key: "customFormula".to_string(),
                operator: "gt".to_string(),
                min: None,
                max: None,
                value: Some(100.0),
                range: "all".to_string(),
                enabled: true,
            }],
            ..Default::default()
        };
        let mut pass = stock("600001", "a", 0.0);
        pass.metrics.insert("qualityScore".to_string(), 80.0);
        pass.metrics.insert("revenueGrowth".to_string(), 35.0);
        let mut fail = stock("600002", "a", 0.0);
        fail.metrics.insert("qualityScore".to_string(), 50.0);
        fail.metrics.insert("revenueGrowth".to_string(), 10.0);
        let stocks = vec![pass, fail];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "customFormula".to_string(),
            name: "custom".to_string(),
            group: "custom".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: Some("qualityScore + revenueGrowth".to_string()),
        }];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(3),
                weight_limit: Some(1),
            },
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].stock.code, "600001");
        assert_eq!(rows[0].passed_filters, 1);
    }

    #[test]
    fn dynamic_stock_pool_filters_universe_in_rust_screening() {
        let strategy = StrategyConfig {
            id: "dynamic-pool-strategy".to_string(),
            name: "dynamic-pool-strategy".to_string(),
            pool_id: "growth-pool".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 4,
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..Default::default()
        };
        let mut fast = stock("600001", "a", 80.0);
        fast.metrics.insert("revenueGrowth".to_string(), 35.0);
        let mut slow = stock("600002", "a", 90.0);
        slow.metrics.insert("revenueGrowth".to_string(), 5.0);
        let stocks = vec![fast, slow];
        let pools = vec![StockPool {
            id: "growth-pool".to_string(),
            name: "growth-pool".to_string(),
            pool_type: "dynamic".to_string(),
            codes: Vec::new(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: vec![FilterCondition {
                id: "growth-filter".to_string(),
                factor_key: "revenueGrowth".to_string(),
                operator: "gt".to_string(),
                min: None,
                max: None,
                value: Some(20.0),
                range: "all".to_string(),
                enabled: true,
            }],
        }];
        let factors = vec![
            Factor {
                key: "valueScore".to_string(),
                name: "value".to_string(),
                group: "financial".to_string(),
                unit: None,
                description: String::new(),
                default_order: "desc".to_string(),
                precision: None,
                formula: None,
            },
            Factor {
                key: "revenueGrowth".to_string(),
                name: "growth".to_string(),
                group: "financial".to_string(),
                unit: None,
                description: String::new(),
                default_order: "desc".to_string(),
                precision: None,
                formula: None,
            },
        ];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(4),
                weight_limit: Some(1),
            },
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].stock.code, "600001");
    }

    #[test]
    fn compound_stock_pool_can_intersect_dynamic_pool_results() {
        let strategy = StrategyConfig {
            id: "compound-pool-strategy".to_string(),
            name: "compound-pool-strategy".to_string(),
            pool_id: "compound-pool".to_string(),
            hot_pool_id: "all".to_string(),
            pool_limit: 4,
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..Default::default()
        };
        let mut first = stock("600001", "a", 100.0);
        first.metrics.insert("revenueGrowth".to_string(), 35.0);
        let mut second = stock("600002", "a", 80.0);
        second.metrics.insert("revenueGrowth".to_string(), 30.0);
        let mut third = stock("600003", "a", 60.0);
        third.metrics.insert("revenueGrowth".to_string(), 5.0);
        let stocks = vec![first, second, third];
        let pools = vec![
            StockPool {
                id: "growth-pool".to_string(),
                name: "growth-pool".to_string(),
                pool_type: "dynamic".to_string(),
                codes: Vec::new(),
                description: None,
                source_pool_id: None,
                target_pool_id: None,
                operator: None,
                dynamic_filters: vec![FilterCondition {
                    id: "growth-filter".to_string(),
                    factor_key: "revenueGrowth".to_string(),
                    operator: "gt".to_string(),
                    min: None,
                    max: None,
                    value: Some(20.0),
                    range: "all".to_string(),
                    enabled: true,
                }],
            },
            StockPool {
                id: "watchlist".to_string(),
                name: "watchlist".to_string(),
                pool_type: "static".to_string(),
                codes: vec!["600002".to_string(), "600003".to_string()],
                description: None,
                source_pool_id: None,
                target_pool_id: None,
                operator: None,
                dynamic_filters: Vec::new(),
            },
            StockPool {
                id: "compound-pool".to_string(),
                name: "compound-pool".to_string(),
                pool_type: "compound".to_string(),
                codes: Vec::new(),
                description: None,
                source_pool_id: Some("growth-pool".to_string()),
                target_pool_id: Some("watchlist".to_string()),
                operator: Some("and".to_string()),
                dynamic_filters: Vec::new(),
            },
        ];
        let factors = vec![
            Factor {
                key: "valueScore".to_string(),
                name: "value".to_string(),
                group: "financial".to_string(),
                unit: None,
                description: String::new(),
                default_order: "desc".to_string(),
                precision: None,
                formula: None,
            },
            Factor {
                key: "revenueGrowth".to_string(),
                name: "growth".to_string(),
                group: "financial".to_string(),
                unit: None,
                description: String::new(),
                default_order: "desc".to_string(),
                precision: None,
                formula: None,
            },
        ];

        let rows = screen_stocks(
            &strategy,
            &stocks,
            &pools,
            &factors,
            ScreenStocksOptions {
                result_limit: Some(4),
                weight_limit: Some(1),
            },
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].stock.code, "600002");
    }

    #[test]
    fn run_backtest_builds_curve_metrics_and_trades() {
        let strategy = StrategyConfig {
            id: "backtest".to_string(),
            name: "backtest".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            trading: crate::types::TradingConfig {
                max_holdings: 2,
                period: 5,
                ..Default::default()
            },
            ..Default::default()
        };
        let stocks = vec![
            stock("600001", "a", 10.0),
            stock("600002", "a", 30.0),
            stock("600003", "b", 20.0),
        ];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "valueScore".to_string(),
            name: "value".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: None,
        }];
        let result = run_backtest(
            &strategy,
            &stocks,
            &pools,
            &factors,
            &BacktestConfig {
                start_date: "2024-01-01".to_string(),
                end_date: "2024-03-01".to_string(),
                benchmark: "CSI300".to_string(),
                cost: 0.2,
                exclude_time_range: false,
            },
        );

        assert_eq!(result.rows.len(), 2);
        assert!(!result.curve.is_empty());
        assert!(result.metrics.cumulative_return.is_finite());
        assert!(result.metrics.volatility.is_finite());
        assert_eq!(result.trades.len(), 4);
        assert_eq!(result.trades[0].action, "\u{4e70}\u{5165}");
        assert!(!result.yearly.is_empty());
    }

    #[test]
    fn optimize_strategy_returns_candidate_and_result() {
        let strategy = StrategyConfig {
            id: "opt".to_string(),
            name: "opt".to_string(),
            pool_id: "all".to_string(),
            hot_pool_id: "all".to_string(),
            ranks: vec![RankCondition {
                id: "rank".to_string(),
                factor_key: "valueScore".to_string(),
                order: "desc".to_string(),
                range: "all".to_string(),
                weight: 100.0,
                enabled: true,
            }],
            ..Default::default()
        };
        let stocks = vec![
            stock("600001", "a", 10.0),
            stock("600002", "a", 30.0),
            stock("600003", "b", 20.0),
        ];
        let pools = vec![StockPool {
            id: "all".to_string(),
            name: "all".to_string(),
            pool_type: "static".to_string(),
            codes: stocks.iter().map(|item| item.code.clone()).collect(),
            description: None,
            source_pool_id: None,
            target_pool_id: None,
            operator: None,
            dynamic_filters: Vec::new(),
        }];
        let factors = vec![Factor {
            key: "valueScore".to_string(),
            name: "value".to_string(),
            group: "financial".to_string(),
            unit: None,
            description: String::new(),
            default_order: "desc".to_string(),
            precision: None,
            formula: None,
        }];
        let result = optimize_strategy(
            &strategy,
            &stocks,
            &pools,
            &factors,
            &BacktestConfig {
                start_date: "2024-01-01".to_string(),
                end_date: "2024-03-01".to_string(),
                benchmark: "CSI300".to_string(),
                cost: 0.2,
                exclude_time_range: false,
            },
        );

        assert!([6, 8, 10, 12, 15].contains(&result.candidate.trading.max_holdings));
        assert!(!result.result.curve.is_empty());
    }
}
