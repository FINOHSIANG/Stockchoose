import { readFileSync } from "node:fs";

const DEFAULT_BASE_URL = "http://127.0.0.1:18082";
const MAX_RESPONSE_CHARS = 2_000_000;

export function validateStockChooseApiBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_BASE_URL).trim());
  } catch {
    throw new Error("STOCKCHOOSE_BUN_API_URL must be a valid URL");
  }
  const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.search || url.hash) {
    throw new Error("STOCKCHOOSE_BUN_API_URL must be a credential-free HTTP loopback URL");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url;
}

function safeToken(value) {
  const token = String(value || "").trim();
  if (token.length < 32 || /[\r\n]/u.test(token)) {
    throw new Error("STOCKCHOOSE_BUN_API_TOKEN must contain the current Bun sidecar instance token");
  }
  return token;
}

function resolveToken(options) {
  const direct = options.token ?? process.env.STOCKCHOOSE_BUN_API_TOKEN;
  if (String(direct || "").trim()) return safeToken(direct);
  const authFile = String(options.authFile ?? process.env.STOCKCHOOSE_AGENT_AUTH_FILE ?? "").trim();
  if (!authFile) throw new Error("STOCKCHOOSE_AGENT_AUTH_FILE is required when a direct sidecar token is unavailable");
  try {
    return safeToken(readFileSync(authFile, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read STOCKCHOOSE Agent auth file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function redactText(value) {
  return String(value)
    .replace(/(authorization|cookie|token|api[-_]?key|secret|password)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 500);
}

export function createStockChooseAgentClient(options = {}) {
  const baseUrl = validateStockChooseApiBaseUrl(options.baseUrl ?? process.env.STOCKCHOOSE_BUN_API_URL ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1_000, Number(options.timeoutMs)) : 30_000;

  async function requestJson(pathname, init = {}) {
    const url = new URL(pathname, baseUrl);
    const token = resolveToken(options);
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        "x-stockchoose-instance-token": token,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARS) {
      throw new Error("STOCKCHOOSE API response exceeds the Agent tool limit");
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new Error("STOCKCHOOSE API response exceeds the Agent tool limit");
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("STOCKCHOOSE API returned invalid JSON");
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object" ? payload.message || payload.details : "";
      throw new Error(`STOCKCHOOSE API HTTP ${response.status}${message ? `: ${redactText(message)}` : ""}`);
    }
    return payload;
  }

  return Object.freeze({
    status: () => requestJson("/api/sync/status"),
    marketOverview: () => requestJson("/api/dashboard/market-overview"),
    quotes(symbols) {
      const list = symbols.map((item) => String(item).trim()).filter(Boolean).slice(0, 50);
      return requestJson(`/api/market/tencent/quote-rows?q=${encodeURIComponent(list.join(","))}`);
    },
    stockProfile({ code, name, industry1, industry2, forceRefresh = false }) {
      const url = new URL(`/api/market/stock/${encodeURIComponent(code)}/profile`, baseUrl);
      if (name) url.searchParams.set("name", name);
      if (industry1) url.searchParams.set("industry1", industry1);
      if (industry2) url.searchParams.set("industry2", industry2);
      if (forceRefresh) url.searchParams.set("force", "1");
      return requestJson(`${url.pathname}${url.search}`);
    },
    financeStatements(code) {
      return requestJson(`/api/finance/statements/${encodeURIComponent(code)}`);
    },
    announcements(codes, maxItems = 30) {
      return requestJson("/api/filing/announcements", {
        method: "POST",
        body: JSON.stringify({ codes: codes.slice(0, 20), maxItems: Math.min(Math.max(maxItems, 1), 50) })
      });
    },
    workspaceAction(type, payload, waitMs = 20_000) {
      return requestJson("/api/agent/workspace/actions", {
        method: "POST",
        body: JSON.stringify({ type, payload, waitMs: Math.min(Math.max(waitMs, 0), 25_000) })
      });
    }
  });
}

export const stockChooseAgentClientTesting = {
  redactText
};
