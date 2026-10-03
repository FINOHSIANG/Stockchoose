# STOCKCHOOSE Agent / 官方 DSH 后端接入说明

**日期：** 2026-09-25

**阶段：** 外部 DSH runtime 联调，不含前端和安装包内置 runtime

## 1. 运行组件

- STOCKCHOOSE Bun API：股票领域事实和 `/api/agent/*` 网关。
- 官方 DeepSeek Harness：会话、模型、权限、历史和 MCP 管理。
- STOCKCHOOSE MCP Server：`scripts/stockchoose-agent-mcp.mjs`。
- DSH profile overlay：`agent/stockchoose-dsh-profile.yml`。

参考 Volt GUI `origin/dev` 的运行时契约：官方 DSH 使用 Node 26，Electron 或启动器以 loopback 随机端口启动 `dsh web`，通过 profile patch 注册产品工具。

## 2. 环境变量

| 变量 | 组件 | 必需 | 说明 |
|---|---|---:|---|
| `STOCKCHOOSE_DSH_START_URL` | Bun | 联调时是 | 官方 DSH 输出的完整启动 URL，例如 `http://127.0.0.1:43123/?token=...` |
| `STOCKCHOOSE_AGENT_WORKSPACE` | Bun | 否 | 创建 DSH 会话时使用的工作区，默认当前目录 |
| `STOCKCHOOSE_BUN_API_URL` | MCP | 否 | Bun loopback 地址，默认 `http://127.0.0.1:18082` |
| `STOCKCHOOSE_AGENT_AUTH_FILE` | MCP/Bun | 是 | sidecar token 文件路径；文件内容不得写入日志或 profile |
| `STOCKCHOOSE_AGENT_MCP_COMMAND` | DSH profile | 否 | MCP 启动命令，默认 `process.execPath` |
| `STOCKCHOOSE_AGENT_MCP_ARGS_JSON` | DSH profile | 否 | MCP 命令参数 JSON |
| `STOCKCHOOSE_AGENT_MCP_SCRIPT` | DSH profile | 否 | MCP 脚本路径，默认 `scripts/stockchoose-agent-mcp.mjs` |
| `DSH_CWD` | DSH | 否 | DSH/MCP 工作目录 |

不要通过 DSH 子进程环境传入 `STOCKCHOOSE_BUN_API_TOKEN`。Volt GUI 的官方 DSH 启动边界会清除 secret/token/apiKey 类环境变量，且直接传递秘密会扩大泄漏面。

## 3. 源码联调流程

### 3.1 启动 Bun API

```powershell
npm run bun:api
```

启动脚本会：

1. 生成或读取 Bun sidecar 实例 token。
2. 写入 `tmp/agent-runtime/sidecar-auth`，或写入 `STOCKCHOOSE_AGENT_AUTH_FILE` 指定路径。
3. 启动 `bun-api/server.ts`。
4. 退出时删除认证文件。

### 3.2 启动官方 DSH

官方 DSH 必须使用 Node 26 和 web profile，并应用：

```text
agent/stockchoose-dsh-profile.yml
```

等价的运行时参数边界为：

```text
dsh web --patch <absolute-path-to-agent/stockchoose-dsh-profile.yml> --host 127.0.0.1 --port 0 --no-open
```

启动 DSH 前至少向其非秘密环境传入：

```powershell
$env:STOCKCHOOSE_BUN_API_URL = "http://127.0.0.1:18082"
$env:STOCKCHOOSE_AGENT_AUTH_FILE = (Resolve-Path "tmp/agent-runtime/sidecar-auth")
$env:STOCKCHOOSE_AGENT_MCP_SCRIPT = (Resolve-Path "scripts/stockchoose-agent-mcp.mjs")
$env:DSH_CWD = (Get-Location).Path
```

DSH 会输出类似下面的 loopback URL：

```text
dsh web: http://127.0.0.1:<port>/?token=<43-character-token>
```

将完整 URL 设置为启动 Bun/Electron 进程时可见的 `STOCKCHOOSE_DSH_START_URL`。当前实现不支持在 Bun 启动后热更新该变量。

### 3.3 验证网关

通过 Electron 代理或携带当前 Bun 实例 token 调用：

```text
GET /api/agent/status?probe=1
POST /api/agent/sessions
POST /api/agent/sessions/<sessionId>/prompt
GET /api/agent/sessions/<sessionId>/history
POST /api/agent/sessions/<sessionId>/cancel
```

未配置 DSH 时，`GET /api/agent/status` 应返回：

```json
{
  "configured": false,
  "connected": false,
  "runtime": "official-dsh",
  "available": false
}
```

## 4. Prompt 请求

```json
{
  "text": "分析贵州茅台近期财务和公告风险",
  "mode": "queue",
  "clientTimeZone": "Asia/Shanghai",
  "context": {
    "section": "valuation",
    "stockCodes": ["sh600519"],
    "strategyId": "optional-strategy-id",
    "poolId": "optional-pool-id",
    "datasetId": "optional-dataset-id",
    "snapshotAt": "2026-09-25T00:00:00.000Z"
  }
}
```

- `text` 最大 32,000 字符。
- `mode` 为 `queue` 或 `steer`。
- 股票代码最多 20 个，必须匹配 A 股代码格式。
- 上下文会被转换为冻结文本，不允许覆盖系统约束。

## 5. MCP 工具测试

MCP Server 使用 stdio，不向 stdout 输出诊断文本。由 DSH profile 正常启动时会自动完成 `tools/list` 和 `tools/call`。

本地验证命令：

```powershell
npm run test:agent
node --test electron/bun-api.test.cjs
npm run bun:check
```

## 6. 安全检查

- DSH URL 只接受 `127.0.0.1`，不接受 `localhost`、IPv6、HTTPS、路径或额外查询参数。
- MCP API URL 只接受 HTTP loopback，拒绝凭据、query 和 fragment。
- DSH token 只用于 Bun 到 DSH 的认证，不返回给 renderer。
- Bun sidecar token 只存在于进程内存和认证文件，不写入 profile。
- MCP 响应最大 2,000,000 字符。
- 所有已注册工具标记为只读、幂等、非破坏性。
- 错误信息对 authorization、cookie、token、api key、secret 和 password 脱敏。

## 7. 当前未完成

- Electron 自动 staging/启动/停止官方 DSH。
- Node 26 和官方 DSH 的安装包资源布局。
- packaged runtime smoke 和 DSH 版本升级门禁。
- Agent 右侧工作栏前端。
- 新闻、舆情、策略、估值和研究报告 MCP 工具。

这些工作应按 `docs/agent-workbench-plan-2026-09-25.md` 的后续阶段实施，不得通过新增第二套 Bun Agent 引擎规避。
