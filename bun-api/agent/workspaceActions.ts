import { randomUUID } from "node:crypto";
import { ApiError } from "../lib/http";

export const workspaceActionTypes = [
  "create-strategy",
  "create-stock-pool",
  "create-custom-factor",
  "open-section"
] as const;

export type WorkspaceActionType = typeof workspaceActionTypes[number];
export type WorkspaceActionStatus = "pending" | "claimed" | "completed" | "failed";

export interface WorkspaceAction {
  id: string;
  type: WorkspaceActionType;
  payload: Record<string, unknown>;
  status: WorkspaceActionStatus;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  message?: string;
  result?: Record<string, unknown>;
}

interface StoredWorkspaceAction extends WorkspaceAction {
  waiters: Set<(action: WorkspaceAction) => void>;
}

const actions = new Map<string, StoredWorkspaceAction>();
const CLAIM_TIMEOUT_MS = 30_000;
const RETENTION_MS = 5 * 60_000;
const MAX_ACTIONS = 100;
const OWNER_TTL_MS = 2 * 60_000;
let actionOwner: { clientId: string; expiresAt: number } | null = null;

function publicAction(action: StoredWorkspaceAction): WorkspaceAction {
  const { waiters: _waiters, ...value } = action;
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, field: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ApiError(400, `Agent workspace action ${field} is required`);
  if (text.length > maxLength) throw new ApiError(400, `Agent workspace action ${field} is too long`);
  return text;
}

function optionalString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeWorkspaceActionInput(value: unknown): { type: WorkspaceActionType; payload: Record<string, unknown> } {
  const input = record(value);
  const type = String(input.type ?? "") as WorkspaceActionType;
  if (!workspaceActionTypes.includes(type)) throw new ApiError(400, "Unsupported Agent workspace action");
  const payload = record(input.payload);

  if (type === "create-strategy") {
    return {
      type,
      payload: {
        name: requiredString(payload.name, "name", 80),
        description: optionalString(payload.description, 500),
        poolId: optionalString(payload.poolId, 128) || "all",
        addToHoldings: payload.addToHoldings === true
      }
    };
  }

  if (type === "create-stock-pool") {
    const codes = Array.isArray(payload.codes)
      ? Array.from(new Set(payload.codes.map((item) => String(item).trim().toLowerCase()).filter((item) => /^(?:sh|sz|bj)?\d{6}$/u.test(item)))).slice(0, 100)
      : [];
    if (!codes.length) throw new ApiError(400, "Agent workspace action codes are required");
    return {
      type,
      payload: {
        name: requiredString(payload.name, "name", 80),
        codes,
        select: payload.select !== false
      }
    };
  }

  if (type === "create-custom-factor") {
    const formula = requiredString(payload.formula, "formula", 500);
    const unsafeIdentifier = /\b(?:constructor|document|eval|function|globalthis|import|process|prototype|this|window|__proto__)\b/iu;
    if (!/^[\w\s+\-*/%().,<>=!&|?:]+$/u.test(formula) || unsafeIdentifier.test(formula)) {
      throw new ApiError(400, "Agent workspace action formula contains unsupported characters");
    }
    return {
      type,
      payload: {
        name: requiredString(payload.name, "name", 80),
        formula
      }
    };
  }

  const section = String(payload.section ?? "");
  if (!["dashboard", "strategy", "trade", "sentiment", "valuation", "settings"].includes(section)) {
    throw new ApiError(400, "Agent workspace action section is invalid");
  }
  return { type, payload: { section } };
}

function prune(now = Date.now()) {
  if (actionOwner && actionOwner.expiresAt <= now) actionOwner = null;
  for (const [id, action] of actions) {
    if (action.status === "claimed" && action.claimedAt && now - Date.parse(action.claimedAt) > CLAIM_TIMEOUT_MS) {
      action.status = "pending";
      delete action.claimedAt;
    }
    if ((action.status === "completed" || action.status === "failed") && action.completedAt && now - Date.parse(action.completedAt) > RETENTION_MS) {
      actions.delete(id);
    }
  }
  while (actions.size >= MAX_ACTIONS) {
    const oldest = actions.keys().next().value;
    if (!oldest) break;
    actions.delete(oldest);
  }
}

export function setWorkspaceActionOwner(clientId: string, active: boolean, now = Date.now()) {
  prune(now);
  if (!active) {
    if (actionOwner?.clientId === clientId) actionOwner = null;
    return actionOwner;
  }
  actionOwner = { clientId, expiresAt: now + OWNER_TTL_MS };
  return actionOwner;
}

export function enqueueWorkspaceAction(input: { type: WorkspaceActionType; payload: Record<string, unknown> }) {
  prune();
  const action: StoredWorkspaceAction = {
    id: `workspace-action-${randomUUID()}`,
    type: input.type,
    payload: input.payload,
    status: "pending",
    createdAt: new Date().toISOString(),
    waiters: new Set()
  };
  actions.set(action.id, action);
  return publicAction(action);
}

export function claimWorkspaceActions(limit = 5, clientId = "") {
  prune();
  if (actionOwner && actionOwner.clientId !== clientId) return [];
  const claimedAt = new Date().toISOString();
  const claimed: WorkspaceAction[] = [];
  for (const action of actions.values()) {
    if (action.status !== "pending") continue;
    action.status = "claimed";
    action.claimedAt = claimedAt;
    claimed.push(publicAction(action));
    if (claimed.length >= Math.min(Math.max(limit, 1), 10)) break;
  }
  return claimed;
}

export function completeWorkspaceAction(id: string, outcome: { ok: boolean; message: string; result?: Record<string, unknown> }) {
  const action = actions.get(id);
  if (!action) throw new ApiError(404, "Agent workspace action was not found");
  if (action.status === "completed" || action.status === "failed") return publicAction(action);
  action.status = outcome.ok ? "completed" : "failed";
  action.completedAt = new Date().toISOString();
  action.message = outcome.message.slice(0, 500);
  action.result = outcome.result;
  const value = publicAction(action);
  action.waiters.forEach((resolve) => resolve(value));
  action.waiters.clear();
  return value;
}

export async function waitForWorkspaceAction(id: string, timeoutMs: number, signal?: AbortSignal) {
  const action = actions.get(id);
  if (!action) throw new ApiError(404, "Agent workspace action was not found");
  if (action.status === "completed" || action.status === "failed") return publicAction(action);

  return await new Promise<WorkspaceAction>((resolve) => {
    let settled = false;
    const finish = (value: WorkspaceAction) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action.waiters.delete(finish);
      resolve(value);
    };
    const onAbort = () => finish(publicAction(action));
    const timer = setTimeout(() => finish(publicAction(action)), Math.min(Math.max(timeoutMs, 0), 25_000));
    action.waiters.add(finish);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function resetWorkspaceActionsForTests() {
  actions.clear();
  actionOwner = null;
}
