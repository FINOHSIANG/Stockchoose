import { expect, test } from "@playwright/test";

test("Agent workspace actions create strategy resources and open another section", async ({ page }) => {
  const pending = [
    {
      id: "action-strategy",
      type: "create-strategy",
      payload: { name: "Agent Quality Strategy", description: "Created from Agent", poolId: "all", addToHoldings: true },
      status: "claimed",
      createdAt: new Date().toISOString()
    },
    {
      id: "action-pool",
      type: "create-stock-pool",
      payload: { name: "Agent Core Pool", codes: ["600519", "000001"], select: true },
      status: "claimed",
      createdAt: new Date().toISOString()
    },
    {
      id: "action-factor",
      type: "create-custom-factor",
      payload: { name: "Agent Growth Factor", formula: "revenueGrowth * 0.6 + roe * 0.4" },
      status: "claimed",
      createdAt: new Date().toISOString()
    },
    {
      id: "action-section",
      type: "open-section",
      payload: { section: "valuation" },
      status: "claimed",
      createdAt: new Date().toISOString()
    }
  ];
  const results: Array<{ id: string; body: Record<string, unknown> }> = [];
  const pageErrors: string[] = [];
  let claimRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/agent/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/agent/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: false, connected: false, available: false, runtime: "official-dsh" }) });
      return;
    }
    if (path === "/api/agent/workspace/owner" && request.method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", active: true, expiresAt: Date.now() + 120_000 }) });
      return;
    }
    if (path === "/api/agent/workspace/actions" && request.method() === "GET") {
      claimRequests += 1;
      const items = pending.splice(0);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", items }) });
      return;
    }
    const resultMatch = path.match(/^\/api\/agent\/workspace\/actions\/([^/]+)\/result$/u);
    if (resultMatch && request.method() === "POST") {
      results.push({ id: resultMatch[1], body: request.postDataJSON() as Record<string, unknown> });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", action: { id: resultMatch[1], status: "completed" } }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "not found" }) });
  });

  await page.goto("/");
  await expect.poll(() => claimRequests).toBeGreaterThan(0);
  await expect.poll(() => results.length).toBe(4);
  expect(pageErrors).toEqual([]);
  expect(results.every((item) => item.body.ok === true)).toBe(true);
  await expect(page.locator(".app-shell")).toHaveAttribute("data-section", "valuation");

  const stored = await page.evaluate(() => ({
    strategies: JSON.parse(localStorage.getItem("stockchoose:savedStrategies") || "[]"),
    holdings: JSON.parse(localStorage.getItem("stockchoose:holdingStrategies") || "[]"),
    pools: JSON.parse(localStorage.getItem("stockchoose:customPools") || "[]"),
    factors: JSON.parse(localStorage.getItem("stockchoose:customFactors") || "[]"),
    draft: JSON.parse(localStorage.getItem("stockchoose:draftStrategy") || "{}")
  }));

  expect(stored.strategies).toEqual([expect.objectContaining({ name: "Agent Quality Strategy" })]);
  expect(stored.holdings).toEqual([expect.objectContaining({ name: "Agent Quality Strategy" })]);
  expect(stored.pools).toEqual([expect.objectContaining({ name: "Agent Core Pool", codes: ["600519", "000001"] })]);
  expect(stored.factors).toEqual([expect.objectContaining({ name: "Agent Growth Factor", formula: "revenueGrowth * 0.6 + roe * 0.4" })]);
  expect(stored.draft.poolId).toBe(stored.pools[0].id);
});

test("Agent workspace actions stay with the tab that sent the prompt and sync to other tabs", async ({ context }) => {
  const backgroundPage = await context.newPage();
  const activePage = await context.newPage();
  const actionResults: Array<{ page: string; id: string }> = [];
  const claimPagesAfterPrompt: string[] = [];
  const pending: Array<Record<string, unknown>> = [];
  let promptAccepted = false;
  let sessionCounter = 0;
  const pageName = (page: import("@playwright/test").Page) => page === activePage ? "active" : "background";

  await context.route("**/api/agent/**", async (route) => {
    const request = route.request();
    const requestPage = request.frame().page();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/agent/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, connected: true, available: true, runtime: "official-dsh" }) });
      return;
    }
    if (path === "/api/agent/workspace/owner" && request.method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", active: true, expiresAt: Date.now() + 120_000 }) });
      return;
    }
    if (path === "/api/agent/sessions" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", items: [] }) });
      return;
    }
    if (path === "/api/agent/sessions" && request.method() === "POST") {
      sessionCounter += 1;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", sessionId: `session-${sessionCounter}` }) });
      return;
    }
    if (/^\/api\/agent\/sessions\/[^/]+\/history$/u.test(path)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", events: [], hasMore: false, cursor: 0 }) });
      return;
    }
    if (/^\/api\/agent\/sessions\/[^/]+\/prompt$/u.test(path) && request.method() === "POST") {
      promptAccepted = true;
      pending.push(
        {
          id: "owned-action-strategy",
          type: "create-strategy",
          payload: { name: "Owned Tab Strategy", description: "Created in the prompt tab", addToHoldings: true },
          status: "claimed",
          createdAt: new Date().toISOString()
        },
        {
          id: "owned-action-section",
          type: "open-section",
          payload: { section: "valuation" },
          status: "claimed",
          createdAt: new Date().toISOString()
        }
      );
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", sessionId: "session-2", accepted: true }) });
      return;
    }
    if (path === "/api/agent/workspace/actions" && request.method() === "GET") {
      if (promptAccepted) claimPagesAfterPrompt.push(pageName(requestPage));
      const items = pending.splice(0);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", items }) });
      return;
    }
    const resultMatch = path.match(/^\/api\/agent\/workspace\/actions\/([^/]+)\/result$/u);
    if (resultMatch && request.method() === "POST") {
      actionResults.push({ page: pageName(requestPage), id: resultMatch[1] });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ engine: "official-dsh", action: { id: resultMatch[1], status: "completed" } }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "not found" }) });
  });

  await backgroundPage.goto("/");
  await activePage.goto("/");
  if (await activePage.getByTestId("agent-dock").getAttribute("data-expanded") !== "true") {
    await activePage.getByTestId("agent-dock-expand").click();
  }
  await activePage.getByRole("button", { name: "新建 Agent 会话" }).click();
  await activePage.getByLabel("发送给 Agent 的消息").fill("创建策略并打开估值板块");
  await activePage.getByRole("button", { name: "发送", exact: true }).click();

  await expect.poll(() => actionResults.length).toBe(2);
  await activePage.waitForTimeout(700);
  expect(actionResults.every((item) => item.page === "active")).toBe(true);
  expect(claimPagesAfterPrompt.length).toBeGreaterThan(0);
  expect(claimPagesAfterPrompt.every((name) => name === "active")).toBe(true);
  await expect(activePage.locator(".app-shell")).toHaveAttribute("data-section", "valuation");

  await backgroundPage.locator(".primary-nav button").filter({ hasText: "策略" }).click();
  await expect(backgroundPage.locator(".strategy-manager")).toContainText("Owned Tab Strategy");
});
