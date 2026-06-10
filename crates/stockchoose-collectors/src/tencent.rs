use crate::CollectorError;
use encoding_rs::GBK;
use reqwest::Url;
use serde::Serialize;
use serde_json::Value;

const TENCENT_QUOTE_BASE: &str = "https://qt.gtimg.cn/q=";
const TENCENT_KLINE_BASE: &str = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const QUOTE_CHUNK_SIZE: usize = 80;
const QUOTE_CONCURRENCY: usize = 8;

#[derive(Debug, Clone)]
pub struct TencentClient {
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TencentQuoteRow {
    pub symbol: String,
    pub prefix: String,
    pub code: String,
    pub query_code: String,
    pub name: String,
    pub price: Option<f64>,
    pub pct_change: Option<f64>,
    pub volume_wan_shou: Option<f64>,
    pub amount_yi: Option<f64>,
    pub amplitude: Option<f64>,
    pub turnover: Option<f64>,
    pub pe: Option<f64>,
    pub pb: Option<f64>,
    pub market_cap_yi: Option<f64>,
    pub float_market_cap_yi: Option<f64>,
    pub status_flag: String,
    pub market_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TencentKlinePoint {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

impl TencentClient {
    pub fn new() -> Result<Self, CollectorError> {
        Ok(Self {
            http: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 StockChoose-Rust/0.1")
                .build()?,
        })
    }

    pub async fn quote_bytes(&self, symbols: &[String]) -> Result<Vec<u8>, CollectorError> {
        let url = format!("{}{}", TENCENT_QUOTE_BASE, symbols.join(","));
        Ok(self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?
            .to_vec())
    }

    pub async fn quote_rows(
        &self,
        symbols: &[String],
    ) -> Result<Vec<TencentQuoteRow>, CollectorError> {
        let mut rows = Vec::new();
        for chunk in symbols.chunks(QUOTE_CHUNK_SIZE) {
            rows.extend(self.quote_rows_chunk(chunk).await?);
        }
        if !symbols.is_empty() && rows.is_empty() {
            return Err(CollectorError::InvalidPayload(
                "tencent quote response contained no usable rows".to_string(),
            ));
        }
        Ok(rows)
    }

    pub async fn all_ashare_quote_rows(&self) -> Result<Vec<TencentQuoteRow>, CollectorError> {
        let symbols = generate_tencent_ashare_symbols();
        let mut rows = Vec::new();
        for chunk in symbols
            .chunks(QUOTE_CHUNK_SIZE)
            .collect::<Vec<_>>()
            .chunks(QUOTE_CONCURRENCY)
        {
            let mut tasks = tokio::task::JoinSet::new();
            for symbols in chunk {
                let client = self.clone();
                let symbols = symbols.to_vec();
                tasks.spawn(async move { client.quote_rows_chunk(&symbols).await });
            }
            while let Some(result) = tasks.join_next().await {
                let chunk_rows = result.map_err(|error| {
                    CollectorError::InvalidPayload(format!("tencent quote task failed: {error}"))
                })??;
                rows.extend(chunk_rows);
            }
        }
        Ok(rows)
    }

    async fn quote_rows_chunk(
        &self,
        symbols: &[String],
    ) -> Result<Vec<TencentQuoteRow>, CollectorError> {
        let bytes = self.quote_bytes(symbols).await?;
        let text = decode_quote_bytes(&bytes);
        parse_tencent_quote_text(&text)
    }

    pub async fn kline_payload(
        &self,
        symbol: &str,
        period: &str,
        limit: usize,
    ) -> Result<Value, CollectorError> {
        let mut url = Url::parse(TENCENT_KLINE_BASE)?;
        url.query_pairs_mut()
            .append_pair("param", &format!("{symbol},{period},,,{limit},qfq"));
        Ok(self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?)
    }

    pub async fn kline_points(
        &self,
        symbol: &str,
        period: &str,
        limit: usize,
    ) -> Result<Vec<TencentKlinePoint>, CollectorError> {
        let payload = self.kline_payload(symbol, period, limit).await?;
        parse_tencent_kline_points(&payload, symbol, period)
    }
}

fn decode_quote_bytes(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    let (text, _, _) = GBK.decode(bytes);
    text.into_owned()
}

fn parse_tencent_quote_text(text: &str) -> Result<Vec<TencentQuoteRow>, CollectorError> {
    let mut rows = Vec::new();
    for (index, line) in text.split(';').enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(row) = parse_tencent_quote_line(line, index)? {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn parse_tencent_quote_line(
    line: &str,
    index: usize,
) -> Result<Option<TencentQuoteRow>, CollectorError> {
    let line = line.trim();
    let rest = line.strip_prefix("v_").ok_or_else(|| {
        CollectorError::InvalidPayload(format!("tencent quote line {index} missing v_ prefix"))
    })?;
    let (symbol_text, payload) = rest.split_once("=\"").ok_or_else(|| {
        CollectorError::InvalidPayload(format!("tencent quote line {index} missing quote payload"))
    })?;
    if symbol_text.len() < 8 {
        return Err(CollectorError::InvalidPayload(format!(
            "tencent quote line {index} has invalid symbol {symbol_text}"
        )));
    }
    let prefix = symbol_text
        .get(0..2)
        .ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "tencent quote line {index} has invalid symbol {symbol_text}"
            ))
        })?
        .to_string();
    if prefix == "pv" {
        return Ok(None);
    }
    if !matches!(prefix.as_str(), "sh" | "sz" | "bj") {
        return Err(CollectorError::InvalidPayload(format!(
            "tencent quote line {index} has unsupported prefix {prefix}"
        )));
    }
    let query_code = symbol_text
        .get(2..)
        .ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "tencent quote line {index} has invalid symbol {symbol_text}"
            ))
        })?
        .to_string();
    let payload = payload.trim_end_matches('"');
    if payload.trim().is_empty() {
        return Ok(None);
    }
    let parts: Vec<&str> = payload.split('~').collect();
    if parts.len() < 4 {
        return Err(CollectorError::InvalidPayload(format!(
            "tencent quote line {index} has {} fields, expected at least 4",
            parts.len()
        )));
    }
    let code = part_text(&parts, 2).unwrap_or_else(|| query_code.clone());
    let name = part_text(&parts, 1).ok_or_else(|| {
        CollectorError::InvalidPayload(format!("tencent quote line {index} missing stock name"))
    })?;
    Ok(Some(TencentQuoteRow {
        symbol: format!("{prefix}{query_code}"),
        prefix,
        code,
        query_code,
        name,
        price: number_part(&parts, 3),
        pct_change: number_part(&parts, 32),
        volume_wan_shou: number_part(&parts, 36).map(|value| value / 10_000.0),
        amount_yi: number_part(&parts, 37).map(|value| value / 10_000.0),
        turnover: number_part(&parts, 38),
        pe: number_part(&parts, 39),
        market_cap_yi: number_part(&parts, 44),
        float_market_cap_yi: number_part(&parts, 45),
        pb: number_part(&parts, 46),
        amplitude: number_part(&parts, 43),
        status_flag: part_text(&parts, 40).unwrap_or_default(),
        market_type: part_text(&parts, 61).unwrap_or_default(),
    }))
}

fn part_text(parts: &[&str], index: usize) -> Option<String> {
    parts
        .get(index)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn number_part(parts: &[&str], index: usize) -> Option<f64> {
    part_text(parts, index).and_then(|value| value.replace(',', "").parse::<f64>().ok())
}

fn generate_tencent_ashare_symbols() -> Vec<String> {
    let mut symbols = Vec::new();
    push_symbol_range(&mut symbols, "sh", 600_000, 605_999);
    push_symbol_range(&mut symbols, "sh", 688_000, 689_999);
    push_symbol_range(&mut symbols, "sz", 1, 3_999);
    push_symbol_range(&mut symbols, "sz", 300_000, 302_999);
    push_symbol_range(&mut symbols, "bj", 920_000, 920_999);
    symbols
}

fn push_symbol_range(symbols: &mut Vec<String>, prefix: &str, start: u32, end: u32) {
    for code in start..=end {
        symbols.push(format!("{prefix}{code:06}"));
    }
}

fn parse_tencent_kline_points(
    payload: &Value,
    symbol: &str,
    period: &str,
) -> Result<Vec<TencentKlinePoint>, CollectorError> {
    let period_keys = [format!("qfq{period}"), period.to_string()];
    for period_key in period_keys {
        let pointer = format!("/data/{symbol}/{period_key}");
        let Some(value) = payload.pointer(&pointer) else {
            continue;
        };
        let rows = value.as_array().ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "tencent kline payload at {pointer} must be an array"
            ))
        })?;
        return rows
            .iter()
            .enumerate()
            .map(|(index, row)| parse_tencent_kline_row(row, index))
            .collect();
    }
    Err(CollectorError::InvalidPayload(format!(
        "tencent kline payload missing array for {symbol} {period}"
    )))
}

fn parse_tencent_kline_row(row: &Value, index: usize) -> Result<TencentKlinePoint, CollectorError> {
    let parts: Vec<Value> = if let Some(items) = row.as_array() {
        items.clone()
    } else {
        row.as_str()
            .ok_or_else(|| {
                CollectorError::InvalidPayload(format!(
                    "tencent kline row {index} must be an array or comma-separated string"
                ))
            })?
            .split(',')
            .map(|item| Value::String(item.to_string()))
            .collect()
    };
    if parts.len() < 6 {
        return Err(CollectorError::InvalidPayload(format!(
            "tencent kline row {index} has {} fields, expected at least 6",
            parts.len()
        )));
    }
    let date = text_value(&parts[0]).ok_or_else(|| {
        CollectorError::InvalidPayload(format!("tencent kline row {index} missing date"))
    })?;
    let open = required_number_value(&parts[1], index, "open")?;
    let close = required_number_value(&parts[2], index, "close")?;
    let high = required_number_value(&parts[3], index, "high")?;
    let low = required_number_value(&parts[4], index, "low")?;
    let volume = required_number_value(&parts[5], index, "volume")?;
    Ok(TencentKlinePoint {
        date,
        open: round(open, 2),
        close: round(close, 2),
        high: round(high, 2),
        low: round(low, 2),
        volume: round(volume / 10_000.0, 2),
    })
}

fn required_number_value(value: &Value, index: usize, field: &str) -> Result<f64, CollectorError> {
    number_value(value).ok_or_else(|| {
        CollectorError::InvalidPayload(format!(
            "tencent kline row {index} field {field} must be numeric"
        ))
    })
}

fn text_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn number_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.replace(',', "").parse::<f64>().ok(),
        _ => None,
    }
}

fn round(value: f64, precision: i32) -> f64 {
    let scale = 10_f64.powi(precision);
    (value * scale).round() / scale
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_index_kline_day_without_qfq_prefix() {
        let payload = json!({
            "data": {
                "sh000300": {
                    "day": [
                        ["2026-06-08", "4703.770", "4713.640", "4779.860", "4677.570", "299647565.000"],
                        ["2026-06-09", "4743.450", "4801.810", "4802.500", "4715.390", "258391601.000"]
                    ]
                }
            }
        });

        let points = parse_tencent_kline_points(&payload, "sh000300", "day").expect("kline points");

        assert_eq!(points.len(), 2);
        assert_eq!(points[0].date, "2026-06-08");
        assert_eq!(points[1].close, 4801.81);
    }

    #[test]
    fn skips_empty_tencent_quote_records() {
        let rows = parse_tencent_quote_text("v_sh600000=\"\";")
            .expect("empty quote records are valid for sparse generated symbols");

        assert!(rows.is_empty());
    }

    #[test]
    fn skips_tencent_quote_metadata_records() {
        let rows = parse_tencent_quote_text("v_pv_none_match=\"1\";")
            .expect("metadata records are not stock quote rows");

        assert!(rows.is_empty());
    }

    #[test]
    fn rejects_malformed_tencent_quote_records() {
        let error = parse_tencent_quote_text("v_sh600000=\"51~\";")
            .expect_err("malformed quote record should fail");

        assert!(error
            .to_string()
            .contains("tencent quote line 0 has 2 fields"));
    }

    #[test]
    fn rejects_missing_tencent_kline_array() {
        let payload = json!({ "data": { "sh000300": {} } });
        let error = parse_tencent_kline_points(&payload, "sh000300", "day")
            .expect_err("missing kline array should fail");

        assert!(error
            .to_string()
            .contains("tencent kline payload missing array for sh000300 day"));
    }

    #[test]
    fn rejects_malformed_tencent_kline_rows() {
        let payload = json!({
            "data": {
                "sh000300": {
                    "day": [["2026-06-08", "4703.770"]]
                }
            }
        });
        let error = parse_tencent_kline_points(&payload, "sh000300", "day")
            .expect_err("malformed kline row should fail");

        assert!(error
            .to_string()
            .contains("tencent kline row 0 has 2 fields"));
    }
}
