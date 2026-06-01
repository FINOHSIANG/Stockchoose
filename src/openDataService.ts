import { AKSHARE_AKTOOLS_PROVIDER, ensureInfoSourceSettings, isAkShareProvider, isLocalProvider, type InfoSourceSettings } from "./integrationServices";
import { marketDataCodeForStock } from "./stockIdentity";
import type { Stock } from "./types";

export interface OpenSourceDataSummary {
  provider: string;
  lastSyncAt?: string;
  matchedRows: number;
  sourceRows: number;
  stockCount: number;
  details: string;
}

export interface OpenSourceSyncResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details: string;
  stocks: Stock[];
  summary: OpenSourceDataSummary;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AkShareRow = Record<string, unknown>;

export const defaultOpenSourceDataSummary: OpenSourceDataSummary = {
  provider: "未接入真实数据",
  matchedRows: 0,
  sourceRows: 0,
  stockCount: 0,
  details: "尚未同步真实数据"
};

const textValue = (row: AkShareRow, keys: string[]) => {
  const value = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  return value === undefined || value === null ? "" : String(value).trim();
};

const numberValue = (row: AkShareRow, keys: string[]) => {
  const raw = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const normalized = String(raw).replace(/[,，%]/g, "").trim();
  if (!normalized || normalized === "-" || normalized === "--") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const round = (value: number, precision = 2) => {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
};

const amountToYi = (value: number | undefined) => {
  if (value === undefined) return undefined;
  return value > 100000 ? value / 100000000 : value;
};

const volumeToWanShou = (value: number | undefined) => {
  if (value === undefined) return undefined;
  return value > 10000 ? value / 10000 : value;
};

const withMetric = (metrics: Record<string, number>, key: string, value: number | undefined, precision = 2) => {
  if (value === undefined || !Number.isFinite(value)) return metrics;
  return { ...metrics, [key]: round(value, precision) };
};

function stockShellFromAkShareRow(row: NonNullable<ReturnType<typeof normalizeAkShareSpotRow>>): Stock {
  const exchange = row.code.startsWith("6") ? "沪市" : row.code.startsWith("8") || row.code.startsWith("4") ? "北交所" : "深市";
  const board = row.code.startsWith("688") ? "科创板" : row.code.startsWith("300") || row.code.startsWith("301") ? "创业板" : exchange === "北交所" ? "北交所" : "主板";
  return {
    code: row.code,
    name: row.name || row.code,
    exchange,
    board,
    industry1: "未分类",
    industry2: "未分类",
    region: "未分类",
    property: "民企",
    isST: row.name.includes("ST"),
    isSuspended: false,
    isSTAR: board === "科创板",
    isMargin: false,
    indexes: [],
    metrics: {}
  };
}

export function normalizeAkShareSpotRow(row: AkShareRow) {
  const code = textValue(row, ["代码", "code", "symbol"]).replace(/\D/g, "").padStart(6, "0").slice(-6);
  const name = textValue(row, ["名称", "name"]);
  if (!code) return null;
  return {
    code,
    name,
    price: numberValue(row, ["最新价", "收盘", "close", "price", "latest"]),
    pctChange: numberValue(row, ["涨跌幅", "pctChange", "changePercent"]),
    amountYi: amountToYi(numberValue(row, ["成交额", "amount", "turnoverAmount"])),
    volumeWanShou: volumeToWanShou(numberValue(row, ["成交量", "volume"])),
    turnover: numberValue(row, ["换手率", "turnover", "turnoverRate"]),
    marketCapYi: amountToYi(numberValue(row, ["总市值", "marketCap", "totalMarketCap"])),
    floatMarketCapYi: amountToYi(numberValue(row, ["流通市值", "floatMarketCap", "circulatingMarketCap"])),
    pe: numberValue(row, ["市盈率-动态", "市盈率", "pe", "peDynamic"]),
    pb: numberValue(row, ["市净率", "pb"]),
    amplitude: numberValue(row, ["振幅", "amplitude"])
  };
}

export function mergeAkShareSpotRows(baseStocks: Stock[], rows: AkShareRow[]) {
  const normalizedRows = rows.map(normalizeAkShareSpotRow).filter((row): row is NonNullable<ReturnType<typeof normalizeAkShareSpotRow>> => Boolean(row));
  const rowByCode = new Map(normalizedRows.map((row) => [row.code, row]));
  let matchedRows = 0;

  const sourceStocks = baseStocks.length ? baseStocks : normalizedRows.map(stockShellFromAkShareRow);
  const stocks = sourceStocks.map((stock) => {
    const row = rowByCode.get(stock.code) ?? rowByCode.get(marketDataCodeForStock(stock));
    if (!row) return stock;
    matchedRows += 1;

    let metrics = { ...stock.metrics };
    metrics = withMetric(metrics, "price", row.price);
    metrics = withMetric(metrics, "pctChange", row.pctChange);
    metrics = withMetric(metrics, "relativeChange", row.pctChange === undefined ? undefined : row.pctChange - 0.25);
    metrics = withMetric(metrics, "amount", row.amountYi);
    metrics = withMetric(metrics, "volume", row.volumeWanShou);
    metrics = withMetric(metrics, "turnover", row.turnover);
    metrics = withMetric(metrics, "marketCap", row.marketCapYi);
    metrics = withMetric(metrics, "floatMarketCap", row.floatMarketCapYi);
    metrics = withMetric(metrics, "pe", row.pe);
    metrics = withMetric(metrics, "pb", row.pb);
    metrics = withMetric(metrics, "priceAmplitude", row.amplitude);
    metrics = withMetric(metrics, "limitFlag", row.pctChange === undefined ? undefined : row.pctChange >= 9.8 ? 1 : row.pctChange <= -9.8 ? -1 : 0, 0);
    metrics = withMetric(metrics, "min15Momentum", row.pctChange === undefined ? undefined : row.pctChange / 4);
    metrics = withMetric(metrics, "intradayStrength", row.pctChange === undefined ? undefined : Math.max(0, Math.min(100, 50 + row.pctChange * 4)));
    metrics = withMetric(metrics, "realQuoteSource", 1, 0);

    return {
      ...stock,
      name: row.name || stock.name,
      metrics
    };
  });

  return {
    stocks,
    matchedRows,
    sourceRows: normalizedRows.length
  };
}

export async function syncOpenSourceMarketData(
  rawSettings: InfoSourceSettings,
  baseStocks: Stock[],
  fetchImpl: FetchLike = fetch
): Promise<OpenSourceSyncResult> {
  const settings = ensureInfoSourceSettings(rawSettings);
  const checkedAt = new Date().toISOString();

  if (isLocalProvider(settings)) {
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details: "本地模拟数据已停用，请配置真实行情接口",
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details: "本地模拟数据已停用"
      }
    };
  }

  if (!isAkShareProvider(settings)) {
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details: `当前来源不是 ${AKSHARE_AKTOOLS_PROVIDER}`,
      stocks: baseStocks,
      summary: {
        ...defaultOpenSourceDataSummary,
        provider: settings.provider,
        stockCount: baseStocks.length,
        details: "未同步"
      }
    };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(settings.timeoutSeconds, 3) * 1000);
  try {
    const response = await fetchImpl(`${settings.baseUrl.replace(/\/$/, "")}/stock_zh_a_spot_em`, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        ok: false,
        checkedAt,
        message: "开源数据同步失败",
        details: `AKTools 返回 HTTP ${response.status}`,
        stocks: baseStocks,
        summary: { ...defaultOpenSourceDataSummary, provider: settings.provider, stockCount: baseStocks.length, details: "同步失败" }
      };
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const merged = mergeAkShareSpotRows(baseStocks, rows);
    if (!merged.matchedRows) {
      return {
        ok: false,
        checkedAt,
        message: "开源数据同步失败",
        details: "AKShare 行情已返回，但没有匹配到当前股票池代码",
        stocks: baseStocks,
        summary: { ...defaultOpenSourceDataSummary, provider: settings.provider, sourceRows: merged.sourceRows, stockCount: baseStocks.length, details: "未匹配到股票代码" }
      };
    }

    return {
      ok: true,
      checkedAt,
      message: "开源数据同步完成",
      details: `匹配 ${merged.matchedRows}/${merged.sourceRows} 条 AKShare A 股实时行情`,
      stocks: merged.stocks,
      summary: {
        provider: settings.provider,
        lastSyncAt: checkedAt,
        matchedRows: merged.matchedRows,
        sourceRows: merged.sourceRows,
        stockCount: merged.stocks.length,
        details: "AKShare A 股实时行情"
      }
    };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : "未知网络错误";
    return {
      ok: false,
      checkedAt,
      message: "开源数据同步失败",
      details: detail,
      stocks: baseStocks,
      summary: { ...defaultOpenSourceDataSummary, provider: settings.provider, stockCount: baseStocks.length, details: "同步失败" }
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
