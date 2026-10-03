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
  skipped?: boolean;
  error?: string;
}

export type SyncCompletionStatus = "idle" | "success" | "partial" | "failed";
export type SyncSourceKey = keyof ScheduleSources;

export interface SyncSnapshot<T = unknown> {
  snapshotAt: string;
  data: T;
}

export interface SyncStatus {
  config: ScheduleConfig;
  running: boolean;
  activeSources?: string[];
  lastFullSync: string | null;
  lastAttemptAt?: string | null;
  status?: SyncCompletionStatus;
  runs: SyncRunRecord[];
  cacheFiles: Array<{ name: string; size: number; modifiedAt: string }>;
}

export interface ManualSyncResult {
  ok: boolean;
  status: Exclude<SyncCompletionStatus, "idle">;
  results: SyncRunRecord[];
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

const snapshotNameBySource: Record<SyncSourceKey, string> = {
  marketQuotes: "market-quotes",
  financialReports: "financial-reports",
  analystForecasts: "analyst-forecasts",
  marginBalances: "margin-balances",
  northHoldings: "north-holdings",
  technicalIndicators: "technical-indicators"
};

export function isSyncSourceKey(value: string): value is SyncSourceKey {
  return Object.prototype.hasOwnProperty.call(snapshotNameBySource, value);
}

export function syncResultStatus(results: SyncRunRecord[]): Exclude<SyncCompletionStatus, "idle"> {
  if (!results.length || results.every((result) => !result.ok)) return "failed";
  return results.every((result) => result.ok) ? "success" : "partial";
}

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

export async function triggerManualSync(fetchImpl?: FetchLike): Promise<ManualSyncResult> {
  const fn = requireFetch(fetchImpl);
  const payload = await parseJson(await fn("/api/sync/run", { method: "POST" }), "手动触发同步") as { results?: unknown };
  const results = Array.isArray(payload?.results) ? payload.results as SyncRunRecord[] : [];
  const status = syncResultStatus(results);
  return { ok: status === "success", status, results };
}

export async function fetchSyncSnapshot<T = unknown>(source: SyncSourceKey, fetchImpl?: FetchLike): Promise<SyncSnapshot<T>> {
  const fn = requireFetch(fetchImpl);
  const name = snapshotNameBySource[source];
  const payload = await parseJson(
    await fn(`/api/sync/snapshot/${encodeURIComponent(name)}`),
    `读取${source}快照`
  ) as Partial<SyncSnapshot<T>>;
  if (!payload || typeof payload.snapshotAt !== "string" || !payload.snapshotAt.trim() || !("data" in payload)) {
    throw new Error(`读取${source}快照失败：快照结构无效`);
  }
  return { snapshotAt: payload.snapshotAt, data: payload.data as T };
}
