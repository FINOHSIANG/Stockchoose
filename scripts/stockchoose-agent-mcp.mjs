#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createStockChooseAgentClient } from "./stockchoose-agent-client.mjs";

const client = createStockChooseAgentClient();
const server = new McpServer({ name: "stockchoose-agent-tools", version: "0.1.0" });

function result(value) {
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value : { value }
  };
}

function toolError(error) {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const workspaceWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const stockCode = z.string().regex(/^(?:sh|sz|bj)?\d{6}$/iu);

async function workspaceResult(type, payload) {
  const response = await client.workspaceAction(type, payload);
  if (!response?.completed || response?.action?.status !== "completed") {
    throw new Error(response?.action?.message || "STOCKCHOOSE workspace did not confirm the action");
  }
  return result(response.action);
}

server.registerTool("stockchoose_sync_status", {
  description: "读取 STOCKCHOOSE 数据同步状态、最近运行、缓存快照和数据源健康度。",
  inputSchema: {},
  annotations: readOnly
}, async () => {
  try { return result(await client.status()); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_market_overview", {
  description: "读取当前 A 股市场概览。结果来自 STOCKCHOOSE Bun 数据服务，不由模型估算。",
  inputSchema: {},
  annotations: readOnly
}, async () => {
  try { return result(await client.marketOverview()); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_market_quotes", {
  description: "按股票代码读取腾讯真实行情。最多一次查询 50 个代码。",
  inputSchema: { symbols: z.array(stockCode).min(1).max(50) },
  annotations: readOnly
}, async ({ symbols }) => {
  try { return result(await client.quotes(symbols)); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_stock_profile", {
  description: "读取一只 A 股的公司资料、行业和可用真实数据字段。",
  inputSchema: {
    code: stockCode,
    name: z.string().max(80).optional(),
    industry1: z.string().max(80).optional(),
    industry2: z.string().max(80).optional(),
    forceRefresh: z.boolean().optional()
  },
  annotations: readOnly
}, async (args) => {
  try { return result(await client.stockProfile(args)); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_finance_statements", {
  description: "读取指定 A 股的真实财务报表数据。",
  inputSchema: { code: stockCode },
  annotations: readOnly
}, async ({ code }) => {
  try { return result(await client.financeStatements(code)); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_filing_announcements", {
  description: "读取指定股票的公司公告。最多 20 只股票、返回最多 50 条。",
  inputSchema: {
    codes: z.array(stockCode).min(1).max(20),
    maxItems: z.number().int().min(1).max(50).optional()
  },
  annotations: readOnly
}, async ({ codes, maxItems }) => {
  try { return result(await client.announcements(codes, maxItems)); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_create_strategy", {
  description: "Create and save a new strategy in the active STOCKCHOOSE workspace. Use only when the user explicitly asks to add a strategy.",
  inputSchema: {
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    poolId: z.string().trim().max(128).optional(),
    addToHoldings: z.boolean().optional()
  },
  annotations: workspaceWrite
}, async (args) => {
  try { return await workspaceResult("create-strategy", args); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_create_stock_pool", {
  description: "Create a static stock pool in the active STOCKCHOOSE workspace and optionally select it for the current strategy.",
  inputSchema: {
    name: z.string().trim().min(1).max(80),
    codes: z.array(stockCode).min(1).max(100),
    select: z.boolean().optional()
  },
  annotations: workspaceWrite
}, async (args) => {
  try { return await workspaceResult("create-stock-pool", args); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_create_custom_factor", {
  description: "Create a custom factor formula in the active STOCKCHOOSE workspace. Formula characters are restricted by the strategy engine.",
  inputSchema: {
    name: z.string().trim().min(1).max(80),
    formula: z.string().trim().min(1).max(500)
  },
  annotations: workspaceWrite
}, async (args) => {
  try { return await workspaceResult("create-custom-factor", args); } catch (error) { return toolError(error); }
});

server.registerTool("stockchoose_open_section", {
  description: "Open a STOCKCHOOSE workspace section for the user.",
  inputSchema: {
    section: z.enum(["dashboard", "strategy", "trade", "sentiment", "valuation", "settings"])
  },
  annotations: workspaceWrite
}, async (args) => {
  try { return await workspaceResult("open-section", args); } catch (error) { return toolError(error); }
});

await server.connect(new StdioServerTransport());
