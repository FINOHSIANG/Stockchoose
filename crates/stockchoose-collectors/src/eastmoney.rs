use crate::CollectorError;
use reqwest::Url;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

const EASTMONEY_CLIST_URL: &str = "https://push2delay.eastmoney.com/api/qt/clist/get";
const EASTMONEY_KLINE_URL: &str = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const EASTMONEY_DATACENTER_URL: &str = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const EASTMONEY_ANNOUNCEMENT_URL: &str = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const EASTMONEY_UT: &str = "bd1d9ddb04089700cf9c27f6f7426281";
const SPOT_FIELDS: &str =
    "f12,f14,f2,f3,f5,f6,f8,f20,f21,f9,f23,f7,f24,f26,f62,f66,f69,f72,f75,f78,f81,f84,f87,f184";
const A_SHARE_FS: &str = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";
const PAGE_CONCURRENCY: usize = 8;

#[derive(Debug, Clone)]
pub struct EastmoneyClient {
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialStatementRows {
    pub performance_rows: Vec<Value>,
    pub income_rows: Vec<Value>,
    pub balance_rows: Vec<Value>,
    pub cash_flow_rows: Vec<Value>,
    pub report_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialMetricRow {
    pub code: String,
    pub name: String,
    pub report_date: String,
    pub source_rows: usize,
    pub metrics: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementRow {
    pub id: String,
    pub title: String,
    pub url: String,
    pub published_at: String,
    pub source: String,
    pub category: String,
    pub stock_codes: Vec<String>,
    pub stock_names: Vec<String>,
}

impl EastmoneyClient {
    pub fn new() -> Result<Self, CollectorError> {
        let http = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 StockChoose-Rust/0.1")
            .build()?;
        Ok(Self { http })
    }

    pub async fn aktools_payload(
        &self,
        endpoint: &str,
        query: &HashMap<String, String>,
    ) -> Result<Option<Value>, CollectorError> {
        let payload = match endpoint {
            "stock_zh_a_spot_em" | "stock_zh_a_spot" => Value::Array(self.fetch_spot_rows().await?),
            "stock_zh_a_hist" => Value::Array(self.fetch_hist_rows(query).await?),
            "stock_yjbb_em" | "stock_lrb_em" | "stock_zcfz_em" | "stock_xjll_em" => Value::Array(
                self.financial_rows_for_endpoint(endpoint, query.get("date").map(String::as_str))
                    .await?,
            ),
            _ => return Ok(None),
        };
        Ok(Some(payload))
    }

    pub async fn fetch_spot_rows(&self) -> Result<Vec<Value>, CollectorError> {
        let page_size = 100_u64;
        let first_url = url_with_params(
            EASTMONEY_CLIST_URL,
            &[
                ("pn", "1".to_string()),
                ("pz", page_size.to_string()),
                ("po", "1".to_string()),
                ("np", "1".to_string()),
                ("ut", EASTMONEY_UT.to_string()),
                ("fltt", "2".to_string()),
                ("invt", "2".to_string()),
                ("fid", "f3".to_string()),
                ("fs", A_SHARE_FS.to_string()),
                ("fields", SPOT_FIELDS.to_string()),
            ],
        )?;
        let first_payload = self.fetch_json(first_url.clone()).await?;
        let total = first_payload
            .pointer("/data/total")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let pages = total.div_ceil(page_size).max(1);
        let mut rows = value_array_at(&first_payload, "/data/diff")?;

        for payload in self.fetch_remaining_pages(&first_url, pages, "pn").await? {
            rows.extend(value_array_at(&payload, "/data/diff")?);
        }

        Ok(rows
            .iter()
            .map(map_spot_row)
            .filter(|row| row.get("代码").is_some() && row.get("名称").is_some())
            .collect())
    }

    pub async fn fetch_hist_rows(
        &self,
        query: &HashMap<String, String>,
    ) -> Result<Vec<Value>, CollectorError> {
        let symbol = normalize_code(
            query
                .get("symbol")
                .or_else(|| query.get("code"))
                .map(String::as_str)
                .unwrap_or("000001"),
        );
        let url = url_with_params(
            EASTMONEY_KLINE_URL,
            &[
                ("secid", eastmoney_secid(&symbol)),
                ("fields1", "f1,f2,f3,f4,f5,f6".to_string()),
                ("fields2", "f51,f52,f53,f54,f55,f56,f57".to_string()),
                ("klt", "101".to_string()),
                (
                    "fqt",
                    if query.get("adjust").is_some() {
                        "1"
                    } else {
                        "0"
                    }
                    .to_string(),
                ),
                (
                    "beg",
                    query
                        .get("start_date")
                        .cloned()
                        .unwrap_or_else(|| "20240501".to_string()),
                ),
                (
                    "end",
                    query
                        .get("end_date")
                        .cloned()
                        .unwrap_or_else(|| "20240531".to_string()),
                ),
            ],
        )?;
        let payload = self.fetch_json(url).await?;
        let rows = value_array_at(&payload, "/data/klines")?;
        Ok(rows
            .iter()
            .enumerate()
            .map(|(index, row)| {
                let line = row.as_str().ok_or_else(|| {
                    CollectorError::InvalidPayload(format!(
                        "eastmoney hist row {index} must be a comma-separated string"
                    ))
                })?;
                validate_hist_line(line, index)?;
                let parts: Vec<_> = line.split(',').collect();
                Ok(compact_row(vec![
                    ("日期", str_value(parts.first().copied().unwrap_or(""))),
                    ("开盘", number_value(parts.get(1).copied())),
                    ("收盘", number_value(parts.get(2).copied())),
                    ("最高", number_value(parts.get(3).copied())),
                    ("最低", number_value(parts.get(4).copied())),
                    ("成交量", number_value(parts.get(5).copied())),
                    ("成交额", number_value(parts.get(6).copied())),
                ]))
            })
            .collect::<Result<Vec<_>, CollectorError>>()?)
    }

    pub async fn fetch_financial_statements(
        &self,
        report_date: Option<&str>,
    ) -> Result<FinancialStatementRows, CollectorError> {
        let report_date = normalize_report_date(report_date);
        let (performance, income, balance, cash_flow) = tokio::try_join!(
            self.fetch_performance_rows(Some(&report_date)),
            self.fetch_statement_rows("RPT_DMSK_FN_INCOME", Some(&report_date)),
            self.fetch_statement_rows("RPT_DMSK_FN_BALANCE", Some(&report_date)),
            self.fetch_statement_rows("RPT_DMSK_FN_CASHFLOW", Some(&report_date))
        )?;
        let performance_rows = performance.iter().map(map_performance_row).collect();
        let income_rows = income.iter().map(map_income_row).collect();
        let balance_rows = balance
            .iter()
            .map(map_balance_row)
            .filter(|row| row.get("资产总计").is_some())
            .collect();
        let cash_flow_rows = cash_flow
            .iter()
            .map(map_cashflow_row)
            .filter(|row| row.get("经营活动产生的现金流量净额").is_some())
            .collect();
        Ok(FinancialStatementRows {
            performance_rows,
            income_rows,
            balance_rows,
            cash_flow_rows,
            report_date,
        })
    }

    pub async fn fetch_financial_metrics(
        &self,
        report_date: Option<&str>,
    ) -> Result<Vec<FinancialMetricRow>, CollectorError> {
        let statements = self.fetch_financial_statements(report_date).await?;
        Ok(financial_metrics_from_statements(&statements))
    }

    pub async fn fetch_analyst_forecast_metrics(
        &self,
    ) -> Result<Vec<FinancialMetricRow>, CollectorError> {
        let first_url = datacenter_url_with_columns(
            "RPT_WEB_RESPREDICT",
            "WEB_RESPREDICT",
            "RATING_ORG_NUM",
            "-1",
            None,
        )?;
        let rows = self.fetch_datacenter_pages(first_url).await?;
        analyst_forecast_metrics_from_rows(&rows)
    }

    pub async fn fetch_margin_balance_metrics(
        &self,
    ) -> Result<Vec<FinancialMetricRow>, CollectorError> {
        let trade_date = self.fetch_latest_margin_trade_date().await?;
        let first_url = datacenter_url_with_columns(
            "RPTA_WEB_RZRQ_GGMX",
            "SCODE,SECNAME,DATE,RZYE,RQYE,RZRQYE,RZMRE,RZCHE,RZJME,FIN_BALANCE_GR,SECUCODE",
            "RZRQYE",
            "-1",
            Some(&format!("(DATE='{trade_date}')")),
        )?;
        let rows = self.fetch_datacenter_pages(first_url).await?;
        margin_balance_metrics_from_rows(&rows)
    }

    pub async fn fetch_north_holding_metrics(
        &self,
    ) -> Result<Vec<FinancialMetricRow>, CollectorError> {
        let trade_date = self.fetch_latest_north_hold_trade_date().await?;
        let first_url = datacenter_url_with_columns(
            "RPT_MUTUAL_HOLDSTOCKNDATE_STA",
            "SECUCODE,SECURITY_CODE,SECURITY_NAME,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,HOLD_SHARES,HOLD_MARKET_CAP,A_SHARES_RATIO,HOLD_SHARES_RATIO,FREE_SHARES_RATIO,TOTAL_SHARES_RATIO,ADD_SHARES_REPAIR,PREDICT_AMC,HMC_CHANGE",
            "HOLD_MARKET_CAP",
            "-1",
            Some(&format!(
                "(INTERVAL_TYPE=\"1\")(TRADE_DATE>='{trade_date}')(TRADE_DATE<='{trade_date}')"
            )),
        )?;
        let rows = self.fetch_datacenter_pages(first_url).await?;
        north_holding_metrics_from_rows(&rows)
    }

    pub async fn fetch_announcement_rows(
        &self,
        stock_codes: &[String],
        max_items: usize,
    ) -> Result<Vec<AnnouncementRow>, CollectorError> {
        let limit = max_items.clamp(1, 100);
        let mut rows = Vec::new();
        if stock_codes.is_empty() {
            rows.extend(self.fetch_announcement_page(None, limit).await?);
        } else {
            for stock_code in stock_codes {
                rows.extend(
                    self.fetch_announcement_page(Some(&normalize_code(stock_code)), limit)
                        .await?,
                );
            }
        }
        rows.sort_by(|left, right| right.published_at.cmp(&left.published_at));
        rows.dedup_by(|left, right| left.id == right.id);
        rows.truncate(limit);
        Ok(rows)
    }

    async fn financial_rows_for_endpoint(
        &self,
        endpoint: &str,
        report_date: Option<&str>,
    ) -> Result<Vec<Value>, CollectorError> {
        Ok(match endpoint {
            "stock_yjbb_em" => self
                .fetch_performance_rows(report_date)
                .await?
                .iter()
                .map(map_performance_row)
                .collect(),
            "stock_lrb_em" => self
                .fetch_statement_rows("RPT_DMSK_FN_INCOME", report_date)
                .await?
                .iter()
                .map(map_income_row)
                .collect(),
            "stock_zcfz_em" => self
                .fetch_statement_rows("RPT_DMSK_FN_BALANCE", report_date)
                .await?
                .iter()
                .map(map_balance_row)
                .filter(|row| row.get("资产总计").is_some())
                .collect(),
            "stock_xjll_em" => self
                .fetch_statement_rows("RPT_DMSK_FN_CASHFLOW", report_date)
                .await?
                .iter()
                .map(map_cashflow_row)
                .filter(|row| row.get("经营活动产生的现金流量净额").is_some())
                .collect(),
            _ => return Err(CollectorError::UnsupportedEndpoint(endpoint.to_string())),
        })
    }

    async fn fetch_performance_rows(
        &self,
        report_date: Option<&str>,
    ) -> Result<Vec<Value>, CollectorError> {
        let report_date = normalize_report_date(report_date);
        let first_url = datacenter_url(
            "RPT_LICO_FN_CPD",
            "SECURITY_CODE",
            "1",
            &format!("(REPORTDATE='{}')", report_date),
        )?;
        self.fetch_datacenter_pages(first_url).await
    }

    async fn fetch_statement_rows(
        &self,
        report_name: &str,
        report_date: Option<&str>,
    ) -> Result<Vec<Value>, CollectorError> {
        let report_date = normalize_report_date(report_date);
        let filter = format!(
            "(SECURITY_TYPE_CODE in (\"058001001\",\"058001008\"))(TRADE_MARKET_CODE!=\"069001017\")(REPORT_DATE='{}')",
            report_date
        );
        let first_url = datacenter_url(report_name, "NOTICE_DATE,SECURITY_CODE", "-1,-1", &filter)?;
        self.fetch_datacenter_pages(first_url).await
    }

    async fn fetch_latest_margin_trade_date(&self) -> Result<String, CollectorError> {
        let url = url_with_params(
            EASTMONEY_DATACENTER_URL,
            &[
                ("sortColumns", "date".to_string()),
                ("sortTypes", "-1".to_string()),
                ("pageSize", "1".to_string()),
                ("pageNumber", "1".to_string()),
                ("reportName", "RPTA_WEB_RZRQ_GGMX".to_string()),
                ("columns", "DATE".to_string()),
            ],
        )?;
        let payload = self.fetch_json(url).await?;
        let rows = value_array_at(&payload, "/result/data")?;
        let first = rows.first().ok_or_else(|| {
            CollectorError::InvalidPayload(
                "eastmoney margin balance latest-date probe returned no rows".to_string(),
            )
        })?;
        margin_trade_date_label(first).ok_or_else(|| {
            CollectorError::InvalidPayload(
                "eastmoney margin balance latest-date probe missing DATE".to_string(),
            )
        })
    }

    async fn fetch_latest_north_hold_trade_date(&self) -> Result<String, CollectorError> {
        let url = with_query_param(
            &datacenter_url_with_columns(
                "RPT_MUTUAL_HOLDSTOCKNDATE_STA",
                "TRADE_DATE",
                "TRADE_DATE",
                "-1",
                Some("(INTERVAL_TYPE=\"1\")"),
            )?,
            "pageSize",
            "1",
        );
        let payload = self.fetch_json(url).await?;
        let rows = value_array_at(&payload, "/result/data")?;
        rows.first()
            .and_then(|row| row_text(row, &["TRADE_DATE"]))
            .and_then(|text| text.split_whitespace().next().map(str::to_string))
            .ok_or_else(|| {
                CollectorError::InvalidPayload(
                    "eastmoney north holdings payload missing latest TRADE_DATE".to_string(),
                )
            })
    }

    async fn fetch_announcement_page(
        &self,
        stock_code: Option<&str>,
        max_items: usize,
    ) -> Result<Vec<AnnouncementRow>, CollectorError> {
        let mut url = Url::parse(EASTMONEY_ANNOUNCEMENT_URL)?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("sr", "-1")
                .append_pair("page_size", &max_items.clamp(1, 100).to_string())
                .append_pair("page_index", "1")
                .append_pair("ann_type", "A")
                .append_pair("client_source", "web")
                .append_pair("f_node", "0")
                .append_pair("s_node", "0");
            if let Some(code) = stock_code.filter(|value| !value.trim().is_empty()) {
                query.append_pair("stock_list", code);
            }
        }
        let payload = self.fetch_json(url).await?;
        let rows = value_array_at(&payload, "/data/list")?;
        rows.iter()
            .enumerate()
            .map(|(index, row)| announcement_row_from_value(row, index))
            .collect()
    }

    async fn fetch_datacenter_pages(&self, first_url: Url) -> Result<Vec<Value>, CollectorError> {
        let first_payload = self.fetch_json(first_url.clone()).await?;
        let pages = first_payload
            .pointer("/result/pages")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1);
        let mut rows = value_array_at(&first_payload, "/result/data")?;
        for payload in self
            .fetch_remaining_pages(&first_url, pages, "pageNumber")
            .await?
        {
            rows.extend(value_array_at(&payload, "/result/data")?);
        }
        Ok(rows)
    }

    async fn fetch_remaining_pages(
        &self,
        first_url: &Url,
        pages: u64,
        page_param: &str,
    ) -> Result<Vec<Value>, CollectorError> {
        let mut payloads = Vec::new();
        let page_numbers: Vec<u64> = (2..=pages).collect();
        for chunk in page_numbers.chunks(PAGE_CONCURRENCY) {
            let mut tasks = tokio::task::JoinSet::new();
            for page in chunk {
                let client = self.clone();
                let url = with_query_param(first_url, page_param, &page.to_string());
                tasks.spawn(async move { client.fetch_json(url).await });
            }
            while let Some(result) = tasks.join_next().await {
                let payload = result.map_err(|error| {
                    CollectorError::InvalidPayload(format!("eastmoney page task failed: {error}"))
                })??;
                payloads.push(payload);
            }
        }
        Ok(payloads)
    }

    async fn fetch_json(&self, url: Url) -> Result<Value, CollectorError> {
        Ok(self
            .http
            .get(url)
            .header("accept", "application/json,text/plain,*/*")
            .header("referer", "https://quote.eastmoney.com/")
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?)
    }
}

fn url_with_params(base: &str, params: &[(&str, String)]) -> Result<Url, CollectorError> {
    let mut url = Url::parse(base)?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    Ok(url)
}

fn datacenter_url(
    report_name: &str,
    sort_columns: &str,
    sort_types: &str,
    filter: &str,
) -> Result<Url, CollectorError> {
    datacenter_url_with_columns(report_name, "ALL", sort_columns, sort_types, Some(filter))
}

fn datacenter_url_with_columns(
    report_name: &str,
    columns: &str,
    sort_columns: &str,
    sort_types: &str,
    filter: Option<&str>,
) -> Result<Url, CollectorError> {
    let mut params = vec![
        ("sortColumns", sort_columns.to_string()),
        ("sortTypes", sort_types.to_string()),
        ("pageSize", "500".to_string()),
        ("pageNumber", "1".to_string()),
        ("reportName", report_name.to_string()),
        ("columns", columns.to_string()),
    ];
    if let Some(filter) = filter.filter(|value| !value.trim().is_empty()) {
        params.push(("filter", filter.to_string()));
    }
    url_with_params(EASTMONEY_DATACENTER_URL, &params)
}

fn with_query_param(url: &Url, key: &str, value: &str) -> Url {
    let mut next = url.clone();
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(item_key, _)| item_key != key)
        .map(|(item_key, item_value)| (item_key.into_owned(), item_value.into_owned()))
        .collect();
    next.set_query(None);
    {
        let mut query = next.query_pairs_mut();
        for (item_key, item_value) in pairs {
            query.append_pair(&item_key, &item_value);
        }
        query.append_pair(key, value);
    }
    next
}

fn value_array_at(payload: &Value, pointer: &str) -> Result<Vec<Value>, CollectorError> {
    payload
        .pointer(pointer)
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            CollectorError::InvalidPayload(format!("eastmoney payload missing array at {pointer}"))
        })
}

fn validate_hist_line(line: &str, index: usize) -> Result<(), CollectorError> {
    let field_count = line.split(',').count();
    if field_count < 7 {
        return Err(CollectorError::InvalidPayload(format!(
            "eastmoney hist row {index} has {field_count} fields, expected at least 7"
        )));
    }
    Ok(())
}

fn compact_row(entries: Vec<(&str, Value)>) -> Value {
    let mut map = Map::new();
    for (key, value) in entries {
        if is_present(&value) {
            map.insert(key.to_string(), value);
        }
    }
    Value::Object(map)
}

fn is_present(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        _ => true,
    }
}

fn str_value(value: &str) -> Value {
    Value::String(value.to_string())
}

fn number_value(value: Option<&str>) -> Value {
    value
        .and_then(|text| text.replace(',', "").parse::<f64>().ok())
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn value_at(row: &Value, key: &str) -> Value {
    row.get(key).cloned().unwrap_or(Value::Null)
}

fn announcement_row_from_value(
    row: &Value,
    index: usize,
) -> Result<AnnouncementRow, CollectorError> {
    let id = row_text(row, &["art_code", "id"]).ok_or_else(|| {
        CollectorError::InvalidPayload(format!("eastmoney announcement row {index} missing id"))
    })?;
    let title = row_text(row, &["title", "title_ch"]).ok_or_else(|| {
        CollectorError::InvalidPayload(format!("eastmoney announcement row {index} missing title"))
    })?;
    let codes = row.get("codes").and_then(Value::as_array).ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "eastmoney announcement row {index} missing codes array"
        ))
    })?;
    let mut stock_codes = Vec::new();
    let mut stock_names = Vec::new();
    for code_row in codes {
        if let Some(code) = row_text(code_row, &["stock_code", "code"]) {
            stock_codes.push(normalize_code(&code));
        }
        if let Some(name) = row_text(code_row, &["short_name", "name"]) {
            stock_names.push(name);
        }
    }
    stock_codes.sort();
    stock_codes.dedup();
    stock_names.sort();
    stock_names.dedup();
    if stock_codes.is_empty() {
        return Err(CollectorError::InvalidPayload(format!(
            "eastmoney announcement row {index} has no stock code"
        )));
    }
    let published_at =
        row_text(row, &["display_time", "notice_date", "sort_date"]).ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "eastmoney announcement row {index} missing published time"
            ))
        })?;
    let category = row
        .get("columns")
        .and_then(Value::as_array)
        .and_then(|columns| columns.first())
        .and_then(|column| row_text(column, &["column_name", "name"]))
        .unwrap_or_else(|| "公司公告".to_string());
    let first_code = stock_codes
        .first()
        .ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "eastmoney announcement row {index} has no stock code"
            ))
        })?
        .clone();
    Ok(AnnouncementRow {
        id: id.clone(),
        title,
        url: format!("https://data.eastmoney.com/notices/detail/{first_code}/{id}.html"),
        published_at,
        source: "东方财富公告".to_string(),
        category,
        stock_codes,
        stock_names,
    })
}

fn number_at(row: &Value, key: &str) -> Option<f64> {
    match row.get(key) {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.replace(',', "").parse::<f64>().ok(),
        _ => None,
    }
}

fn number_or_null(value: Option<f64>) -> Value {
    value
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn sum_numbers(values: &[Option<f64>]) -> Option<f64> {
    let valid: Vec<f64> = values.iter().flatten().copied().collect();
    if valid.is_empty() {
        None
    } else {
        Some(valid.iter().sum())
    }
}

fn normalize_code(value: &str) -> String {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() >= 6 {
        digits[digits.len() - 6..].to_string()
    } else {
        format!("{digits:0>6}")
    }
}

fn eastmoney_secid(code: &str) -> String {
    if code.starts_with('6') || code.starts_with('9') {
        format!("1.{code}")
    } else {
        format!("0.{code}")
    }
}

fn normalize_report_date(value: Option<&str>) -> String {
    let digits: String = value
        .unwrap_or("")
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect();
    if digits.len() >= 8 {
        return format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8]);
    }
    "2025-12-31".to_string()
}

fn map_spot_row(row: &Value) -> Value {
    compact_row(vec![
        ("代码", value_at(row, "f12")),
        ("名称", value_at(row, "f14")),
        ("最新价", value_at(row, "f2")),
        ("涨跌幅", value_at(row, "f3")),
        ("成交量", value_at(row, "f5")),
        ("成交额", value_at(row, "f6")),
        ("换手率", value_at(row, "f8")),
        ("总市值", value_at(row, "f20")),
        ("流通市值", value_at(row, "f21")),
        ("市盈率-动态", value_at(row, "f9")),
        ("市净率", value_at(row, "f23")),
        ("振幅", value_at(row, "f7")),
        ("60日涨跌幅", value_at(row, "f24")),
        ("listingDate", value_at(row, "f26")),
        ("netInflow", value_at(row, "f62")),
        ("superLargeNetInflow", value_at(row, "f66")),
        ("superLargeNetInflowRatio", value_at(row, "f69")),
        ("largeNetInflow", value_at(row, "f72")),
        ("largeNetInflowRatio", value_at(row, "f75")),
        ("mediumNetInflow", value_at(row, "f78")),
        ("mediumNetInflowRatio", value_at(row, "f81")),
        ("smallNetInflow", value_at(row, "f84")),
        ("smallNetInflowRatio", value_at(row, "f87")),
        ("netInflowRatio", value_at(row, "f184")),
        ("code", value_at(row, "f12")),
        ("name", value_at(row, "f14")),
        ("price", value_at(row, "f2")),
        ("pctChange", value_at(row, "f3")),
        ("volume", value_at(row, "f5")),
        ("amount", value_at(row, "f6")),
        ("turnover", value_at(row, "f8")),
        ("marketCap", value_at(row, "f20")),
        ("floatMarketCap", value_at(row, "f21")),
        ("pe", value_at(row, "f9")),
        ("pb", value_at(row, "f23")),
        ("amplitude", value_at(row, "f7")),
        ("momentum60", value_at(row, "f24")),
    ])
}

fn map_performance_row(row: &Value) -> Value {
    compact_row(vec![
        ("股票代码", value_at(row, "SECURITY_CODE")),
        ("股票简称", value_at(row, "SECURITY_NAME_ABBR")),
        ("披露日期", value_at(row, "NOTICE_DATE")),
        ("营业收入", value_at(row, "TOTAL_OPERATE_INCOME")),
        ("营业总收入", value_at(row, "TOTAL_OPERATE_INCOME")),
        ("净利润", value_at(row, "PARENT_NETPROFIT")),
        ("基本每股收益", value_at(row, "BASIC_EPS")),
        ("每股收益", value_at(row, "BASIC_EPS")),
        ("每股净资产", value_at(row, "BPS")),
        ("净资产收益率", value_at(row, "WEIGHTAVG_ROE")),
        ("营业收入同比增长", value_at(row, "YSTZ")),
        ("净利润同比增长", value_at(row, "SJLTZ")),
        ("销售毛利率", value_at(row, "XSMLL")),
        ("报告期", value_at(row, "REPORTDATE")),
    ])
}

fn map_income_row(row: &Value) -> Value {
    let revenue = number_at(row, "TOTAL_OPERATE_INCOME");
    let gross_margin = number_at(row, "XSMLL");
    let gross_profit = gross_margin
        .zip(revenue)
        .map(|(margin, amount)| amount * margin / 100.0);
    let operating_cost = number_at(row, "TOTAL_OPERATE_COST")
        .or_else(|| number_at(row, "OPERATE_COST"))
        .or_else(|| {
            gross_profit
                .zip(revenue)
                .map(|(profit, amount)| amount - profit)
        });
    compact_row(vec![
        ("股票代码", value_at(row, "SECURITY_CODE")),
        ("股票简称", value_at(row, "SECURITY_NAME_ABBR")),
        ("披露日期", value_at(row, "NOTICE_DATE")),
        ("营业总收入", value_at(row, "TOTAL_OPERATE_INCOME")),
        ("营业收入", value_at(row, "TOTAL_OPERATE_INCOME")),
        ("营业成本", number_or_null(operating_cost)),
        ("净利润", value_at(row, "PARENT_NETPROFIT")),
        ("归母净利润", value_at(row, "PARENT_NETPROFIT")),
    ])
}

fn map_balance_row(row: &Value) -> Value {
    let investment_assets = sum_numbers(&[
        number_at(row, "MONETARYFUNDS"),
        number_at(row, "TRADING_FINANCIAL_ASSETS"),
        number_at(row, "AVAILABLE_SALE_FINASSET"),
        number_at(row, "LONG_EQUITY_INVEST"),
    ]);
    let interest_bearing_debt = sum_numbers(&[
        number_at(row, "SHORT_LOAN"),
        number_at(row, "LONG_LOAN"),
        number_at(row, "BOND_PAYABLE"),
        number_at(row, "NONCURRENT_LIAB_1YEAR"),
    ]);
    compact_row(vec![
        ("股票代码", value_at(row, "SECURITY_CODE")),
        ("股票简称", value_at(row, "SECURITY_NAME_ABBR")),
        ("披露日期", value_at(row, "NOTICE_DATE")),
        ("资产总计", value_at(row, "TOTAL_ASSETS")),
        ("负债合计", value_at(row, "TOTAL_LIABILITIES")),
        ("流动资产合计", value_at(row, "TOTAL_CURRENT_ASSETS")),
        ("流动负债合计", value_at(row, "TOTAL_CURRENT_LIAB")),
        ("存货", value_at(row, "INVENTORY")),
        ("应收账款", value_at(row, "ACCOUNTS_RECE")),
        (
            "投资性资产",
            number_or_null(investment_assets.or(Some(0.0))),
        ),
        (
            "有息负债",
            number_or_null(interest_bearing_debt.or(Some(0.0))),
        ),
    ])
}

fn map_cashflow_row(row: &Value) -> Value {
    let share_base = share_base_from_performance(row);
    let cashflow_per_share = number_at(row, "MGJYXJJE");
    let derived_cashflow = share_base
        .zip(cashflow_per_share)
        .map(|(shares, cashflow)| shares * cashflow);
    compact_row(vec![
        ("股票代码", value_at(row, "SECURITY_CODE")),
        ("股票简称", value_at(row, "SECURITY_NAME_ABBR")),
        ("披露日期", value_at(row, "NOTICE_DATE")),
        (
            "经营活动产生的现金流量净额",
            number_or_null(number_at(row, "NETCASH_OPERATE").or(derived_cashflow)),
        ),
    ])
}

fn share_base_from_performance(row: &Value) -> Option<f64> {
    let net_profit = number_at(row, "PARENT_NETPROFIT");
    let eps = number_at(row, "BASIC_EPS");
    net_profit.zip(eps).and_then(|(profit, eps)| {
        if eps.abs() > 0.0001 {
            Some(profit / eps)
        } else {
            None
        }
    })
}

fn financial_metrics_from_statements(
    statements: &FinancialStatementRows,
) -> Vec<FinancialMetricRow> {
    let performance_by_code = rows_by_code(&statements.performance_rows);
    let income_by_code = rows_by_code(&statements.income_rows);
    let balance_by_code = rows_by_code(&statements.balance_rows);
    let cash_flow_by_code = rows_by_code(&statements.cash_flow_rows);

    let mut codes: HashSet<String> = HashSet::new();
    codes.extend(performance_by_code.keys().cloned());
    codes.extend(income_by_code.keys().cloned());
    codes.extend(balance_by_code.keys().cloned());
    codes.extend(cash_flow_by_code.keys().cloned());

    let mut rows: Vec<FinancialMetricRow> = codes
        .into_iter()
        .filter_map(|code| {
            let performance = performance_by_code.get(&code).copied();
            let income = income_by_code.get(&code).copied();
            let balance = balance_by_code.get(&code).copied();
            let cash_flow = cash_flow_by_code.get(&code).copied();
            financial_metric_row_for_code(
                &code,
                performance,
                income,
                balance,
                cash_flow,
                &statements.report_date,
            )
        })
        .collect();
    rows.sort_by(|a, b| a.code.cmp(&b.code));
    rows
}

fn financial_metric_row_for_code(
    code: &str,
    performance: Option<&Value>,
    income: Option<&Value>,
    balance: Option<&Value>,
    cash_flow: Option<&Value>,
    report_date: &str,
) -> Option<FinancialMetricRow> {
    let revenue = first_number(&[
        amount_yi(
            income,
            &[
                "营业收入",
                "营业总收入",
                "OPERATE_INCOME",
                "TOTAL_OPERATE_INCOME",
            ],
        ),
        amount_yi(
            performance,
            &[
                "营业收入",
                "营业总收入",
                "OPERATE_INCOME",
                "TOTAL_OPERATE_INCOME",
            ],
        ),
    ]);
    let net_profit = first_number(&[
        amount_yi(
            income,
            &["归母净利润", "净利润", "NETPROFIT", "PARENT_NETPROFIT"],
        ),
        amount_yi(
            performance,
            &["归母净利润", "净利润", "NETPROFIT", "PARENT_NETPROFIT"],
        ),
    ]);
    let operating_cashflow = amount_yi(
        cash_flow,
        &[
            "经营活动产生的现金流量净额",
            "经营现金流量净额",
            "NETCASH_OPERATE",
            "NET_CASH_FLOWS_OPERATE",
        ],
    );
    let total_assets = amount_yi(balance, &["资产总计", "总资产", "TOTAL_ASSETS"]);
    let total_liabilities = amount_yi(balance, &["负债合计", "总负债", "TOTAL_LIABILITIES"]);
    let inventory = amount_yi(balance, &["存货", "INVENTORY"]);
    let receivables = amount_yi(balance, &["应收账款", "ACCOUNTS_RECE"]);
    let current_assets = amount_yi(balance, &["流动资产合计", "TOTAL_CURRENT_ASSETS"]);
    let current_liabilities = amount_yi(balance, &["流动负债合计", "TOTAL_CURRENT_LIAB"]);
    let operating_cost = first_number(&[
        amount_yi(
            income,
            &[
                "营业成本",
                "营业总成本",
                "OPERATE_COST",
                "TOTAL_OPERATE_COST",
            ],
        ),
        amount_yi(
            performance,
            &[
                "营业成本",
                "营业总成本",
                "OPERATE_COST",
                "TOTAL_OPERATE_COST",
            ],
        ),
    ]);
    let net_assets = total_assets
        .zip(total_liabilities)
        .map(|(assets, liabilities)| assets - liabilities);
    let eps = number_field(performance, &["基本每股收益", "每股收益", "EPS"]);
    let bps = number_field(performance, &["每股净资产", "BPS"]);
    let roe = first_number(&[
        number_field(performance, &["净资产收益率", "ROE"]),
        safe_ratio(net_profit, net_assets, 100.0),
    ]);
    let roa = first_number(&[
        number_field(performance, &["总资产收益率", "ROA"]),
        safe_ratio(net_profit, total_assets, 100.0),
    ]);
    let gross_margin = first_number(&[
        number_field(performance, &["销售毛利率", "毛利率", "GROSS_PROFIT_RATIO"]),
        revenue
            .zip(operating_cost)
            .and_then(|(income, cost)| safe_ratio(Some(income - cost), Some(income), 100.0)),
    ]);
    let net_margin = first_number(&[
        number_field(performance, &["销售净利率", "净利率", "NET_PROFIT_RATIO"]),
        safe_ratio(net_profit, revenue, 100.0),
    ]);
    let revenue_growth = number_field(
        performance,
        &[
            "营业收入同比增长",
            "营收同比",
            "营业收入增长率",
            "TOTAL_OPERATE_INCOME_YOY",
        ],
    );
    let profit_growth = number_field(
        performance,
        &[
            "净利润同比增长",
            "归母净利润同比增长",
            "净利润增长率",
            "NETPROFIT_YOY",
        ],
    );
    let debt_ratio = first_number(&[
        number_field(performance, &["资产负债率", "DEBT_ASSET_RATIO"]),
        safe_ratio(total_liabilities, total_assets, 100.0),
    ]);
    let current_ratio = current_assets
        .zip(current_liabilities)
        .and_then(|(assets, liabilities)| safe_ratio(Some(assets), Some(liabilities), 1.0));
    let asset_turnover = safe_ratio(revenue, total_assets, 1.0);
    let investment_assets = first_number(&[
        amount_yi(balance, &["投资性资产", "INVESTMENT_ASSETS"]),
        sum_metric_numbers(&[
            amount_yi(balance, &["货币资金", "MONETARYFUNDS"]),
            amount_yi(balance, &["交易性金融资产", "TRADING_FINANCIAL_ASSETS"]),
            amount_yi(balance, &["可供出售金融资产", "AVAILABLE_SALE_FINASSET"]),
            amount_yi(balance, &["长期股权投资", "LONG_EQUITY_INVEST"]),
        ]),
    ]);
    let production_assets = total_assets
        .zip(investment_assets)
        .map(|(assets, investments)| (assets - investments).max(0.0));
    let interest_bearing_debt = first_number(&[
        amount_yi(balance, &["有息负债", "INTEREST_BEARING_DEBT"]),
        sum_metric_numbers(&[
            amount_yi(balance, &["短期借款", "SHORT_LOAN"]),
            amount_yi(balance, &["长期借款", "LONG_LOAN"]),
            amount_yi(balance, &["应付债券", "BOND_PAYABLE"]),
            amount_yi(
                balance,
                &["一年内到期的非流动负债", "NONCURRENT_LIAB_1YEAR"],
            ),
        ]),
    ]);
    let non_interest_bearing_debt = total_liabilities
        .zip(interest_bearing_debt)
        .map(|(liabilities, interest_debt)| (liabilities - interest_debt).max(0.0));
    let quality_score = roe
        .zip(net_margin)
        .zip(debt_ratio)
        .map(|((roe, margin), debt)| {
            clamp(roe * 1.5 + margin * 0.8 - debt * 0.2 + 50.0, 0.0, 100.0)
        });

    let has_report_data = [
        revenue,
        net_profit,
        operating_cashflow,
        total_assets,
        total_liabilities,
    ]
    .iter()
    .any(|value| value.is_some_and(f64::is_finite));
    if !has_report_data {
        return None;
    }

    let report_date_number = parse_date_number(report_date);
    let disclosure_date = first_number(&[
        date_number_field(performance, &["披露日期", "公告日期", "NOTICE_DATE"]),
        date_number_field(income, &["披露日期", "公告日期", "NOTICE_DATE"]),
        date_number_field(balance, &["披露日期", "公告日期", "NOTICE_DATE"]),
        date_number_field(cash_flow, &["披露日期", "公告日期", "NOTICE_DATE"]),
        report_date_number,
    ]);
    let source_rows = [performance, income, balance, cash_flow]
        .iter()
        .filter(|row| row.is_some())
        .count();

    let mut metrics = HashMap::new();
    insert_metric(&mut metrics, "revenue", revenue);
    insert_metric(&mut metrics, "netProfit", net_profit);
    insert_metric(&mut metrics, "operatingCashflow", operating_cashflow);
    insert_metric(&mut metrics, "totalAssets", total_assets);
    insert_metric(&mut metrics, "totalLiabilities", total_liabilities);
    insert_metric(&mut metrics, "inventory", inventory);
    insert_metric(&mut metrics, "receivables", receivables);
    insert_metric(&mut metrics, "eps", eps);
    insert_metric(&mut metrics, "bps", bps);
    insert_metric(&mut metrics, "roe", roe);
    insert_metric(&mut metrics, "roa", roa);
    insert_metric(&mut metrics, "grossMargin", gross_margin);
    insert_metric(&mut metrics, "netMargin", net_margin);
    insert_metric(&mut metrics, "revenueGrowth", revenue_growth);
    insert_metric(&mut metrics, "profitGrowth", profit_growth);
    insert_metric(&mut metrics, "debtRatio", debt_ratio);
    insert_metric(&mut metrics, "currentRatio", current_ratio);
    insert_metric(&mut metrics, "assetTurnover", asset_turnover);
    insert_metric(&mut metrics, "investmentAssets", investment_assets);
    insert_metric(&mut metrics, "productionAssets", production_assets);
    insert_metric(&mut metrics, "interestBearingDebt", interest_bearing_debt);
    insert_metric(
        &mut metrics,
        "nonInterestBearingDebt",
        non_interest_bearing_debt,
    );
    insert_metric(&mut metrics, "qualityScore", quality_score);
    insert_metric(&mut metrics, "realAnnualReportSource", Some(1.0));
    insert_metric(&mut metrics, "realFinancialReportDate", report_date_number);
    insert_metric(
        &mut metrics,
        "realFinancialReportDisclosureDate",
        disclosure_date,
    );
    if report_date_number.is_some_and(is_annual_report_date) {
        insert_metric(&mut metrics, "realAnnualReportDate", report_date_number);
        insert_metric(
            &mut metrics,
            "realAnnualReportDisclosureDate",
            disclosure_date,
        );
    }

    Some(FinancialMetricRow {
        code: code.to_string(),
        name: first_text(
            &[performance, income, balance, cash_flow],
            &["股票简称", "股票名称", "名称"],
        )
        .unwrap_or_else(|| code.to_string()),
        report_date: report_date.to_string(),
        source_rows,
        metrics,
    })
}

fn analyst_forecast_metrics_from_rows(
    rows: &[Value],
) -> Result<Vec<FinancialMetricRow>, CollectorError> {
    let mut metrics = rows
        .iter()
        .enumerate()
        .map(|(index, row)| analyst_forecast_metric_row_from_value(row, index))
        .collect::<Result<Vec<_>, CollectorError>>()?;
    metrics.sort_by(|left, right| left.code.cmp(&right.code));
    Ok(metrics)
}

fn margin_balance_metrics_from_rows(
    rows: &[Value],
) -> Result<Vec<FinancialMetricRow>, CollectorError> {
    let mut metrics = rows
        .iter()
        .enumerate()
        .map(|(index, row)| margin_balance_metric_row_from_value(row, index))
        .collect::<Result<Vec<_>, CollectorError>>()?;
    metrics.sort_by(|left, right| left.code.cmp(&right.code));
    Ok(metrics)
}

fn north_holding_metrics_from_rows(
    rows: &[Value],
) -> Result<Vec<FinancialMetricRow>, CollectorError> {
    let mut metrics = rows
        .iter()
        .enumerate()
        .map(|(index, row)| north_holding_metric_row_from_value(row, index))
        .collect::<Result<Vec<_>, CollectorError>>()?;
    metrics.sort_by(|left, right| left.code.cmp(&right.code));
    Ok(metrics)
}

fn north_holding_metric_row_from_value(
    row: &Value,
    index: usize,
) -> Result<FinancialMetricRow, CollectorError> {
    let code = code_from_row(row).ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "eastmoney north holding row {index} missing SECURITY_CODE"
        ))
    })?;
    let north_hold = number_at(row, "HOLD_SHARES_RATIO").ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "eastmoney north holding row {index} missing HOLD_SHARES_RATIO"
        ))
    })?;
    let trade_date_number = date_number_field(Some(row), &["TRADE_DATE"]);
    let mut metrics = HashMap::new();
    insert_metric(&mut metrics, "northHold", Some(north_hold));
    insert_metric(
        &mut metrics,
        "northHoldShares",
        number_at(row, "HOLD_SHARES"),
    );
    insert_metric(
        &mut metrics,
        "northHoldMarketCap",
        yuan_amount_yi(row, "HOLD_MARKET_CAP"),
    );
    insert_metric(
        &mut metrics,
        "northHoldAsharesRatio",
        number_at(row, "A_SHARES_RATIO"),
    );
    insert_metric(
        &mut metrics,
        "northHoldFreeSharesRatio",
        number_at(row, "FREE_SHARES_RATIO"),
    );
    insert_metric(
        &mut metrics,
        "northHoldTotalSharesRatio",
        number_at(row, "TOTAL_SHARES_RATIO"),
    );
    insert_metric(
        &mut metrics,
        "northHoldAddedShares",
        number_at(row, "ADD_SHARES_REPAIR"),
    );
    insert_metric(
        &mut metrics,
        "northHoldPredictAddMarketCap",
        yuan_amount_yi(row, "PREDICT_AMC"),
    );
    insert_metric(
        &mut metrics,
        "northHoldMarketCapChange",
        yuan_amount_yi(row, "HMC_CHANGE"),
    );
    insert_metric(&mut metrics, "northHoldDate", trade_date_number);
    insert_metric(&mut metrics, "realNorthHoldSource", Some(1.0));

    let name = row_text(row, &["SECURITY_NAME", "SECURITY_NAME_ABBR", "name"])
        .unwrap_or_else(|| code.clone());

    Ok(FinancialMetricRow {
        code,
        name,
        report_date: north_hold_date_label(row).unwrap_or_else(|| "north-holding".to_string()),
        source_rows: 1,
        metrics,
    })
}

fn margin_balance_metric_row_from_value(
    row: &Value,
    index: usize,
) -> Result<FinancialMetricRow, CollectorError> {
    let code = code_from_row(row).ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "eastmoney margin balance row {index} missing SCODE"
        ))
    })?;
    let margin_balance = yuan_amount_yi(row, "RZRQYE").ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "eastmoney margin balance row {index} missing RZRQYE"
        ))
    })?;
    let trade_date_number = date_number_field(Some(row), &["DATE"]);
    let mut metrics = HashMap::new();
    insert_metric(&mut metrics, "marginBalance", Some(margin_balance));
    insert_metric(
        &mut metrics,
        "financingBalance",
        yuan_amount_yi(row, "RZYE"),
    );
    insert_metric(
        &mut metrics,
        "securitiesLendingBalance",
        yuan_amount_yi(row, "RQYE"),
    );
    insert_metric(
        &mut metrics,
        "financingBuyAmount",
        yuan_amount_yi(row, "RZMRE"),
    );
    insert_metric(
        &mut metrics,
        "financingRepayAmount",
        yuan_amount_yi(row, "RZCHE"),
    );
    insert_metric(
        &mut metrics,
        "financingNetBuyAmount",
        yuan_amount_yi(row, "RZJME"),
    );
    insert_metric(
        &mut metrics,
        "marginBalanceGrowthRate",
        number_at(row, "FIN_BALANCE_GR"),
    );
    insert_metric(&mut metrics, "marginTradeDate", trade_date_number);
    insert_metric(&mut metrics, "realMarginSource", Some(1.0));

    let name = row_text(
        row,
        &["SECNAME", "SECURITY_NAME_ABBR", "SECURITY_NAME", "name"],
    )
    .unwrap_or_else(|| code.clone());

    Ok(FinancialMetricRow {
        code,
        name,
        report_date: margin_trade_date_label(row).unwrap_or_else(|| "margin-balance".to_string()),
        source_rows: 1,
        metrics,
    })
}

fn margin_trade_date_label(row: &Value) -> Option<String> {
    row_text(row, &["DATE", "DIM_DATE"])
        .and_then(|text| text.split_whitespace().next().map(str::to_string))
}

fn north_hold_date_label(row: &Value) -> Option<String> {
    row_text(row, &["TRADE_DATE"])
        .and_then(|text| text.split_whitespace().next().map(str::to_string))
}

fn yuan_amount_yi(row: &Value, key: &str) -> Option<f64> {
    number_at(row, key).map(|value| value / 100_000_000.0)
}

fn analyst_forecast_metric_row_from_value(
    row: &Value,
    index: usize,
) -> Result<FinancialMetricRow, CollectorError> {
    let code = code_from_row(row).ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "eastmoney analyst forecast row {index} missing SECURITY_CODE"
        ))
    })?;
    let name = row_text(row, &["SECURITY_NAME_ABBR", "SECURITY_NAME", "name"])
        .unwrap_or_else(|| code.clone());
    let recommendation_count = first_number(&[
        number_at(row, "RATING_ORG_NUM"),
        number_at(row, "RATING_LONG_NUM"),
        sum_metric_numbers(&[
            number_at(row, "RATING_BUY_NUM"),
            number_at(row, "RATING_ADD_NUM"),
            number_at(row, "RATING_NEUTRAL_NUM"),
            number_at(row, "RATING_REDUCE_NUM"),
            number_at(row, "RATING_SALE_NUM"),
        ]),
    ]);
    let rating_score = analyst_rating_score(row);
    let actual_eps = eps_by_mark(row, "A").or_else(|| number_at(row, "EPS1"));
    let forecast_eps = first_forecast_eps(row).or_else(|| number_at(row, "EPS2"));
    let eps_forecast_growth = actual_eps.zip(forecast_eps).and_then(|(actual, forecast)| {
        if actual.is_finite() && forecast.is_finite() && actual.abs() >= 0.0001 {
            Some((forecast - actual) / actual.abs() * 100.0)
        } else {
            None
        }
    });
    let target_price_high = number_at(row, "DEC_AIMPRICEMAX");
    let target_price_low = number_at(row, "DEC_AIMPRICEMIN");
    let target_price_mid = match (target_price_low, target_price_high) {
        (Some(low), Some(high)) => Some((low + high) / 2.0),
        (Some(low), None) => Some(low),
        (None, Some(high)) => Some(high),
        (None, None) => None,
    };

    let mut metrics = HashMap::new();
    insert_metric(&mut metrics, "recommendationCount", recommendation_count);
    insert_metric(&mut metrics, "ratingScore", rating_score);
    insert_metric(&mut metrics, "actualEps", actual_eps);
    insert_metric(&mut metrics, "forecastEps", forecast_eps);
    insert_metric(&mut metrics, "epsForecastGrowth", eps_forecast_growth);
    insert_metric(&mut metrics, "targetPriceHigh", target_price_high);
    insert_metric(&mut metrics, "targetPriceLow", target_price_low);
    insert_metric(&mut metrics, "targetPriceMid", target_price_mid);
    insert_metric(&mut metrics, "realAnalystForecastSource", Some(1.0));

    Ok(FinancialMetricRow {
        code,
        name,
        report_date: forecast_year_label(row).unwrap_or_else(|| "analyst-forecast".to_string()),
        source_rows: 1,
        metrics,
    })
}

fn analyst_rating_score(row: &Value) -> Option<f64> {
    let buy = number_at(row, "RATING_BUY_NUM").unwrap_or(0.0);
    let add = number_at(row, "RATING_ADD_NUM").unwrap_or(0.0);
    let neutral = number_at(row, "RATING_NEUTRAL_NUM").unwrap_or(0.0);
    let reduce = number_at(row, "RATING_REDUCE_NUM").unwrap_or(0.0);
    let sale = number_at(row, "RATING_SALE_NUM").unwrap_or(0.0);
    let total = buy + add + neutral + reduce + sale;
    if total > 0.0 {
        Some((buy * 5.0 + add * 4.0 + neutral * 3.0 + reduce * 2.0 + sale) / total)
    } else {
        None
    }
}

fn eps_by_mark(row: &Value, mark: &str) -> Option<f64> {
    (1..=4).find_map(|index| {
        let year_mark = row_text(row, &[&format!("YEAR_MARK{index}")])?;
        if year_mark.eq_ignore_ascii_case(mark) {
            number_at(row, &format!("EPS{index}"))
        } else {
            None
        }
    })
}

fn first_forecast_eps(row: &Value) -> Option<f64> {
    (1..=4).find_map(|index| {
        let year_mark = row_text(row, &[&format!("YEAR_MARK{index}")])?;
        if year_mark.eq_ignore_ascii_case("E") {
            number_at(row, &format!("EPS{index}"))
        } else {
            None
        }
    })
}

fn forecast_year_label(row: &Value) -> Option<String> {
    (1..=4).find_map(|index| {
        let year_mark = row_text(row, &[&format!("YEAR_MARK{index}")])?;
        if !year_mark.eq_ignore_ascii_case("E") {
            return None;
        }
        row_text(row, &[&format!("YEAR{index}")]).map(|year| format!("{year}E"))
    })
}

fn rows_by_code(rows: &[Value]) -> HashMap<String, &Value> {
    let mut map = HashMap::new();
    for row in rows {
        if let Some(code) = code_from_row(row) {
            map.entry(code).or_insert(row);
        }
    }
    map
}

fn code_from_row(row: &Value) -> Option<String> {
    row_text(
        row,
        &[
            "股票代码",
            "证券代码",
            "代码",
            "SECURITY_CODE",
            "SECURITYCODE",
            "SCODE",
            "SECUCODE",
        ],
    )
    .map(|text| normalize_code(&text))
}

fn row_text(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        row.get(*key).and_then(|value| match value {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
    })
}

fn first_text(rows: &[Option<&Value>], keys: &[&str]) -> Option<String> {
    rows.iter()
        .filter_map(|row| row.and_then(|value| row_text(value, keys)))
        .next()
}

fn number_field(row: Option<&Value>, keys: &[&str]) -> Option<f64> {
    row.and_then(|value| {
        keys.iter().find_map(|key| match value.get(*key) {
            Some(Value::Number(number)) => number.as_f64(),
            Some(Value::String(text)) => text.replace(',', "").parse::<f64>().ok(),
            _ => None,
        })
    })
}

fn amount_yi(row: Option<&Value>, keys: &[&str]) -> Option<f64> {
    number_field(row, keys).map(|value| {
        if value.abs() > 100_000.0 {
            value / 100_000_000.0
        } else {
            value
        }
    })
}

fn date_number_field(row: Option<&Value>, keys: &[&str]) -> Option<f64> {
    row.and_then(|value| {
        keys.iter()
            .filter_map(|key| value.get(*key))
            .find_map(parse_date_number_value)
    })
}

fn parse_date_number(value: &str) -> Option<f64> {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() < 8 {
        return None;
    }
    digits.get(0..8)?.parse::<f64>().ok()
}

fn parse_date_number_value(value: &Value) -> Option<f64> {
    match value {
        Value::String(text) => parse_date_number(text),
        Value::Number(number) => number.as_f64(),
        _ => None,
    }
}

fn first_number(values: &[Option<f64>]) -> Option<f64> {
    values
        .iter()
        .flatten()
        .copied()
        .find(|value| value.is_finite())
}

fn sum_metric_numbers(values: &[Option<f64>]) -> Option<f64> {
    let mut has_value = false;
    let mut total = 0.0;
    for value in values
        .iter()
        .flatten()
        .copied()
        .filter(|value| value.is_finite())
    {
        has_value = true;
        total += value;
    }
    has_value.then_some(total)
}

fn safe_ratio(numerator: Option<f64>, denominator: Option<f64>, scale: f64) -> Option<f64> {
    numerator.zip(denominator).and_then(|(top, bottom)| {
        if top.is_finite() && bottom.is_finite() && bottom.abs() >= 0.01 {
            Some(top / bottom * scale)
        } else {
            None
        }
    })
}

fn insert_metric(metrics: &mut HashMap<String, f64>, key: &str, value: Option<f64>) {
    if let Some(value) = value.filter(|value| value.is_finite()) {
        metrics.insert(key.to_string(), round_metric(value, 2));
    }
}

fn round_metric(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.min(max).max(min)
}

fn is_annual_report_date(value: f64) -> bool {
    (value as i64) % 10_000 == 1231
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_statements(report_date: &str) -> FinancialStatementRows {
        FinancialStatementRows {
            performance_rows: vec![json!({
                "股票代码": "600519",
                "股票简称": "贵州茅台",
                "营业收入": 127500000000.0,
                "净利润": 74700000000.0,
                "基本每股收益": 59.49,
                "每股净资产": 230.5,
                "净资产收益率": 31.2,
                "营业收入同比增长": 15.8,
                "净利润同比增长": 19.2,
                "披露日期": "2026-04-30"
            })],
            income_rows: vec![json!({
                "股票代码": "600519",
                "营业总收入": 127500000000.0,
                "营业成本": 11800000000.0,
                "净利润": 74700000000.0
            })],
            balance_rows: vec![json!({
                "股票代码": "600519",
                "资产总计": 255000000000.0,
                "负债合计": 42000000000.0,
                "存货": 38800000000.0,
                "应收账款": 1200000000.0,
                "流动资产合计": 210000000000.0,
                "流动负债合计": 35000000000.0,
                "货币资金": 120000000000.0,
                "交易性金融资产": 5000000000.0,
                "长期股权投资": 1000000000.0,
                "短期借款": 6000000000.0,
                "长期借款": 4000000000.0
            })],
            cash_flow_rows: vec![json!({
                "股票代码": "600519",
                "经营活动产生的现金流量净额": 65000000000.0
            })],
            report_date: report_date.to_string(),
        }
    }

    #[test]
    fn normalizes_financial_statement_rows_to_metrics() {
        let rows = financial_metrics_from_statements(&sample_statements("2025-12-31"));
        let row = rows.iter().find(|row| row.code == "600519").unwrap();

        assert_eq!(row.name, "贵州茅台");
        assert_eq!(row.report_date, "2025-12-31");
        assert_eq!(row.source_rows, 4);
        assert_eq!(row.metrics.get("revenue"), Some(&1275.0));
        assert_eq!(row.metrics.get("netProfit"), Some(&747.0));
        assert_eq!(row.metrics.get("operatingCashflow"), Some(&650.0));
        assert_eq!(row.metrics.get("totalAssets"), Some(&2550.0));
        assert_eq!(row.metrics.get("investmentAssets"), Some(&1260.0));
        assert_eq!(row.metrics.get("productionAssets"), Some(&1290.0));
        assert_eq!(row.metrics.get("interestBearingDebt"), Some(&100.0));
        assert_eq!(row.metrics.get("nonInterestBearingDebt"), Some(&320.0));
        assert_eq!(row.metrics.get("currentRatio"), Some(&6.0));
        assert_eq!(row.metrics.get("realAnnualReportDate"), Some(&20251231.0));
        assert_eq!(
            row.metrics.get("realAnnualReportDisclosureDate"),
            Some(&20260430.0)
        );
    }

    #[test]
    fn maps_spot_rows_with_real_sixty_day_momentum() {
        let row = json!({
            "f12": "600519",
            "f14": "贵州茅台",
            "f2": 1688.88,
            "f3": 1.25,
            "f5": 123456.0,
            "f6": 208000000.0,
            "f8": 0.42,
            "f20": 2100000000000.0,
            "f21": 2100000000000.0,
            "f9": 28.6,
            "f23": 8.2,
            "f7": 2.4,
            "f24": 12.34,
            "f26": 20010827,
            "f62": 2235612416.0,
            "f184": 8.34
        });

        let mapped = map_spot_row(&row);

        assert_eq!(mapped.get("代码"), Some(&json!("600519")));
        assert_eq!(mapped.get("60日涨跌幅"), Some(&json!(12.34)));
        assert_eq!(mapped.get("listingDate"), Some(&json!(20010827)));
        assert_eq!(mapped.get("netInflow"), Some(&json!(2235612416.0)));
        assert_eq!(mapped.get("netInflowRatio"), Some(&json!(8.34)));
    }

    #[test]
    fn rejects_missing_eastmoney_array_payloads() {
        let payload = json!({ "data": { "total": 1 } });
        let error = value_array_at(&payload, "/data/diff").expect_err("missing array should fail");

        assert!(error
            .to_string()
            .contains("eastmoney payload missing array at /data/diff"));
    }

    #[test]
    fn accepts_empty_eastmoney_arrays_when_path_exists() {
        let payload = json!({ "data": { "diff": [] } });
        let rows = value_array_at(&payload, "/data/diff").expect("array path");

        assert!(rows.is_empty());
    }

    #[test]
    fn rejects_malformed_eastmoney_hist_lines() {
        let error =
            validate_hist_line("2024-01-02,10.1,10.2", 0).expect_err("short hist row should fail");

        assert!(error
            .to_string()
            .contains("eastmoney hist row 0 has 3 fields"));
    }

    #[test]
    fn normalizes_eastmoney_announcement_rows() {
        let row = json!({
            "art_code": "AN202606021823168597",
            "title": "Kweichow Moutai annual shareholder meeting materials",
            "display_time": "2026-06-02 20:07:18",
            "codes": [{
                "stock_code": "600519",
                "short_name": "Kweichow Moutai"
            }],
            "columns": [{
                "column_name": "Shareholder meeting"
            }]
        });

        let announcement = announcement_row_from_value(&row, 0).expect("announcement row");

        assert_eq!(announcement.id, "AN202606021823168597");
        assert_eq!(announcement.stock_codes, vec!["600519"]);
        assert_eq!(announcement.stock_names, vec!["Kweichow Moutai"]);
        assert_eq!(announcement.category, "Shareholder meeting");
        assert_eq!(
            announcement.url,
            "https://data.eastmoney.com/notices/detail/600519/AN202606021823168597.html"
        );
    }

    #[test]
    fn rejects_eastmoney_announcement_rows_without_codes() {
        let row = json!({
            "art_code": "AN202606021823168597",
            "title": "Kweichow Moutai annual shareholder meeting materials",
            "display_time": "2026-06-02 20:07:18",
            "codes": []
        });

        let error = announcement_row_from_value(&row, 0).expect_err("missing code should fail");

        assert!(error.to_string().contains("has no stock code"));
    }

    #[test]
    fn normalizes_eastmoney_analyst_forecast_rows() {
        let row = json!({
            "SECURITY_CODE": "600519",
            "SECURITY_NAME_ABBR": "Kweichow Moutai",
            "RATING_ORG_NUM": 44,
            "RATING_BUY_NUM": 37,
            "RATING_ADD_NUM": 7,
            "RATING_NEUTRAL_NUM": null,
            "RATING_REDUCE_NUM": null,
            "RATING_SALE_NUM": null,
            "YEAR1": 2025,
            "YEAR_MARK1": "A",
            "EPS1": 65.851754826108,
            "YEAR2": 2026,
            "YEAR_MARK2": "E",
            "EPS2": 68.959622222222,
            "DEC_AIMPRICEMAX": 2030,
            "DEC_AIMPRICEMIN": 1525
        });

        let metric_row =
            analyst_forecast_metric_row_from_value(&row, 0).expect("analyst forecast metric row");

        assert_eq!(metric_row.code, "600519");
        assert_eq!(metric_row.name, "Kweichow Moutai");
        assert_eq!(metric_row.report_date, "2026E");
        assert_eq!(metric_row.metrics.get("recommendationCount"), Some(&44.0));
        assert_eq!(metric_row.metrics.get("ratingScore"), Some(&4.84));
        assert_eq!(metric_row.metrics.get("epsForecastGrowth"), Some(&4.72));
        assert_eq!(metric_row.metrics.get("targetPriceMid"), Some(&1777.5));
        assert_eq!(
            metric_row.metrics.get("realAnalystForecastSource"),
            Some(&1.0)
        );
    }

    #[test]
    fn normalizes_eastmoney_margin_balance_rows() {
        let row = json!({
            "SCODE": "600519",
            "SECNAME": "Kweichow Moutai",
            "DATE": "2026-06-08 00:00:00",
            "RZYE": 19498594489.0,
            "RQYE": 137841637.2,
            "RZRQYE": 19636436126.2,
            "RZMRE": 349575989.0,
            "RZCHE": 589339461.0,
            "RZJME": -239763472.0,
            "FIN_BALANCE_GR": -1.214708302796,
            "SECUCODE": "600519.SH"
        });

        let metric_row = margin_balance_metric_row_from_value(&row, 0).expect("margin metric row");

        assert_eq!(metric_row.code, "600519");
        assert_eq!(metric_row.name, "Kweichow Moutai");
        assert_eq!(metric_row.report_date, "2026-06-08");
        assert_eq!(metric_row.metrics.get("marginBalance"), Some(&196.36));
        assert_eq!(metric_row.metrics.get("financingBalance"), Some(&194.99));
        assert_eq!(
            metric_row.metrics.get("securitiesLendingBalance"),
            Some(&1.38)
        );
        assert_eq!(metric_row.metrics.get("financingBuyAmount"), Some(&3.5));
        assert_eq!(metric_row.metrics.get("financingRepayAmount"), Some(&5.89));
        assert_eq!(metric_row.metrics.get("financingNetBuyAmount"), Some(&-2.4));
        assert_eq!(
            metric_row.metrics.get("marginBalanceGrowthRate"),
            Some(&-1.21)
        );
        assert_eq!(metric_row.metrics.get("marginTradeDate"), Some(&20260608.0));
        assert_eq!(metric_row.metrics.get("realMarginSource"), Some(&1.0));
    }

    #[test]
    fn normalizes_eastmoney_north_holding_rows() {
        let row = json!({
            "SECUCODE": "600519.SH",
            "SECURITY_CODE": "600519",
            "SECURITY_NAME": "Kweichow Moutai",
            "TRADE_DATE": "2024-08-16 00:00:00",
            "HOLD_SHARES": 82354427.0,
            "HOLD_MARKET_CAP": 117865655922.4,
            "A_SHARES_RATIO": 6.56,
            "HOLD_SHARES_RATIO": 6.55,
            "FREE_SHARES_RATIO": 6.5558,
            "TOTAL_SHARES_RATIO": 6.5558,
            "ADD_SHARES_REPAIR": 39399.0,
            "PREDICT_AMC": 56264037.4425,
            "HMC_CHANGE": 411165619.48
        });

        let metric_row =
            north_holding_metric_row_from_value(&row, 0).expect("north holding metric row");

        assert_eq!(metric_row.code, "600519");
        assert_eq!(metric_row.name, "Kweichow Moutai");
        assert_eq!(metric_row.report_date, "2024-08-16");
        assert_eq!(metric_row.metrics.get("northHold"), Some(&6.55));
        assert_eq!(metric_row.metrics.get("northHoldShares"), Some(&82354427.0));
        assert_eq!(metric_row.metrics.get("northHoldMarketCap"), Some(&1178.66));
        assert_eq!(metric_row.metrics.get("northHoldAsharesRatio"), Some(&6.56));
        assert_eq!(
            metric_row.metrics.get("northHoldAddedShares"),
            Some(&39399.0)
        );
        assert_eq!(
            metric_row.metrics.get("northHoldMarketCapChange"),
            Some(&4.11)
        );
        assert_eq!(metric_row.metrics.get("northHoldDate"), Some(&20240816.0));
        assert_eq!(metric_row.metrics.get("realNorthHoldSource"), Some(&1.0));
    }

    #[test]
    fn rejects_eastmoney_margin_balance_rows_without_balance() {
        let row = json!({
            "SCODE": "600519",
            "SECNAME": "Kweichow Moutai"
        });

        let error =
            margin_balance_metric_row_from_value(&row, 5).expect_err("missing balance should fail");

        assert!(error
            .to_string()
            .contains("eastmoney margin balance row 5 missing RZRQYE"));
    }

    #[test]
    fn treats_small_eastmoney_margin_amounts_as_yuan() {
        let row = json!({
            "SCODE": "159958",
            "SECNAME": "Small ETF",
            "DATE": "2026-06-08 00:00:00",
            "RZYE": 1000000.0,
            "RQYE": 0.0,
            "RZRQYE": 1000000.0,
            "RZMRE": 25000.0,
            "RZCHE": 90217.0,
            "RZJME": -65217.0,
            "FIN_BALANCE_GR": 55.19
        });

        let metric_row = margin_balance_metric_row_from_value(&row, 0).expect("margin metric row");

        assert_eq!(metric_row.metrics.get("marginBalance"), Some(&0.01));
        assert_eq!(metric_row.metrics.get("financingBuyAmount"), Some(&0.0));
        assert_eq!(metric_row.metrics.get("financingRepayAmount"), Some(&0.0));
        assert_eq!(metric_row.metrics.get("financingNetBuyAmount"), Some(&0.0));
    }

    #[test]
    fn rejects_eastmoney_analyst_forecast_rows_without_code() {
        let row = json!({
            "SECURITY_NAME_ABBR": "No Code",
            "RATING_ORG_NUM": 1
        });

        let error =
            analyst_forecast_metric_row_from_value(&row, 3).expect_err("missing code should fail");

        assert!(error
            .to_string()
            .contains("eastmoney analyst forecast row 3 missing SECURITY_CODE"));
    }

    #[test]
    fn does_not_mark_quarterly_financial_metrics_as_annual_reports() {
        let rows = financial_metrics_from_statements(&sample_statements("2026-03-31"));
        let row = rows.iter().find(|row| row.code == "600519").unwrap();

        assert_eq!(
            row.metrics.get("realFinancialReportDate"),
            Some(&20260331.0)
        );
        assert!(!row.metrics.contains_key("realAnnualReportDate"));
    }
}
