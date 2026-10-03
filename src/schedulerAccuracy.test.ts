import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCHEDULE_CONFIG, loadStatus, readSnapshot, runScheduledSync } from "../bun-api/scheduler";
import { writeFileAtomic } from "../bun-api/lib/persistentCache";
import { fetchFinancialMetricRows } from "../bun-api/services/finance";

vi.mock("../bun-api/services/finance", () => ({
  fetchFinancialMetricRows: vi.fn(),
  fetchAnalystForecastRows: vi.fn(),
  fetchMarginBalanceRows: vi.fn(),
  fetchNorthHoldingRows: vi.fn(),
  fetchTechnicalIndicators: vi.fn()
}));

afterEach(() => vi.unstubAllEnvs());

describe("scheduler snapshot accuracy", () => {
  it("retains a valid snapshot and marks an empty refresh as failed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stockchoose-empty-sync-"));
    vi.stubEnv("STOCKCHOOSE_DATA_CACHE_DIR", root);
    const snapshotFile = path.join(root, "snapshots", "financial-reports.json");
    const previous = JSON.stringify({ snapshotAt: "2026-08-31T08:00:00.000Z", data: [{ code: "600519", metrics: { revenue: 100 } }] });
    await writeFileAtomic(snapshotFile, previous);
    vi.mocked(fetchFinancialMetricRows).mockResolvedValue([]);
    const runs = await runScheduledSync({
      ...DEFAULT_SCHEDULE_CONFIG,
      sources: { ...DEFAULT_SCHEDULE_CONFIG.sources, marketQuotes: false, financialReports: true }
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: false, rowCount: 0 });
    expect(await readFile(snapshotFile, "utf8")).toBe(previous);
    expect((await readSnapshot("financial-reports"))?.data).toHaveLength(1);
    expect((await loadStatus()).status).toBe("failed");
  });
});
