import { expect, test, type Page } from "@playwright/test";

interface AgentMockState {
  promptBodies: Array<Record<string, unknown>>;
  selectedModels: Array<Record<string, unknown>>;
  uploadCount: number;
}

const agentMockStates = new WeakMap<Page, AgentMockState>();

async function installAgentMocks(page: Page) {
  const state: AgentMockState = { promptBodies: [], selectedModels: [], uploadCount: 0 };
  let running = false;
  let events: Array<{ event: Record<string, unknown> }> = [
    { event: { type: "user/message", seq: 1, data: { text: "分析当前市场" } } },
    { event: { type: "assistant/chunk", seq: 2, data: { chunk: { type: "text-delta", text: "市场" } } } },
    { event: { type: "assistant/chunk", seq: 3, data: { chunk: { type: "text-delta", text: "分析已就绪。" } } } }
  ];

  await page.route("**/api/agent/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/agent/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configured: true, connected: true, available: true, runtime: "official-dsh", sessionCount: 1 })
      });
      return;
    }

    if (path === "/api/agent/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          engine: "official-dsh",
          default: { provider: "stockchoose-relay", model: "gpt-5.5" },
          groups: [{
            id: "stockchoose-relay",
            name: "STOCKCHOOSE CliRelay",
            models: [
              { id: "gpt-5.5", name: "GPT 5.5" },
              { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" }
            ]
          }]
        })
      });
      return;
    }

    if (path === "/api/agent/workspace/actions" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", items: [] })
      });
      return;
    }

    if (path === "/api/agent/workspace/owner" && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", active: true, expiresAt: Date.now() + 120_000 })
      });
      return;
    }

    if (path === "/api/agent/sessions" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", items: [{ sessionId: "session-1", updatedAt: Date.now(), running }] })
      });
      return;
    }

    if (path === "/api/agent/sessions" && request.method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", sessionId: "session-2" })
      });
      return;
    }

    if (path.endsWith("/history")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", sessionId: "session-1", events, hasMore: false, cursor: events.length })
      });
      return;
    }

    if (path.endsWith("/model")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.selectedModels.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", sessionId: "session-1", selected: body })
      });
      return;
    }

    if (path.endsWith("/files")) {
      state.uploadCount += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          engine: "official-dsh",
          sessionId: "session-1",
          receiptId: `receipt-${state.uploadCount}`,
          file: { attachmentId: `sha256:test-${state.uploadCount}`, name: "research.csv", bytes: 12 }
        })
      });
      return;
    }

    if (path.endsWith("/prompt")) {
      const body = request.postDataJSON() as { text?: string } & Record<string, unknown>;
      state.promptBodies.push(body);
      const nextSeq = events.length + 1;
      events = [
        ...events,
        { event: { type: "user/message", seq: nextSeq, data: { text: body.text ?? "" } } },
        { event: { type: "assistant/message", seq: nextSeq + 1, data: { text: "已收到，正在结合工作区数据分析。" } } }
      ];
      running = false;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", sessionId: "session-1", accepted: true })
      });
      return;
    }

    if (path.endsWith("/cancel")) {
      running = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "official-dsh", sessionId: "session-1", accepted: true })
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "not found" }) });
  });
  return state;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("stockchoose.agentDock.testInitialized") !== "true") {
      window.localStorage.removeItem("stockchoose.agentDock.expanded.v1");
      window.sessionStorage.setItem("stockchoose.agentDock.testInitialized", "true");
    }
  });
  agentMockStates.set(page, await installAgentMocks(page));
});

test("Agent 对话框固定在右侧并可收回展开", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  const dock = page.getByTestId("agent-dock");
  await expect(dock).toHaveAttribute("data-expanded", "true");
  await expect(page.getByTestId("agent-message-list")).toContainText("市场分析已就绪。");

  const expandedDockBox = await dock.boundingBox();
  const navBox = await page.locator(".primary-nav").boundingBox();
  expect(expandedDockBox?.width).toBeGreaterThanOrEqual(340);
  expect((expandedDockBox?.x ?? 0) + (expandedDockBox?.width ?? 0)).toBeCloseTo(1280, 0);
  expect(navBox?.x).toBe(0);
  expect(navBox?.width).toBeLessThanOrEqual((expandedDockBox?.x ?? 1280) + 1);

  await page.getByTestId("agent-dock-collapse").click();
  await expect(dock).toHaveAttribute("data-expanded", "false");
  await expect.poll(async () => (await dock.boundingBox())?.width ?? 999).toBeLessThanOrEqual(60);

  await page.reload();
  await expect(dock).toHaveAttribute("data-expanded", "false");
  await page.getByTestId("agent-dock-expand").click();
  await expect(dock).toHaveAttribute("data-expanded", "true");

  await page.getByLabel("发送给 Agent 的消息").fill("总结当前策略风险");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTestId("agent-message-list")).toContainText("总结当前策略风险");
  await expect(page.getByTestId("agent-message-list")).toContainText("已收到，正在结合工作区数据分析。", { timeout: 5_000 });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("移动端使用右侧覆盖抽屉且无横向溢出", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const dock = page.getByTestId("agent-dock");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  await page.getByTestId("agent-dock-expand").click();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  await expect(page.getByRole("button", { name: "关闭 Agent 对话框" })).toBeVisible();

  const dockBox = await dock.boundingBox();
  expect(dockBox?.width).toBeLessThanOrEqual(370);
  expect((dockBox?.x ?? 0) + (dockBox?.width ?? 0)).toBeCloseTo(390, 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  expect(pageErrors).toEqual([]);
});

test("Agent 对话框可选择模型并把上传文件收据发送给 DSH", async ({ page }) => {
  await page.goto("/");
  const state = agentMockStates.get(page);
  expect(state).toBeDefined();

  const modelSelect = page.getByLabel("选择 Agent 模型");
  await expect(modelSelect).toContainText("GPT 5.5");
  await modelSelect.click();
  await page.getByRole("menuitem", { name: /GPT 5\.6 Luna/ }).click();
  await expect(modelSelect).toContainText("GPT 5.6 Luna");
  await expect.poll(() => state?.selectedModels.at(-1)).toMatchObject({ provider: "stockchoose-relay", model: "gpt-5.6-luna" });

  await page.getByTestId("agent-file-input").setInputFiles({
    name: "research.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("code,score\n600519,92")
  });
  await expect(page.getByLabel("待发送文件")).toContainText("research.csv");
  await expect(page.getByLabel("待发送文件")).toContainText("12 B");

  await page.getByLabel("发送给 Agent 的消息").fill("分析这个文件");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state?.promptBodies.length).toBe(1);
  expect(state?.promptBodies[0]).toMatchObject({
    text: "分析这个文件",
    model: { provider: "stockchoose-relay", model: "gpt-5.6-luna" },
    attachmentReceiptIds: ["receipt-1"]
  });
  await expect(page.getByLabel("待发送文件")).toHaveCount(0);
});

test("Agent 展开时选股指标明细不会挤压或覆盖选股条件", async ({ page }) => {
  await page.goto("/");
  await page.locator(".primary-nav button").filter({ hasText: "策略" }).click();

  const factorPanel = page.locator(".factor-panel");
  const conditionPanel = page.locator(".condition-panel");
  const detailGrid = page.locator(".factor-detail-grid");

  await expect(detailGrid).toBeVisible();
  await expect.poll(async () => factorPanel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(async () => page.locator(".factor-panel > .tabs").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(async () => detailGrid.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  const factorBox = await factorPanel.boundingBox();
  const conditionBox = await conditionPanel.boundingBox();
  expect(factorBox).not.toBeNull();
  expect(conditionBox).not.toBeNull();
  const separatedHorizontally = (factorBox?.x ?? 0) + (factorBox?.width ?? 0) <= (conditionBox?.x ?? 0) + 1;
  const separatedVertically = (factorBox?.y ?? 0) + (factorBox?.height ?? 0) <= (conditionBox?.y ?? 0) + 1;
  expect(separatedHorizontally || separatedVertically).toBe(true);

  await detailGrid.getByRole("button").first().click();
  const conditionTable = conditionPanel.locator(".condition-table");
  await expect(conditionTable).toBeVisible();
  await expect.poll(async () => conditionPanel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(async () => conditionTable.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});
