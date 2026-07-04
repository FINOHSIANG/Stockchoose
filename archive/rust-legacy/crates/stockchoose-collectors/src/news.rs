use crate::CollectorError;
use reqwest::{
    header::{HeaderValue, ACCEPT, ACCEPT_ENCODING, RETRY_AFTER},
    RequestBuilder, StatusCode, Url,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::{
    sync::Mutex,
    time::{sleep, Duration, Instant},
};

const GDELT_DOC_BASE: &str = "https://api.gdeltproject.org/api/v2/doc/doc";
const EASTMONEY_NEWS_BASE: &str = "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns";
const GDELT_MAX_ATTEMPTS: usize = 4;
const GDELT_RETRY_DELAYS_SECONDS: [u64; 3] = [6, 11, 21];
const GDELT_SUCCESS_CACHE_SECONDS: u64 = 90;

#[derive(Debug, Clone)]
pub struct GdeltClient {
    http: reqwest::Client,
    gdelt_cache: Arc<Mutex<Option<GdeltCacheEntry>>>,
}

#[derive(Debug, Clone)]
struct GdeltCacheEntry {
    key: String,
    cached_at: Instant,
    payload: Value,
}

impl GdeltClient {
    pub fn new() -> Result<Self, CollectorError> {
        Ok(Self {
            http: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 StockChoose-Rust/0.1")
                .build()?,
            gdelt_cache: Arc::new(Mutex::new(None)),
        })
    }

    pub async fn article_list(
        &self,
        query: &str,
        max_records: usize,
    ) -> Result<Value, CollectorError> {
        match self.gdelt_article_list(query, max_records).await {
            Ok(payload) => Ok(payload),
            Err(error) => {
                let fallback = self.eastmoney_article_list(max_records).await?;
                let mut payload = match fallback {
                    Value::Object(map) => map,
                    _ => return Err(error),
                };
                payload.insert(
                    "fallbackSource".to_string(),
                    Value::String("eastmoney".to_string()),
                );
                payload.insert(
                    "fallbackReason".to_string(),
                    Value::String(error.to_string()),
                );
                Ok(Value::Object(payload))
            }
        }
    }

    pub async fn source_article_list(
        &self,
        provider: &str,
        base_url: &str,
        query: &str,
        max_records: usize,
        api_token: &str,
        language: &str,
    ) -> Result<Value, CollectorError> {
        match provider {
            "GDELT 2.1" => self.article_list(query, max_records).await,
            "NewsAPI" => {
                self.newsapi_article_list(base_url, query, max_records, api_token, language)
                    .await
            }
            "自定义 REST" => {
                self.custom_rest_article_list(base_url, query, max_records, api_token)
                    .await
            }
            "自定义 RSS" => {
                self.rss_article_list(base_url, max_records, api_token)
                    .await
            }
            other => Err(CollectorError::UnsupportedEndpoint(format!(
                "unsupported news provider: {other}"
            ))),
        }
    }

    async fn gdelt_article_list(
        &self,
        query: &str,
        max_records: usize,
    ) -> Result<Value, CollectorError> {
        let mut url = Url::parse(GDELT_DOC_BASE)?;
        url.query_pairs_mut()
            .append_pair("query", &normalize_gdelt_query(query))
            .append_pair("mode", "ArtList")
            .append_pair("format", "json")
            .append_pair("maxrecords", &max_records.clamp(1, 250).to_string())
            .append_pair("sort", "HybridRel");
        let cache_key = gdelt_cache_key(query, max_records);
        if let Some(payload) = self.cached_gdelt_payload(&cache_key).await {
            return Ok(payload);
        }
        let payload = self.gdelt_payload_with_retry(url).await?;
        self.store_gdelt_payload(cache_key, payload.clone()).await;
        Ok(payload)
    }

    async fn cached_gdelt_payload(&self, cache_key: &str) -> Option<Value> {
        let guard = self.gdelt_cache.lock().await;
        let entry = guard.as_ref()?;
        if entry.key == cache_key
            && entry.cached_at.elapsed() < Duration::from_secs(GDELT_SUCCESS_CACHE_SECONDS)
        {
            Some(entry.payload.clone())
        } else {
            None
        }
    }

    async fn store_gdelt_payload(&self, cache_key: String, payload: Value) {
        let mut guard = self.gdelt_cache.lock().await;
        *guard = Some(GdeltCacheEntry {
            key: cache_key,
            cached_at: Instant::now(),
            payload,
        });
    }

    async fn gdelt_payload_with_retry(&self, url: Url) -> Result<Value, CollectorError> {
        let mut last_error = None;
        for attempt in 0..GDELT_MAX_ATTEMPTS {
            match self.gdelt_payload_once(url.clone()).await {
                Ok(payload) => return Ok(payload),
                Err(error)
                    if gdelt_error_is_retryable(&error) && attempt + 1 < GDELT_MAX_ATTEMPTS =>
                {
                    let delay_seconds =
                        gdelt_retry_delay_seconds(attempt, gdelt_retry_after_seconds(&error));
                    last_error = Some(error);
                    sleep(Duration::from_secs(delay_seconds)).await;
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_error.unwrap_or_else(|| {
            CollectorError::InvalidPayload("GDELT request failed after retry attempts".to_string())
        }))
    }

    async fn gdelt_payload_once(&self, url: Url) -> Result<Value, CollectorError> {
        let response = self
            .http
            .get(url)
            .header(ACCEPT, "application/json,text/plain,*/*")
            .header(ACCEPT_ENCODING, "identity")
            .send()
            .await?;
        let status = response.status();
        let retry_after = response.headers().get(RETRY_AFTER).cloned();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(gdelt_status_error(status, retry_after.as_ref(), &text));
        }
        match json_payload_from_text("GDELT", &text) {
            Ok(payload) => Ok(payload),
            Err(error) if gdelt_text_mentions_rate_limit(&text) => {
                Err(CollectorError::InvalidPayload(error.to_string()))
            }
            Err(error) => Err(error),
        }
    }

    async fn eastmoney_article_list(&self, max_records: usize) -> Result<Value, CollectorError> {
        let mut url = Url::parse(EASTMONEY_NEWS_BASE)?;
        url.query_pairs_mut()
            .append_pair("client", "web")
            .append_pair("biz", "web_news_col")
            .append_pair("column", "353")
            .append_pair("order", "1")
            .append_pair("needInteractData", "0")
            .append_pair("page_index", "1")
            .append_pair("page_size", &max_records.clamp(1, 100).to_string())
            .append_pair("req_trace", "stockchoose");
        let payload = self
            .http
            .get(url)
            .header("accept", "application/json,text/plain,*/*")
            .header("referer", "https://finance.eastmoney.com/")
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?;
        let rows = array_at(&payload, "/data/list", "eastmoney news")?;
        let articles = rows
            .into_iter()
            .enumerate()
            .map(|(index, row)| {
                let title = string_at(&row, "title").or_else(|| string_at(&row, "summary")).ok_or_else(|| {
                    CollectorError::InvalidPayload(format!("eastmoney news row {index} missing title"))
                })?;
                let url = string_at(&row, "url").or_else(|| string_at(&row, "uniqueUrl")).ok_or_else(|| {
                    CollectorError::InvalidPayload(format!("eastmoney news row {index} missing url"))
                })?;
                Ok(json!({
                    "url": url,
                    "title": title,
                    "seendate": string_at(&row, "showTime").unwrap_or_default(),
                    "domain": string_at(&row, "mediaName").unwrap_or_else(|| "东方财富".to_string()),
                    "sourceCountry": "CN",
                    "sourceCollection": "eastmoney"
                }))
            })
            .collect::<Result<Vec<_>, CollectorError>>()?;
        Ok(json!({ "articles": articles }))
    }

    async fn newsapi_article_list(
        &self,
        base_url: &str,
        query: &str,
        max_records: usize,
        api_token: &str,
        language: &str,
    ) -> Result<Value, CollectorError> {
        let normalized_base = if base_url.trim().is_empty() {
            "https://newsapi.org".to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };
        let endpoint = if normalized_base.ends_with("/v2/everything") {
            normalized_base
        } else {
            format!("{normalized_base}/v2/everything")
        };
        let mut url = Url::parse(&endpoint)?;
        url.query_pairs_mut()
            .append_pair(
                "q",
                if query.trim().is_empty() {
                    "stock"
                } else {
                    query
                },
            )
            .append_pair("pageSize", &max_records.clamp(1, 100).to_string())
            .append_pair("sortBy", "publishedAt");
        if let Some(newsapi_language) = newsapi_language_code(language) {
            url.query_pairs_mut()
                .append_pair("language", newsapi_language);
        }
        let payload = with_optional_auth(self.http.get(url), api_token)
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?;
        Ok(json!({ "articles": normalized_article_rows(&payload, "NewsAPI")? }))
    }

    async fn custom_rest_article_list(
        &self,
        base_url: &str,
        query: &str,
        max_records: usize,
        api_token: &str,
    ) -> Result<Value, CollectorError> {
        let mut url = Url::parse(base_url)?;
        {
            let mut pairs = url.query_pairs_mut();
            if !query.trim().is_empty() {
                pairs.append_pair("q", query);
            }
            pairs.append_pair("limit", &max_records.clamp(1, 250).to_string());
        }
        let payload = with_optional_auth(self.http.get(url), api_token)
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?;
        Ok(json!({ "articles": normalized_article_rows(&payload, "custom REST news")? }))
    }

    async fn rss_article_list(
        &self,
        base_url: &str,
        max_records: usize,
        api_token: &str,
    ) -> Result<Value, CollectorError> {
        let url = Url::parse(base_url)?;
        let body = with_optional_auth(self.http.get(url), api_token)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        Ok(json!({ "articles": rss_article_rows(&body, max_records)? }))
    }
}

fn string_at(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn with_optional_auth(builder: RequestBuilder, api_token: &str) -> RequestBuilder {
    let token = api_token.trim();
    if token.is_empty() {
        builder
    } else {
        builder.bearer_auth(token).header("x-api-key", token)
    }
}

fn gdelt_cache_key(query: &str, max_records: usize) -> String {
    format!(
        "{}|{}",
        normalize_gdelt_query(query),
        max_records.clamp(1, 250)
    )
}

fn normalize_gdelt_query(query: &str) -> String {
    let normalized = query
        .split_whitespace()
        .map(quote_gdelt_dash_term)
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.trim().is_empty() {
        "stock".to_string()
    } else {
        normalized
    }
}

fn quote_gdelt_dash_term(token: &str) -> String {
    if token.contains('"') || !token.contains('-') {
        return token.to_string();
    }
    let leading = token
        .chars()
        .take_while(|ch| matches!(ch, '(' | '[' | '{'))
        .collect::<String>();
    let trailing = token
        .chars()
        .rev()
        .take_while(|ch| matches!(ch, ')' | ']' | '}' | ',' | ';'))
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let core = token
        .trim_start_matches(|ch| matches!(ch, '(' | '[' | '{'))
        .trim_end_matches(|ch| matches!(ch, ')' | ']' | '}' | ',' | ';'));
    if core.is_empty() || !core.contains('-') {
        token.to_string()
    } else {
        format!("{leading}\"{core}\"{trailing}")
    }
}

fn json_payload_from_text(source_label: &str, text: &str) -> Result<Value, CollectorError> {
    serde_json::from_str::<Value>(text).map_err(|error| {
        let preview = text.chars().take(160).collect::<String>();
        CollectorError::InvalidPayload(format!(
            "{source_label} returned invalid JSON: {error}; body starts with {preview:?}"
        ))
    })
}

fn preview_text(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn gdelt_status_error(
    status: StatusCode,
    retry_after: Option<&HeaderValue>,
    text: &str,
) -> CollectorError {
    let reason = status.canonical_reason().unwrap_or("upstream error");
    let retry_after_suffix = retry_after
        .and_then(parse_retry_after_seconds)
        .map(|seconds| format!("; retryAfterSeconds={seconds}"))
        .unwrap_or_default();
    CollectorError::InvalidPayload(format!(
        "GDELT returned HTTP {} {reason}{retry_after_suffix}; body starts with {:?}",
        status.as_u16(),
        preview_text(text, 160)
    ))
}

fn gdelt_error_is_retryable(error: &CollectorError) -> bool {
    match error {
        CollectorError::Http(error) => error.is_timeout() || error.is_connect(),
        CollectorError::InvalidPayload(message) => {
            message.contains("GDELT returned HTTP 429")
                || message.contains("GDELT returned HTTP 503")
                || message.contains("GDELT returned HTTP 502")
                || message.contains("GDELT returned HTTP 504")
                || gdelt_text_mentions_rate_limit(message)
        }
        _ => false,
    }
}

fn gdelt_retry_after_seconds(error: &CollectorError) -> Option<u64> {
    let CollectorError::InvalidPayload(message) = error else {
        return None;
    };
    let marker = "retryAfterSeconds=";
    let value = message.split(marker).nth(1)?;
    value
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>()
        .parse::<u64>()
        .ok()
}

fn gdelt_retry_delay_seconds(attempt: usize, retry_after: Option<u64>) -> u64 {
    retry_after
        .unwrap_or_else(|| {
            GDELT_RETRY_DELAYS_SECONDS[attempt.min(GDELT_RETRY_DELAYS_SECONDS.len() - 1)]
        })
        .clamp(1, 60)
}

fn parse_retry_after_seconds(value: &HeaderValue) -> Option<u64> {
    value
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(|seconds| seconds.clamp(1, 60))
}

fn gdelt_text_mentions_rate_limit(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("too many requests")
        || lower.contains("limit requests")
        || lower.contains("rate limit")
}

fn array_at(
    payload: &Value,
    pointer: &str,
    source_label: &str,
) -> Result<Vec<Value>, CollectorError> {
    payload
        .pointer(pointer)
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "{source_label} payload missing array at {pointer}"
            ))
        })
}

fn newsapi_language_code(language: &str) -> Option<&'static str> {
    match language {
        "zh-CN" => Some("zh"),
        "en-US" => Some("en"),
        _ => None,
    }
}

fn normalized_article_rows(
    payload: &Value,
    source_label: &str,
) -> Result<Vec<Value>, CollectorError> {
    let rows = article_rows_payload(payload, source_label)?;

    rows.into_iter()
        .enumerate()
        .map(|(index, row)| normalize_article_row(&row, source_label, index))
        .collect()
}

fn article_rows_payload(payload: &Value, source_label: &str) -> Result<Vec<Value>, CollectorError> {
    if let Some(rows) = payload
        .get("articles")
        .or_else(|| payload.get("data"))
        .or_else(|| payload.get("items"))
        .or_else(|| payload.get("news"))
    {
        return rows.as_array().cloned().ok_or_else(|| {
            CollectorError::InvalidPayload(format!(
                "{source_label} article container must be an array"
            ))
        });
    }
    if let Some(rows) = payload.as_array() {
        return Ok(rows.clone());
    }
    Err(CollectorError::InvalidPayload(format!(
        "{source_label} payload missing articles/data/items/news array"
    )))
}

fn normalize_article_row(
    row: &Value,
    source_label: &str,
    index: usize,
) -> Result<Value, CollectorError> {
    let title = first_string_at(row, &["title", "headline", "name"]).ok_or_else(|| {
        CollectorError::InvalidPayload(format!("{source_label} article row {index} missing title"))
    })?;
    let url = first_string_at(row, &["url", "link", "webUrl", "guid"]).ok_or_else(|| {
        CollectorError::InvalidPayload(format!("{source_label} article row {index} missing url"))
    })?;
    let domain = first_string_at(row, &["domain", "sourceName", "provider"])
        .or_else(|| nested_string_at(row, &["source"], "name"))
        .or_else(|| domain_from_url(&url))
        .unwrap_or_else(|| "custom.news".to_string());
    let published_at = first_string_at(
        row,
        &[
            "seendate",
            "publishedAt",
            "pubDate",
            "published",
            "updated",
            "date",
            "time",
        ],
    )
    .unwrap_or_default();
    let summary = first_string_at(row, &["summary", "description", "content"]).unwrap_or_default();
    Ok(json!({
        "url": url,
        "title": title,
        "seendate": published_at,
        "domain": domain,
        "summary": summary,
        "content": first_string_at(row, &["content", "body"]).unwrap_or_default(),
        "imageUrl": first_string_at(row, &["urlToImage", "imageUrl", "image"]).unwrap_or_default(),
        "author": first_string_at(row, &["author", "byline"]).unwrap_or_default()
    }))
}

fn first_string_at(row: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_at(row, key))
}

fn nested_string_at(row: &Value, parents: &[&str], key: &str) -> Option<String> {
    parents
        .iter()
        .filter_map(|parent| row.get(parent))
        .find_map(|value| string_at(value, key))
}

fn domain_from_url(value: &str) -> Option<String> {
    Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(ToString::to_string))
}

fn rss_article_rows(xml: &str, max_records: usize) -> Result<Vec<Value>, CollectorError> {
    let mut rows = rss_items(xml, "item", max_records)?;
    if rows.is_empty() {
        rows = rss_items(xml, "entry", max_records)?;
    }
    if rows.is_empty() {
        return Err(CollectorError::InvalidPayload(
            "RSS payload missing item/entry rows".to_string(),
        ));
    }
    Ok(rows)
}

fn rss_items(xml: &str, tag: &str, max_records: usize) -> Result<Vec<Value>, CollectorError> {
    let open_tag = format!("<{tag}");
    let close_tag = format!("</{tag}>");
    xml.split(&open_tag)
        .skip(1)
        .filter_map(|chunk| chunk.split_once('>').map(|(_, body)| body))
        .filter_map(|body| body.split_once(&close_tag).map(|(item, _)| item))
        .take(max_records.clamp(1, 250))
        .enumerate()
        .map(|(index, item)| {
            let title = xml_tag_text(item, "title").ok_or_else(|| {
                CollectorError::InvalidPayload(format!("RSS {tag} row {index} missing title"))
            })?;
            let url = xml_tag_text(item, "link")
                .or_else(|| atom_link_href(item))
                .ok_or_else(|| {
                    CollectorError::InvalidPayload(format!("RSS {tag} row {index} missing link"))
                })?;
            let published_at = xml_tag_text(item, "pubDate")
                .or_else(|| xml_tag_text(item, "published"))
                .or_else(|| xml_tag_text(item, "updated"))
                .unwrap_or_default();
            let summary = xml_tag_text(item, "description")
                .or_else(|| xml_tag_text(item, "summary"))
                .unwrap_or_default();
            Ok(json!({
                "url": url,
                "title": title,
                "seendate": published_at,
                "domain": domain_from_url(&url).unwrap_or_else(|| "rss.news".to_string()),
                "summary": summary,
                "content": summary,
                "imageUrl": "",
                "author": xml_tag_text(item, "author").unwrap_or_default()
            }))
        })
        .collect()
}

fn xml_tag_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let after_open = xml.split_once(&open)?.1;
    let body = after_open.split_once('>')?.1.split_once(&close)?.0;
    let cleaned = body
        .trim()
        .strip_prefix("<![CDATA[")
        .unwrap_or(body.trim())
        .strip_suffix("]]>")
        .unwrap_or(body.trim())
        .trim();
    let decoded = cleaned
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}

fn atom_link_href(xml: &str) -> Option<String> {
    let link = xml.split("<link").skip(1).find_map(|chunk| {
        let tag = chunk.split_once('>')?.0;
        let href = tag.split("href=").nth(1)?;
        let quote = href.chars().next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }
        href[1..].split(quote).next().map(ToString::to_string)
    })?;
    if link.trim().is_empty() {
        None
    } else {
        Some(link)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_newsapi_article_rows() {
        let payload = json!({
            "articles": [
                {
                    "title": "贵州茅台回购完成",
                    "url": "https://example.com/news/maotai",
                    "publishedAt": "2026-06-09T09:00:00Z",
                    "description": "公司公告回购完成",
                    "content": "贵州茅台公告显示回购完成",
                    "urlToImage": "https://example.com/a.jpg",
                    "author": "Reporter",
                    "source": { "name": "Example News" }
                }
            ]
        });

        let rows = normalized_article_rows(&payload, "NewsAPI").expect("newsapi rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["title"], "贵州茅台回购完成");
        assert_eq!(rows[0]["domain"], "Example News");
        assert_eq!(rows[0]["seendate"], "2026-06-09T09:00:00Z");
        assert_eq!(rows[0]["summary"], "公司公告回购完成");
        assert_eq!(rows[0]["imageUrl"], "https://example.com/a.jpg");
    }

    #[test]
    fn rejects_news_payloads_without_article_container() {
        let payload = json!({ "status": "ok" });
        let error = normalized_article_rows(&payload, "custom REST news")
            .expect_err("missing article container should fail");

        assert!(error
            .to_string()
            .contains("custom REST news payload missing articles/data/items/news array"));
    }

    #[test]
    fn invalid_json_payload_errors_include_source_and_preview() {
        let error = json_payload_from_text("GDELT", "Please limit requests to one every 5 seconds")
            .expect_err("invalid json should fail");

        let message = error.to_string();
        assert!(message.contains("GDELT returned invalid JSON"));
        assert!(message.contains("Please limit requests"));
    }

    #[test]
    fn gdelt_rate_limit_payloads_are_retryable() {
        let error = CollectorError::InvalidPayload(
            "GDELT returned HTTP 429 Too Many Requests; retryAfterSeconds=7; body starts with \"Please limit requests\""
                .to_string(),
        );

        assert!(gdelt_error_is_retryable(&error));
        assert_eq!(gdelt_retry_after_seconds(&error), Some(7));
        assert_eq!(
            gdelt_retry_delay_seconds(0, gdelt_retry_after_seconds(&error)),
            7
        );
    }

    #[test]
    fn gdelt_retry_delay_uses_bounded_backoff() {
        assert_eq!(gdelt_retry_delay_seconds(0, None), 6);
        assert_eq!(gdelt_retry_delay_seconds(1, None), 11);
        assert_eq!(gdelt_retry_delay_seconds(99, None), 21);
        assert_eq!(gdelt_retry_delay_seconds(0, Some(90)), 60);
    }

    #[test]
    fn parses_retry_after_seconds_header() {
        let header = HeaderValue::from_static("5");
        assert_eq!(parse_retry_after_seconds(&header), Some(5));
        let large = HeaderValue::from_static("120");
        assert_eq!(parse_retry_after_seconds(&large), Some(60));
        let date = HeaderValue::from_static("Wed, 10 Jun 2026 02:00:00 GMT");
        assert_eq!(parse_retry_after_seconds(&date), None);
    }

    #[test]
    fn gdelt_cache_key_normalizes_query_whitespace_and_limit() {
        assert_eq!(
            gdelt_cache_key(" China   A-shares stock ", 300),
            "China \"A-shares\" stock|250"
        );
        assert_eq!(gdelt_cache_key("stock", 0), "stock|1");
        assert_eq!(
            normalize_gdelt_query("(A-shares OR B-shares), stock"),
            "(\"A-shares\" OR \"B-shares\"), stock"
        );
    }

    #[test]
    fn rejects_news_rows_without_url() {
        let payload = json!({ "articles": [{ "title": "Missing URL" }] });
        let error =
            normalized_article_rows(&payload, "NewsAPI").expect_err("missing url should fail");

        assert!(error
            .to_string()
            .contains("NewsAPI article row 0 missing url"));
    }

    #[test]
    fn rejects_rss_items_without_links() {
        let xml = r#"
          <rss><channel>
            <item>
              <title>Missing link</title>
            </item>
          </channel></rss>
        "#;
        let error = rss_article_rows(xml, 10).expect_err("missing rss link should fail");

        assert!(error.to_string().contains("RSS item row 0 missing link"));
    }

    #[test]
    fn parses_rss_items_into_article_rows() {
        let xml = r#"
          <rss><channel>
            <item>
              <title><![CDATA[新能源车政策支持]]></title>
              <link>https://example.com/auto</link>
              <pubDate>Tue, 09 Jun 2026 10:00:00 GMT</pubDate>
              <description>新能源汽车产业链获支持</description>
            </item>
          </channel></rss>
        "#;

        let rows = rss_article_rows(xml, 10).expect("rss rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["title"], "新能源车政策支持");
        assert_eq!(rows[0]["url"], "https://example.com/auto");
        assert_eq!(rows[0]["domain"], "example.com");
        assert_eq!(rows[0]["summary"], "新能源汽车产业链获支持");
    }
}
