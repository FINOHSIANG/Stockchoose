# ADR 0002: Agent 工作台采用官方 DSH 单运行时与 STOCKCHOOSE MCP 工具层

## 状态

Accepted，2026-09-25。

## 背景

STOCKCHOOSE 已有 React renderer、Electron 本地代理和 Bun sidecar。股票行情、财务、公告、同步等事实能力集中在 Bun API。

Agent 功能需要会话、模型、权限、工具调用、历史和取消能力。参考 `zuohuadong/volt-gui` 的 `origin/dev` 提交 `08a09f86109d5e92d65a848bd712fc0ef8dc0146` 后，确认其当前产品边界是 Node 26 + Electron + 官方 DeepSeek Harness（DSH）：官方 DSH 是唯一 Harness，桌面应用不维护第二套 Agent 引擎。

如果 STOCKCHOOSE 在 Bun 中另建 `AgentOrchestrator`、`RunStore` 和模型凭据体系，会形成双会话、双权限、双持久化和双升级边界，长期无法与官方 DSH 能力保持一致。

## 决策

1. 官方 `@deepseek-ai/dsh` 是唯一 Agent 运行时，拥有会话、模型、权限、工具选择和持久化。
2. STOCKCHOOSE Bun sidecar 保持领域服务职责，不实现第二套 Agent 编排器。
3. 股票能力通过官方 DSH MCP client 注册的 stdio MCP Server 暴露。
4. Bun 提供薄 DSH 网关，将官方会话 RPC/事件映射为 `/api/agent/*`。
5. MCP 工具使用显式只读白名单、结构化输入、数量上限、响应上限和 loopback 限制。
6. Electron 生成 Bun sidecar 实例 token，并通过权限受限认证文件提供给 MCP；秘密不进入 profile 或命令参数。
7. 当前阶段不修改前端。后续右侧 Agent 工作栏只消费网关 API，不拥有会话或编排状态。
8. V1 不注册纸面交易或真实交易提交工具。

## 理由

- 与 Volt GUI 当前官方 DSH 架构保持一致，避免复制已由 DSH 提供的能力。
- STOCKCHOOSE 只维护自己的差异化价值：股票领域事实、数据质量和研究工具。
- MCP 是官方 DSH 的原生扩展边界，工具 schema、权限提示和取消语义更稳定。
- 会话、模型和凭据只有一个事实源，升级和故障定位更清晰。
- Agent 未配置或不可用时，现有股票应用仍可独立运行。

## 被否决的方案

### Bun 自建完整 Agent 编排器

否决原因：与官方 DSH 重复实现会话、状态机、持久化、模型配置和权限，形成第二套运行时。

### Renderer 直接调用模型或 MCP

否决原因：扩大凭据和权限暴露面，页面生命周期也不适合拥有 Agent 会话。

### 将 STOCKCHOOSE 业务逻辑复制进 DSH 插件

否决原因：会造成股票领域实现和数据缓存分叉。DSH 工具应调用现有 Bun API，而不是复制服务。

### 模型自由访问任意 URL、文件或代码

否决原因：无法满足 SSRF、防越权、可审计和金融数据真实性要求。

## 影响

### 正向影响

- 不维护第二套 Agent 引擎。
- 官方 DSH 升级可通过明确的 RPC/MCP 契约测试验证。
- 股票工具可独立测试，并继续复用 Bun 的缓存、出站安全和数据契约。
- Agent 故障与现有 STOCKCHOOSE 功能隔离。

### 负向影响

- 产品运行依赖外部或随包分发的官方 DSH 和 Node 26。
- DSH RPC/event schema 升级需要同步适配网关。
- 完整桌面体验仍需实现 DSH 子进程 staging、启动、停止和安装包 smoke。
- 当前阶段没有前端 Agent 入口。

## 安全约束

- DSH 启动 URL 必须是 `127.0.0.1`、HTTP、唯一 token、无额外查询参数。
- STOCKCHOOSE MCP 客户端只允许无凭据的 HTTP loopback URL。
- profile、日志和错误中不得记录 sidecar token、模型凭据或 DSH 启动 token。
- 工具结果属于不可信数据，不得改变系统约束或扩大权限。
- Agent 不得假设未由工具提供的当前行情。
- 交易提交工具保持未注册。

## 后续决策

Electron 自动管理官方 DSH 生命周期、Node 26 staging 和安装包布局属于下一阶段实现，但必须继续遵守本 ADR 的“唯一官方 DSH 运行时”约束。

## 回滚

不设置 `STOCKCHOOSE_DSH_START_URL` 即可停用 Agent 网关。移除 MCP profile 插入项不会影响 Bun 数据服务；现有股票功能不依赖 DSH 才能启动。
