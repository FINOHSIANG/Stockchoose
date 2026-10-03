export type AgentRuntime = "official-dsh";

export interface AgentStatus {
  configured: boolean;
  connected: boolean;
  available: boolean;
  runtime: AgentRuntime;
  origin?: string;
  sessionCount?: number;
}

export interface AgentSessionSummary {
  sessionId: string;
  updatedAt?: number;
  running?: boolean;
  blank?: boolean;
  cwd?: string;
  agentPreset?: string;
}

export interface AgentHistoryEvent {
  event: Record<string, unknown>;
}

export interface AgentHistoryResponse {
  engine: AgentRuntime;
  sessionId: string;
  events: AgentHistoryEvent[];
  hasMore: boolean;
  cursor: number;
}

export interface AgentPromptContext {
  section?: string;
  stockCodes?: string[];
  strategyId?: string;
  poolId?: string;
  datasetId?: string;
  snapshotAt?: string;
}

export interface AgentModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface AgentModelCatalogModel {
  id: string;
  name: string;
  description?: string;
}

export interface AgentModelProviderGroup {
  id: string;
  name: string;
  models: AgentModelCatalogModel[];
}

export interface AgentModelCatalog {
  engine: AgentRuntime;
  default: AgentModelSelection;
  groups: AgentModelProviderGroup[];
}

export interface AgentUploadedFile {
  receiptId: string;
  file: {
    attachmentId: string;
    name: string;
    bytes: number;
  };
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
}

export type AgentWorkspaceActionType = "create-strategy" | "create-stock-pool" | "create-custom-factor" | "open-section";

export interface AgentWorkspaceAction {
  id: string;
  type: AgentWorkspaceActionType;
  payload: Record<string, unknown>;
  status: "pending" | "claimed" | "completed" | "failed";
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  message?: string;
  result?: Record<string, unknown>;
}
