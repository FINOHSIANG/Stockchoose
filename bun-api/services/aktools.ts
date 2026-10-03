import { ApiError } from "../lib/http";
import { assertSafeOutboundUrl } from "../lib/outboundSecurity";

export const CONFIGURED_AKTOOLS_BASE = "/akshare-api/api/public";

interface AktoolsOptions {
  fetchImpl?: typeof fetch;
  configuredBaseUrl?: string;
  timeoutMs?: number;
}

function normalizeBase(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function aktoolsRowsFromPayload(payload: unknown): Record<string, unknown>[] {
  const root = payload as { data?: unknown; rows?: unknown } | null;
  const rows = Array.isArray(payload) ? payload : root?.data ?? root?.rows;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new ApiError(502, "AKTools upstream payload must contain object rows");
  }
  return rows;
}

export async function fetchAktoolsRows(
  baseInput: string,
  endpoint: string,
  params: Record<string, string>,
  options: AktoolsOptions = {}
): Promise<Record<string, unknown>[]> {
  if (!/^[a-z][a-z0-9_]*$/.test(endpoint)) {
    throw new ApiError(400, "AKTools endpoint must be a function name");
  }
  // AKTools 0.0.91 builds an eval expression from query text; encoding alone is not a boundary.
  for (const [key, value] of Object.entries(params)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || typeof value !== "string" || /["'\\&=%\u0000-\u001f\u007f]/.test(value)) {
      throw new ApiError(400, "AKTools parameters contain unsupported expression characters");
    }
  }
  const configuredBase = normalizeBase(options.configuredBaseUrl ?? process.env.STOCKCHOOSE_AKTOOLS_BASE_URL ?? "");
  const base = normalizeBase(baseInput) === CONFIGURED_AKTOOLS_BASE ? configuredBase : normalizeBase(baseInput);
  if (!base) throw new ApiError(400, "STOCKCHOOSE_AKTOOLS_BASE_URL is not configured");
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    throw new ApiError(400, "AKTools baseUrl must be an absolute HTTP(S) URL or the configured alias");
  }
  if (!["https:", "http:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new ApiError(400, "AKTools baseUrl cannot contain credentials, query, fragment or a non-HTTP protocol");
  }
  // Only an exact, operator-configured loopback service bypasses the public upstream policy.
  const trustedLoopback = base === configuredBase && ["127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  const url = new URL(`${base}/${endpoint}`);
  if (!trustedLoopback) await assertSafeOutboundUrl(url);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  const timeoutMs = Math.max(3000, Math.min(options.timeoutMs ?? 20000, 60000));
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new ApiError(502, `AKTools upstream HTTP ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "AKTools upstream returned invalid JSON");
  }
  return aktoolsRowsFromPayload(payload);
}

export async function testAktoolsConnection(
  baseUrl: string,
  nativeLoader: (endpoint: string, params: Record<string, string>) => Promise<unknown>,
  options: AktoolsOptions = {}
) {
  const base = normalizeBase(baseUrl) || "/aktools/api/public";
  const native = base === "/aktools/api/public" || base.startsWith("/aktools/");
  const endpoint = "stock_zh_a_hist";
  const params = { symbol: "000001", start_date: "20240501", end_date: "20240531" };
  const rows = native
    ? aktoolsRowsFromPayload(await nativeLoader(endpoint, params))
    : await fetchAktoolsRows(base, endpoint, params, options);
  const usable = rows.filter((row) => {
    const date = row["日期"] ?? row.date;
    const close = row["收盘"] ?? row.close;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)
      && (typeof close === "number" || typeof close === "string")
      && close !== "" && Number.isFinite(Number(close)) && Number(close) > 0;
  });
  return {
    ok: usable.length > 0 && usable.length === rows.length,
    rowCount: rows.length,
    endpoint,
    source: native ? "bun-native" : "aktools",
  };
}
