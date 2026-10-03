import { describe, expect, it, vi } from "vitest";
import {
  AgentApiError,
  claimAgentWorkspaceActions,
  completeAgentWorkspaceAction,
  getAgentModels,
  getAgentStatus,
  parseAgentHistoryEvents,
  promptAgentSession,
  setAgentWorkspaceActionOwner,
  uploadAgentFile
} from "./agentService";

describe("parseAgentHistoryEvents", () => {
  it("converts user events and merges consecutive assistant chunks", () => {
    const messages = parseAgentHistoryEvents([
      { event: { type: "user/message", seq: 1, time: 1_700_000_000, data: { text: "分析贵州茅台" } } },
      { event: { type: "assistant/chunk", seq: 2, data: { chunk: { type: "text-delta", text: "正在" } } } },
      { event: { type: "assistant/chunk", seq: 3, data: { chunk: { type: "text-delta", text: "分析。" } } } },
      { event: { type: "tool/call", seq: 4, data: { name: "stockchoose_market_snapshot" } } }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", text: "分析贵州茅台", createdAt: 1_700_000_000_000 }),
      expect.objectContaining({ role: "assistant", text: "正在分析。" })
    ]);
  });

  it("reads durable assistant messages and text chunk rows", () => {
    const messages = parseAgentHistoryEvents([
      { event: { type: "assistant/message", seq: 1, data: { content: [{ text: "结论一" }] } } },
      { event: { type: "user/message", seq: 2, data: { content: "继续" } } },
      { event: { type: "chunkrow/text-chunks", seq: 3, data: { texts: ["结论", "二"] } } }
    ]);

    expect(messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "assistant", text: "结论一" },
      { role: "user", text: "继续" },
      { role: "assistant", text: "结论二" }
    ]);
  });
  it("hides DSH injected user-role context and unwraps the STOCKCHOOSE request", () => {
    const messages = parseAgentHistoryEvents([
      {
        event: {
          type: "user/message",
          seq: 1,
          data: {
            source: { kind: "user" },
            content: [{
              type: "text",
              text: "Workspace tool instruction.\n\u4f60\u6b63\u5728 STOCKCHOOSE A\u80a1\u7814\u7a76\u5de5\u4f5c\u7ad9\u4e2d\u3002\n\u4f18\u5148\u8c03\u7528 stockchoose_* \u5de5\u5177\u3002\n\n\u7528\u6237\u8bf7\u6c42\uff1a\nReply with exactly UI_OK"
            }]
          }
        }
      },
      {
        event: {
          type: "user/message",
          seq: 2,
          data: {
            source: { kind: "agent-instructions" },
            content: [{ type: "text", text: "<system-reminder>internal instructions</system-reminder>" }]
          }
        }
      },
      {
        event: {
          type: "user/message",
          seq: 3,
          data: {
            source: { kind: "plugin" },
            content: [{ type: "text", text: "runtime context" }]
          }
        }
      }
    ]);

    expect(messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Reply with exactly UI_OK" }
    ]);
  });
});

describe("Agent API client", () => {
  it("surfaces JSON API errors with their HTTP status", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "Official DSH runtime is not configured" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;

    await expect(getAgentStatus(true, fetchMock)).rejects.toMatchObject({
      status: 503,
      message: "Official DSH runtime is not configured"
    });
  });

  it("claims and completes workspace actions through the local Agent API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/result")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({ ok: true, message: "created" });
        return new Response(JSON.stringify({ engine: "official-dsh", action: { id: "a-1", status: "completed" } }), { status: 200 });
      }
      expect(url).toBe("/api/agent/workspace/actions?limit=3&clientId=client-123");
      return new Response(JSON.stringify({ engine: "official-dsh", items: [{ id: "a-1", type: "create-strategy", payload: {}, status: "claimed", createdAt: "now" }] }), { status: 200 });
    });

    await expect(claimAgentWorkspaceActions(3, "client-123", fetchMock)).resolves.toMatchObject({ items: [{ id: "a-1" }] });
    await expect(completeAgentWorkspaceAction("a-1", { ok: true, message: "created" }, fetchMock)).resolves.toMatchObject({ action: { status: "completed" } });
  });

  it("registers the browser tab as the workspace action owner", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/api/agent/workspace/owner");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ clientId: "client-owner-123", active: true });
      return new Response(JSON.stringify({ engine: "official-dsh", active: true }), { status: 200 });
    });
    await expect(setAgentWorkspaceActionOwner("client-owner-123", true, false, fetchMock)).resolves.toMatchObject({ active: true });
  });

  it("loads the DSH model catalog and sends model plus attachment receipts", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input) === "/api/agent/models") {
        return new Response(JSON.stringify({
          engine: "official-dsh",
          default: { provider: "stockchoose-relay", model: "gpt-5.5" },
          groups: [{ id: "stockchoose-relay", name: "CliRelay", models: [{ id: "gpt-5.6-luna", name: "GPT 5.6 Luna" }] }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ engine: "official-dsh", sessionId: "session-1", accepted: true }), { status: 202 });
    });

    await expect(getAgentModels(fetchMock)).resolves.toMatchObject({ groups: [{ models: [{ id: "gpt-5.6-luna" }] }] });
    await promptAgentSession("session-1", "分析附件", { section: "valuation" }, {
      model: { provider: "stockchoose-relay", model: "gpt-5.6-luna" },
      attachmentReceiptIds: ["receipt-1"]
    }, fetchMock);
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      model: { provider: "stockchoose-relay", model: "gpt-5.6-luna" },
      attachmentReceiptIds: ["receipt-1"]
    });
  });

  it("uploads files as multipart data without forcing a JSON content type", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/api/agent/sessions/session-1/files");
      expect(new Headers(init?.headers).has("content-type")).toBe(false);
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect((form.get("file") as File).name).toBe("research.csv");
      return new Response(JSON.stringify({
        engine: "official-dsh",
        sessionId: "session-1",
        receiptId: "receipt-1",
        file: { attachmentId: "sha256:test", name: "research.csv", bytes: 4 }
      }), { status: 201 });
    });

    const file = new File(["code"], "research.csv", { type: "text/csv" });
    await expect(uploadAgentFile("session-1", file, fetchMock)).resolves.toMatchObject({ receiptId: "receipt-1" });
  });
});
