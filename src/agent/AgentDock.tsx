import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  Cpu,
  FileText,
  MessageSquare,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Send,
  Square,
  X
} from "lucide-react";
import {
  cancelAgentSession,
  claimAgentWorkspaceActions,
  completeAgentWorkspaceAction,
  createAgentSession,
  getAgentHistory,
  getAgentModels,
  getAgentStatus,
  listAgentSessions,
  parseAgentHistoryEvents,
  promptAgentSession,
  selectAgentModel,
  setAgentWorkspaceActionOwner,
  uploadAgentFile
} from "./agentService";
import type { AgentMessage, AgentModelSelection, AgentPromptContext, AgentSessionSummary, AgentStatus, AgentWorkspaceAction } from "./agentTypes";
import "./agentDock.css";

interface AgentDockProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  context: AgentPromptContext;
  onWorkspaceAction: (action: AgentWorkspaceAction) => Promise<{ message: string; result?: Record<string, unknown> }> | { message: string; result?: Record<string, unknown> };
}

const WORKSPACE_ACTION_CLIENT_KEY = "stockchoose:agentWorkspaceActionClientId";
const WORKSPACE_ACTION_OWNER_KEY = "stockchoose:agentWorkspaceActionOwner";
const WORKSPACE_ACTION_OWNER_TTL_MS = 2 * 60_000;
const MAX_AGENT_ATTACHMENTS = 4;
const MAX_AGENT_FILE_BYTES = 8 * 1024 * 1024;

interface AgentComposerAttachment {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  receiptId?: string;
  error?: string;
}

interface AgentModelOption extends AgentModelSelection {
  name: string;
  providerName: string;
}

interface WorkspaceActionOwner {
  clientId: string;
  expiresAt: number;
}

function workspaceActionClientId() {
  try {
    const existing = window.sessionStorage.getItem(WORKSPACE_ACTION_CLIENT_KEY);
    if (existing) return existing;
    const next = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `agent-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(WORKSPACE_ACTION_CLIENT_KEY, next);
    return next;
  } catch {
    return `agent-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function readWorkspaceActionOwner(): WorkspaceActionOwner | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_ACTION_OWNER_KEY);
    if (!raw) return null;
    const owner = JSON.parse(raw) as Partial<WorkspaceActionOwner>;
    if (typeof owner.clientId !== "string" || !Number.isFinite(owner.expiresAt)) return null;
    if (Number(owner.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(WORKSPACE_ACTION_OWNER_KEY);
      return null;
    }
    return { clientId: owner.clientId, expiresAt: Number(owner.expiresAt) };
  } catch {
    return null;
  }
}

function claimWorkspaceActionOwnership(clientId: string) {
  try {
    window.localStorage.setItem(WORKSPACE_ACTION_OWNER_KEY, JSON.stringify({
      clientId,
      expiresAt: Date.now() + WORKSPACE_ACTION_OWNER_TTL_MS
    } satisfies WorkspaceActionOwner));
  } catch {
    // The visible-tab fallback below still prevents background tabs from taking work.
  }
}

function releaseWorkspaceActionOwnership(clientId: string) {
  try {
    if (readWorkspaceActionOwner()?.clientId === clientId) {
      window.localStorage.removeItem(WORKSPACE_ACTION_OWNER_KEY);
    }
  } catch {
    // Ignore storage cleanup failures during navigation.
  }
}

function canClaimWorkspaceActions(clientId: string) {
  const owner = readWorkspaceActionOwner();
  if (owner) return owner.clientId === clientId;
  return document.visibilityState !== "hidden";
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Agent 服务暂时不可用";
}

function sortSessions(items: AgentSessionSummary[]) {
  return [...items].sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
}

function sessionLabel(session: AgentSessionSummary) {
  const shortId = session.sessionId.length > 16 ? `${session.sessionId.slice(0, 8)}…${session.sessionId.slice(-5)}` : session.sessionId;
  if (!session.updatedAt) return `会话 ${shortId}`;
  const milliseconds = session.updatedAt < 10_000_000_000 ? session.updatedAt * 1000 : session.updatedAt;
  const updatedAt = new Date(milliseconds);
  const time = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return time ? `${time} · ${shortId}` : `会话 ${shortId}`;
}

function statusView(status: AgentStatus | null, loading: boolean) {
  if (loading && !status) return { tone: "loading", label: "正在连接" };
  if (!status) return { tone: "offline", label: "连接失败" };
  if (!status.configured) return { tone: "offline", label: "未配置" };
  if (status.available && status.connected) return { tone: "online", label: "已连接" };
  return { tone: "offline", label: "运行时离线" };
}

function modelValue(selection: AgentModelSelection) {
  return `${encodeURIComponent(selection.provider)}|${encodeURIComponent(selection.model)}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentDock({ expanded, onExpandedChange, context, onWorkspaceAction }: AgentDockProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<AgentModelSelection | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [attachments, setAttachments] = useState<AgentComposerAttachment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const activeSessionIdRef = useRef(activeSessionId);
  const workspaceActionHandlerRef = useRef(onWorkspaceAction);
  const workspaceActionClientIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  if (!workspaceActionClientIdRef.current) workspaceActionClientIdRef.current = workspaceActionClientId();
  activeSessionIdRef.current = activeSessionId;
  workspaceActionHandlerRef.current = onWorkspaceAction;

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const selectedModelOption = useMemo(
    () => selectedModel ? modelOptions.find((option) => modelValue(option) === modelValue(selectedModel)) ?? null : null,
    [modelOptions, selectedModel]
  );
  const connection = statusView(status, loading);

  const loadHistory = useCallback(async (sessionId: string, showLoading = false) => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    if (showLoading) setHistoryLoading(true);
    try {
      const history = await getAgentHistory(sessionId);
      if (activeSessionIdRef.current === sessionId) setMessages(parseAgentHistoryEvents(history.events));
    } catch (historyError) {
      if (activeSessionIdRef.current === sessionId) setError(errorMessage(historyError));
    } finally {
      if (showLoading) setHistoryLoading(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let nextStatus: AgentStatus;
      try {
        nextStatus = await getAgentStatus(true);
      } catch (probeError) {
        nextStatus = await getAgentStatus(false);
        if (nextStatus.configured) setError(errorMessage(probeError));
      }
      setStatus(nextStatus);
      if (!nextStatus.available) {
        setSessions([]);
        setActiveSessionId("");
        setMessages([]);
        return "";
      }

      const response = await listAgentSessions();
      const nextSessions = sortSessions(response.items);
      const currentId = activeSessionIdRef.current;
      const nextId = nextSessions.some((session) => session.sessionId === currentId)
        ? currentId
        : nextSessions[0]?.sessionId ?? "";
      setSessions(nextSessions);
      setActiveSessionId(nextId);
      if (!nextId) setMessages([]);
      return nextId;
    } catch (bootstrapError) {
      setStatus(null);
      setSessions([]);
      setActiveSessionId("");
      setMessages([]);
      setError(errorMessage(bootstrapError));
      return "";
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void bootstrap().then((sessionId) => {
      if (active && sessionId) void loadHistory(sessionId, true);
    });
    return () => {
      active = false;
    };
  }, [bootstrap, loadHistory]);

  useEffect(() => {
    if (!status?.available) {
      setModelOptions([]);
      setSelectedModel(null);
      return;
    }
    let active = true;
    setModelsLoading(true);
    void getAgentModels()
      .then((catalog) => {
        if (!active) return;
        const options = catalog.groups.flatMap((group) => group.models.map((model) => ({
          provider: group.id,
          model: model.id,
          name: model.name,
          providerName: group.name
        })));
        setModelOptions(options);
        setSelectedModel((current) => current && options.some((option) => modelValue(option) === modelValue(current))
          ? current
          : catalog.default);
      })
      .catch((modelError) => {
        if (active) setError(errorMessage(modelError));
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status?.available]);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadHistory(activeSessionId, true);
  }, [activeSessionId, loadHistory]);

  useEffect(() => {
    if (!expanded || !status?.available || !activeSessionId) return;
    const timer = window.setInterval(() => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      void Promise.all([listAgentSessions(), getAgentHistory(sessionId)])
        .then(([sessionResponse, history]) => {
          setSessions(sortSessions(sessionResponse.items));
          if (activeSessionIdRef.current === sessionId) setMessages(parseAgentHistoryEvents(history.events));
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, expanded, status?.available]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, historyLoading]);

  useEffect(() => {
    let active = true;
    let polling = false;
    const poll = async () => {
      const clientId = workspaceActionClientIdRef.current;
      if (!active || polling || !clientId || !canClaimWorkspaceActions(clientId)) return;
      polling = true;
      try {
        const response = await claimAgentWorkspaceActions(5, clientId);
        for (const action of response.items) {
          if (!active) return;
          try {
            const outcome = await workspaceActionHandlerRef.current(action);
            await completeAgentWorkspaceAction(action.id, { ok: true, ...outcome });
          } catch (actionError) {
            await completeAgentWorkspaceAction(action.id, {
              ok: false,
              message: actionError instanceof Error ? actionError.message : String(actionError)
            });
          }
        }
      } catch {
        // The local action channel is optional until the Bun sidecar is ready.
      } finally {
        polling = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") void poll();
    };
    const handlePageHide = () => {
      const clientId = workspaceActionClientIdRef.current;
      if (clientId) {
        releaseWorkspaceActionOwnership(clientId);
        void setAgentWorkspaceActionOwner(clientId, false, true).catch(() => undefined);
      }
    };
    const firstPoll = window.setTimeout(() => void poll(), 100);
    const timer = window.setInterval(() => void poll(), 500);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      active = false;
      window.clearTimeout(firstPoll);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExpandedChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, onExpandedChange]);

  const handleCreateSession = async () => {
    if (!status?.available || creating) return null;
    setCreating(true);
    setError("");
    try {
      const created = await createAgentSession();
      const nextSession: AgentSessionSummary = {
        sessionId: created.sessionId,
        agentPreset: created.agentPreset,
        running: false,
        blank: true,
        updatedAt: Date.now()
      };
      setSessions((current) => sortSessions([nextSession, ...current.filter((item) => item.sessionId !== created.sessionId)]));
      setActiveSessionId(created.sessionId);
      setMessages([]);
      setAttachments([]);
      return created.sessionId;
    } catch (createError) {
      setError(errorMessage(createError));
      return null;
    } finally {
      setCreating(false);
    }
  };

  const handleRefresh = async () => {
    const sessionId = await bootstrap();
    if (sessionId) await loadHistory(sessionId, true);
  };

  const handleModelChange = async (value: string) => {
    const next = modelOptions.find((option) => modelValue(option) === value);
    if (!next) return;
    const previous = selectedModel;
    const selection = { provider: next.provider, model: next.model };
    setSelectedModel(selection);
    setError("");
    if (!activeSessionId) return;
    try {
      const result = await selectAgentModel(activeSessionId, selection);
      setSelectedModel(result.selected);
    } catch (modelError) {
      setSelectedModel(previous);
      setError(errorMessage(modelError));
    }
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length || !status?.available) return;
    const remaining = Math.max(0, MAX_AGENT_ATTACHMENTS - attachments.length);
    const selected = Array.from(files).slice(0, remaining);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (remaining === 0) {
      setError(`每次最多上传 ${MAX_AGENT_ATTACHMENTS} 个文件`);
      return;
    }
    const accepted = selected.filter((file) => file.size <= MAX_AGENT_FILE_BYTES);
    if (accepted.length !== selected.length || files.length > remaining) {
      setError(`最多上传 ${MAX_AGENT_ATTACHMENTS} 个文件，单个文件不能超过 8 MB`);
    } else {
      setError("");
    }
    if (!accepted.length) return;

    let sessionId = activeSessionId;
    if (!sessionId) sessionId = await handleCreateSession() ?? "";
    if (!sessionId) return;

    const pending = accepted.map((file) => ({
      file,
      item: {
        id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `file-${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        status: "uploading" as const
      }
    }));
    setAttachments((current) => [...current, ...pending.map(({ item }) => item)]);

    for (const { file, item } of pending) {
      try {
        const uploaded = await uploadAgentFile(sessionId, file);
        setAttachments((current) => current.map((attachment) => attachment.id === item.id
          ? { ...attachment, status: "ready", receiptId: uploaded.receiptId, name: uploaded.file.name, size: uploaded.file.bytes }
          : attachment));
      } catch (uploadError) {
        const message = errorMessage(uploadError);
        setAttachments((current) => current.map((attachment) => attachment.id === item.id
          ? { ...attachment, status: "error", error: message }
          : attachment));
        setError(message);
      }
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    const readyAttachments = attachments.filter((attachment) => attachment.status === "ready" && attachment.receiptId);
    const uploading = attachments.some((attachment) => attachment.status === "uploading");
    if ((!text && readyAttachments.length === 0) || uploading || !status?.available || sending || creating) return;
    let sessionId = activeSessionId;
    if (!sessionId) sessionId = await handleCreateSession() ?? "";
    if (!sessionId) return;

    setSending(true);
    setError("");
    setDraft("");
    const localText = [text, readyAttachments.length ? `附件：${readyAttachments.map((attachment) => attachment.name).join("、")}` : ""]
      .filter(Boolean)
      .join("\n");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", text: localText, createdAt: Date.now() }
    ]);
    setSessions((current) => current.map((session) => session.sessionId === sessionId ? { ...session, running: true } : session));
    const workspaceActionClientId = workspaceActionClientIdRef.current;
    try {
      if (workspaceActionClientId) {
        claimWorkspaceActionOwnership(workspaceActionClientId);
        await setAgentWorkspaceActionOwner(workspaceActionClientId, true);
      }
      await promptAgentSession(sessionId, text, context, {
        ...(selectedModel ? { model: selectedModel } : {}),
        attachmentReceiptIds: readyAttachments.map((attachment) => attachment.receiptId as string)
      });
      setAttachments([]);
    } catch (sendError) {
      if (workspaceActionClientId) {
        releaseWorkspaceActionOwnership(workspaceActionClientId);
        await setAgentWorkspaceActionOwner(workspaceActionClientId, false).catch(() => undefined);
      }
      setError(errorMessage(sendError));
      setDraft(text);
      setSessions((current) => current.map((session) => session.sessionId === sessionId ? { ...session, running: false } : session));
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    if (!activeSessionId || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      await cancelAgentSession(activeSessionId);
      setSessions((current) => current.map((session) => session.sessionId === activeSessionId ? { ...session, running: false } : session));
      await loadHistory(activeSessionId);
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      {expanded ? <button className="agent-dock-backdrop" type="button" aria-label="关闭 Agent 对话框" onClick={() => onExpandedChange(false)} /> : null}
      <aside
        className={`agent-dock ${expanded ? "expanded" : "collapsed"}`}
        aria-label="Agent 对话工作栏"
        data-testid="agent-dock"
        data-expanded={expanded ? "true" : "false"}
      >
        {expanded ? (
          <>
            <header className="agent-dock-header">
              <div className="agent-dock-identity">
                <span className="agent-dock-logo" aria-hidden="true"><Bot size={18} /></span>
                <span>
                  <strong>Agent 工作台</strong>
                  <small><i className={`agent-status-dot ${connection.tone}`} />{connection.label}</small>
                </span>
              </div>
              <div className="agent-dock-header-actions">
                <button type="button" title="刷新 Agent" aria-label="刷新 Agent" onClick={() => void handleRefresh()} disabled={loading}>
                  <RefreshCw size={16} className={loading ? "agent-spin" : ""} />
                </button>
                <button type="button" title="新建会话" aria-label="新建 Agent 会话" onClick={() => void handleCreateSession()} disabled={!status?.available || creating}>
                  <Plus size={17} />
                </button>
                <button type="button" title="收回工作栏" aria-label="收回 Agent 对话框" onClick={() => onExpandedChange(false)} data-testid="agent-dock-collapse">
                  <PanelRightClose size={17} />
                </button>
              </div>
            </header>

            <div className="agent-session-bar">
              <MessageSquare size={14} aria-hidden="true" />
              <details className={`agent-session-picker ${!status?.available || sessions.length === 0 ? "disabled" : ""}`}>
                <summary
                  aria-label="选择 Agent 会话"
                  onClick={(event) => {
                    if (!status?.available || sessions.length === 0) event.preventDefault();
                  }}
                >
                  <span>{activeSession ? sessionLabel(activeSession) : "暂无会话"}</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </summary>
                <div className="agent-session-menu" role="menu" aria-label="Agent 会话列表">
                  {sessions.map((session) => (
                    <button
                      type="button"
                      role="menuitem"
                      className={session.sessionId === activeSessionId ? "active" : ""}
                      key={session.sessionId}
                      onClick={(event) => {
                        setActiveSessionId(session.sessionId);
                        setAttachments([]);
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      <span>{sessionLabel(session)}</span>
                      {session.running ? <i>运行中</i> : null}
                    </button>
                  ))}
                </div>
              </details>
              {activeSession?.running ? <span className="agent-running-label">运行中</span> : null}
            </div>

            <div className="agent-message-list" aria-live="polite" data-testid="agent-message-list">
              {historyLoading ? <div className="agent-empty-state"><RefreshCw size={18} className="agent-spin" /><span>正在读取会话</span></div> : null}
              {!historyLoading && !status?.configured ? (
                <div className="agent-empty-state agent-offline-state">
                  <AlertCircle size={20} />
                  <strong>Agent 运行时未配置</strong>
                  <span>启动官方 DSH 运行时后，在本机连接配置中提供启动地址。</span>
                </div>
              ) : null}
              {!historyLoading && status?.configured && !status.available ? (
                <div className="agent-empty-state agent-offline-state">
                  <AlertCircle size={20} />
                  <strong>Agent 运行时离线</strong>
                  <span>检查官方 DSH 进程是否仍在运行，然后刷新连接。</span>
                </div>
              ) : null}
              {!historyLoading && status?.available && !activeSessionId ? (
                <div className="agent-empty-state">
                  <Bot size={22} />
                  <strong>开始新的研究会话</strong>
                  <span>新建会话后即可结合当前工作区提问。</span>
                  <button type="button" onClick={() => void handleCreateSession()} disabled={creating}><Plus size={15} />新建会话</button>
                </div>
              ) : null}
              {!historyLoading && activeSessionId && messages.length === 0 ? (
                <div className="agent-empty-state">
                  <Bot size={22} />
                  <strong>当前会话暂无消息</strong>
                  <span>可直接询问行情、财务、公告或当前策略。</span>
                </div>
              ) : null}
              {messages.map((message) => (
                <article className={`agent-message ${message.role}`} key={message.id}>
                  <span className="agent-message-role">{message.role === "user" ? "你" : "Agent"}</span>
                  <div>{message.text}</div>
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {error ? <div className="agent-error" role="status"><AlertCircle size={14} />{error}</div> : null}

            <footer className="agent-composer">
              <div className="agent-composer-toolbar">
                <details className={`agent-model-select ${!status?.available || modelsLoading || modelOptions.length === 0 || sending ? "disabled" : ""}`}>
                  <summary
                    aria-label="选择 Agent 模型"
                    onClick={(event) => {
                      if (!status?.available || modelsLoading || modelOptions.length === 0 || sending) event.preventDefault();
                    }}
                  >
                    <Cpu size={14} aria-hidden="true" />
                    <span>{selectedModelOption?.name ?? (modelsLoading ? "加载模型" : "无可用模型")}</span>
                    <ChevronDown size={13} aria-hidden="true" />
                  </summary>
                  <div className="agent-model-menu" role="menu" aria-label="Agent 模型列表">
                    {modelOptions.map((option) => (
                      <button
                        type="button"
                        role="menuitem"
                        className={selectedModel && modelValue(option) === modelValue(selectedModel) ? "active" : ""}
                        key={modelValue(option)}
                        onClick={(event) => {
                          void handleModelChange(modelValue(option));
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                      >
                        <span>{option.name}</span>
                        <small>{option.providerName}</small>
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  className="agent-attach-button"
                  type="button"
                  title="上传文件"
                  aria-label="上传文件"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!status?.available || creating || sending || attachments.length >= MAX_AGENT_ATTACHMENTS}
                >
                  <Paperclip size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  data-testid="agent-file-input"
                  className="agent-file-input"
                  type="file"
                  multiple
                  onChange={(event) => void handleFilesSelected(event.target.files)}
                />
              </div>
              {attachments.length ? (
                <div className="agent-attachment-list" aria-label="待发送文件">
                  {attachments.map((attachment) => (
                    <div className={`agent-attachment-item ${attachment.status}`} key={attachment.id} title={attachment.error || attachment.name}>
                      <FileText size={14} aria-hidden="true" />
                      <span><strong>{attachment.name}</strong><small>{attachment.status === "uploading" ? "上传中" : attachment.status === "error" ? "上传失败" : formatFileSize(attachment.size)}</small></span>
                      <button type="button" aria-label={`移除文件 ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                aria-label="发送给 Agent 的消息"
                placeholder={status?.available ? "输入研究问题，Enter 发送" : "Agent 连接后可发送消息"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={!status?.available || creating}
                rows={3}
              />
              <div className="agent-composer-actions">
                <span>Shift + Enter 换行</span>
                {activeSession?.running || sending ? (
                  <button className="agent-stop-button" type="button" onClick={() => void handleCancel()} disabled={cancelling}>
                    <Square size={13} />停止
                  </button>
                ) : (
                  <button className="agent-send-button" type="button" onClick={() => void handleSend()} disabled={(!draft.trim() && !attachments.some((attachment) => attachment.status === "ready")) || attachments.some((attachment) => attachment.status === "uploading") || !status?.available || sending || creating}>
                    <Send size={14} />发送
                  </button>
                )}
              </div>
            </footer>
          </>
        ) : (
          <div className="agent-dock-rail">
            <button type="button" title="展开 Agent 工作栏" aria-label="展开 Agent 对话框" onClick={() => onExpandedChange(true)} data-testid="agent-dock-expand">
              <PanelRightOpen size={18} />
            </button>
            <Bot size={20} aria-hidden="true" />
            <i className={`agent-status-dot ${connection.tone}`} aria-label={connection.label} />
            <span>Agent</span>
          </div>
        )}
      </aside>
    </>
  );
}
