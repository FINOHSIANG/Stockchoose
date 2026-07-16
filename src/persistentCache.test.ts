import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import {
  persistentCacheFilePath,
  persistentCacheGet,
  persistentCacheGetOrCreate,
  persistentCacheSet,
  resolveDataCacheDir
} from "../bun-api/lib/persistentCache";

const require = createRequire(import.meta.url);
const { bunApiProcessEnv, dataCacheDir: electronDataCacheDir } = require("../electron/bun-api.cjs") as {
  bunApiProcessEnv: () => NodeJS.ProcessEnv;
  dataCacheDir: () => string;
};

describe.sequential("persistent data cache", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "stockchoose-cache-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes a miss to disk and reuses it without calling the loader again", async () => {
    const loader = vi.fn(async () => ({ tags: ["白酒", "消费"] }));
    const options = { rootDir };

    await expect(persistentCacheGetOrCreate("stock-profile", "600519", 60000, loader, options)).resolves.toEqual({ tags: ["白酒", "消费"] });
    await expect(persistentCacheGetOrCreate("stock-profile", "600519", 60000, loader, options)).resolves.toEqual({ tags: ["白酒", "消费"] });

    expect(loader).toHaveBeenCalledTimes(1);
    await expect(fs.stat(persistentCacheFilePath("stock-profile", "600519", options))).resolves.toBeTruthy();
  });

  it("reuses a disk entry in a later request lifecycle", async () => {
    await persistentCacheSet("finance-statements", "20251231", [{ code: "600519" }], 60000, { rootDir });
    const loader = vi.fn(async () => [{ code: "000001" }]);

    await expect(persistentCacheGetOrCreate("finance-statements", "20251231", 60000, loader, { rootDir })).resolves.toEqual([{ code: "600519" }]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("reuses fetched stock tags after the service modules are reloaded", async () => {
    const previous = process.env.STOCKCHOOSE_DATA_CACHE_DIR;
    process.env.STOCKCHOOSE_DATA_CACHE_DIR = rootDir;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("CompanySurvey")) {
        return new Response(JSON.stringify({ jbzl: [{ SECURITY_NAME_ABBR: "贵州茅台", ORG_WEB: "www.moutaichina.com", INDUSTRYCSRC1: "制造业-酒、饮料和精制茶制造业" }] }), { status: 200 });
      }
      if (url.includes("CoreConception")) {
        return new Response(JSON.stringify({ ssbk: [{ BOARD_NAME: "食品饮料" }, { BOARD_NAME: "白酒Ⅱ" }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      vi.resetModules();
      const firstService = await import("../bun-api/services/finance");
      const first = await firstService.fetchStockProfile("600519");
      vi.resetModules();
      const secondService = await import("../bun-api/services/finance");
      const second = await secondService.fetchStockProfile("SH600519");

      expect(first.industry1).toBe("制造业-酒、饮料和精制茶制造业");
      expect(first.industry2).toBe("白酒Ⅱ");
      expect(first.industryTags).toContain("白酒Ⅱ");
      expect(second).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      if (previous === undefined) delete process.env.STOCKCHOOSE_DATA_CACHE_DIR;
      else process.env.STOCKCHOOSE_DATA_CACHE_DIR = previous;
    }
  });

  it("refreshes an expired entry", async () => {
    let now = 1000;
    const options = { rootDir, now: () => now };
    await persistentCacheSet("stock-profile", "000001", { version: 1 }, 50, options);
    now = 1050;
    const loader = vi.fn(async () => ({ version: 2 }));

    await expect(persistentCacheGetOrCreate("stock-profile", "000001", 50, loader, options)).resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("supports a shorter TTL for partial upstream results", async () => {
    let now = 1000;
    const options = { rootDir, now: () => now };
    const firstLoader = vi.fn(async () => ({ complete: false, value: 1 }));
    await persistentCacheGetOrCreate("profile-partial", "600519", (value) => value.complete ? 1000 : 50, firstLoader, options);
    now = 1050;
    const refreshLoader = vi.fn(async () => ({ complete: true, value: 2 }));

    await expect(persistentCacheGetOrCreate("profile-partial", "600519", (value) => value.complete ? 1000 : 50, refreshLoader, options)).resolves.toEqual({ complete: true, value: 2 });
    expect(refreshLoader).toHaveBeenCalledTimes(1);
  });

  it("supports an explicit refresh while keeping automatic reads cached", async () => {
    await persistentCacheSet("stock-profile", "000002", { version: 1 }, 60000, { rootDir });
    const loader = vi.fn(async () => ({ version: 2 }));

    await expect(persistentCacheGetOrCreate("stock-profile", "000002", 60000, loader, { rootDir, forceRefresh: true })).resolves.toEqual({ version: 2 });
    await expect(persistentCacheGet("stock-profile", "000002", { rootDir })).resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not persist caller fallback fields with the upstream stock profile", async () => {
    const previous = process.env.STOCKCHOOSE_DATA_CACHE_DIR;
    process.env.STOCKCHOOSE_DATA_CACHE_DIR = rootDir;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("CompanySurvey")) {
        return new Response(JSON.stringify({ jbzl: [{ SECURITY_NAME_ABBR: "平安银行", ORG_WEB: "bank.pingan.com" }] }), { status: 200 });
      }
      if (url.includes("CoreConception")) {
        return new Response(JSON.stringify({ ssbk: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      vi.resetModules();
      const firstService = await import("../bun-api/services/finance");
      const first = await firstService.fetchStockProfile("000001", { industry1: "旧分类", industry2: "旧子类" });
      vi.resetModules();
      const secondService = await import("../bun-api/services/finance");
      const second = await secondService.fetchStockProfile("SZ000001", { industry1: "新分类", industry2: "新子类" });

      expect(first.industry1).toBe("旧分类");
      expect(second.industry1).toBe("新分类");
      expect(second.industry2).toBe("新子类");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const profileFile = (await fs.readdir(path.join(rootDir, "cache", "stock-profile-v5"))).at(0);
      const raw = await fs.readFile(path.join(rootDir, "cache", "stock-profile-v5", profileFile!), "utf8");
      expect(raw).not.toContain("旧分类");
      expect(raw).not.toContain("新分类");
    } finally {
      if (previous === undefined) delete process.env.STOCKCHOOSE_DATA_CACHE_DIR;
      else process.env.STOCKCHOOSE_DATA_CACHE_DIR = previous;
    }
  });

  it("keeps a precise fallback industry2 when the concept request is partial", async () => {
    const previous = process.env.STOCKCHOOSE_DATA_CACHE_DIR;
    process.env.STOCKCHOOSE_DATA_CACHE_DIR = rootDir;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("CompanySurvey")) {
        return new Response(JSON.stringify({ jbzl: [{ SECURITY_NAME_ABBR: "测试公司", INDUSTRYCSRC1: "制造业" }] }), { status: 200 });
      }
      if (url.includes("CoreConception")) return new Response("temporary failure", { status: 503 });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      vi.resetModules();
      const firstService = await import("../bun-api/services/finance");
      const first = await firstService.fetchStockProfile("300001", { industry2: "本地精确分类A" });
      vi.resetModules();
      const secondService = await import("../bun-api/services/finance");
      const second = await secondService.fetchStockProfile("300001", { industry2: "本地精确分类B" });

      expect(first.industry1).toBe("制造业");
      expect(first.industry2).toBe("本地精确分类A");
      expect(second.industry2).toBe("本地精确分类B");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      if (previous === undefined) delete process.env.STOCKCHOOSE_DATA_CACHE_DIR;
      else process.env.STOCKCHOOSE_DATA_CACHE_DIR = previous;
    }
  });

  it("ignores corrupted JSON and falls back to the loader", async () => {
    const options = { rootDir };
    const filePath = persistentCacheFilePath("stock-profile", "000003", options);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{broken", "utf8");
    const loader = vi.fn(async () => ({ industry: "银行" }));

    await expect(persistentCacheGetOrCreate("stock-profile", "000003", 60000, loader, options)).resolves.toEqual({ industry: "银行" });
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(persistentCacheGet("stock-profile", "000003", options)).resolves.toEqual({ industry: "银行" });
  });

  it("deduplicates concurrent disk misses", async () => {
    let release!: (value: string[]) => void;
    const pending = new Promise<string[]>((resolve) => {
      release = resolve;
    });
    const loader = vi.fn(() => pending);
    const options = { rootDir };

    const requests = Array.from({ length: 20 }, () => persistentCacheGetOrCreate("stock-profile", "000004", 60000, loader, options));
    release(["新能源"]);

    await expect(Promise.all(requests)).resolves.toEqual(Array.from({ length: 20 }, () => ["新能源"]));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("queues a force refresh behind an older miss so stale data cannot overwrite it", async () => {
    let releaseNormal!: (value: { version: number }) => void;
    let markNormalStarted!: () => void;
    const normalStarted = new Promise<void>((resolve) => {
      markNormalStarted = resolve;
    });
    const normalValue = new Promise<{ version: number }>((resolve) => {
      releaseNormal = resolve;
    });
    const normalLoader = vi.fn(async () => {
      markNormalStarted();
      return normalValue;
    });
    const forceLoader = vi.fn(async () => ({ version: 2 }));
    const options = { rootDir };

    const normalRequest = persistentCacheGetOrCreate("stock-profile", "600519", 60000, normalLoader, options);
    await normalStarted;
    const forceRequest = persistentCacheGetOrCreate("stock-profile", "600519", 60000, forceLoader, { ...options, forceRefresh: true });
    expect(forceLoader).not.toHaveBeenCalled();
    releaseNormal({ version: 1 });

    await expect(normalRequest).resolves.toEqual({ version: 1 });
    await expect(forceRequest).resolves.toEqual({ version: 2 });
    await expect(persistentCacheGet("stock-profile", "600519", options)).resolves.toEqual({ version: 2 });
    expect(forceLoader).toHaveBeenCalledTimes(1);
  });

  it("clears single-flight state after a loader error", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary upstream failure"))
      .mockResolvedValueOnce(["恢复"]);

    await expect(persistentCacheGetOrCreate("stock-profile", "000005", 60000, loader, { rootDir })).rejects.toThrow("temporary upstream failure");
    await expect(persistentCacheGetOrCreate("stock-profile", "000005", 60000, loader, { rootDir })).resolves.toEqual(["恢复"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("isolates tag entries by stock code", async () => {
    const options = { rootDir };
    await persistentCacheSet("stock-profile", "600519", ["白酒"], 60000, options);
    await persistentCacheSet("stock-profile", "000001", ["银行"], 60000, options);

    await expect(persistentCacheGet("stock-profile", "600519", options)).resolves.toEqual(["白酒"]);
    await expect(persistentCacheGet("stock-profile", "000001", options)).resolves.toEqual(["银行"]);
  });

  it("hashes cache keys so tokens are not written to paths or JSON", async () => {
    const token = "secret-api-token-123";
    const options = { rootDir };
    await persistentCacheSet("asharehub", `rows:${token}`, [{ ok: true }], 60000, options);
    const filePath = persistentCacheFilePath("asharehub", `rows:${token}`, options);
    const raw = await fs.readFile(filePath, "utf8");

    expect(filePath).not.toContain(token);
    expect(raw).not.toContain(token);
  });

  it("keeps the previous file intact when an atomic commit fails", async () => {
    await persistentCacheSet("stock-profile", "600000", { version: 1 }, 60000, { rootDir });

    await expect(persistentCacheSet("stock-profile", "600000", { version: 2 }, 60000, {
      rootDir,
      beforeCommit: async () => {
        throw new Error("simulated rename failure");
      }
    })).rejects.toThrow("simulated rename failure");
    await expect(persistentCacheGet("stock-profile", "600000", { rootDir })).resolves.toEqual({ version: 1 });
  });

  it("honors the configured data-cache directory without adding a second data-cache level", () => {
    const previous = process.env.STOCKCHOOSE_DATA_CACHE_DIR;
    process.env.STOCKCHOOSE_DATA_CACHE_DIR = rootDir;
    try {
      expect(resolveDataCacheDir()).toBe(rootDir);
      expect(electronDataCacheDir()).toBe(rootDir);
      expect(bunApiProcessEnv().STOCKCHOOSE_DATA_CACHE_DIR).toBe(rootDir);
    } finally {
      if (previous === undefined) delete process.env.STOCKCHOOSE_DATA_CACHE_DIR;
      else process.env.STOCKCHOOSE_DATA_CACHE_DIR = previous;
    }
  });
});
