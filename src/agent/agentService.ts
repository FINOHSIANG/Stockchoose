import type {
  AgentHistoryEvent,
  AgentHistoryResponse,
  AgentMessage,
  AgentModelCatalog,
  AgentModelSelection,
  AgentPromptContext,
  AgentSessionSummary,
  AgentStatus,
  AgentUploadedFile,
  AgentWorkspaceAction
} from "./agentTypes";

type FetchLike = typeof fetch;

interface AgentSessionsResponse {
  engine: "official-dsh";
  items: AgentSessionSummary[];
}

interface AgentCreateSessionResponse {
  engine: "official-dsh";
  sessionId: string;
  agentPreset?: string;
}

interface AgentAcceptedResponse {
  engine: "official-dsh";
  sessionId: string;
  accepted: boolean;
}

interface AgentWorkspaceActionsResponse {
  engine: "official-dsh";
  items: AgentWorkspaceAction[];
}

export class AgentApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractErrorMessage(value: unknown) {
  const data = record(value);
  for (const key of ["message", "error", "detail"]) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key].trim();
  }
  return "Agent 服务请求失败";
}

async function requestJson<T>(path: string, init: RequestInit = {}, fetchImpl: FetchLike = fetch): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type") && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetchImpl(path, { ...init, headers });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) throw new AgentApiError(response.status, extractErrorMessage(payload));
  return payload as T;
}

export function getAgentStatus(probe = true, fetchImpl: FetchLike = fetch) {
  return requestJson<AgentStatus>(`/api/agent/status${probe ? "?probe=1" : ""}`, {}, fetchImpl);
}

export function listAgentSessions(fetchImpl: FetchLike = fetch) {
  return requestJson<AgentSessionsResponse>("/api/agent/sessions", {}, fetchImpl);
}

export function createAgentSession(fetchImpl: FetchLike = fetch) {
  return requestJson<AgentCreateSessionResponse>("/api/agent/sessions", { method: "POST" }, fetchImpl);
}

export function getAgentModels(fetchImpl: FetchLike = fetch) {
  return requestJson<AgentModelCatalog>("/api/agent/models", {}, fetchImpl);
}

export function uploadAgentFile(sessionId: string, file: File, fetchImpl: FetchLike = fetch) {
  const body = new FormData();
  body.set("file", file, file.name);
  return requestJson<AgentUploadedFile & { engine: "official-dsh"; sessionId: string }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/files`,
    { method: "POST", body },
    fetchImpl
  );
}

export function selectAgentModel(sessionId: string, selection: AgentModelSelection, fetchImpl: FetchLike = fetch) {
  return requestJson<{ engine: "official-dsh"; sessionId: string; selected: AgentModelSelection }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/model`,
    { method: "POST", body: JSON.stringify(selection) },
    fetchImpl
  );
}

export function getAgentHistory(sessionId: string, maxMessages = 120, fetchImpl: FetchLike = fetch) {
  const query = new URLSearchParams({ maxMessages: String(maxMessages) });
  return requestJson<AgentHistoryResponse>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/history?${query}`, {}, fetchImpl);
}

export function promptAgentSession(
  sessionId: string,
  text: string,
  context: AgentPromptContext,
  options: { model?: AgentModelSelection; attachmentReceiptIds?: string[] } = {},
  fetchImpl: FetchLike = fetch
) {
  return requestJson<AgentAcceptedResponse>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/prompt`, {
    method: "POST",
    body: JSON.stringify({
      text,
      mode: "queue",
      context,
      ...(options.model ? { model: options.model } : {}),
      ...(options.attachmentReceiptIds?.length ? { attachmentReceiptIds: options.attachmentReceiptIds } : {}),
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
    })
  }, fetchImpl);
}

export function cancelAgentSession(sessionId: string, fetchImpl: FetchLike = fetch) {
  return requestJson<AgentAcceptedResponse>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST"
  }, fetchImpl);
}

export function claimAgentWorkspaceActions(limit = 5, clientId = "", fetchImpl: FetchLike = fetch) {
  const query = new URLSearchParams({ limit: String(Math.min(Math.max(Math.trunc(limit), 1), 10)) });
  if (clientId) query.set("clientId", clientId);
  return requestJson<AgentWorkspaceActionsResponse>(`/api/agent/workspace/actions?${query}`, {}, fetchImpl);
}

export function setAgentWorkspaceActionOwner(clientId: string, active: boolean, keepalive = false, fetchImpl: FetchLike = fetch) {
  return requestJson<{ engine: "official-dsh"; active: boolean; expiresAt?: number }>("/api/agent/workspace/owner", {
    method: "POST",
    keepalive,
    body: JSON.stringify({ clientId, active })
  }, fetchImpl);
}

export function completeAgentWorkspaceAction(
  actionId: string,
  outcome: { ok: boolean; message: string; result?: Record<string, unknown> },
  fetchImpl: FetchLike = fetch
) {
  return requestJson<{ engine: "official-dsh"; action: AgentWorkspaceAction }>(
    `/api/agent/workspace/actions/${encodeURIComponent(actionId)}/result`,
    { method: "POST", body: JSON.stringify(outcome) },
    fetchImpl
  );
}

function textValue(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => textValue(item, depth + 1)).join("");
  const data = record(value);
  for (const key of ["text", "content", "delta", "message", "value", "texts", "chunk"]) {
    if (key in data) {
      const text = textValue(data[key], depth + 1);
      if (text) return text;
    }
  }
  return "";
}

const STOCKCHOOSE_PROMPT_PREFIX = "\u4f60\u6b63\u5728 STOCKCHOOSE A\u80a1\u7814\u7a76\u5de5\u4f5c\u7ad9\u4e2d\u3002";
const STOCKCHOOSE_USER_REQUEST_MARKER = "\n\n\u7528\u6237\u8bf7\u6c42\uff1a\n";

function userMessageText(data: Record<string, unknown>) {
  const sourceKind = record(data.source).kind;
  if (typeof sourceKind === "string" && sourceKind !== "user") return "";

  const text = textValue(data).trim();
  if (!text.includes(STOCKCHOOSE_PROMPT_PREFIX)) return text;

  const requestIndex = text.lastIndexOf(STOCKCHOOSE_USER_REQUEST_MARKER);
  if (requestIndex < 0) return text;
  return text.slice(requestIndex + STOCKCHOOSE_USER_REQUEST_MARKER.length).trim();
}

function eventTime(event: Record<string, unknown>) {
  const raw = Number(event.time ?? record(event.data).time);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function eventSequence(event: Record<string, unknown>, fallback: number) {
  const raw = Number(event.seq);
  return Number.isFinite(raw) ? raw : fallback;
}

function pushMessage(messages: AgentMessage[], next: AgentMessage, mergeAssistantChunk: boolean) {
  const previous = messages[messages.length - 1];
  if (mergeAssistantChunk && previous?.role === "assistant") {
    previous.text += next.text;
    previous.createdAt = next.createdAt ?? previous.createdAt;
    return;
  }
  messages.push(next);
}

export function parseAgentHistoryEvents(entries: AgentHistoryEvent[]): AgentMessage[] {
  const messages: AgentMessage[] = [];

  entries.forEach((entry, index) => {
    const event = record(entry.event);
    const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
    const data = record(event.data);
    const sequence = eventSequence(event, index);
    const createdAt = eventTime(event);

    if (type === "user/message" || type.startsWith("user/")) {
      const text = userMessageText(data);
      if (text) pushMessage(messages, { id: `user-${sequence}-${index}`, role: "user", text, createdAt }, false);
      return;
    }

    const isTextChunk = type === "assistant/chunk" || type === "chunkrow/text-chunks";
    const isAssistantMessage = type === "assistant/message" || type === "assistant/text";
    if (!isTextChunk && !isAssistantMessage) return;

    const text = textValue(isTextChunk ? (data.chunk ?? data.texts ?? data) : data);
    if (!text) return;
    pushMessage(messages, { id: `assistant-${sequence}-${index}`, role: "assistant", text, createdAt }, isTextChunk);
  });

  return messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => message.text.length > 0);
}
