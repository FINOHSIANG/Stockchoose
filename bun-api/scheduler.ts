import { promises as fs } from "fs";
import path from "path";
import { resolveDataCacheDir } from "./lib/persistentCache";
import { fetchEastmoneySpotRows, stockFromMarketRow } from "./services/market";
import { fetchFinancialMetricRows, fetchAnalystForecastRows, fetchMarginBalanceRows, fetchNorthHoldingRows, fetchTechnicalIndicators } from "./services/finance";

// Electron 使用 userData；命令行开发默认使用项目内 data-cache。
export function dataCacheDir(): string {
  return resolveDataCacheDir();
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeFileAtomic(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
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
  error?: string;
}

export interface SyncStatus {
  config: ScheduleConfig;
  running: boolean;
  activeSources: string[];
  lastFullSync: string | null;
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
        const parsed = JSON.parse(raw) as { runs?: SyncRunRecord[]; lastFullSync?: string };
        const savedRuns = Array.isArray(parsed.runs) ? parsed.runs.slice(-MAX_RUN_RECORDS) : [];
        runRecords.length = 0;
        runRecords.push(...savedRuns);
        if (parsed.lastFullSync) lastFullSync = parsed.lastFullSync;
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
  return { config: currentConfig, running, activeSources: [...activeSources], lastFullSync, runs: [...runRecords].reverse().slice(0, 50), cacheFiles };
}

let lastFullSync: string | null = null;

async function persistStatus() {
  const payload = JSON.stringify({ runs: runRecords.slice(-MAX_RUN_RECORDS), lastFullSync });
  await writeFileAtomic(STATUS_FILE(), payload);
}

function recordRun(record: SyncRunRecord) {
  runRecords.push(record);
  if (runRecords.length > MAX_RUN_RECORDS) runRecords.splice(0, runRecords.length - MAX_RUN_RECORDS);
}

async function cacheSnapshot(name: string, data: unknown) {
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
  const reportDate = latestReportDate();
  const rows = await fetchFinancialMetricRows(reportDate);
  await cacheSnapshot("financial-reports", rows);
  return rows.length;
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

function latestReportDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Use most recent quarter end
  if (month >= 10) return `${year}-09-30`;
  if (month >= 7) return `${year}-06-30`;
  if (month >= 4) return `${year}-03-31`;
  return `${year - 1}-12-31`;
}

export async function runScheduledSync(config: ScheduleConfig): Promise<SyncRunRecord[]> {
  await hydratePersistedStatus();
  if (running) {
    log("sync already in progress, skipping");
    return [];
  }
  running = true;
  log("starting scheduled sync");
  const tasks: Array<[string, boolean, () => Promise<number>]> = [
    ["marketQuotes", config.sources.marketQuotes, taskMarketQuotes],
    ["financialReports", config.sources.financialReports, taskFinancialReports],
    ["analystForecasts", config.sources.analystForecasts, taskAnalystForecasts],
    ["marginBalances", config.sources.marginBalances, taskMarginBalances],
    ["northHoldings", config.sources.northHoldings, taskNorthHoldings],
    ["technicalIndicators", config.sources.technicalIndicators, taskTechnicalIndicators],
  ];

  try {
    const enabledTasks = tasks.filter(([, enabled]) => enabled);
    const promises = new Map<string, Promise<SyncRunRecord>>();
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
      const dependency = name === "technicalIndicators" && marketPromise ? marketPromise.then(() => undefined) : Promise.resolve();
      const promise = dependency.then(() => {
        log(`fetching ${name}...`);
        return runSource(name, fn);
      }).then((record) => {
        log(`${name}: ${record.ok ? `${record.rowCount} rows` : `FAILED ${record.error}`}`);
        return record;
      });
      promises.set(name, promise);
    }

    const results = await Promise.all(enabledTasks.map(([name]) => promises.get(name)!));
    lastFullSync = new Date().toISOString();
    await persistStatus();
    log("scheduled sync complete");
    return results;
  } finally {
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
