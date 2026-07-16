// Client-side service for the Bun-side scheduled sync. All HTTP goes to the same-origin Bun API proxy.

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ScheduleSources {
  marketQuotes: boolean;
  financialReports: boolean;
  analystForecasts: boolean;
  marginBalances: boolean;
  northHoldings: boolean;
  technicalIndicators: boolean;
}

export interface ScheduleConfig {
  enabled: boolean;
  intervalMinutes: number;
  sources: ScheduleSources;
}

export interface SyncRunRecord {
  source: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  rowCount: number;
  error?: string;
}

export interface SyncStatus {
  config: ScheduleConfig;
  running: boolean;
  activeSources?: string[];
  lastFullSync: string | null;
  runs: SyncRunRecord[];
  cacheFiles: Array<{ name: string; size: number; modifiedAt: string }>;
}

export const defaultScheduleConfig: ScheduleConfig = {
  enabled: false,
  intervalMinutes: 15,
  sources: {
    marketQuotes: true,
    financialReports: false,
    analystForecasts: false,
    marginBalances: false,
    northHoldings: false,
    technicalIndicators: false
  }
};

export const scheduleSourceLabels: Array<{ key: keyof ScheduleSources; label: string; description: string }> = [
  { key: "marketQuotes", label: "行情快照", description: "全市场实时行情（东方财富），适合高频" },
  { key: "financialReports", label: "财报数据", description: "利润表/资产负债表/现金流，每日一次" },
  { key: "analystForecasts", label: "分析师预测", description: "机构评级与目标价" },
  { key: "marginBalances", label: "融资融券", description: "两融余额变动" },
  { key: "northHoldings", label: "北向持仓", description: "沪深股通持股变动" },
  { key: "technicalIndicators", label: "技术指标", description: "MA/动量/波动率，依赖行情快照" }
];

function requireFetch(fetchImpl?: FetchLike): FetchLike {
  const fn = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fn) throw new Error("定时同步服务不可用：当前环境没有 fetch");
  return fn;
}

async function parseJson(response: Response, label: string) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${label} HTTP ${response.status}${text.trim() ? `: ${text.trim().slice(0, 200)}` : ""}`);
  }
  return response.json();
}

export async function fetchSyncStatus(fetchImpl?: FetchLike): Promise<SyncStatus> {
  const fn = requireFetch(fetchImpl);
  return parseJson(await fn("/api/sync/status"), "获取同步状态");
}

export async function fetchSyncConfig(fetchImpl?: FetchLike): Promise<ScheduleConfig> {
  const fn = requireFetch(fetchImpl);
  return parseJson(await fn("/api/sync/config"), "获取同步配置");
}

export async function saveSyncConfig(config: ScheduleConfig, fetchImpl?: FetchLike): Promise<ScheduleConfig> {
  const fn = requireFetch(fetchImpl);
  return parseJson(
    await fn("/api/sync/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    }),
    "保存同步配置"
  );
}

export async function triggerManualSync(fetchImpl?: FetchLike): Promise<{ ok: boolean; results: SyncRunRecord[] }> {
  const fn = requireFetch(fetchImpl);
  return parseJson(await fn("/api/sync/run", { method: "POST" }), "手动触发同步");
}
