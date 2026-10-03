import path from "node:path";
import { ApiError, jsonResponse, requestJson } from "../lib/http";
import {
  officialDshGateway,
  type DshFileUpload,
  type DshGatewayStatus,
  type DshHistorySnapshot,
  type DshModelCatalog,
  type DshModelSelection,
  type DshPromptContentPart,
  type DshSessionSummary
} from "./dshGateway";
import {
  claimWorkspaceActions,
  completeWorkspaceAction,
  enqueueWorkspaceAction,
  normalizeWorkspaceActionInput,
  setWorkspaceActionOwner,
  waitForWorkspaceAction
} from "./workspaceActions";

type PromptMode = "queue" | "steer";
const MAX_AGENT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_AGENT_ATTACHMENTS = 4;

export interface AgentGateway {
  status(): DshGatewayStatus;
  listSessions(signal?: AbortSignal): Promise<{ items: DshSessionSummary[] }>;
  createSession(workspace: string, signal?: AbortSignal): Promise<{ sessionId: string; agentPreset?: string }>;
  modelCatalog(signal?: AbortSignal): Promise<DshModelCatalog>;
  selectModel(sessionId: string, selection: DshModelSelection, signal?: AbortSignal): Promise<{ selected: DshModelSelection }>;
  uploadFile(sessionId: string, bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<DshFileUpload>;
  prompt(sessionId: string, content: DshPromptContentPart[], mode: PromptMode, clientTimeZone: string, signal?: AbortSignal): Promise<{ accepted: boolean; command?: unknown }>;
  cancel(sessionId: string, signal?: AbortSignal): Promise<{ accepted: boolean }>;
  history(sessionId: string, maxMessages: number, signal?: AbortSignal): Promise<DshHistorySnapshot>;
}

interface PromptContext {
  section?: string;
  stockCodes?: string[];
  strategyId?: string;
  poolId?: string;
  datasetId?: string;
  snapshotAt?: string;
}

function validateSessionId(value: string) {
  const sessionId = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(sessionId)) throw new ApiError(400, "Invalid Agent sessionId");
  return sessionId;
}

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePromptContext(value: unknown): PromptContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const stockCodes = Array.isArray(source.stockCodes)
    ? source.stockCodes.map((item) => stringField(item, 16)).filter((item) => /^(?:sh|sz|bj)?\d{6}$/iu.test(item)).slice(0, 20)
    : [];
  return {
    ...(stringField(source.section, 40) ? { section: stringField(source.section, 40) } : {}),
    ...(stockCodes.length ? { stockCodes } : {}),
    ...(stringField(source.strategyId, 128) ? { strategyId: stringField(source.strategyId, 128) } : {}),
    ...(stringField(source.poolId, 128) ? { poolId: stringField(source.poolId, 128) } : {}),
    ...(stringField(source.datasetId, 128) ? { datasetId: stringField(source.datasetId, 128) } : {}),
    ...(stringField(source.snapshotAt, 64) ? { snapshotAt: stringField(source.snapshotAt, 64) } : {})
  };
}

function normalizeModelSelection(value: unknown): DshModelSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const provider = stringField(source.provider, 128);
  const model = stringField(source.model, 128);
  const reasoningEffort = stringField(source.reasoningEffort, 128);
  if (!provider || !model) throw new ApiError(400, "Invalid Agent model selection");
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

function normalizeAttachmentReceiptIds(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError(400, "Invalid Agent attachment receipts");
  const receiptIds = value.map((item) => stringField(item, 256));
  if (receiptIds.length > MAX_AGENT_ATTACHMENTS || receiptIds.some((item) => !/^[A-Za-z0-9._:-]{1,256}$/u.test(item))) {
    throw new ApiError(400, "Invalid Agent attachment receipts");
  }
  return [...new Set(receiptIds)];
}

export function buildStockChooseAgentPrompt(text: string, context: PromptContext) {
  const contextLines = Object.entries(context).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
  const workspaceInstruction = "When the user explicitly asks to create a strategy, stock pool, custom factor, or open another section, use the matching stockchoose_* workspace tool. Never claim success unless the tool reports completed.";
  return [
    workspaceInstruction,
    "你正在 STOCKCHOOSE A股研究工作站中。",
    "优先调用 stockchoose_* 白名单工具获取行情、财务、公告和同步状态。",
    "严格区分事实、推断与建议；没有真实工具证据时必须明确说明数据不足。",
    "不得提交纸面或真实交易，不得假设未提供的当前行情。",
    ...(contextLines.length ? ["当前冻结上下文：", ...contextLines] : []),
    "",
    "用户请求：",
    text
  ].join("\n");
}

function configuredWorkspace() {
  return path.resolve(process.env.STOCKCHOOSE_AGENT_WORKSPACE || process.cwd());
}

export function createAgentRouteHandler(gateway: AgentGateway = officialDshGateway) {
  return async function handleAgentRoute(request: Request, url: URL): Promise<Response | null> {
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/agent")) return null;

    if (pathname === "/api/agent/status" && request.method === "GET") {
      const current = gateway.status();
      if (url.searchParams.get("probe") === "1" && current.configured) {
        const sessions = await gateway.listSessions(request.signal);
        return jsonResponse({ ...gateway.status(), available: true, sessionCount: sessions.items.length });
      }
      return jsonResponse({ ...current, available: current.connected });
    }

    if (pathname === "/api/agent/workspace/actions" && request.method === "GET") {
      const requested = Number(url.searchParams.get("limit") ?? 5);
      const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 10) : 5;
      const clientId = stringField(url.searchParams.get("clientId"), 128);
      return jsonResponse({ engine: "official-dsh", items: claimWorkspaceActions(limit, clientId) });
    }

    if (pathname === "/api/agent/workspace/owner" && request.method === "POST") {
      const body = await requestJson<Record<string, unknown>>(request);
      const clientId = stringField(body.clientId, 128);
      if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(clientId)) throw new ApiError(400, "Invalid Agent workspace clientId");
      const owner = setWorkspaceActionOwner(clientId, body.active !== false);
      return jsonResponse({ engine: "official-dsh", active: owner?.clientId === clientId, expiresAt: owner?.expiresAt });
    }

    if (pathname === "/api/agent/workspace/actions" && request.method === "POST") {
      const body = await requestJson<Record<string, unknown>>(request);
      const action = enqueueWorkspaceAction(normalizeWorkspaceActionInput(body));
      const requestedWait = Number(body.waitMs ?? 20_000);
      const waitMs = Number.isFinite(requestedWait) ? Math.min(Math.max(Math.trunc(requestedWait), 0), 25_000) : 20_000;
      const completedAction = waitMs > 0 ? await waitForWorkspaceAction(action.id, waitMs, request.signal) : action;
      const completed = completedAction.status === "completed" || completedAction.status === "failed";
      return jsonResponse({ engine: "official-dsh", completed, action: completedAction }, completed ? 200 : 202);
    }

    const workspaceResultRoute = pathname.match(/^\/api\/agent\/workspace\/actions\/([^/]+)\/result$/u);
    if (workspaceResultRoute && request.method === "POST") {
      const body = await requestJson<Record<string, unknown>>(request);
      const message = stringField(body.message, 500) || (body.ok === true ? "Workspace action completed" : "Workspace action failed");
      const result = body.result && typeof body.result === "object" && !Array.isArray(body.result)
        ? body.result as Record<string, unknown>
        : undefined;
      const action = completeWorkspaceAction(decodeURIComponent(workspaceResultRoute[1] ?? ""), {
        ok: body.ok === true,
        message,
        ...(result ? { result } : {})
      });
      return jsonResponse({ engine: "official-dsh", action });
    }

    if (pathname === "/api/agent/sessions" && request.method === "GET") {
      const sessions = await gateway.listSessions(request.signal);
      return jsonResponse({ engine: "official-dsh", ...sessions });
    }

    if (pathname === "/api/agent/sessions" && request.method === "POST") {
      const session = await gateway.createSession(configuredWorkspace(), request.signal);
      return jsonResponse({ engine: "official-dsh", ...session }, 201);
    }

    if (pathname === "/api/agent/models" && request.method === "GET") {
      const catalog = await gateway.modelCatalog(request.signal);
      return jsonResponse({ engine: "official-dsh", ...catalog });
    }

    const sessionRoute = pathname.match(/^\/api\/agent\/sessions\/([^/]+)(?:\/(history|prompt|cancel|files|model))?$/u);
    if (!sessionRoute) return null;
    const sessionId = validateSessionId(decodeURIComponent(sessionRoute[1] ?? ""));
    const action = sessionRoute[2] ?? "";

    if (action === "history" && request.method === "GET") {
      const requested = Number(url.searchParams.get("maxMessages") ?? 80);
      const maxMessages = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 80;
      const history = await gateway.history(sessionId, maxMessages, request.signal);
      return jsonResponse({ engine: "official-dsh", sessionId, ...history });
    }

    if (action === "model" && request.method === "POST") {
      const body = await requestJson<Record<string, unknown>>(request);
      const selection = normalizeModelSelection(body);
      if (!selection) throw new ApiError(400, "Invalid Agent model selection");
      const result = await gateway.selectModel(sessionId, selection, request.signal);
      return jsonResponse({ engine: "official-dsh", sessionId, ...result });
    }

    if (action === "prompt" && request.method === "POST") {
      const body = await requestJson<Record<string, unknown>>(request);
      const text = stringField(body.text, 32_000);
      const attachmentReceiptIds = normalizeAttachmentReceiptIds(body.attachmentReceiptIds);
      if (!text && attachmentReceiptIds.length === 0) throw new ApiError(400, "Agent prompt text or attachment is required");
      const mode: PromptMode = body.mode === "steer" ? "steer" : "queue";
      const context = normalizePromptContext(body.context);
      const clientTimeZone = stringField(body.clientTimeZone, 80) || "Asia/Shanghai";
      const selection = normalizeModelSelection(body.model);
      if (selection) await gateway.selectModel(sessionId, selection, request.signal);
      const promptText = text || "请读取并分析所附文件。";
      const content: DshPromptContentPart[] = [
        { type: "text", text: buildStockChooseAgentPrompt(promptText, context) },
        ...attachmentReceiptIds.map((receiptId): DshPromptContentPart => ({ type: "file", receiptId }))
      ];
      const result = await gateway.prompt(sessionId, content, mode, clientTimeZone, request.signal);
      return jsonResponse({ engine: "official-dsh", sessionId, ...result }, 202);
    }

    if (action === "files" && request.method === "POST") {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_AGENT_FILE_BYTES + 512 * 1024) {
        throw new ApiError(413, "Agent attachment is too large");
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(400, "Agent attachment file is required");
      if (!file.name.trim()) throw new ApiError(400, "Agent attachment name is required");
      if (file.size > MAX_AGENT_FILE_BYTES) throw new ApiError(413, "Agent attachment is too large");
      const uploaded = await gateway.uploadFile(sessionId, new Uint8Array(await file.arrayBuffer()), file.name, request.signal);
      return jsonResponse({ engine: "official-dsh", sessionId, ...uploaded }, 201);
    }

    if (action === "cancel" && request.method === "POST") {
      const result = await gateway.cancel(sessionId, request.signal);
      return jsonResponse({ engine: "official-dsh", sessionId, ...result });
    }

    throw new ApiError(405, "Agent route method is not allowed");
  };
}

export const handleAgentRoute = createAgentRouteHandler();
