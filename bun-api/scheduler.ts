import { promises as fs } from "fs";
import path from "path";
import { resolveDataCacheDir, writeFileAtomic } from "./lib/persistentCache";
import { financialReportDateCandidates } from "../src/dataContracts";
import { fetchEastmoneySpotRows, stockFromMarketRow } from "./services/market";
import { fetchFinancialMetricRows, fetchAnalystForecastRows, fetchMarginBalanceRows, fetchNorthHoldingRows, fetchTechnicalIndicators } from "./services/finance";

// Electron 使用 userData；命令行开发默认使用项目内 data-cache。
export function dataCacheDir(): string {
  return resolveDataCacheDir();
}

export interface ScheduleConfig {
  enabled: boolean;
  intervalMinutes: number;
  sources: {
    marketQuotes: boolean;
    financialReports: boolean;
    analystForecasts: boolean;
    marginBalances: boolean;
    northHoldings: boolean;
    technicalIndicators: boolean;
  };
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
export type SyncSourceKey = keyof ScheduleConfig["sources"];

export interface SyncStatus {
  config: ScheduleConfig;
  running: boolean;
  activeSources: string[];
  lastFullSync: string | null;
  lastAttemptAt: string | null;
  status: SyncCompletionStatus;
  runs: SyncRunRecord[];
  cacheFiles: Array<{ name: string; size: number; modifiedAt: string }>;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  enabled: false,
  intervalMinutes: 15,
  sources: {
    marketQuotes: true,
    financialReports: false,
    analystForecasts: false,
    marginBalances: false,
    northHoldings: false,
    technicalIndicators: false,
  }
};

const CONFIG_FILE = () => path.join(dataCacheDir(), "config", "schedule.json");
const STATUS_FILE = () => path.join(dataCacheDir(), "config", "status.json");
const MAX_RUN_RECORDS = 200;

let currentConfig: ScheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG };
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
const runRecords: SyncRunRecord[] = [];
const activeSources = new Set<string>();
let statusHydrationPromise: Promise<void> | null = null;
let lastAttemptAt: string | null = null;
let syncStatus: SyncCompletionStatus = "idle";

function log(msg: string) {
  console.log(`[scheduler] ${msg}`);
}

export async function loadConfig(): Promise<ScheduleConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ScheduleConfig>;
    currentConfig = {
      ...DEFAULT_SCHEDULE_CONFIG,
      ...parsed,
      sources: { ...DEFAULT_SCHEDULE_CONFIG.sources, ...(parsed.sources ?? {}) }
    };
  } catch {
    currentConfig = { ...DEFAULT_SCHEDULE_CONFIG };
  }
  return currentConfig;
}

export async function saveConfig(config: ScheduleConfig): Promise<ScheduleConfig> {
  currentConfig = { ...config };
  await writeFileAtomic(CONFIG_FILE(), JSON.stringify(config, null, 2));
  applySchedule();
  return currentConfig;
}

async function hydratePersistedStatus() {
  if (!statusHydrationPromise) {
    statusHydrationPromise = (async () => {
      try {
        const raw = await fs.readFile(STATUS_FILE(), "utf8");
        const parsed = JSON.parse(raw) as { runs?: SyncRunRecord[]; lastFullSync?: string; lastAttemptAt?: string; status?: SyncCompletionStatus };
        const savedRuns = Array.isArray(parsed.runs) ? parsed.runs.slice(-MAX_RUN_RECORDS) : [];
        runRecords.length = 0;
        runRecords.push(...savedRuns);
        if (parsed.lastFullSync) lastFullSync = parsed.lastFullSync;
        if (parsed.lastAttemptAt) lastAttemptAt = parsed.lastAttemptAt;
        if (parsed.status && ["idle", "success", "partial", "failed"].includes(parsed.status)) syncStatus = parsed.status;
      } catch {
        // no saved status yet
      }
    })();
  }
  await statusHydrationPromise;
}

export async function loadStatus(): Promise<SyncStatus> {
  await hydratePersistedStatus();
  const cacheFiles = await listCacheFiles();
  return { config: currentConfig, running, activeSources: [...activeSources], lastFullSync, lastAttemptAt, status: syncStatus, runs: [...runRecords].reverse().slice(0, 50), cacheFiles };
}

let lastFullSync: string | null = null;

async function persistStatus() {
  const payload = JSON.stringify({ runs: runRecords.slice(-MAX_RUN_RECORDS), lastFullSync, lastAttemptAt, status: syncStatus });
  await writeFileAtomic(STATUS_FILE(), payload);
}

function recordRun(record: SyncRunRecord) {
  runRecords.push(record);
  if (runRecords.length > MAX_RUN_RECORDS) runRecords.splice(0, runRecords.length - MAX_RUN_RECORDS);
}

function skippedRun(source: string, error: string): SyncRunRecord {
  const now = new Date().toISOString();
  const record: SyncRunRecord = { source, startedAt: now, finishedAt: now, ok: false, skipped: true, rowCount: 0, error };
  recordRun(record);
  return record;
}

async function cacheSnapshot(name: string, data: unknown) {
  if (!Array.isArray(data) || !data.length) throw new Error(`${name} returned no rows; previous snapshot retained`);
  const filePath = path.join(dataCacheDir(), "snapshots", `${name}.json`);
  await writeFileAtomic(filePath, JSON.stringify({ snapshotAt: new Date().toISOString(), data }));
}

async function listCacheFiles(): Promise<Array<{ name: string; size: number; modifiedAt: string }>> {
  try {
    const dir = path.join(dataCacheDir(), "snapshots");
    const entries = await fs.readdir(dir);
    const result: Array<{ name: string; size: number; modifiedAt: string }> = [];
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      result.push({ name: name.replace(/\.json$/, ""), size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
    return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch {
    return [];
  }
}

export async function readSnapshot(name: string): Promise<{ snapshotAt: string; data: unknown } | null> {
  try {
    const raw = await fs.readFile(path.join(dataCacheDir(), "snapshots", `${name}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function runSource(source: string, fn: () => Promise<number>): Promise<SyncRunRecord> {
  if (activeSources.has(source)) {
    return { source, startedAt: "", finishedAt: "", ok: false, rowCount: 0, error: "already running, skipped" };
  }
  activeSources.add(source);
  const startedAt = new Date().toISOString();
  try {
    const rowCount = await fn();
    if (!Number.isFinite(rowCount) || rowCount <= 0) throw new Error("source returned no usable rows");
    const record: SyncRunRecord = { source, startedAt, finishedAt: new Date().toISOString(), ok: true, rowCount };
    recordRun(record);
    return record;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const record: SyncRunRecord = { source, startedAt, finishedAt: new Date().toISOString(), ok: false, rowCount: 0, error: msg };
    recordRun(record);
    return record;
  } finally {
    activeSources.delete(source);
  }
}

// Each task fetches from upstream and writes a snapshot file; returns row count.
async function taskMarketQuotes(): Promise<number> {
  const rows = await fetchEastmoneySpotRows();
  const stocks = rows.map((row) => stockFromMarketRow(row as Record<string, unknown>)).filter((s) => s.code);
  await cacheSnapshot("market-quotes", stocks);
  return stocks.length;
}

async function taskFinancialReports(): Promise<number> {
  for (const reportDate of financialReportDateCandidates()) {
    const rows = await fetchFinancialMetricRows(reportDate);
    if (!rows.length) continue;
    await cacheSnapshot("financial-reports", rows);
    return rows.length;
  }
  throw new Error("No financial report period returned usable rows");
}

async function taskAnalystForecasts(): Promise<number> {
  const rows = await fetchAnalystForecastRows();
  await cacheSnapshot("analyst-forecasts", rows);
  return rows.length;
}

async function taskMarginBalances(): Promise<number> {
  const rows = await fetchMarginBalanceRows();
  await cacheSnapshot("margin-balances", rows);
  return rows.length;
}

async function taskNorthHoldings(): Promise<number> {
  const rows = await fetchNorthHoldingRows();
  await cacheSnapshot("north-holdings", rows);
  return rows.length;
}

async function taskTechnicalIndicators(): Promise<number> {
  // Technical indicators need code list; read last market snapshot for codes
  const snapshot = await readSnapshot("market-quotes");
  const stocks = (snapshot?.data as Array<{ code: string }> | undefined) ?? [];
  const codes = stocks.map((s) => s.code).slice(0, 200);
  const rows = await fetchTechnicalIndicators(codes, 120);
  await cacheSnapshot("technical-indicators", rows);
  return rows.length;
}

export type SyncTaskOverrides = Partial<Record<SyncSourceKey, () => Promise<number>>>;

export async function runScheduledSync(config: ScheduleConfig, taskOverrides: SyncTaskOverrides = {}): Promise<SyncRunRecord[]> {
  await hydratePersistedStatus();
  if (running) {
    log("sync already in progress, skipping");
    return [];
  }
  running = true;
  lastAttemptAt = new Date().toISOString();
  log("starting scheduled sync");
  const tasks: Array<[SyncSourceKey, boolean, () => Promise<number>]> = [
    ["marketQuotes", config.sources.marketQuotes, taskOverrides.marketQuotes ?? taskMarketQuotes],
    ["financialReports", config.sources.financialReports, taskOverrides.financialReports ?? taskFinancialReports],
    ["analystForecasts", config.sources.analystForecasts, taskOverrides.analystForecasts ?? taskAnalystForecasts],
    ["marginBalances", config.sources.marginBalances, taskOverrides.marginBalances ?? taskMarginBalances],
    ["northHoldings", config.sources.northHoldings, taskOverrides.northHoldings ?? taskNorthHoldings],
    ["technicalIndicators", config.sources.technicalIndicators, taskOverrides.technicalIndicators ?? taskTechnicalIndicators],
  ];

  try {
    const enabledTasks = tasks.filter(([, enabled]) => enabled);
    const promises = new Map<SyncSourceKey, Promise<SyncRunRecord>>();
    const marketTask = enabledTasks.find(([name]) => name === "marketQuotes");
    const marketPromise = marketTask
      ? runSource(marketTask[0], marketTask[2]).then((record) => {
          log(`${marketTask[0]}: ${record.ok ? `${record.rowCount} rows` : `FAILED ${record.error}`}`);
          return record;
        })
      : undefined;
    if (marketPromise) promises.set("marketQuotes", marketPromise);

    for (const [name, , fn] of enabledTasks) {
      if (name === "marketQuotes") continue;
      const run = () => {
        log(`fetching ${name}...`);
        return runSource(name, fn);
      };
      const promise = name === "technicalIndicators" && marketPromise
        ? marketPromise.then((marketRecord) => marketRecord.ok
            ? run()
            : skippedRun(name, "marketQuotes failed; technical indicators skipped"))
        : run();
      promises.set(name, promise.then((record) => {
        log(`${name}: ${record.ok ? `${record.rowCount} rows` : `FAILED ${record.error}`}`);
        return record;
      }));
    }

    const results = await Promise.all(enabledTasks.map(([name]) => promises.get(name)!));
    const marketRecord = results.find((record) => record.source === "marketQuotes");
    const allEnabledSucceeded = enabledTasks.length > 0 && results.length === enabledTasks.length && results.every((record) => record.ok);
    const criticalMarketSucceeded = Boolean(marketRecord?.ok);
    syncStatus = allEnabledSucceeded && criticalMarketSucceeded ? "success" : results.some((record) => record.ok) ? "partial" : "failed";
    if (allEnabledSucceeded && criticalMarketSucceeded) lastFullSync = new Date().toISOString();
    await persistStatus();
    log(`scheduled sync complete (${syncStatus})`);
    return results;
  } finally {
    if (!Object.values(config.sources).some(Boolean)) syncStatus = "failed";
    await persistStatus().catch(() => undefined);
    running = false;
  }
}

export async function triggerManualSync(): Promise<SyncRunRecord[]> {
  log("manual sync triggered");
  return runScheduledSync(currentConfig);
}

export async function readSnapshotRoute(name: string): Promise<{ snapshotAt: string; data: unknown } | null> {
  return readSnapshot(name);
}

export function applySchedule() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!currentConfig.enabled) {
    log("schedule disabled");
    return;
  }
  const intervalMs = Math.max(1, currentConfig.intervalMinutes) * 60 * 1000;
  log(`scheduling sync every ${currentConfig.intervalMinutes} min`);
  timer = setInterval(() => {
    runScheduledSync(currentConfig).catch((error) => log(`sync error: ${error}`));
  }, intervalMs);
}

export async function initScheduler() {
  await loadConfig();
  await hydratePersistedStatus();
  applySchedule();
  log(`initialized, data cache dir: ${dataCacheDir()}`);
}
