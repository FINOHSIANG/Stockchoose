import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/http";
import { dshGatewayTesting, OfficialDshGateway, parseOfficialDshStartUrl } from "./dshGateway";

const startUrl = `http://127.0.0.1:43123/?token=${"A".repeat(43)}`;

describe("OfficialDshGateway", () => {
  it("accepts only the authenticated DSH IPv4 loopback URL shape", () => {
    expect(parseOfficialDshStartUrl(startUrl).origin).toBe("http://127.0.0.1:43123");
    for (const value of [
      "http://localhost:43123/?token=" + "A".repeat(43),
      "https://127.0.0.1:43123/?token=" + "A".repeat(43),
      "http://127.0.0.1:43123/session?token=" + "A".repeat(43),
      "http://127.0.0.1:43123/?token=short",
      "http://127.0.0.1:43123/?token=" + "A".repeat(43) + "&extra=1"
    ]) {
      expect(() => parseOfficialDshStartUrl(value)).toThrow(ApiError);
    }
  });

  it("authenticates once and calls the official DSH session endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 303,
      headers: { location: "/", "set-cookie": "dsh-auth-test=session-cookie; Path=/; HttpOnly" }
    }));
    fetchMock.mockImplementationOnce(async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.method).toBe("session/list");
      expect(request.payload.args).toEqual({ _request: {} });
      expect(new Headers(init?.headers).get("cookie")).toBe("dsh-auth-test=session-cookie");
      return new Response(JSON.stringify({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { items: [{ sessionId: "session-1", running: false }] } }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const gateway = new OfficialDshGateway({ startUrl, fetchImpl: fetchMock });
    await expect(gateway.listSessions()).resolves.toEqual({ items: [{ sessionId: "session-1", running: false }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gateway.status()).toMatchObject({ configured: true, connected: true, origin: "http://127.0.0.1:43123" });
  });

  it("normalizes durable and in-flight assistant history", () => {
    const history = dshGatewayTesting.normalizeHistorySnapshot({
      type: "snapshot",
      cursor: 4,
      hasMore: true,
      records: [{ type: "event", event: { type: "user/message", seq: 1, data: { text: "分析" } } }],
      assistantStream: {
        activeAttempt: {
          attemptId: "attempt-1",
          startedAfterSeq: 1,
          turn: 1,
          step: 1,
          stream: [{ type: "chunk", time: 2, chunk: { type: "text-delta", text: "处理中" } }]
        }
      }
    });
    expect(history.hasMore).toBe(true);
    expect(history.cursor).toBe(4);
    expect(history.events.map((entry) => entry.event.type)).toEqual(["user/message", "assistant/chunk"]);
  });

  it("uses official model selection and staged file upload protocols", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/") {
        return new Response(null, {
          status: 303,
          headers: { location: "/", "set-cookie": "dsh-auth-test=session-cookie; Path=/; HttpOnly" }
        });
      }
      if (url.pathname === "/api/session/uploadFileBinary") {
        expect(url.searchParams.get("sessionId")).toBe("session-1");
        expect(url.searchParams.get("name")).toBe("research.csv");
        expect(new Headers(init?.headers).get("cookie")).toBe("dsh-auth-test=session-cookie");
        expect(init?.body).toBeInstanceOf(Uint8Array);
        return new Response(JSON.stringify({
          ok: true,
          value: { receiptId: "receipt-1", file: { attachmentId: "sha256:test", name: "research.csv", bytes: 4 } }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      const request = JSON.parse(String(init?.body));
      if (request.method === "session/modelCatalog") {
        expect(request.payload.args).toEqual({});
        return new Response(JSON.stringify({
          type: "server-response",
          rpcId: request.rpcId,
          result: { ok: true, value: { default: { provider: "stockchoose-relay", model: "gpt-5.5" }, groups: [] } }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(request.method).toBe("session/selectModel");
      expect(request.payload.args.request).toMatchObject({ sessionId: "session-1", model: "gpt-5.6-luna" });
      return new Response(JSON.stringify({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { selected: request.payload.args.request } }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const gateway = new OfficialDshGateway({ startUrl, fetchImpl: fetchMock });
    await expect(gateway.modelCatalog()).resolves.toMatchObject({ default: { model: "gpt-5.5" } });
    await expect(gateway.selectModel("session-1", { provider: "stockchoose-relay", model: "gpt-5.6-luna" })).resolves.toMatchObject({ selected: { model: "gpt-5.6-luna" } });
    await expect(gateway.uploadFile("session-1", new Uint8Array([1, 2, 3, 4]), "research.csv")).resolves.toMatchObject({ receiptId: "receipt-1" });
  });
});
