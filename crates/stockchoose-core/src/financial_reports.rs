use crate::types::Stock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnualFinancialReportMetrics {
    pub revenue: f64,
    pub net_profit: f64,
    pub operating_cashflow: f64,
    pub total_assets: f64,
    pub total_liabilities: f64,
    pub inventory: f64,
    pub receivables: f64,
    pub eps: f64,
    pub bps: f64,
    pub employee_count: i64,
    pub gross_margin: f64,
    pub net_margin: f64,
    pub roe: f64,
    pub roa: f64,
    pub revenue_growth: f64,
    pub profit_growth: f64,
    pub debt_ratio: f64,
    pub current_ratio: f64,
    pub asset_turnover: f64,
    pub dividend_yield: f64,
    pub cash_profit_ratio: f64,
    pub receivable_revenue_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnualFinancialReport {
    pub code: String,
    pub name: String,
    pub year: String,
    pub period_end: String,
    pub disclosure_date: String,
    pub report_type: String,
    pub currency_unit: String,
    pub audit_opinion: String,
    pub source_provider: String,
    pub source_file_name: String,
    pub source_file_type: String,
    pub source_note: String,
    pub metrics: AnnualFinancialReportMetrics,
    pub source_csv: String,
}

fn round(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn metric(stock: &Stock, key: &str, fallback: f64) -> f64 {
    stock
        .metrics
        .get(key)
        .copied()
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn safe_ratio(numerator: f64, denominator: f64, scale: f64) -> f64 {
    if !numerator.is_finite() || !denominator.is_finite() || denominator.abs() < 0.01 {
        0.0
    } else {
        numerator / denominator * scale
    }
}

fn date_number(stock: &Stock, key: &str) -> Option<i64> {
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

fn date_text(value: i64) -> String {
    let text = format!("{value:08}");
    format!("{}-{}-{}", &text[0..4], &text[4..6], &text[6..8])
}

fn report_year(value: i64) -> String {
    (value / 10000).to_string()
}

fn is_annual_report_date(value: i64) -> bool {
    value % 10000 == 1231
}

fn has_real_annual_report_data(stock: &Stock) -> bool {
    metric(stock, "realAnnualReportSource", 0.0) == 1.0
        && date_number(stock, "realAnnualReportDate").is_some_and(is_annual_report_date)
}

pub fn build_annual_financial_reports(stock: &Stock) -> Vec<AnnualFinancialReport> {
    if !has_real_annual_report_data(stock) {
        return Vec::new();
    }
    let Some(report_date) = date_number(stock, "realAnnualReportDate") else {
        return Vec::new();
    };
    let revenue = metric(stock, "revenue", 0.0);
    let net_profit = metric(stock, "netProfit", 0.0);
    let operating_cashflow = metric(stock, "operatingCashflow", 0.0);
    let total_assets = metric(stock, "totalAssets", 0.0);
    let total_liabilities = metric(stock, "totalLiabilities", 0.0);
    let inventory = metric(stock, "inventory", 0.0);
    let receivables = metric(stock, "receivables", 0.0);
    let disclosure_date =
        date_text(date_number(stock, "realAnnualReportDisclosureDate").unwrap_or(report_date));
    let year = report_year(report_date);
    let metrics = AnnualFinancialReportMetrics {
        revenue: round(revenue, 2),
        net_profit: round(net_profit, 2),
        operating_cashflow: round(operating_cashflow, 2),
        total_assets: round(total_assets, 2),
        total_liabilities: round(total_liabilities, 2),
        inventory: round(inventory, 2),
        receivables: round(receivables, 2),
        eps: round(metric(stock, "eps", 0.0), 2),
        bps: round(metric(stock, "bps", 0.0), 2),
        employee_count: metric(stock, "employeeCount", 0.0).round() as i64,
        gross_margin: round(clamp(metric(stock, "grossMargin", 0.0), -20.0, 90.0), 2),
        net_margin: round(
            metric(stock, "netMargin", safe_ratio(net_profit, revenue, 100.0)),
            2,
        ),
        roe: round(clamp(metric(stock, "roe", 0.0), -30.0, 55.0), 2),
        roa: round(
            metric(stock, "roa", safe_ratio(net_profit, total_assets, 100.0)),
            2,
        ),
        revenue_growth: round(metric(stock, "revenueGrowth", 0.0), 2),
        profit_growth: round(metric(stock, "profitGrowth", 0.0), 2),
        debt_ratio: round(
            metric(
                stock,
                "debtRatio",
                safe_ratio(total_liabilities, total_assets, 100.0),
            ),
            2,
        ),
        current_ratio: round(metric(stock, "currentRatio", 0.0), 2),
        asset_turnover: round(
            metric(
                stock,
                "assetTurnover",
                safe_ratio(revenue, total_assets, 1.0),
            ),
            2,
        ),
        dividend_yield: round(metric(stock, "dividendYield", 0.0), 2),
        cash_profit_ratio: round(safe_ratio(operating_cashflow, net_profit, 100.0), 2),
        receivable_revenue_ratio: round(safe_ratio(receivables, revenue, 100.0), 2),
    };

    let mut report = AnnualFinancialReport {
        code: stock.code.clone(),
        name: stock.name.clone(),
        year: year.clone(),
        period_end: date_text(report_date),
        disclosure_date,
        report_type: "年度报告".to_string(),
        currency_unit: "人民币亿元".to_string(),
        audit_opinion: "以真实财报接口返回字段为准".to_string(),
        source_provider: "真实财报接口".to_string(),
        source_file_name: format!(
            "{}-{}-{year}-real-annual-report-source.csv",
            stock.code, stock.name
        ),
        source_file_type: "CSV".to_string(),
        source_note:
            "由 AKShare / AKTools / Eastmoney 财报接口返回的本报告期字段生成，不倒推历史年度。"
                .to_string(),
        metrics,
        source_csv: String::new(),
    };
    report.source_csv = build_financial_report_source_csv(&report);
    vec![report]
}

fn csv_escape(value: impl ToString) -> String {
    let text = value.to_string();
    if text.contains('"') || text.contains(',') || text.contains('\r') || text.contains('\n') {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

pub fn build_financial_report_source_csv(report: &AnnualFinancialReport) -> String {
    let m = &report.metrics;
    let rows = vec![
        vec![
            "股票代码",
            "股票名称",
            "年度",
            "报告期",
            "报表",
            "字段",
            "数值",
            "单位",
        ],
        vec![
            &report.code,
            &report.name,
            &report.year,
            &report.period_end,
            "源文件",
            "来源机构",
            &report.source_provider,
            "",
        ],
        vec![
            &report.code,
            &report.name,
            &report.year,
            &report.period_end,
            "源文件",
            "披露日期",
            &report.disclosure_date,
            "",
        ],
        vec![
            &report.code,
            &report.name,
            &report.year,
            &report.period_end,
            "源文件",
            "审计意见",
            &report.audit_opinion,
            "",
        ],
    ];
    let mut csv_rows = rows
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(csv_escape)
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>();
    let metric_rows = [
        ("利润表", "营业收入", m.revenue, "亿元"),
        ("利润表", "归母净利润", m.net_profit, "亿元"),
        (
            "现金流量表",
            "经营活动现金流净额",
            m.operating_cashflow,
            "亿元",
        ),
        ("资产负债表", "总资产", m.total_assets, "亿元"),
        ("资产负债表", "总负债", m.total_liabilities, "亿元"),
        ("资产负债表", "存货", m.inventory, "亿元"),
        ("资产负债表", "应收账款", m.receivables, "亿元"),
        ("每股指标", "每股收益 EPS", m.eps, "元"),
        ("每股指标", "每股净资产 BPS", m.bps, "元"),
        ("经营数据", "员工人数", m.employee_count as f64, "人"),
        ("财务比率", "毛利率", m.gross_margin, "%"),
        ("财务比率", "净利率", m.net_margin, "%"),
        ("财务比率", "ROE", m.roe, "%"),
        ("财务比率", "ROA", m.roa, "%"),
        ("财务比率", "营收增长", m.revenue_growth, "%"),
        ("财务比率", "净利增长", m.profit_growth, "%"),
        ("财务比率", "资产负债率", m.debt_ratio, "%"),
        ("财务比率", "流动比率", m.current_ratio, "x"),
        ("财务比率", "总资产周转率", m.asset_turnover, "x"),
        ("财务比率", "现金流/净利润", m.cash_profit_ratio, "%"),
        ("财务比率", "应收/收入", m.receivable_revenue_ratio, "%"),
    ];
    csv_rows.extend(metric_rows.into_iter().map(|(sheet, field, value, unit)| {
        [
            csv_escape(&report.code),
            csv_escape(&report.name),
            csv_escape(&report.year),
            csv_escape(&report.period_end),
            csv_escape(sheet),
            csv_escape(field),
            csv_escape(value),
            csv_escape(unit),
        ]
        .join(",")
    }));
    csv_rows.join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn stock(metrics: HashMap<String, f64>) -> Stock {
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
            indexes: Vec::new(),
            metrics,
        }
    }

    #[test]
    fn builds_only_real_annual_report_period() {
        let reports = build_annual_financial_reports(&stock(HashMap::from([
            ("realAnnualReportSource".to_string(), 1.0),
            ("realAnnualReportDate".to_string(), 20251231.0),
            ("realAnnualReportDisclosureDate".to_string(), 20260430.0),
            ("revenue".to_string(), 1275.0),
            ("netProfit".to_string(), 747.0),
            ("operatingCashflow".to_string(), 650.0),
            ("totalAssets".to_string(), 2550.0),
            ("totalLiabilities".to_string(), 420.0),
        ])));

        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].year, "2025");
        assert_eq!(reports[0].period_end, "2025-12-31");
        assert_eq!(reports[0].disclosure_date, "2026-04-30");
        assert!(reports[0].source_note.contains("不倒推历史年度"));
        assert!(reports[0].source_csv.contains("利润表"));
    }

    #[test]
    fn rejects_quarterly_or_sample_financial_fields() {
        assert!(build_annual_financial_reports(&stock(HashMap::from([
            ("realAnnualReportSource".to_string(), 1.0),
            ("realFinancialReportDate".to_string(), 20260331.0),
        ])))
        .is_empty());
        assert!(build_annual_financial_reports(&stock(HashMap::from([
            ("revenue".to_string(), 1275.0),
            ("netProfit".to_string(), 747.0),
        ])))
        .is_empty());
    }
}
