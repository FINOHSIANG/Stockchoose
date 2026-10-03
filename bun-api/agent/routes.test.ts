import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRouteHandler, buildStockChooseAgentPrompt, type AgentGateway } from "./routes";
import { resetWorkspaceActionsForTests } from "./workspaceActions";

function gateway(overrides: Partial<AgentGateway> = {}): AgentGateway {
  return {
    status: () => ({ configured: true, connected: true, origin: "http://127.0.0.1:43123", runtime: "official-dsh" }),
    listSessions: vi.fn(async () => ({ items: [{ sessionId: "session-1" }] })),
    createSession: vi.fn(async () => ({ sessionId: "session-2" })),
    modelCatalog: vi.fn(async () => ({
      default: { provider: "stockchoose-relay", model: "gpt-5.5" },
      groups: [{ id: "stockchoose-relay", name: "CliRelay", models: [{ id: "gpt-5.5", name: "GPT 5.5" }] }]
    })),
    selectModel: vi.fn(async (_sessionId, selected) => ({ selected })),
    uploadFile: vi.fn(async (_sessionId, bytes, name) => ({
      receiptId: "receipt-1",
      file: { attachmentId: "sha256:test", name, bytes: bytes.byteLength }
    })),
    prompt: vi.fn(async () => ({ accepted: true })),
    cancel: vi.fn(async () => ({ accepted: true })),
    history: vi.fn(async () => ({ events: [], hasMore: false, cursor: 0 })),
    ...overrides
  };
}

describe("Agent routes", () => {
  beforeEach(() => resetWorkspaceActionsForTests());

  it("keeps unrelated Bun routes untouched", async () => {
    const response = await createAgentRouteHandler(gateway())(
      new Request("http://127.0.0.1/api/market/ashare/spot"),
      new URL("http://127.0.0.1/api/market/ashare/spot")
    );
    expect(response).toBeNull();
  });

  it("creates an official DSH session in the configured workspace", async () => {
    const createSession = vi.fn(async () => ({ sessionId: "session-2" }));
    const handler = createAgentRouteHandler(gateway({ createSession }));
    const response = await handler(
      new Request("http://127.0.0.1/api/agent/sessions", { method: "POST" }),
      new URL("http://127.0.0.1/api/agent/sessions")
    );
    expect(response?.status).toBe(201);
    expect(createSession).toHaveBeenCalledWith(expect.any(String), expect.any(AbortSignal));
    await expect(response?.json()).resolves.toMatchObject({ engine: "official-dsh", sessionId: "session-2" });
  });

  it("wraps prompts with the STOCKCHOOSE evidence contract and bounded context", async () => {
    const prompt = vi.fn(async () => ({ accepted: true }));
    const handler = createAgentRouteHandler(gateway({ prompt }));
    const request = new Request("http://127.0.0.1/api/agent/sessions/session-1/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "分析贵州茅台", context: { section: "valuation", stockCodes: ["sh600519", "bad"] } })
    });
    const response = await handler(request, new URL(request.url));
    expect(response?.status).toBe(202);
    const sentPrompt = String(prompt.mock.calls[0]?.[1]?.[0]?.text);
    expect(sentPrompt).toContain("优先调用 stockchoose_* 白名单工具");
    expect(sentPrompt).toContain("stockCodes: sh600519");
    expect(sentPrompt).not.toContain("bad");
  });

  it("lists models and applies a model before prompting with file receipts", async () => {
    const selectModel = vi.fn(async (_sessionId, selected) => ({ selected }));
    const prompt = vi.fn(async () => ({ accepted: true }));
    const handler = createAgentRouteHandler(gateway({ selectModel, prompt }));

    const catalogResponse = await handler(
      new Request("http://127.0.0.1/api/agent/models"),
      new URL("http://127.0.0.1/api/agent/models")
    );
    await expect(catalogResponse?.json()).resolves.toMatchObject({ groups: [{ models: [{ id: "gpt-5.5" }] }] });

    const request = new Request("http://127.0.0.1/api/agent/sessions/session-1/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "分析文件",
        model: { provider: "stockchoose-relay", model: "gpt-5.6-luna" },
        attachmentReceiptIds: ["receipt-1"]
      })
    });
    expect((await handler(request, new URL(request.url)))?.status).toBe(202);
    expect(selectModel).toHaveBeenCalledWith("session-1", { provider: "stockchoose-relay", model: "gpt-5.6-luna" }, expect.any(AbortSignal));
    expect(prompt.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "file", receiptId: "receipt-1" }
    ]);
  });

  it("uploads a bounded multipart file through the DSH gateway", async () => {
    const uploadFile = vi.fn(async (_sessionId, bytes, name) => ({
      receiptId: "receipt-1",
      file: { attachmentId: "sha256:test", name, bytes: bytes.byteLength }
    }));
    const handler = createAgentRouteHandler(gateway({ uploadFile }));
    const form = new FormData();
    form.set("file", new File(["a,b\n1,2"], "research.csv", { type: "text/csv" }));
    const request = new Request("http://127.0.0.1/api/agent/sessions/session-1/files", { method: "POST", body: form });
    const response = await handler(request, new URL(request.url));
    expect(response?.status).toBe(201);
    expect(uploadFile).toHaveBeenCalledWith("session-1", expect.any(Uint8Array), "research.csv", expect.any(AbortSignal));
    await expect(response?.json()).resolves.toMatchObject({ receiptId: "receipt-1", file: { name: "research.csv" } });
  });

  it("builds a stable Chinese domain prompt", () => {
    expect(buildStockChooseAgentPrompt("检查风险", { section: "trade", strategyId: "s-1" })).toContain("不得提交纸面或真实交易");
  });

  it("queues, claims and completes a workspace action", async () => {
    const handler = createAgentRouteHandler(gateway());
    const createRequest = new Request("http://127.0.0.1/api/agent/workspace/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "create-strategy", payload: { name: "Agent Strategy" }, waitMs: 0 })
    });
    const createdResponse = await handler(createRequest, new URL(createRequest.url));
    expect(createdResponse?.status).toBe(202);
    const created = await createdResponse?.json() as any;

    const claimRequest = new Request("http://127.0.0.1/api/agent/workspace/actions?limit=2");
    const claimResponse = await handler(claimRequest, new URL(claimRequest.url));
    await expect(claimResponse?.json()).resolves.toMatchObject({
      items: [{ id: created.action.id, type: "create-strategy", status: "claimed" }]
    });

    const resultRequest = new Request(`http://127.0.0.1/api/agent/workspace/actions/${created.action.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, message: "created", result: { strategyId: "strategy-1" } })
    });
    const resultResponse = await handler(resultRequest, new URL(resultRequest.url));
    await expect(resultResponse?.json()).resolves.toMatchObject({
      action: { id: created.action.id, status: "completed", result: { strategyId: "strategy-1" } }
    });
  });

  it("registers a workspace owner and blocks other clients from claiming", async () => {
    const handler = createAgentRouteHandler(gateway());
    const ownerRequest = new Request("http://127.0.0.1/api/agent/workspace/owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "client-owner-123", active: true })
    });
    const ownerResponse = await handler(ownerRequest, new URL(ownerRequest.url));
    await expect(ownerResponse?.json()).resolves.toMatchObject({ active: true });

    const createRequest = new Request("http://127.0.0.1/api/agent/workspace/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "open-section", payload: { section: "valuation" }, waitMs: 0 })
    });
    await handler(createRequest, new URL(createRequest.url));

    const blocked = new Request("http://127.0.0.1/api/agent/workspace/actions?clientId=client-other-456");
    await expect((await handler(blocked, new URL(blocked.url)))?.json()).resolves.toMatchObject({ items: [] });
    const allowed = new Request("http://127.0.0.1/api/agent/workspace/actions?clientId=client-owner-123");
    await expect((await handler(allowed, new URL(allowed.url)))?.json()).resolves.toMatchObject({ items: [expect.objectContaining({ type: "open-section" })] });
  });
});
