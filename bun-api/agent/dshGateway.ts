import { randomUUID } from "node:crypto";
import WebSocket, { type ClientOptions, type RawData } from "ws";
import { ApiError } from "../lib/http";

const DSH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DSH_REQUEST_TIMEOUT_MS = 30_000;
const DSH_STREAM_TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;
type WebSocketFactory = (url: string, options: ClientOptions) => WebSocket;
type JsonRecord = Record<string, unknown>;

export interface DshSessionSummary {
  sessionId: string;
  updatedAt?: number;
  running?: boolean;
  blank?: boolean;
  cwd?: string;
  agentPreset?: string;
  projections?: unknown;
}

export interface DshHistorySnapshot {
  events: Array<{ event: JsonRecord }>;
  hasMore: boolean;
  cursor: number;
}

export interface DshGatewayStatus {
  configured: boolean;
  connected: boolean;
  origin?: string;
  runtime: "official-dsh";
}

export interface DshModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface DshModelCatalog {
  default: DshModelSelection;
  groups: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string; description?: string }>;
  }>;
}

export interface DshFileUpload {
  receiptId: string;
  file: {
    attachmentId: string;
    name: string;
    bytes: number;
  };
}

export type DshPromptContentPart =
  | { type: "text"; text: string }
  | { type: "file"; receiptId: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function requestSignal(signal?: AbortSignal, timeoutMs = DSH_REQUEST_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function getSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") return extended.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/u) : [];
}

export function parseOfficialDshStartUrl(value: string): URL {
  const raw = value.trim();
  if (!raw) {
    throw new ApiError(503, "Official DSH runtime is not configured", "Set STOCKCHOOSE_DSH_START_URL to the loopback URL printed by the official DSH runtime");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(503, "Official DSH runtime URL is invalid");
  }

  const tokens = url.searchParams.getAll("token");
  const hasUnknownQuery = [...url.searchParams.keys()].some((key) => key !== "token");
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !/^\d+$/u.test(url.port) ||
    url.pathname !== "/" ||
    Boolean(url.username || url.password || url.hash) ||
    tokens.length !== 1 ||
    !DSH_TOKEN_PATTERN.test(tokens[0] ?? "") ||
    hasUnknownQuery
  ) {
    throw new ApiError(503, "Official DSH runtime URL must be an authenticated IPv4 loopback URL");
  }
  return url;
}

function normalizeHistorySnapshot(snapshot: unknown): DshHistorySnapshot {
  const value = record(snapshot);
  const events = Array.isArray(value.records)
    ? value.records.flatMap((candidate): Array<{ event: JsonRecord }> => {
        const item = record(candidate);
        const event = record(item.event);
        return item.type === "event" && Object.keys(event).length ? [{ event }] : [];
      })
    : [];

  const assistantStream = record(value.assistantStream);
  const activeAttempt = record(assistantStream.activeAttempt);
  const stream = Array.isArray(activeAttempt.stream) ? activeAttempt.stream : [];
  const startedAfterSeq = Number(activeAttempt.startedAfterSeq ?? -1);
  const turn = Number(activeAttempt.turn ?? 0);
  const step = Number(activeAttempt.step ?? 0);
  if (typeof activeAttempt.attemptId === "string" && Number.isFinite(startedAfterSeq)) {
    stream.forEach((candidate, ordinal) => {
      const item = record(candidate);
      const seq = startedAfterSeq + ordinal + 1;
      if (item.type === "chunk") {
        events.push({ event: { type: "assistant/chunk", seq, time: item.time, data: { turn, step, chunk: item.chunk } } });
      } else if (item.type === "text-chunks" || item.type === "reasoning-chunks") {
        events.push({ event: { type: `chunkrow/${item.type}`, seq, time: item.time0, data: { turn, step, index: item.index, dt: item.dt, texts: item.texts } } });
      }
    });
  }

  return {
    events,
    hasMore: value.hasMore === true,
    cursor: typeof value.cursor === "number" ? value.cursor : -1
  };
}

class AsyncQueue<T> {
  private values: T[] = [];
  private waiters: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void }> = [];
  private ended = false;
  private failure?: Error;

  push(value: T) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  end(error?: Error) {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    const waiters = this.waiters.splice(0);
    waiters.forEach((waiter) => error ? waiter.reject(error) : waiter.resolve({ done: true, value: undefined as never }));
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length) return { done: false, value: this.values.shift() as T };
    if (this.failure) throw this.failure;
    if (this.ended) return { done: true, value: undefined as never };
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

export class OfficialDshGateway {
  private readonly startUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly websocketFactory: WebSocketFactory;
  private origin = "";
  private cookie = "";

  constructor(options: {
    startUrl?: string;
    fetchImpl?: FetchLike;
    websocketFactory?: WebSocketFactory;
  } = {}) {
    this.startUrl = options.startUrl ?? process.env.STOCKCHOOSE_DSH_START_URL ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.websocketFactory = options.websocketFactory ?? ((url, clientOptions) => new WebSocket(url, clientOptions));
  }

  status(): DshGatewayStatus {
    return {
      configured: Boolean(this.startUrl.trim()),
      connected: Boolean(this.origin && this.cookie),
      ...(this.origin ? { origin: this.origin } : {}),
      runtime: "official-dsh"
    };
  }

  reset() {
    this.origin = "";
    this.cookie = "";
  }

  private async authenticate(signal?: AbortSignal) {
    const startupUrl = parseOfficialDshStartUrl(this.startUrl);
    let response: Response;
    try {
      response = await this.fetchImpl(startupUrl, {
        redirect: "manual",
        signal: requestSignal(signal, 10_000)
      });
    } catch (error) {
      throw new ApiError(502, "Official DSH authentication failed", error instanceof Error ? error.message : String(error));
    }
    if (response.status !== 303 || response.headers.get("location") !== "/") {
      throw new ApiError(502, "Official DSH authentication returned an invalid response", `HTTP ${response.status}`);
    }
    const cookies = getSetCookies(response.headers)
      .map((item) => item.split(";", 1)[0]?.trim())
      .filter((item): item is string => Boolean(item && /^dsh-auth-[^=]+=.+$/u.test(item)));
    if (!cookies.length) throw new ApiError(502, "Official DSH authentication did not return a session cookie");
    this.cookie = cookies.join("; ");
    this.origin = startupUrl.origin;
  }

  private async ensureAuthenticated(signal?: AbortSignal) {
    if (!this.origin || !this.cookie) await this.authenticate(signal);
  }

  private async callOnce(endpoint: string, args: JsonRecord, signal?: AbortSignal): Promise<unknown> {
    await this.ensureAuthenticated(signal);
    const rpcId = randomUUID();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: this.cookie },
        body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }),
        signal: requestSignal(signal)
      });
    } catch (error) {
      throw new ApiError(502, "Official DSH request failed", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.reset();
      throw new ApiError(response.status === 401 || response.status === 403 ? 502 : response.status, "Official DSH request failed", `HTTP ${response.status}`);
    }
    const message = record(await response.json());
    if (message.type !== "server-response" || message.rpcId !== rpcId) {
      throw new ApiError(502, "Official DSH response correlation is invalid");
    }
    const result = record(message.result);
    if (result.ok !== true) {
      const error = record(result.error);
      throw new ApiError(502, "Official DSH operation failed", String(error.message ?? "Unknown DSH error"));
    }
    return result.value;
  }

  async call(endpoint: string, args: JsonRecord = {}, signal?: AbortSignal): Promise<unknown> {
    try {
      return await this.callOnce(endpoint, args, signal);
    } catch (error) {
      if (!(error instanceof ApiError) || this.origin || !this.startUrl.trim()) throw error;
      return await this.callOnce(endpoint, args, signal);
    }
  }

  async listSessions(signal?: AbortSignal): Promise<{ items: DshSessionSummary[] }> {
    const value = record(await this.call("session/list", { _request: {} }, signal));
    return { items: Array.isArray(value.items) ? value.items.map((item) => record(item) as DshSessionSummary) : [] };
  }

  async createSession(workspace: string, signal?: AbortSignal): Promise<{ sessionId: string; agentPreset?: string }> {
    const value = record(await this.call("session/create", { request: { cwd: workspace } }, signal));
    if (typeof value.sessionId !== "string" || !value.sessionId) throw new ApiError(502, "Official DSH did not return a sessionId");
    return { sessionId: value.sessionId, ...(typeof value.agentPreset === "string" ? { agentPreset: value.agentPreset } : {}) };
  }

  async modelCatalog(signal?: AbortSignal): Promise<DshModelCatalog> {
    const value = record(await this.call("session/modelCatalog", {}, signal));
    const defaultSelection = record(value.default);
    const groups = Array.isArray(value.groups)
      ? value.groups.flatMap((candidate) => {
          const group = record(candidate);
          if (typeof group.id !== "string" || typeof group.name !== "string" || !Array.isArray(group.models)) return [];
          const models = group.models.flatMap((modelCandidate) => {
            const model = record(modelCandidate);
            if (typeof model.id !== "string" || typeof model.name !== "string") return [];
            return [{
              id: model.id,
              name: model.name,
              ...(typeof model.description === "string" ? { description: model.description } : {})
            }];
          });
          return [{ id: group.id, name: group.name, models }];
        })
      : [];
    if (typeof defaultSelection.provider !== "string" || typeof defaultSelection.model !== "string") {
      throw new ApiError(502, "Official DSH returned an invalid model catalog");
    }
    return {
      default: {
        provider: defaultSelection.provider,
        model: defaultSelection.model,
        ...(typeof defaultSelection.reasoningEffort === "string" ? { reasoningEffort: defaultSelection.reasoningEffort } : {})
      },
      groups
    };
  }

  async selectModel(sessionId: string, selection: DshModelSelection, signal?: AbortSignal) {
    const value = record(await this.call("session/selectModel", {
      request: { sessionId, ...selection }
    }, signal));
    const selected = record(value.selected);
    if (typeof selected.provider !== "string" || typeof selected.model !== "string") {
      throw new ApiError(502, "Official DSH did not confirm the selected model");
    }
    return {
      selected: {
        provider: selected.provider,
        model: selected.model,
        ...(typeof selected.reasoningEffort === "string" ? { reasoningEffort: selected.reasoningEffort } : {})
      }
    };
  }

  private async uploadFileOnce(sessionId: string, bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<DshFileUpload> {
    await this.ensureAuthenticated(signal);
    const url = new URL("/api/session/uploadFileBinary", this.origin);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("name", name);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", cookie: this.cookie },
        body: bytes,
        signal: requestSignal(signal)
      });
    } catch (error) {
      throw new ApiError(502, "Official DSH file upload failed", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) this.reset();
      throw new ApiError(response.status === 401 || response.status === 403 ? 502 : response.status, "Official DSH file upload failed", `HTTP ${response.status}`);
    }
    const result = record(await response.json());
    if (result.ok !== true) {
      const error = record(result.error);
      throw new ApiError(502, "Official DSH file upload failed", String(error.message ?? "Unknown DSH error"));
    }
    const value = record(result.value);
    const file = record(value.file);
    if (
      typeof value.receiptId !== "string" ||
      typeof file.attachmentId !== "string" ||
      typeof file.name !== "string" ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 0
    ) {
      throw new ApiError(502, "Official DSH returned an invalid file upload receipt");
    }
    return {
      receiptId: value.receiptId,
      file: { attachmentId: file.attachmentId, name: file.name, bytes: Number(file.bytes) }
    };
  }

  async uploadFile(sessionId: string, bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<DshFileUpload> {
    try {
      return await this.uploadFileOnce(sessionId, bytes, name, signal);
    } catch (error) {
      if (!(error instanceof ApiError) || this.origin || !this.startUrl.trim()) throw error;
      return await this.uploadFileOnce(sessionId, bytes, name, signal);
    }
  }

  async prompt(sessionId: string, content: DshPromptContentPart[], mode: "queue" | "steer", clientTimeZone: string, signal?: AbortSignal) {
    const value = record(await this.call("session/prompt", {
      request: {
        requestId: randomUUID(),
        sessionId,
        mode,
        content,
        clientTimeZone
      }
    }, signal));
    return { accepted: value.accepted === true, ...(value.command ? { command: value.command } : {}) };
  }

  async cancel(sessionId: string, signal?: AbortSignal) {
    const value = record(await this.call("session/cancel", { request: { sessionId } }, signal));
    return { accepted: value.accepted === true };
  }

  private async *openStream(endpoint: string, args: JsonRecord, signal?: AbortSignal): AsyncIterable<unknown> {
    await this.ensureAuthenticated(signal);
    const streamId = randomUUID();
    const url = new URL("/api/remote.mux", this.origin);
    url.protocol = "ws:";
    const socket = this.websocketFactory(url.toString(), { headers: { cookie: this.cookie }, origin: this.origin });
    const queue = new AsyncQueue<unknown>();
    let closed = false;
    const close = (error?: Error) => {
      if (closed) return;
      closed = true;
      queue.end(error);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    };
    const abort = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel", streamId }));
      close(new ApiError(499, "Official DSH stream was canceled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("error", (error) => close(error instanceof Error ? error : new Error(String(error))));
    socket.once("close", () => close());
    socket.on("message", (raw: RawData) => {
      try {
        const frame = record(JSON.parse(raw.toString()));
        if (frame.streamId !== streamId) return;
        if (frame.type === "item") queue.push(frame.value);
        else if (frame.type === "end") close();
        else if (frame.type === "error") close(new Error(String(record(frame.error).message ?? "Official DSH stream failed")));
      } catch (error) {
        close(error instanceof Error ? error : new Error(String(error)));
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => { cleanup(); resolve(); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const onClose = () => { cleanup(); reject(new Error("Official DSH stream closed before opening")); };
        const cleanup = () => {
          socket.off("open", onOpen);
          socket.off("error", onError);
          socket.off("close", onClose);
        };
        socket.once("open", onOpen);
        socket.once("error", onError);
        socket.once("close", onClose);
      });
      socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }));
      while (true) {
        const next = await queue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (!closed) abort();
    }
  }

  async history(sessionId: string, maxMessages: number, signal?: AbortSignal): Promise<DshHistorySnapshot> {
    const streamSignal = requestSignal(signal, DSH_STREAM_TIMEOUT_MS);
    for await (const item of this.openStream("session/follow", {
      request: {
        address: { kind: "session", sessionId },
        maxMessages,
        assistantStream: true
      }
    }, streamSignal)) {
      const frame = record(item);
      if (frame.type === "snapshot") return normalizeHistorySnapshot(frame);
    }
    throw new ApiError(502, "Official DSH history stream returned no snapshot");
  }
}

export const officialDshGateway = new OfficialDshGateway();

export const dshGatewayTesting = {
  normalizeHistorySnapshot
};
