import type { Stock } from "../../src/types";
import { isAllIndustry, stockMatchesIndustry } from "../../src/industryClassification";
import { cacheGetOrCreate, cacheSet, fetchJson, fetchText, mapConcurrent } from "../crawler/engine";
import { persistentCacheGetOrCreate } from "../lib/persistentCache";
import { amountToYi, asNumber, compactRow, fetchEastmoneySpotRows, fetchKlinePointsWithFallback, urlWithParams } from "./market";

const EASTMONEY_DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const EASTMONEY_ANNOUNCEMENT_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const EASTMONEY_COMPANY_SURVEY_URL = "https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax";
const EASTMONEY_CORE_CONCEPTION_URL = "https://emweb.securities.eastmoney.com/PC_HSF10/CoreConception/PageAjax";
const EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const EASTMONEY_DATACENTER_REQUEST_GAP_MS = 90;
const FINANCE_FETCH_CONCURRENCY = 6;
const FINANCE_STATEMENT_CACHE_TTL_MS = 15 * 60 * 1000;
const FINANCE_METRIC_CACHE_TTL_MS = 15 * 60 * 1000;
const DAILY_REFERENCE_CACHE_TTL_MS = 5 * 60 * 1000;
const PROFILE_PERSISTENT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_PARTIAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FINANCE_PERSISTENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ANALYST_PERSISTENT_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const DAILY_REFERENCE_PERSISTENT_CACHE_TTL_MS = 60 * 60 * 1000;

const round = (value: number, precision = 2) => Math.round(value * 10 ** precision) / 10 ** precision;
const textValue = (row: Record<string, unknown>, keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && String(value).trim() !== "");
const numberAt = (row: Record<string, unknown>, keys: string[]) => keys.map((key) => asNumber(row[key])).find((value) => value !== undefined);
const normalizeCode = (value: unknown) => String(value ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6);

function withMetric(metrics: Record<string, number>, key: string, value: number | undefined, precision = 2) {
  if (value === undefined || !Number.isFinite(value)) return metrics;
  metrics[key] = round(value, precision);
  return metrics;
}

const firstDefined = <T>(...values: Array<T | undefined>) => values.find((value) => value !== undefined);

function sumDefined(values: Array<number | undefined>) {
  const usable = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) : undefined;
}

function safeRatio(numerator: number | undefined, denominator: number | undefined, scale = 100) {
  if (numerator === undefined || denominator === undefined || Math.abs(denominator) < 0.000001) return undefined;
  return numerator / denominator * scale;
}

function normalizeReportDate(reportDate: string | undefined) {
  const raw = String(reportDate ?? "").trim() || "2025-12-31";
  const compact = raw.replace(/[^0-9]/g, "");
  const yyyymmdd = compact.length >= 8 ? compact.slice(0, 8) : "20251231";
  return {
    date: `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
    yyyymmdd,
    number: Number(yyyymmdd)
  };
}

function rowByCode(rows: Record<string, unknown>[]) {
  const map = new Map<string, Record<string, unknown>>();
  rows.forEach((row) => {
    const code = normalizeCode(textValue(row, ["SECURITY_CODE", "SECUCODE"]));
    if (/^\d{6}$/.test(code) && !map.has(code)) map.set(code, row);
  });
  return map;
}

function disclosureDateNumber(...rows: Array<Record<string, unknown> | undefined>) {
  for (const row of rows) {
    const raw = row ? textValue(row, ["NOTICE_DATE", "鍏憡鏃ユ湡", "鎶湶鏃ユ湡"]) : undefined;
    const compact = String(raw ?? "").replace(/[^0-9]/g, "").slice(0, 8);
    if (compact.length === 8) return Number(compact);
  }
  return undefined;
}

function datacenterUrl(reportName: string, columns: string, sortColumns: string, sortTypes: string, filter?: string, pageNumber = 1, pageSize = 500) {
  const params: Record<string, string> = {
    sortColumns,
    sortTypes,
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
    reportName,
    columns,
    source: "WEB",
    client: "WEB"
  };
  if (filter) params.filter = filter;
  return urlWithParams(EASTMONEY_DATACENTER_URL, params);
}

async function fetchDatacenterPages(reportName: string, columns: string, sortColumns: string, sortTypes: string, filter?: string, pageSize = 500, maxPages = 5) {
  const first = await fetchJson(datacenterUrl(reportName, columns, sortColumns, sortTypes, filter, 1, pageSize), { headers: { referer: "https://data.eastmoney.com/" } }, 30000, EASTMONEY_DATACENTER_REQUEST_GAP_MS);
  const totalPages = Math.max(1, Math.min(maxPages, Math.ceil((asNumber((first as any)?.result?.count) ?? pageSize) / pageSize)));
  const firstRows = [...((((first as any)?.result?.data ?? []) as Record<string, unknown>[]))];
  const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
  const laterPages = await mapConcurrent(pageNumbers, FINANCE_FETCH_CONCURRENCY, async (page) => {
    const payload = await fetchJson(datacenterUrl(reportName, columns, sortColumns, sortTypes, filter, page, pageSize), { headers: { referer: "https://data.eastmoney.com/" } }, 30000, EASTMONEY_DATACENTER_REQUEST_GAP_MS);
    return (((payload as any)?.result?.data ?? []) as Record<string, unknown>[]);
  });
  return [...firstRows, ...laterPages.flat()];
}

export async function fetchAsharehubRows(baseUrl: string, endpoint: string, params: Record<string, string | number | undefined>, apiToken: string) {
  if (!apiToken.trim()) throw new Error("AShareHub API Key is required");
  const normalizedBase = (baseUrl.trim() || "https://asharehub.com").replace(/\/$/, "");
  const normalizedEndpoint = endpoint.replace(/^\/+/, "").replace(/^v1\//, "");
  if (normalizedEndpoint.includes("..") || normalizedEndpoint.includes("proxy_any")) throw new Error(`unsupported AShareHub endpoint: ${endpoint}`);
  const url = new URL(`${normalizedBase}${normalizedBase.endsWith("/v1") ? "" : "/v1"}/${normalizedEndpoint}`);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") url.searchParams.set(key, String(value));
  });
  const payload = await fetchJson(url, { headers: { "x-api-key": apiToken, authorization: `Bearer ${apiToken}` } }, 30000);
  if (Array.isArray(payload)) return payload;
  const root = payload as any;
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(root?.rows)) return root.rows;
  if (Array.isArray(root?.items)) return root.items;
  throw new Error("AShareHub payload missing data/rows/items array");
}

export async function fetchAnalystForecastRows() {
  return cacheGetOrCreate("eastmoney:analyst-forecasts", DAILY_REFERENCE_CACHE_TTL_MS, () =>
    persistentCacheGetOrCreate("analyst-forecasts", "latest", ANALYST_PERSISTENT_CACHE_TTL_MS, async () => {
      const rows = await fetchDatacenterPages("RPT_WEB_RESPREDICT", "WEB_RESPREDICT", "RATING_ORG_NUM", "-1", undefined, 500);
      return rows.map((row) => {
        const code = normalizeCode(textValue(row, ["SECURITY_CODE", "SECUCODE"]));
        const epsA = numberAt(row, ["EPS1"]);
        const epsE = numberAt(row, ["EPS2", "EPS3"]);
        const targetHigh = numberAt(row, ["DEC_AIMPRICEMAX"]);
        const targetLow = numberAt(row, ["DEC_AIMPRICEMIN"]);
        const metrics: Record<string, number> = { realAnalystForecastSource: 1 };
        withMetric(metrics, "recommendationCount", numberAt(row, ["RATING_ORG_NUM"]), 0);
        withMetric(metrics, "targetPriceHigh", targetHigh);
        withMetric(metrics, "targetPriceLow", targetLow);
        withMetric(metrics, "targetPriceMid", targetHigh !== undefined && targetLow !== undefined ? (targetHigh + targetLow) / 2 : undefined);
        withMetric(metrics, "epsForecastGrowth", epsA !== undefined && epsE !== undefined && Math.abs(epsA) > 0.0001 ? (epsE / epsA - 1) * 100 : undefined);
        return { code, name: String(textValue(row, ["SECURITY_NAME_ABBR", "SECURITY_NAME"]) ?? code), reportDate: String(textValue(row, ["YEAR2", "YEAR3"]) ?? "forecast"), sourceRows: 1, metrics };
      }).filter((row) => /^\d{6}$/.test(row.code));
    })
  );
}

export async function fetchMarginBalanceRows() {
  return cacheGetOrCreate("eastmoney:margin-balances", DAILY_REFERENCE_CACHE_TTL_MS, () =>
    persistentCacheGetOrCreate("margin-balances", "latest", DAILY_REFERENCE_PERSISTENT_CACHE_TTL_MS, async () => {
      const latestRows = await fetchDatacenterPages("RPTA_WEB_RZRQ_GGMX", "DATE", "DATE", "-1", undefined, 1, 1);
      const latest = String(textValue(latestRows[0] ?? {}, ["DATE"]) ?? "").split(" ")[0];
      const filter = latest ? `(DATE='${latest}')` : undefined;
      const rows = await fetchDatacenterPages("RPTA_WEB_RZRQ_GGMX", "SCODE,SECNAME,DATE,RZYE,RQYE,RZRQYE,RZMRE,RZCHE,RZJME,FIN_BALANCE_GR,SECUCODE", "RZRQYE", "-1", filter, 500, 2);
      return rows.map((row) => {
        const metrics: Record<string, number> = { realMarginSource: 1 };
        withMetric(metrics, "marginBalance", amountToYi(row.RZRQYE));
        withMetric(metrics, "financingBalance", amountToYi(row.RZYE));
        withMetric(metrics, "securitiesLendingBalance", amountToYi(row.RQYE));
        withMetric(metrics, "financingBuyAmount", amountToYi(row.RZMRE));
        withMetric(metrics, "financingRepayAmount", amountToYi(row.RZCHE));
        withMetric(metrics, "financingNetBuyAmount", amountToYi(row.RZJME));
        withMetric(metrics, "marginBalanceGrowthRate", asNumber(row.FIN_BALANCE_GR));
        return { code: normalizeCode(row.SCODE), name: String(row.SECNAME ?? ""), reportDate: String(row.DATE ?? latest), sourceRows: 1, metrics };
      }).filter((row) => /^\d{6}$/.test(row.code));
    })
  );
}

export async function fetchNorthHoldingRows() {
  return cacheGetOrCreate("eastmoney:north-holdings", DAILY_REFERENCE_CACHE_TTL_MS, () =>
    persistentCacheGetOrCreate("north-holdings", "latest", DAILY_REFERENCE_PERSISTENT_CACHE_TTL_MS, async () => {
      const latestRows = await fetchDatacenterPages("RPT_MUTUAL_HOLDSTOCKNDATE_STA", "TRADE_DATE", "TRADE_DATE", "-1", "(INTERVAL_TYPE=\"1\")", 1, 1);
      const latest = String(textValue(latestRows[0] ?? {}, ["TRADE_DATE"]) ?? "").split(" ")[0];
      const filter = latest ? `(INTERVAL_TYPE=\"1\")(TRADE_DATE>='${latest}')(TRADE_DATE<='${latest}')` : "(INTERVAL_TYPE=\"1\")";
      const rows = await fetchDatacenterPages("RPT_MUTUAL_HOLDSTOCKNDATE_STA", "SECUCODE,SECURITY_CODE,SECURITY_NAME,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,HOLD_SHARES,HOLD_MARKET_CAP,A_SHARES_RATIO,HOLD_SHARES_RATIO,FREE_SHARES_RATIO,TOTAL_SHARES_RATIO,ADD_SHARES_REPAIR,PREDICT_AMC,HMC_CHANGE", "HOLD_MARKET_CAP", "-1", filter, 500, 2);
      return rows.map((row) => {
        const metrics: Record<string, number> = { realNorthHoldSource: 1 };
        withMetric(metrics, "northHold", asNumber(row.HOLD_SHARES_RATIO));
        withMetric(metrics, "northHoldShares", asNumber(row.HOLD_SHARES), 0);
        withMetric(metrics, "northHoldMarketCap", amountToYi(row.HOLD_MARKET_CAP));
        withMetric(metrics, "northHoldAsharesRatio", asNumber(row.A_SHARES_RATIO));
        withMetric(metrics, "northHoldAddedShares", asNumber(row.ADD_SHARES_REPAIR), 0);
        withMetric(metrics, "northHoldMarketCapChange", amountToYi(row.HMC_CHANGE));
        return { code: normalizeCode(row.SECURITY_CODE), name: String(row.SECURITY_NAME ?? ""), reportDate: String(row.TRADE_DATE ?? latest), sourceRows: 1, metrics };
      }).filter((row) => /^\d{6}$/.test(row.code));
    })
  );
}

export async function fetchFilingAnnouncements(codes: string[] = [], maxItems = 50) {
  const limit = Math.max(1, Math.min(maxItems, 100));
  const requested = codes.map(normalizeCode).filter((code) => /^\d{6}$/.test(code));
  const pages = requested.length ? requested.slice(0, 20) : [""];
  const all: any[] = [];
  for (const code of pages) {
    const url = new URL(EASTMONEY_ANNOUNCEMENT_URL);
    url.searchParams.set("sr", "-1");
    url.searchParams.set("page_size", String(limit));
    url.searchParams.set("page_index", "1");
    url.searchParams.set("ann_type", "A");
    url.searchParams.set("client_source", "web");
    url.searchParams.set("f_node", "0");
    url.searchParams.set("s_node", "0");
    if (code) url.searchParams.set("stock_list", code);
    const payload = await fetchJson(url, { headers: { referer: "https://data.eastmoney.com/notices/" } }, 20000);
    all.push(...((((payload as any)?.data?.list ?? []) as Record<string, unknown>[])));
  }
  const announcements = all.map((row, index) => {
    const stockRows = Array.isArray(row.codes) ? row.codes as Record<string, unknown>[] : [];
    const stockCodes = stockRows.map((item) => normalizeCode(item.stock_code)).filter((code) => /^\d{6}$/.test(code));
    const id = String(row.art_code ?? `bun-ann-${index}`);
    return {
      id,
      title: String(row.title ?? ""),
      url: stockCodes[0] ? `https://data.eastmoney.com/notices/detail/${stockCodes[0]}/${id}.html` : String(row.eiUrl ?? ""),
      publishedAt: String(row.display_time ?? ""),
      source: "eastmoney-announcement",
      category: String((Array.isArray(row.columns) ? (row.columns[0] as any)?.column_name : undefined) ?? "鍏憡"),
      stockCodes,
      stockNames: stockRows.map((item) => String(item.short_name ?? "")).filter(Boolean)
    };
  }).filter((row) => row.title && row.stockCodes.length).slice(0, limit);
  return { engine: "bun", announcements, stats: { scannedStocks: requested.length, requestCodes: pages.length, returnedRows: announcements.length } };
}

function eastmoneyF10Code(code: string) {
  return `${code.startsWith("6") ? "SH" : code.startsWith("9") || code.startsWith("4") ? "BJ" : "SZ"}${code}`;
}

function profileTags(payload: any) {
  const concept = [payload?.ssbk, payload?.zygcfx, payload?.sshy].filter(Array.isArray).flat();
  return Array.from(new Set(concept.map((row: any) => String(row.BOARD_NAME ?? row.CONCEPT_NAME ?? "").trim()).filter(Boolean))).slice(0, 12);
}

interface CachedStockProfile {
  profile: {
    code: string;
    name: string;
    website?: string;
    industry1: string;
    industry2: string;
    industryTags: string[];
    source: string;
  };
  conceptLoaded: boolean;
}

function applyStockProfileFallback(cached: CachedStockProfile, fallback: { name?: string; industry1?: string; industry2?: string }) {
  const profile = cached.profile;
  const fallbackIndustry1 = String(fallback.industry1 ?? "").trim();
  const fallbackIndustry2 = String(fallback.industry2 ?? "").trim();
  const industry1 = profile.industry1 || fallbackIndustry1;
  const industry2 = profile.industry2 || fallbackIndustry2 || industry1;
  return {
    ...profile,
    name: profile.name && profile.name !== profile.code ? profile.name : String(fallback.name ?? profile.code),
    industry1,
    industry2,
    industryTags: Array.from(new Set([industry1, industry2, ...profile.industryTags].filter(Boolean)))
  };
}

export async function fetchStockProfile(codeInput: string, fallback: { name?: string; industry1?: string; industry2?: string; forceRefresh?: boolean } = {}) {
  const code = normalizeCode(codeInput);
  const memoryKey = `eastmoney:stock-profile:v5:${code}`;
  const memoryTtlMs = 30 * 60 * 1000;
  const load = () =>
    persistentCacheGetOrCreate<CachedStockProfile>(
      "stock-profile-v5",
      code,
      (value) => value.conceptLoaded ? PROFILE_PERSISTENT_CACHE_TTL_MS : PROFILE_PARTIAL_CACHE_TTL_MS,
      async () => {
        const f10Code = eastmoneyF10Code(code);
        const survey = await fetchJson(urlWithParams(EASTMONEY_COMPANY_SURVEY_URL, { code: f10Code }), { headers: { referer: "https://emweb.securities.eastmoney.com/" } }, 20000);
        let concept: any = {};
        let conceptLoaded = true;
        try {
          concept = await fetchJson(urlWithParams(EASTMONEY_CORE_CONCEPTION_URL, { code: f10Code }), { headers: { referer: "https://emweb.securities.eastmoney.com/" } }, 20000);
        } catch {
          concept = {};
          conceptLoaded = false;
        }
        const base = Array.isArray((survey as any)?.jbzl) ? (survey as any).jbzl[0] ?? {} : {};
        const website = String(base.ORG_WEB ?? "").trim();
        const normalizedWebsite = website && website.includes(".") ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : undefined;
        const conceptTags = profileTags(concept);
        conceptLoaded = conceptLoaded && conceptTags.length > 0;
        const industry1 = String(textValue(base, ["INDUSTRY", "INDUSTRYCSRC1"]) ?? "").trim();
        const industry2 = String(conceptTags[1] || conceptTags[0] || "").trim();
        return {
          profile: {
            code,
            name: String(base.SECURITY_NAME_ABBR ?? code),
            website: normalizedWebsite,
            industry1,
            industry2,
            industryTags: Array.from(new Set([industry1, industry2, ...conceptTags].filter(Boolean))),
            source: "eastmoney-f10-bun"
          },
          conceptLoaded
        };
      },
      { forceRefresh: fallback.forceRefresh }
    );

  const cached = fallback.forceRefresh
    ? cacheSet(memoryKey, await load(), memoryTtlMs)
    : await cacheGetOrCreate<CachedStockProfile>(memoryKey, memoryTtlMs, load);
  return applyStockProfileFallback(cached, fallback);
}

export async function fetchTechnicalIndicators(codes: string[], limit = 120) {
  const uniqueCodes = Array.from(new Set(codes.map(normalizeCode).filter((code) => /^\d{6}$/.test(code)))).slice(0, 200);
  const rows = await mapConcurrent(uniqueCodes, FINANCE_FETCH_CONCURRENCY, async (code) => {
    try {
      const { points } = await fetchKlinePointsWithFallback(code, "day", Math.max(20, Math.min(limit, 250)));
      const closes = points.map((point) => point.close);
      const last = points.at(-1);
      if (!last) return undefined;
      const previous = points.at(-2);
      const ma = (days: number) => closes.slice(-days).reduce((sum, value) => sum + value, 0) / Math.max(1, closes.slice(-days).length);
      const momentum = (days: number) => closes.length > days ? (last.close / closes[closes.length - 1 - days] - 1) * 100 : undefined;
      const changes = points.slice(-20).map((point, index, arr) => index === 0 ? 0 : point.close / arr[index - 1].close - 1).slice(1);
      const avg = changes.reduce((sum, value) => sum + value, 0) / Math.max(1, changes.length);
      const volatility = Math.sqrt(changes.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(1, changes.length)) * Math.sqrt(252) * 100;
      return {
        code,
        name: code,
        reportDate: last.date,
        sourceRows: points.length,
        metrics: compactRow([
          ["realTechnicalSource", 1],
          ["ma5", round(ma(5), 2)],
          ["ma20", round(ma(20), 2)],
          ["momentum20", momentum(20) === undefined ? undefined : round(momentum(20)!, 2)],
          ["momentum60", momentum(60) === undefined ? undefined : round(momentum(60)!, 2)],
          ["volatility20", round(volatility, 2)],
          ["price", last.close],
          ["pctChange", previous ? round((last.close / previous.close - 1) * 100, 2) : undefined]
        ])
      };
    } catch {
      // Skip individual unsupported/suspended symbols; the caller sees sourceRows through returned rows.
      return undefined;
    }
  });
  return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
}

async function fetchFinanceStatementsUncached(reportDate: string) {
  const normalized = normalizeReportDate(reportDate);
  const statementFilter = `(REPORT_DATE='${normalized.date}')`;
  const performanceFilter = `(REPORTDATE='${normalized.date}')`;
  const [performanceRows, incomeRows, balanceRows, cashFlowRows] = await Promise.all([
    fetchDatacenterPages("RPT_LICO_FN_CPD", "ALL", "SECURITY_CODE", "1", performanceFilter, 500, 30),
    fetchDatacenterPages("RPT_DMSK_FN_INCOME", "ALL", "SECURITY_CODE", "1", statementFilter, 500, 15),
    fetchDatacenterPages("RPT_DMSK_FN_BALANCE", "ALL", "SECURITY_CODE", "1", statementFilter, 500, 15),
    fetchDatacenterPages("RPT_DMSK_FN_CASHFLOW", "ALL", "SECURITY_CODE", "1", statementFilter, 500, 15)
  ]);
  const stamp = (row: Record<string, unknown>) => ({ ...row, reportDate: normalized.date, REPORT_DATE_LABEL: normalized.yyyymmdd });
  return {
    performanceRows: performanceRows.map((row) => ({ ...stamp(row), REPORTDATE: row.REPORTDATE ?? normalized.date })),
    incomeRows: incomeRows.map((row) => ({ ...stamp(row), REPORT_DATE: row.REPORT_DATE ?? normalized.date })),
    balanceRows: balanceRows.map((row) => ({ ...stamp(row), REPORT_DATE: row.REPORT_DATE ?? normalized.date })),
    cashFlowRows: cashFlowRows.map((row) => ({ ...stamp(row), REPORT_DATE: row.REPORT_DATE ?? normalized.date })),
    reportDate: normalized.date
  };
}

export async function fetchFinanceStatements(reportDate: string) {
  const normalized = normalizeReportDate(reportDate);
  return cacheGetOrCreate(`eastmoney:finance-statements:${normalized.yyyymmdd}`, FINANCE_STATEMENT_CACHE_TTL_MS, () =>
    persistentCacheGetOrCreate("finance-statements", normalized.yyyymmdd, FINANCE_PERSISTENT_CACHE_TTL_MS, () =>
      fetchFinanceStatementsUncached(normalized.date)
    )
  );
}

async function fetchFinancialMetricRowsUncached(reportDate: string) {
  const normalized = normalizeReportDate(reportDate);
  const rows = await fetchFinanceStatements(reportDate);
  const performanceByCode = rowByCode(rows.performanceRows);
  const incomeByCode = rowByCode(rows.incomeRows);
  const balanceByCode = rowByCode(rows.balanceRows);
  const cashFlowByCode = rowByCode(rows.cashFlowRows);
  const codes = new Set<string>();
  [performanceByCode, incomeByCode, balanceByCode, cashFlowByCode].forEach((map) => map.forEach((_, code) => codes.add(code)));

  return Array.from(codes).map((code) => {
    const performance = performanceByCode.get(code);
    const income = incomeByCode.get(code);
    const balance = balanceByCode.get(code);
    const cashFlow = cashFlowByCode.get(code);
    const sourceRows = [performance, income, balance, cashFlow].filter(Boolean).length;
    const revenue = firstDefined(
      amountToYi(numberAt(income ?? {}, ["TOTAL_OPERATE_INCOME", "OPERATE_INCOME"])),
      amountToYi(numberAt(performance ?? {}, ["TOTAL_OPERATE_INCOME", "OPERATE_INCOME"]))
    );
    const netProfit = firstDefined(
      amountToYi(numberAt(income ?? {}, ["PARENT_NETPROFIT", "NETPROFIT"])),
      amountToYi(numberAt(performance ?? {}, ["PARENT_NETPROFIT", "NETPROFIT"]))
    );
    const operatingCost = firstDefined(
      amountToYi(numberAt(income ?? {}, ["TOTAL_OPERATE_COST", "OPERATE_COST"])),
      amountToYi(numberAt(performance ?? {}, ["TOTAL_OPERATE_COST", "OPERATE_COST"]))
    );
    const operatingCashflow = amountToYi(numberAt(cashFlow ?? {}, ["NETCASH_OPERATE", "NET_CASH_FLOWS_OPERATE"]));
    const totalAssets = amountToYi(numberAt(balance ?? {}, ["TOTAL_ASSETS"]));
    const totalLiabilities = amountToYi(numberAt(balance ?? {}, ["TOTAL_LIABILITIES"]));
    const inventory = amountToYi(numberAt(balance ?? {}, ["INVENTORY"]));
    const receivables = amountToYi(numberAt(balance ?? {}, ["ACCOUNTS_RECE"]));
    const currentAssets = amountToYi(numberAt(balance ?? {}, ["TOTAL_CURRENT_ASSETS"]));
    const currentLiabilities = amountToYi(numberAt(balance ?? {}, ["TOTAL_CURRENT_LIAB"]));
    const investmentAssets = sumDefined([
      amountToYi(numberAt(balance ?? {}, ["MONETARYFUNDS"])),
      amountToYi(numberAt(balance ?? {}, ["TRADING_FINANCIAL_ASSETS"])),
      amountToYi(numberAt(balance ?? {}, ["AVAILABLE_SALE_FINASSET"])),
      amountToYi(numberAt(balance ?? {}, ["LONG_EQUITY_INVEST"]))
    ]);
    const productionAssets = totalAssets !== undefined && investmentAssets !== undefined ? Math.max(totalAssets - investmentAssets, 0) : undefined;
    const interestBearingDebt = firstDefined(
      amountToYi(numberAt(balance ?? {}, ["INTEREST_BEARING_DEBT"])),
      sumDefined([
        amountToYi(numberAt(balance ?? {}, ["SHORT_LOAN"])),
        amountToYi(numberAt(balance ?? {}, ["LONG_LOAN"])),
        amountToYi(numberAt(balance ?? {}, ["BOND_PAYABLE"])),
        amountToYi(numberAt(balance ?? {}, ["NONCURRENT_LIAB_1YEAR"]))
      ])
    );
    const metrics: Record<string, number> = { realFinancialSource: 1 };
    withMetric(metrics, "revenue", revenue);
    withMetric(metrics, "netProfit", netProfit);
    withMetric(metrics, "operatingCashflow", operatingCashflow);
    withMetric(metrics, "totalAssets", totalAssets);
    withMetric(metrics, "totalLiabilities", totalLiabilities);
    withMetric(metrics, "inventory", inventory);
    withMetric(metrics, "receivables", receivables);
    withMetric(metrics, "eps", numberAt(performance ?? income ?? {}, ["BASIC_EPS", "EPSJB"]));
    withMetric(metrics, "bps", numberAt(performance ?? {}, ["BPS"]));
    withMetric(metrics, "roe", numberAt(performance ?? {}, ["WEIGHTAVG_ROE", "ROE_WEIGHT"]));
    withMetric(metrics, "roa", safeRatio(netProfit, totalAssets));
    withMetric(metrics, "grossMargin", firstDefined(numberAt(performance ?? {}, ["XSMLL"]), revenue !== undefined && operatingCost !== undefined ? safeRatio(revenue - operatingCost, revenue) : undefined));
    withMetric(metrics, "netMargin", safeRatio(netProfit, revenue));
    withMetric(metrics, "revenueGrowth", numberAt(performance ?? {}, ["YSTZ"]));
    withMetric(metrics, "netProfitGrowth", numberAt(performance ?? {}, ["SJLTZ"]));
    withMetric(metrics, "profitGrowth", numberAt(performance ?? {}, ["SJLTZ"]));
    withMetric(metrics, "debtRatio", safeRatio(totalLiabilities, totalAssets));
    withMetric(metrics, "currentRatio", currentAssets !== undefined && currentLiabilities !== undefined ? safeRatio(currentAssets, currentLiabilities, 1) : undefined);
    withMetric(metrics, "assetTurnover", safeRatio(revenue, totalAssets, 1));
    withMetric(metrics, "dividendYield", numberAt(performance ?? {}, ["ZXGXL"]));
    withMetric(metrics, "investmentAssets", investmentAssets);
    withMetric(metrics, "productionAssets", productionAssets);
    withMetric(metrics, "interestBearingDebt", interestBearingDebt);
    withMetric(metrics, "nonInterestBearingDebt", totalLiabilities !== undefined && interestBearingDebt !== undefined ? Math.max(totalLiabilities - interestBearingDebt, 0) : undefined);
    withMetric(metrics, "qualityScore", metrics.roe !== undefined && metrics.netMargin !== undefined && metrics.debtRatio !== undefined ? Math.max(0, Math.min(100, metrics.roe * 1.5 + metrics.netMargin * 0.8 - metrics.debtRatio * 0.2 + 50)) : undefined);
    const hasReportData = [revenue, netProfit, operatingCashflow, totalAssets, totalLiabilities].some((value) => value !== undefined && Number.isFinite(value));
    const noticeDate = disclosureDateNumber(performance, income, balance, cashFlow) ?? normalized.number;
    withMetric(metrics, "realAnnualReportSource", hasReportData ? 1 : undefined, 0);
    withMetric(metrics, "realFinancialReportDate", hasReportData ? normalized.number : undefined, 0);
    withMetric(metrics, "realFinancialReportDisclosureDate", hasReportData ? noticeDate : undefined, 0);
    withMetric(metrics, "realAnnualReportDate", normalized.yyyymmdd.endsWith("1231") && hasReportData ? normalized.number : undefined, 0);
    withMetric(metrics, "realAnnualReportDisclosureDate", normalized.yyyymmdd.endsWith("1231") && hasReportData ? noticeDate : undefined, 0);
    return {
      code,
      name: String(textValue(performance ?? income ?? balance ?? cashFlow ?? {}, ["SECURITY_NAME_ABBR", "SECURITY_NAME"]) ?? ""),
      reportDate: normalized.date,
      sourceRows,
      metrics
    };
  }).filter((row) => /^\d{6}$/.test(row.code) && row.metrics.realAnnualReportSource === 1);
}

export async function fetchFinancialMetricRows(reportDate: string) {
  const normalized = normalizeReportDate(reportDate);
  return cacheGetOrCreate(`eastmoney:financial-metrics:${normalized.yyyymmdd}`, FINANCE_METRIC_CACHE_TTL_MS, () =>
    persistentCacheGetOrCreate("financial-metrics", normalized.yyyymmdd, FINANCE_PERSISTENT_CACHE_TTL_MS, () =>
      fetchFinancialMetricRowsUncached(normalized.date)
    )
  );
}

export function formatAnnualReportExport(row: { code: string; name: string; reportDate: string; metrics: Record<string, number> }, fallbackStockName: string) {
  const csv = ["股票代码,股票名称,报告期,营业收入,净利润,ROE", [row.code, row.name, row.reportDate, row.metrics.revenue ?? "", row.metrics.netProfit ?? "", row.metrics.roe ?? ""].join(",")].join("\r\n");
  return { year: row.reportDate.slice(0, 4), stockCode: row.code, stockName: row.name || fallbackStockName, reportDate: row.reportDate, source: "eastmoney-bun", sourceNote: "由 Bun 财报接口生成。", sourceCsv: csv, metrics: row.metrics };
}

export async function fetchAnnualReports(stock: Stock) {
  const rows = await fetchFinancialMetricRows("2025-12-31");
  const row = rows.find((item) => item.code === normalizeCode(stock.code));
  if (!row) return [];
  return [formatAnnualReportExport(row, stock.name)];
}

const valuationProfile = {
  industry: "通用行业",
  model: "PE盈利",
  earningsWeight: 0.45,
  assetWeight: 0.2,
  salesWeight: 0.15,
  cashflowWeight: 0.2,
  targetPe: 18,
  targetPb: 1.8,
  targetPs: 1.8,
  cashflowMultiple: 12,
  discountRate: 9.5,
  terminalGrowth: 2,
  riskBuffer: 18
};

function valuationVerdict(margin: number) {
  if (margin >= 60) return "深度低估";
  if (margin >= 35) return "低估";
  if (margin >= 10) return "合理";
  if (margin >= -15) return "偏高";
  return "高估";
}

function valuationState(stock: Stock) {
  const growth = stock.metrics.netProfitGrowth ?? stock.metrics.revenueGrowth ?? 0;
  if ((stock.metrics.debtRatio ?? 0) > 75 || growth < -30) return "困境承压";
  if (growth > 20) return "高速成长";
  if (growth > 5) return "稳定成熟";
  return "周期修复";
}

function hasValuationInputs(stock: Stock) {
  const metrics = stock.metrics ?? {};
  return Number.isFinite(metrics.price) && metrics.price > 0 && Number.isFinite(metrics.marketCap) && metrics.marketCap > 0 && [metrics.eps, metrics.bps, metrics.revenue, metrics.netProfit].some((value) => Number.isFinite(value));
}

function isAllIndustryFilter(value: unknown) {
  return isAllIndustry(String(value ?? ""));
}

export function buildBunValuationRows(stocks: Stock[], filters: any = {}) {
  const industryFilters = Array.isArray(filters?.industries) ? filters.industries : [];
  const shouldIncludeAllIndustries = !industryFilters.length || industryFilters.some(isAllIndustryFilter);
  const industries = industryFilters.map((item: unknown) => String(item ?? "")).filter((item: string) => !isAllIndustryFilter(item));
  return stocks
    .filter(hasValuationInputs)
    .filter((stock) => shouldIncludeAllIndustries || industries.some((industry: string) => stockMatchesIndustry(stock, "industry1", industry) || stockMatchesIndustry(stock, "industry2", industry)))
    .map((stock) => {
      const metrics = stock.metrics;
      const price = Math.max(metrics.price ?? 0, 0.01);
      const marketCap = Math.max(metrics.marketCap ?? 0, 0.01);
      const shareBase = Math.max(marketCap / price, 0.01);
      const eps = Number.isFinite(metrics.eps) ? metrics.eps : Number.isFinite(metrics.netProfit) ? (metrics.netProfit ?? 0) / shareBase : 0;
      const bps = Number.isFinite(metrics.bps) ? metrics.bps : Number.isFinite(metrics.pb) && metrics.pb ? price / Math.max(metrics.pb ?? 1, 0.01) : 0;
      const revenuePerShare = Number.isFinite(metrics.revenue) ? (metrics.revenue ?? 0) / shareBase : 0;
      const cashflowPerShare = Number.isFinite(metrics.operatingCashflow) ? (metrics.operatingCashflow ?? 0) / shareBase : 0;
      const earningsValue = Math.max(0, eps) * valuationProfile.targetPe;
      const assetValue = Math.max(0, bps) * valuationProfile.targetPb * 0.65;
      const salesValue = Math.max(0, revenuePerShare) * valuationProfile.targetPs * 0.55;
      const cashflowValue = Math.max(0, cashflowPerShare) * valuationProfile.cashflowMultiple * 0.65;
      const positiveValues = [earningsValue, assetValue, salesValue, cashflowValue].filter((value) => value > 0.01).sort((a, b) => a - b);
      const anchorValue = positiveValues.length ? positiveValues[0] * 0.7 + (positiveValues[1] ?? positiveValues[0]) * 0.3 : 0.01;
      const qualityScore = Math.max(0, Math.min(100, 45 + (metrics.roe ?? 0) * 1.2 + (metrics.netMargin ?? 0) * 0.8));
      const growthScore = Math.max(0, Math.min(100, 50 + (metrics.netProfitGrowth ?? metrics.revenueGrowth ?? 0)));
      const solvencyScore = Math.max(0, Math.min(100, 80 - Math.max(0, metrics.debtRatio ?? 45) * 0.5));
      const governanceScore = Math.max(40, Math.min(95, 70 - Math.max(0, metrics.pledgeRatio ?? 0) * 0.5 - Math.max(0, metrics.violationScore ?? 0) * 0.4));
      const riskDiscount = Math.max(0.45, Math.min(0.9, 0.9 - valuationProfile.riskBuffer / 100));
      const fairValue = round(anchorValue * (0.55 + qualityScore / 250) * riskDiscount, 2);
      const safetyMargin = round(((fairValue - price) / price) * 100, 2);
      const state = valuationState(stock);
      return {
        stock,
        profile: { ...valuationProfile, industry: stock.industry1 || valuationProfile.industry },
        state,
        model: valuationProfile.model,
        fairValue,
        bearValue: round(fairValue * 0.72, 2),
        bullValue: round(fairValue * 1.12, 2),
        currentPrice: round(price, 2),
        marketCap: round(marketCap, 2),
        safetyMargin,
        upside: safetyMargin,
        verdict: valuationVerdict(safetyMargin),
        action: safetyMargin >= 35 ? "进入候选池，等待价格回撤或业绩确认" : "未满足严苛口径，暂不配置",
        positionHint: safetyMargin >= 60 ? "5-8%" : safetyMargin >= 35 ? "3-5%" : safetyMargin >= 10 ? "1-3%" : "0%",
        qualityScore: round(qualityScore, 1),
        growthScore: round(growthScore, 1),
        solvencyScore: round(solvencyScore, 1),
        governanceScore: round(governanceScore, 1),
        industryFitScore: 70,
        statusModifier: state === "困境承压" ? 0.55 : 0.78,
        governanceModifier: round(0.55 + governanceScore / 250, 2),
        financialModifier: round(0.55 + solvencyScore / 260, 2),
        riskDiscount: round(riskDiscount, 2),
        anchorValue: round(anchorValue, 2),
        drivers: ["Bun 估值接口仅使用传入股票的真实行情和财务字段计算", "估值锚点取盈利、资产、收入、现金流模型中较低值组合"],
        warnings: safetyMargin < 0 ? ["当前价格高于 Bun 核算价值"] : [],
        components: {
          earningsValue: round(earningsValue, 2),
          assetValue: round(assetValue, 2),
          salesValue: round(salesValue, 2),
          cashflowValue: round(cashflowValue, 2),
          anchorValue: round(anchorValue, 2),
          weightedValue: round(anchorValue, 2),
          cashCoverage: round((metrics.operatingCashflow ?? 0) / Math.max(metrics.netProfit ?? 0.01, 0.01), 4),
          cashflowRequirementModifier: cashflowValue > 0 ? 1 : 0,
          cashflowPolicy: { requiredCoverage: 0.8, strongCoverage: 1.2, floorModifier: 0.55, ceilingModifier: 1, penaltyWeight: 0.25, note: "Bun 通用现金流门槛" },
          balanceSheet: {
            totalAssets: round(metrics.totalAssets ?? 0, 2),
            productionAssets: round(metrics.productionAssets ?? 0, 2),
            investmentAssets: round(metrics.investmentAssets ?? 0, 2),
            totalLiabilities: round(metrics.totalLiabilities ?? 0, 2),
            interestBearingDebt: round(metrics.interestBearingDebt ?? 0, 2),
            nonInterestBearingDebt: round(metrics.nonInterestBearingDebt ?? 0, 2),
            nonInterestDebtReserveRate: 0.35,
            netInvestmentAssets: round(Math.max(0, (metrics.investmentAssets ?? 0) - (metrics.interestBearingDebt ?? 0)), 2),
            investmentAssetPerShare: round((metrics.investmentAssets ?? 0) / shareBase, 2),
            netInvestmentAssetPerShare: round(Math.max(0, (metrics.investmentAssets ?? 0) - (metrics.interestBearingDebt ?? 0)) / shareBase, 2),
            interestDebtRatio: round(((metrics.interestBearingDebt ?? 0) / Math.max(metrics.totalAssets ?? 1, 1)) * 100, 2),
            nonInterestDebtRatio: round(((metrics.nonInterestBearingDebt ?? 0) / Math.max(metrics.totalAssets ?? 1, 1)) * 100, 2),
            productionAssetRatio: round(((metrics.productionAssets ?? 0) / Math.max(metrics.totalAssets ?? 1, 1)) * 100, 2)
          },
          formulaRows: [
            { name: "盈利模型", formula: "max(EPS,0) * 目标PE", substitution: `${round(Math.max(0, eps), 2)} * ${valuationProfile.targetPe}`, value: round(earningsValue, 2) },
            { name: "资产模型", formula: "BPS * 目标PB * 0.65", substitution: `${round(bps, 2)} * ${valuationProfile.targetPb} * 0.65`, value: round(assetValue, 2) },
            { name: "收入模型", formula: "每股收入 * 目标PS * 0.55", substitution: `${round(revenuePerShare, 2)} * ${valuationProfile.targetPs} * 0.55`, value: round(salesValue, 2) },
            { name: "现金流模型", formula: "每股经营现金流 * 现金流倍数 * 0.65", substitution: `${round(cashflowPerShare, 2)} * ${valuationProfile.cashflowMultiple} * 0.65`, value: round(cashflowValue, 2) }
          ]
        }
      };
    })
    .filter((row) => row.safetyMargin >= (filters?.minSafetyMargin ?? -999) && row.governanceScore >= (filters?.minGovernanceScore ?? 0));
}
