# STOCKCHOOSE 优化审计报告

**审计日期：** 2026-07-18

**审计对象：** E:\workspace\STOCKCHOOSE 本地 Electron + React + Bun 数据服务

**审计目的：** 找出影响数据新鲜度、策略正确性、持久化可靠性、交互性能和发布安全性的提升方向，并整理为可执行路线图。
**本轮边界：** 仅审计、验证和整理报告；没有修改业务代码。工作区原有的 src/storage.ts、src/strategyEngine.test.ts、tests/smoke.spec.ts 改动均保留。

> 本报告是工程质量和产品可靠性审计，不构成投资建议。动态数量、依赖版本和缓存状态以审计时刻为准，后续运行可能变化。

## 1. 执行摘要

当前项目已经具备可用的策略工作台雏形：行情可先返回再补齐财务/技术数据，Eastmoney 分页和去重逻辑较完整，缓存有 TTL、哈希 envelope 和原子写入，规则模拟也明确标注为“不是历史真实收益”。现有 192 项单测、构建、Bun 检查、浏览器 smoke 和 Bun live probe 均通过，浏览器控制台未发现 error/warning。

但在继续增加数据源、策略因子和看板功能之前，建议先处理下面四类发布阻断风险：

1. **持久化边界不稳定。** 生产 Electron 每次使用随机 loopback 端口，renderer 的 localStorage 因 origin 不同而分裂；已在 userData 中观察到 8 个随机端口 origin。重启后可能读不到策略、设置、纸面持仓或股票快照，配额失败还会被静默吞掉。
2. **同步链路重复抓取且快照未成为 UI 事实源。** 手动同步先运行 Bun Scheduler，再由前端重新调用开放数据同步；Scheduler 写好的快照只被轮询状态，完成后不会直接 hydrate 到 stocks。审计时 lastFullSync 为 2026-07-03，市场快照仅 200 行，而实时行情接口约 5,540 行；定时同步处于关闭状态。
3. **本地 API 的安全边界不足。** Bun 服务固定监听 127.0.0.1:18082，CORS 为 *，没有实例鉴权；集成路由接受任意 HTTP(S) baseUrl，存在本机 SSRF 和被本地网页调用的风险。Electron 还使用 sandbox: false，未发现 CSP。
4. **若干策略因子和仓位语义可能误导用户。** 空排名在引擎中隐式按成交额排序，和“排名选项不预设默认参数”的产品语义不一致；“个股最大买入仓位”被用于计算组合总暴露；相对涨幅和 15 分钟动量由日涨跌幅和常数推导，不能当作真实基准/分时因子。腾讯行情字段存在疑似错位，需用固定 raw fixture 立即复核。

建议的总原则是：**先建立稳定的数据集版本和持久化事实源，再做性能拆分；任何估算因子必须显式标注，任何覆盖不足都应阻止策略静默运行。**

## 2. 审计范围与方法

### 2.1 检查范围

- Electron 启动、窗口和本地代理：electron/main.cjs
- React 工作台、同步入口、看板和设置：src/App.tsx
- renderer 持久化：src/storage.ts
- 行情、财务、技术指标和缓存：src/openDataService.ts、src/realMarketDataService.ts
- 策略筛选、排名和仓位：src/strategyEngine.ts
- Bun API、Scheduler 和 HTTP 响应：bun-api/server.ts、bun-api/scheduler.ts、bun-api/lib/http.ts
- 测试、构建、依赖和发布脚本
- 当前预览地址：http://127.0.0.1:5175/

### 2.2 验证方法

- 阅读关键路径并记录文件/行号证据。
- 运行生产构建、TypeScript/Bun 检查、Vitest 单测和 Playwright smoke。
- 对预览页面进行浏览器检查：控制台、首屏 DOM、资源数量、响应式和交互路径。
- 对 Bun API 和上游数据进行 live probe；对有疑问的字段保留“待 raw fixture 复核”标记。
- 检查 data-cache、Electron userData、Git 跟踪产物和 npm audit。

## 3. 当前架构与数据流

~~~mermaid
flowchart LR
  UI["React App.tsx<br/>工作台/策略/交易/新闻"] --> LS["renderer localStorage<br/>策略、设置、股票快照"]
  UI --> EP["Electron 本地代理<br/>随机 loopback origin"]
  EP --> BA["Bun API<br/>127.0.0.1:18082"]
  BA --> MC["内存缓存<br/>TTL / single-flight"]
  BA --> PC["data-cache<br/>hash envelope / 原子写入"]
  BA --> UP["上游数据源<br/>Eastmoney / Tencent / AKTools / 新闻"]
  SCH["Scheduler<br/>定时或手动"] --> SNAP["snapshots/*.json"]
  SCH --> PC
  SNAP -. "当前主要只返回同步状态<br/>未直接 hydrate UI" .-> UI
  UI -. "手动同步完成后再次抓取" .-> UP
~~~

当前最重要的结构性问题是虚线所示的“双事实源”：一份数据被 Scheduler 写入本地快照，另一份由前端再次请求并写入 renderer 存储。后续应让 datasetId/snapshotId 成为唯一引用，UI 只消费版本化快照。

## 4. 审计基线

| 项目 | 审计时观察值 | 判断 |
|---|---:|---|
| src/App.tsx | 约 8,568 行、373,710 字节、约 46 个组件 | 根组件职责过重，适合按工作区拆分 |
| src/styles.css | 9,588 行、196,810 字节 | 多层历史覆盖，维护成本高 |
| src/openDataService.ts | 约 2,047 行 | 数据源、标准化、缓存和同步编排耦合 |
| 生产 JS | 479,139 字节，gzip 约 141.14 KB | 当前可用，但单 bundle 缺少路由级拆分 |
| 生产 CSS | 156,938 字节，gzip 约 27.16 KB | 可通过分层和工作区按需加载优化 |
| 开发首屏 | 约 225 个 DOM 节点、29 个脚本资源 | 当前首屏不算重，主要瓶颈在后续数据和重渲染 |
| data-cache | 319 个文件、约 46,584,642 字节（约 44.43 MiB） | 已需要全局容量水位和 GC |
| 持久缓存 | 约 316 个 envelope；前一轮按 TTL 解析发现约 206 个过期文件 | 过期数据仍占用空间，缺少统一清理 |
| 市场快照 | 200 行，snapshotAt=2026-07-03T07:46:42.918Z | 当前与实时全市场覆盖明显不一致 |
| lastFullSync | 2026-07-03T07:46:42.921Z | 审计日约 15 天未更新 |
| 定时同步 | enabled=false，间隔配置为 30 分钟 | “及时反馈”默认无法持续保证 |
| Electron origin | userData 中观察到 8 个随机 loopback 端口 origin | 存储会随端口分裂 |
| 单测 | 21 个测试文件、192 项通过 | 单元覆盖基础逻辑，但缺少打包重启与安全 E2E |
| Playwright | 1 个约 900 行的巨型 smoke 流程 | 失败定位和并行执行成本高 |
| Git 临时产物 | 跟踪的 tmp/ 57 个文件、约 8.84 MB | 不应进入长期版本控制 |
| 依赖审计 | 10 个漏洞：2 critical、4 high、3 moderate、1 low | 发布前必须处理或形成书面例外 |

## 5. 优先级总表

优先级含义：**P0** 为发布或数据正确性阻断；**P1** 为近期应完成的可靠性/性能建设；**P2** 为体验和长期维护优化。

| 优先级 | 发现 | 证据 | 建议结果 |
|---|---|---|---|
| P0 | Electron 持久化按随机 origin 分裂，配额失败静默 | electron/main.cjs:121-152、src/storage.ts:5-19 | 稳定协议或主进程存储；迁移旧 origin；错误可见 |
| P0 | Scheduler 快照未被 UI 消费，手动同步重复抓取 | bun-api/scheduler.ts:140-231、src/App.tsx:2740-2745 | 快照成为唯一事实源，单次抓取后 hydrate |
| P0 | 数据新鲜度不足且定时同步关闭 | data-cache/config/status.json、snapshots/market-quotes.json | 显示 as-of/覆盖率；按策略启用可观测同步 |
| P0 | 本地 API 无实例鉴权、CORS 为 *、可配置任意上游 URL | bun-api/lib/http.ts:18-35、bun-api/server.ts:37-45 | 随机端口 + nonce/token + URL 白名单/SSRF 防护 |
| P0 | 空排名仍按成交额排序 | src/strategyEngine.ts:327-334 | 无排名时保持稳定原序或明确“不排序”，不隐式加因子 |
| P0 | 最大买入仓位被当成组合总暴露 | src/strategyEngine.ts:401-406、src/App.tsx:3788-3794 | 区分单票上限、组合目标暴露和现金约束 |
| P0 | 伪实时因子进入策略计算 | src/realMarketDataService.ts:444-455,817-830 | 缺失/估算/真实三态，估算值默认不可用于严格策略 |
| P0（待复核） | 腾讯行情字段/单位/索引可能错位 | bun-api/services/market.ts:291-323，实时样本 | 固定 raw fixture、单位断言和字段映射测试 |
| P0 | 依赖存在 critical/high 漏洞 | 2026-07-18 npm audit | 先修复可升级项，无法升级的项形成例外和缓解措施 |
| P1 | 指标缺少 source/as-of/coverage/quality | Stock.metrics 主要为 Record<string, number> | 使用带元数据的 MetricEnvelope |
| P1 | 关键源失败仍可能更新 lastFullSync | bun-api/scheduler.ts:289 | 关键任务失败时状态为 partial/failed |
| P1 | 技术指标最多只覆盖前 200 只 | src/openDataService.ts:79,1529-1534、scheduler.ts:229 | 分批补齐或阻止覆盖不足的因子 |
| P1 | 缓存无全局 GC，财报单文件约 35 MB | data-cache 目录和缓存 envelope | 容量水位、分片、压缩、清理入口 |
| P1 | 前端重复请求、整树重渲染 | App.tsx 约 38 个 state | Query cache、领域 controller/provider |
| P1 | 新闻/舆情分别抓同一来源 | src/App.tsx:4529,4879 | 共享文章快照和分析结果 |
| P1 | 策略排名存在 O(C×N²) 路径 | src/strategyEngine.ts ranking/filter 流程 | 预计算 rank map、阈值和分组统计 |
| P1 | 每次策略请求跨进程传输完整股票 JSON | Electron/Bun 请求链 | 传 datasetId + strategy，服务端读取快照 |
| P1 | Bun 未纳入主 tsconfig 检查 | tsconfig.json:19 仅 include src | 增加 tsconfig.bun.json 和统一 typecheck |
| P1 | 测试集中在一个巨型 smoke | tests/smoke.spec.ts | 按工作区和风险域拆分，并加入打包 E2E |
| P1 | 缺少结构化运行观测 | API、同步和缓存日志 | requestId、耗时、命中率、覆盖率、上游错误 |
| P2 | Modal 可访问性、弱文本对比度、移动端触控尺寸 | src/styles.css、组件实现 | focus trap、ARIA、对比度和 40–44px 触控区 |
| P2 | 交易时段 useMemo 依赖不足 | src/App.tsx:4114 附近 | 以时钟 tick 或 session state 驱动 |
| P2 | CSS 和 App 历史覆盖过多 | App.tsx、styles.css | 按 tokens/base/components/workspaces/responsive 重组 |
| P2 | 无工作区级 Error Boundary | React 根结构 | 局部失败可恢复，避免全屏白屏 |
| P2 | tmp/ 产物被 Git 跟踪 | git ls-files tmp/** | 清理并加入 ignore，保留必要 fixture |
| P2 | 回测仍不是 point-in-time 历史回测 | 当前规则模拟实现 | 中长期接入带版本和复权的历史数据 |

## 6. 详细发现与行动建议

### P0-1：持久化可能在重启后“丢失”

**现象与证据**

- electron/main.cjs:121 使用 server.listen(0, "127.0.0.1")，每次生产启动得到随机端口。
- electron/main.cjs:152 用这个 URL 作为 renderer 页面地址。
- src/storage.ts:5-19 的所有业务状态都写入 origin-scoped localStorage。
- 已在 Electron userData/Local Storage/leveldb 中发现 8 个不同 loopback 端口 origin。
- saveLocal 捕获所有异常但不返回失败状态；全市场快照、策略、连接设置和纸面交易状态都经过这一层。

**影响**

- 用户重启应用后可能进入新的 origin，读取不到上一轮策略、设置、纸面持仓和行情。
- 大量股票 JSON 可能超出 localStorage 配额，失败时用户看不到提示。
- API key、交易 token 等敏感配置以明文 renderer 存储，无法统一擦除和保护。

**建议**

1. 短期：将生产页面改为稳定的 app://stockchoose 协议，或固定且受保护的内部 origin；启动时提供一次性迁移检测。
2. 中期：策略、数据集、交易状态和快照迁移到 app.getPath("userData") 下的 SQLite/结构化文件，由主进程或 Bun 统一访问；localStorage 只保留主题、列宽等小型 UI 偏好。
3. 敏感信息使用 Electron safeStorage 或 Windows Credential Manager，API 返回和日志均脱敏。
4. 为旧随机 origin 提供一次性导入/导出或兼容读取路径，避免升级后再次丢数据。

**验收**

- 打包应用重启 10 次，策略、设置、纸面持仓和快照 100% 保持一致。
- 人为填满存储或模拟写入失败时，界面出现可读错误和恢复入口。
- userData 中不再产生新的随机 origin；敏感 token 不以明文 JSON 存储。

### P0-2：同步链路重复抓取，后台快照没有成为 UI 事实源

**现象与证据**

- bun-api/scheduler.ts:140-231 已负责抓取并写入 snapshots/*.json。
- src/App.tsx:2740 先调用 triggerManualSync()。
- src/App.tsx:2745 随后又调用 performOpenSourceDataSync()，再次请求上游。
- 前端轮询的是同步状态，没有在同步完成后读取 /api/sync/snapshot/*。
- 自动同步完成后只更新状态文本，不会将新快照 hydrate 到 stocks。

**影响**

- 同一次点击产生重复上游请求、额外延迟和限流压力。
- Scheduler 写入的数据与 UI 使用的数据可能不是同一时间点。
- 后台同步完成后用户仍看到旧股票列表和旧看板，造成“已同步但未反馈”。

**建议**

- 定义统一数据集信封：datasetId、snapshotId、snapshotAt、asOf、provider、coverage、schemaVersion、quality。
- Scheduler 完成后只返回新版本 ID；前端按 ID 拉取一次并更新所有依赖视图。
- 手动同步和定时同步共用同一条 hydrate 函数，不再从前端直接二次抓取。
- 冷启动采用 stale-while-revalidate：先显示最近有效快照，同时后台刷新；刷新失败保留旧数据并明确显示年龄。
- 处理部分成功：关键行情失败时不更新 lastFullSync 为“完整成功”，而是返回 partial 和每个源的状态。

**验收**

- 一次手动同步对每个上游源最多发起一次有效抓取。
- 同步完成后 UI 在一个轮询周期内显示新的 snapshotAt、行数和覆盖率。
- 关闭网络后冷启动仍可显示最后有效快照，并显示“离线/已过期”而不是空白。

### P0-3：数据新鲜度和覆盖率当前不可直接判断

审计时 lastFullSync 和市场快照都停留在 2026-07-03，快照仅 200 行；实时行情接口约 5,540 行，定时同步配置为关闭。这里既有“任务没有启用”的配置因素，也暴露出产品层没有将数据年龄、覆盖率和源状态作为一等信息展示。

建议在看板和策略结果顶部展示：

- 数据集版本和抓取时间（asOf/snapshotAt）。
- 行数、去重后行数和市场覆盖率。
- 每个因子的实际覆盖率和质量状态。
- “实时、缓存、估算、缺失、过期”标签。
- 最近一次失败源及重试倒计时。

策略执行前设立门禁：若必需因子覆盖率低于策略阈值，阻止运行或要求用户确认，而不是静默用旧值/零值。

### P0-4：本地 Bun API 缺少安全边界

**现象与证据**

- bun-api/lib/http.ts:18-35 对 JSON 和文本响应统一设置 access-control-allow-origin: *。
- bun-api/server.ts:37-45 接受任意 http(s) baseUrl 并直接 fetch。
- /api/sync/*、/api/integration/*、快照路由没有实例 token 或来源校验。
- Electron 健康检查只确认固定端口返回 2xx。
- electron/main.cjs:141 为 sandbox: false，未发现 CSP 和导航白名单。
- 请求体、上游响应和单次快照读取没有显式大小上限。

**风险**

即使服务只监听 loopback，任何本机网页、浏览器扩展或被利用的本地进程都可能尝试调用它；任意 URL 转发还可能访问本机内网、云 metadata 或管理端口。固定端口也增加端口抢占和服务冒充风险。

**建议**

1. 每次启动生成随机 sidecar 端口和高熵 nonce；Electron 与 Bun 通过环境变量/握手传递 token。
2. 校验 Origin、Host、协议和允许域名；默认拒绝跨 origin，必要时只允许当前 Electron origin。
3. 对 baseUrl 做解析后白名单：拒绝 loopback、RFC1918、link-local、metadata 和非 HTTPS 公网地址；禁止重定向到不允许地址。
4. 使用 route schema 校验请求体、限制 JSON/响应大小和超时，日志加入 requestId。
5. 开启 Electron sandbox，配置 CSP、禁止未知导航和外链协议；外部链接经显式白名单交给系统浏览器。
6. 健康检查必须携带 token 并验证实例 ID，而不是只看 2xx。

**验收**

- 未携带 token 的请求统一 401/403；不在白名单的 Origin/Host 被拒绝。
- SSRF 测试覆盖 loopback、RFC1918、link-local、IPv6 本地地址、重定向和 DNS rebinding。
- 请求体/响应超过上限或超时会得到可解释错误，进程不会被拖垮。
- packaged E2E 验证 sandbox、CSP、外链和端口抢占行为。

### P0-5：排名选项虽默认空，但引擎仍隐式排序

src/storage.ts 的默认策略已经将 ranks 初始化为空，这符合“排名选项不要预设默认参数”的产品要求；但是 src/strategyEngine.ts:327-334 在没有启用排名时把 amount 写入 score，随后 screenStocks 仍按 score 排序（约在 strategyEngine.ts:428）。

这会造成两个问题：

- UI 看起来没有预设排名条件，但实际结果仍被成交额隐式影响。
- 用户无法区分“用户定义的排名”和“系统默认排序”，策略复现和回测解释不一致。

建议：

- ranks.length === 0 时保留筛选后的稳定输入顺序，或显式提供“按成交额排序”按钮/选项。
- score 在无排名时使用 undefined 或单独的 sortMode，不要伪装成排名分数。
- 增加回归测试：空排名、仅禁用排名、过滤后稳定顺序、显式成交额排序四种场景。
- 看板显示“无排名条件”，不能显示为 0 分或按成交额排名。

### P0-6：仓位参数语义混淆

UI 在 src/App.tsx:3789-3794 同时呈现“个股最大买入仓位”和其他组合参数；引擎 src/strategyEngine.ts:401-406 将所选股票权重归一后乘以 maxBuyPosition。例如设置 20%，得到的是整个已选组合权重合计约 20%，不是每只股票最多 20%。

建议将模型拆为三个独立概念：

- perStockMaxWeight：单只股票权重上限。
- portfolioTargetExposure：组合目标总暴露。
- cashReserve：现金/备用资金比例。

权重分配应先按方法得到原始权重，再应用单票 cap，最后按组合目标暴露缩放并做剩余权重再分配；界面文案、策略导出和看板均显示实际结果。

验收案例至少包括：2 只股票、10 只股票、单票超过上限、所有股票都被 cap、目标暴露小于/大于 100%。

### P0-7：伪实时因子必须与真实数据区分

src/realMarketDataService.ts:444-455 和 817-830 使用如下推导：

- relativeChange = pctChange - 0.25
- min15Momentum = pctChange / 4
- intradayStrength = 50 + pctChange * 4

如果没有基准指数、行业基准或 15 分钟 K 线，这些数值不能代表相对收益或 15 分钟动量，却会进入策略因子选择。

建议：

- 真实基准缺失时返回 undefined，不要填入估算数值。
- 如确实需要估算，字段命名使用 estimated*，并附 quality=estimated，默认不允许严格回测/自动交易使用。
- 15 分钟因子必须绑定真实分时数据的时间窗、交易日和数据集版本。
- 在因子列表、策略结果和导出文件中显示来源与质量。

### P0-8（待立即复核）：腾讯行情字段解析疑似错位

代码审计和子代理实时样本指向 bun-api/services/market.ts:291-323 的字段索引/单位映射风险。样本中平安银行曾出现：

- volumeWanShou=1,075,499
- amountYi=116,319
- industry2=-2.44
- statusFlag=CNY

这些值与字段名称和常识单位不一致，可能把成交量、成交额、行业涨跌和状态字段错位。主代理随后请求该接口遇到 502，因此本项应标为“代码审计及实时样本已发现，需用固定 raw fixture 复核”，不能在没有 fixture 的情况下直接断言最终映射。

处理顺序：

1. 保存脱敏的原始响应 fixture，固定编码和分隔符。
2. 为每个字段写名称、索引、单位、示例范围和转换函数。
3. 对成交量、成交额、价格、状态和行业涨跌增加范围/单位断言。
4. 用 Eastmoney 或另一可信源做抽样交叉校验；差异超过阈值时标记源异常，不更新快照。

## 7. P1：近期可靠性与性能建设

### 7.1 让指标携带数据血缘

当前很多指标仍以 Record<string, number> 传递，无法回答“来自哪个源、哪个交易日、是否完整、是否估算”。建议统一为：

~~~ts
type MetricValue = {
  value: number | null;
  source: string;
  asOf: string;
  tradeDate?: string;
  coverage: number;
  quality: "real" | "cached" | "estimated" | "stale" | "missing";
  datasetId: string;
};
~~~

策略引擎只接收通过质量门禁的 MetricValue；导出和看板沿用同一元数据。

### 7.2 修正 Scheduler 的成功语义

bun-api/scheduler.ts:289 在所有启用任务结束后直接写入 lastFullSync。建议区分：

- complete：所有关键源成功且覆盖率达标。
- partial：非关键源失败或覆盖率不足。
- failed：关键行情源失败，不能替换当前有效快照。

每次运行保存 runId、开始/结束时间、源状态、行数、去重数、错误码、快照 ID 和校验摘要。API 不应在任务失败时无条件返回 ok: true。

### 7.3 补齐技术指标覆盖

Scheduler 当前从市场快照取代码后 slice(0, 200)，技术指标因此最多覆盖 200 只。可选方案：

- 后台分批（例如每批 200）并发受限地补齐全市场；
- 只对当前策略候选集请求指标，但在结果中显示覆盖率；
- 覆盖率不足时禁用依赖该指标的筛选/排名条件。

不能让前 200 只股票看起来拥有“全市场技术指标”。

### 7.4 缓存治理

当前缓存已有 hash envelope、TTL、原子 rename、force refresh 和 single-flight，这是好的基础，但缺少全局治理：

- 设置总容量水位（例如 70% 警告、85% 自动 GC、95% 阻止低优先级写入）。
- 按 namespace、最近访问时间、大小和过期时间做 GC。
- 大型财报缓存（约 35 MB 单文件）改为按报告期/股票分片，必要时压缩。
- 为缓存 envelope 增加 schema version 和迁移策略。
- 设置页增加“缓存大小、最旧数据、清理缓存、保留快照”入口。

### 7.5 前端请求与渲染

建议建立共享 Query Cache，而不是由多个组件各自 fetch：

- 同键在途请求合并（single-flight）。
- 每个请求使用 AbortController，切换工作区取消无关请求。
- stale-while-revalidate：先显示可用数据，后台刷新。
- 缓存键包含 provider、参数、dataset/schema 版本。
- 同步完成只触发一次 store 更新，避免多个 setState 驱动整棵树重渲染。

App.tsx 约有 38 个 state，轮询同步状态会带动当前工作区重新渲染。建议按领域拆成 DashboardController、StrategyController、TradeController、SentimentController 和 SettingsController，再由轻量 provider 组合。

### 7.6 数据传输与策略计算

- 当前策略调用会跨进程传递完整股票 JSON，单次约 2–3 MB。改为 datasetId + strategy，Bun 端从本地快照读取，必要时只返回候选行。
- 排名筛选中存在 O(C×N²) 的范围值收集和排序路径。对每个 factor/range 预计算排序数组、rank map、min/max 和阈值，避免每只股票重复扫描。
- 看板策略涨跌幅应直接使用同一 datasetId 下的可追溯行情，显示计算时间、样本数和缺失数；不能混用旧快照和新实时行。

### 7.7 新闻和舆情

src/App.tsx:4529 与 4879 的舆情/新闻页面会分别抓取相同来源。建议 Bun 端生成共享文章快照：

- 规范化 URL、标题、发布时间和股票代码。
- 按 (source, articleId/url, contentHash) 去重。
- 原文快照和模型分析结果分开缓存，分析失败不丢原文。
- 部分来源失败时保留成功来源，并在 UI 显示覆盖率。
- 对新闻刷新设置 TTL、并发上限、退避和取消。

### 7.8 类型检查、测试和发布

- 增加 tsconfig.bun.json，把 bun-api 纳入严格检查；主构建同时执行前端和 Bun typecheck。
- 将单一 Playwright smoke 拆成 dashboard、strategy、sync、trade、persistence、security 六组，保留一个最小冒烟用例。
- 增加 packaged Electron E2E：重启持久化、随机端口/端口劫持、旧 origin 迁移、快照恢复、CSP 和外链。
- 增加数据契约测试：raw fixture → 标准化 → snapshot → UI hydrate。
- 发布流水线加入 unit、Bun live contract、build、smoke、npm audit（固定使用官方 registry）、签名、SHA-256、SBOM 和产物清单。
- Electron 31 和 Vite 5 的升级应按兼容性分阶段进行；不要仅为追求最新版而一次跨多个主版本。

### 7.9 可观测性

为每次请求和同步任务增加结构化日志字段：

- requestId、runId、datasetId、provider、endpoint。
- DNS/连接/上游/解析/写盘各阶段耗时。
- cache hit/miss、single-flight 合并数、响应大小。
- 行数、去重数、覆盖率、质量状态。
- 错误类别（timeout、rate-limit、schema、upstream、storage）。

看板只显示聚合后的可读状态，详细日志保存在 userData，避免把 token、原始响应或大 JSON 写入控制台。

## 8. P2：体验、可访问性和长期维护

1. Modal 增加焦点 trap、Escape 关闭、焦点恢复和 aria-labelledby。
2. 检查弱文本颜色。审计中发现浅色背景上的 #85899a 对比度约 3.30:1，低于普通文本 WCAG 4.5:1。
3. 移动端主要按钮和筛选控件提升到 40–44px 触控尺寸。
4. 为工作区增加 Error Boundary，使新闻或估值失败不会让整个工作台白屏。
5. 交易时段计算的 useMemo 依赖不足，跨 09:30/11:30/13:00/15:00 不一定自动刷新；使用时钟 tick 或显式 session state。
6. 将 styles.css 分成 tokens、base、components、workspaces、responsive 五层，逐步删除历史覆盖，不做一次性全量重写。
7. 清理跟踪的 57 个 tmp/ 产物，只保留必要的固定 fixture 和构建入口。
8. 中长期再实现真正的 point-in-time 历史回测：历史成分、复权、停牌、涨跌停、财报披露日和数据版本必须可复现。当前“规则模拟”文案应继续保持诚实。

## 9. 推荐目标架构

~~~mermaid
flowchart LR
  SRC["上游源适配器<br/>行情/财务/新闻"] --> NORM["标准化与契约校验"]
  NORM --> REG["Dataset Registry<br/>datasetId / schemaVersion / asOf"]
  REG --> STORE["userData 持久存储<br/>SQLite/分片文件"]
  REG --> CACHE["受治理缓存<br/>TTL / GC / single-flight"]
  SCHED["Scheduler<br/>runId / partial 状态"] --> REG
  API["Bun sidecar<br/>随机端口 + nonce"] --> REG
  UI["React 工作区<br/>Query Cache + domain stores"] --> API
  UI --> VIEW["看板/策略/交易/新闻<br/>显示来源、时间、覆盖率"]
  SECRET["safeStorage / Credential Manager"] --> API
~~~

目标架构的关键不在于立即引入某一个数据库，而在于建立单一事实源和可追溯版本：

- 上游响应先经过 schema/单位校验，再进入 Dataset Registry。
- UI 不保存大数据副本，只保存 dataset 引用和小型偏好。
- 策略、看板和导出使用同一个 datasetId，因此策略涨跌幅、排名和行情能对齐。
- 失败源不会覆盖最后一个有效快照；用户能看到失败原因和数据年龄。

## 10. 分阶段路线图

### 0–2 周：先消除数据和安全阻断

1. 固定 Electron origin 或实现主进程持久化；加入旧 origin 迁移和存储失败提示。
2. 统一 Scheduler/前端同步入口，去掉手动同步二次抓取；实现 snapshot hydrate。
3. 给快照、指标和策略结果加入 datasetId/asOf/coverage/quality。
4. 修正空排名语义和仓位参数语义；补齐回归测试。
5. 为腾讯接口建立 raw fixture 并确认字段/单位；不确定时禁用受影响因子。
6. Bun sidecar 加随机端口、nonce/token、Origin/Host 校验和 SSRF 防护。
7. 对 critical/high 依赖做升级评估和临时缓解，形成发布例外记录。

### 2–6 周：性能、覆盖和测试

1. 引入 Query Cache、请求取消、快照版本缓存和后台刷新。
2. 技术指标按批次补齐或实现覆盖率门禁。
3. 把完整股票 JSON 改为 dataset 引用；优化排名预计算。
4. 新闻/舆情统一文章快照与分析缓存。
5. 拆分 App 工作区和 Playwright 测试；加入 packaged persistence/security E2E。
6. 增加 Bun tsconfig、数据契约 fixture、结构化日志和基础指标面板。
7. 建立缓存 GC、容量水位和清理入口。

### 6–12 周：架构和产品能力

1. 完成 Dataset Registry 与 SQLite/分片存储迁移。
2. 按工作区做 React lazy loading、CSS 分层和 Error Boundary。
3. 建立历史数据版本和 point-in-time 回测。
4. 发布链加入签名、hash、SBOM、可重复 smoke 和升级迁移测试。
5. 根据真实使用数据调优刷新频率、并发、缓存 TTL 和看板指标。

## 11. 建议的验收指标

| 领域 | 指标 | 目标 |
|---|---|---|
| 持久化 | packaged 重启后策略/设置/持仓/快照保留率 | 100% |
| 同步 | 单次手动同步每个数据源的抓取链路启动次数（分页请求除外） | = 1 |
| 反馈 | 同步完成到 UI 显示新 snapshot 的时间 | p95 ≤ 2 秒（本地服务正常时） |
| 新鲜度 | 看板显示数据年龄和来源 | 100% 结果可追溯 |
| 覆盖 | 策略必需因子覆盖率 | 默认 ≥ 95%，低于阈值不得静默运行 |
| 正确性 | raw fixture 字段/单位契约测试 | 关键字段 100% 有断言 |
| 排名 | 空排名是否改变输入顺序 | 不改变；显式排序才改变 |
| 仓位 | 单票上限与组合暴露 | 两者分别可验证，误差 ≤ 0.01% |
| 安全 | 无 token、非法 Origin、SSRF 地址 | 全部拒绝 |
| 性能 | 5,500 行候选集策略筛选 | p95 ≤ 1 秒，且无 O(N²) 重复扫描 |
| 缓存 | 可复用请求命中率 | 稳定运行后 ≥ 80% |
| 测试 | 核心工作区和 packaged E2E | 每个 P0 路径至少 1 个独立用例 |
| 发布 | 依赖审计 | critical=0；high 有修复或书面缓解 |

## 12. 当前已经做得好的地方

优化应建立在现有优点上，不要为了重构而破坏这些行为：

- Eastmoney 分页、去重和约 98% 完整性门禁。
- 域级限速、超时、重试、内存缓存和 single-flight。
- 持久缓存已有 hash envelope、TTL、原子 rename 和 force refresh。
- 行情可以先返回，再并行补齐财务/技术数据，交互反馈策略合理。
- 规则模拟明确说明不是历史真实收益，避免过度承诺。
- 当前 192 项单测、构建、Bun live probe 和浏览器 smoke 均通过。
- 预览页面控制台无错误，响应式检查未发现页面级横向溢出。
- 默认策略的 ranks 已为空；后续应保留这个产品决策，只修正引擎的隐式成交额排序。

## 13. 不建议做的“优化”

- 不要通过删除数据源、降低覆盖率或把缺失值填成常数来换取更快响应。
- 不要在没有 raw fixture 和单位断言前继续扩展腾讯字段映射。
- 不要把定时同步状态当作数据已被 UI 消费的证明。
- 不要用一次大规模重写替代分阶段迁移；先建立契约和回滚点。
- 不要为了“看起来实时”把估算因子命名成真实因子。
- 不要把“个股上限”“组合总暴露”“现金保留”合并成一个参数。
- 不要给排名条件重新加默认参数；应让空排名保持明确、可解释的语义。
- 不要只依赖巨型 smoke；P0 风险需要可独立重跑、可定位的测试。

## 14. 附录：可复用的验证命令

以下命令用于复核本报告的工程基线；运行结果会随时间和网络变化：

~~~powershell
Set-Location E:\workspace\STOCKCHOOSE
git status --short
npm run test:unit
npm run bun:check
npm run build
npm run test:smoke
npm audit --registry=https://registry.npmjs.org
git ls-files 'tmp/**'
Get-ChildItem -Recurse -File data-cache | Measure-Object -Property Length -Sum
~~~

动态数据复核建议同时检查：

- data-cache/config/status.json
- data-cache/config/schedule.json
- data-cache/snapshots/market-quotes.json
- Electron userData/Local Storage/leveldb
- 预览页 Network 面板中同步、快照和策略请求链

### 证据解释边界

- 缓存文件数、文件大小、快照行数、依赖漏洞和实时上游响应都是审计时刻的快照，不应硬编码为永久事实。
- 腾讯字段问题目前是“代码审计 + 实时样本发现，待固定 raw fixture 复核”，在复核完成前按高风险处理。
- 代码行号会随后续编辑变化；报告中的路径用于定位模块，提交前应重新运行一次 rg -n。

## 15. 交付状态

- 已生成本报告。
- 本轮未修改业务代码。
- 原有未提交改动已保留。
- 下一步建议优先执行路线图中的 0–2 周项目，并在每项完成后补充对应验收证据。
