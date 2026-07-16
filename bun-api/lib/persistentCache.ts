import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const CACHE_VERSION = 1;
const persistentInFlight = new Map<string, Promise<unknown>>();

interface PersistentCacheEnvelope<T> {
  version: number;
  namespace: string;
  keyHash: string;
  cachedAt: number;
  expiresAt: number;
  value: T;
}

export interface PersistentCacheOptions {
  rootDir?: string;
  now?: () => number;
  forceRefresh?: boolean;
  beforeCommit?: (temporaryPath: string, targetPath: string) => Promise<void> | void;
}

export function resolveDataCacheDir(rootDir?: string) {
  const configured = rootDir || process.env.STOCKCHOOSE_DATA_CACHE_DIR;
  return configured ? path.resolve(configured) : path.join(process.cwd(), "data-cache");
}

function safeNamespace(namespace: string) {
  const normalized = namespace.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "default";
}

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export function persistentCacheFilePath(namespace: string, key: string, options: PersistentCacheOptions = {}) {
  return path.join(resolveDataCacheDir(options.rootDir), "cache", safeNamespace(namespace), `${hashKey(key)}.json`);
}

async function removeInvalidCache(filePath: string) {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // 缓存清理失败不应阻断上游数据获取。
  }
}

export async function writeFileAtomic(filePath: string, content: string, options: PersistentCacheOptions = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    await options.beforeCommit?.(temporaryPath, filePath);
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function persistentCacheGet<T>(namespace: string, key: string, options: PersistentCacheOptions = {}): Promise<T | undefined> {
  const filePath = persistentCacheFilePath(namespace, key, options);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const envelope = JSON.parse(raw) as PersistentCacheEnvelope<T>;
    if (
      !envelope ||
      typeof envelope !== "object" ||
      envelope.version !== CACHE_VERSION ||
      envelope.namespace !== safeNamespace(namespace) ||
      envelope.keyHash !== hashKey(key) ||
      !Number.isFinite(envelope.cachedAt) ||
      !Number.isFinite(envelope.expiresAt) ||
      !("value" in envelope)
    ) {
      throw new Error("invalid persistent cache envelope");
    }
    const now = options.now?.() ?? Date.now();
    if (now >= envelope.expiresAt) {
      await removeInvalidCache(filePath);
      return undefined;
    }
    return envelope.value;
  } catch {
    await removeInvalidCache(filePath);
    return undefined;
  }
}

export async function persistentCacheSet<T>(namespace: string, key: string, value: T, ttlMs: number, options: PersistentCacheOptions = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("persistent cache ttl must be positive");
  const now = options.now?.() ?? Date.now();
  const envelope: PersistentCacheEnvelope<T> = {
    version: CACHE_VERSION,
    namespace: safeNamespace(namespace),
    keyHash: hashKey(key),
    cachedAt: now,
    expiresAt: now + ttlMs,
    value
  };
  await writeFileAtomic(persistentCacheFilePath(namespace, key, options), JSON.stringify(envelope), options);
  return value;
}

export async function persistentCacheGetOrCreate<T>(
  namespace: string,
  key: string,
  ttlMs: number | ((value: T) => number),
  loader: () => Promise<T>,
  options: PersistentCacheOptions = {}
): Promise<T> {
  const requestKey = persistentCacheFilePath(namespace, key, options);
  let active = persistentInFlight.get(requestKey) as Promise<T> | undefined;
  if (active) {
    if (!options.forceRefresh) return active;
    await active.catch(() => undefined);
    active = persistentInFlight.get(requestKey) as Promise<T> | undefined;
    if (active) return active;
  }

  const request = (async () => {
    if (!options.forceRefresh) {
      const cached = await persistentCacheGet<T>(namespace, key, options);
      if (cached !== undefined) return cached;
    }
    const value = await loader();
    try {
      const resolvedTtlMs = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
      await persistentCacheSet(namespace, key, value, resolvedTtlMs, options);
    } catch (error) {
      console.warn(`[persistent-cache] write failed for ${safeNamespace(namespace)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return value;
  })().finally(() => {
    if (persistentInFlight.get(requestKey) === request) persistentInFlight.delete(requestKey);
  });

  persistentInFlight.set(requestKey, request);
  return request;
}
