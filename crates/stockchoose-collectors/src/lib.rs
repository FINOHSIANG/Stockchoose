pub mod eastmoney;
pub mod news;
pub mod tencent;

pub use eastmoney::{AnnouncementRow, EastmoneyClient, FinancialMetricRow, FinancialStatementRows};
pub use news::GdeltClient;
pub use tencent::TencentClient;

#[derive(Debug, thiserror::Error)]
pub enum CollectorError {
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid upstream url: {0}")]
    Url(#[from] url::ParseError),
    #[error("unsupported endpoint: {0}")]
    UnsupportedEndpoint(String),
    #[error("invalid upstream payload: {0}")]
    InvalidPayload(String),
}
