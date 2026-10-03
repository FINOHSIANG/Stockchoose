# AKShare API 覆盖测试与替换评估

测试日期：2026-09-10。项目：STOCKCHOOSE。

## 结论

**不能把 JoshuaMaoJH/akshare-api 原样作为项目的唯一股票数据源。可以选择性利用 AKShare/AKTools，但需要适配、补齐数据和保留现有来源。**

这不是一个已托管的远程行情服务，而是固定访问 `http://127.0.0.1:8080/api/public/` 的 Python 客户端。真正获取数据的是另行运行的 AKTools 和 AKShare；数据仍来自东方财富、腾讯、新浪等上游，换封装不等于换了底层来源。

本次没有切换默认来源、修改用户已保存配置、替换调度器、写入实际行情缓存或提交代码。新增的是默认未启用的指定 AKTools 接入入口，以及准确检测所选地址的连接测试。

## 范围与环境

- 目标仓库：`https://github.com/JoshuaMaoJH/akshare-api`
- 固定提交：`8abd17190080c19e6b6f9b697ece0aa972649baf`。
- Python 3.12.9，AKTools 0.0.91，AKShare 1.18.94。
- 独立环境及仓库副本：`tmp/akshare-api-audit/`，已加入 Git 忽略。
- 本机服务只监听 `127.0.0.1:18080`，不向局域网或公网开放。
- 历史行情窗口：2026-06-01 至 2026-09-09；财报样本报告期：2026-06-30。
- 27 组项目相关 HTTP 样本，3 个并发客户端，单请求读取/连接超时 35 秒。
- 原仓库函数另做 6 组定向调用，保留原参数行为，仅在测试中将请求重定向到隔离服务并添加超时。
- 检查真实 JSON 字段，并将财报响应送入项目现有解析器；没有用旧缓存或示例财务值补齐缺口。

这是单机、单时段样本测试，不是全量 94 个接口的在线验收，不代表全天可用率、全市场时效性或生产 SLA。客户端超时也不能保证 AKTools 内部请求随之取消。

## 原仓库静态覆盖

README 声称 98 个接口，但主文件 `akshare-api.py` 实际有 **133 个函数定义、94 个唯一接口名称、39 个重复定义**。其他分类 Python 文件没有增加新的唯一接口。

与本次安装的 AKShare 核对：

| 检查项 | 数量 | 说明 |
| --- | ---: | --- |
| 唯一接口 | 94 | 不是 README 中的 98 |
| 函数不存在 | 9 | 调用目标已经缺失，不能视为可用 |
| 参数不兼容 | 4 | 函数还在，但封装传入了不接受的参数 |
| 未发现名称/传参不兼容 | 81 | 81/94，约 86.2%；仅静态结果，不是实际成功率 |

缺失函数：

`stock_zh_a_tick_tx`、`stock_board_concept_cons_ths`、`stock_market_activity_em`、`stock_dt_pool_em`、`stock_institute_visit_em`、`stock_institute_visit_detail_em`、`stock_hot_rank_detail_xq`、`stock_hot_search_em`、`stock_hot_related_em`。

参数差异：

- `stock_financial_report_sina`：封装传 `indicator`，当前函数要求 `symbol` 表示报表类型。
- `stock_zh_a_cdr_daily`：封装多传 `adjust`。
- `stock_hk_daily`、`stock_us_daily`：封装多传 `start_date`、`end_date`。

另外，仓库的普通 `requests.get` 没有客户端超时，异常会被打印后转换为空 DataFrame。历史示例默认日期也不能用于证明数据是最新的。

### 原函数定向实测

这 6 组是针对正常路径和已发现问题选择的样本，不能外推成全部接口成功率。

| 原仓库函数 | HTTP | 行数 | 结果 |
| --- | ---: | ---: | --- |
| `stock_zh_a_hist_tx` | 200 | 72 | 成功 |
| `stock_news_em` | 200 | 10 | 成功 |
| `stock_financial_report_sina` | 500 | 0 | 原封装参数不兼容；改为当前正确参数的直接 HTTP 调用可返回 123 行 |
| `stock_zh_a_tick_tx` | 404 | 0 | 当前 AKShare 无此函数 |
| `stock_dt_pool_em` | 404 | 0 | 当前 AKShare 无此函数 |
| `stock_market_activity_em` | 404 | 0 | 当前 AKShare 无此函数 |

## 项目相关 HTTP 实测

**27 组中 18 组返回非空且包含基础检查字段的数据，9 组失败：基础成功率 66.7%。**

其中 8 组使用了原仓库没有封装、但当前 AKShare 提供的函数。故下表是 AKTools 能力评估，不能全部归功于目标仓库。“成功”仍不表示字段足够支持项目计算。

| 能力 | 接口或样本 | 首轮结果 | 替换判断 |
| --- | --- | --- | --- |
| 股票名单 | `stock_info_a_code_name` | 5,561 行 | 原仓库未封装；可作为名单核对来源 |
| 全市场行情/东方财富 | `stock_zh_a_spot_em` | HTTP 500 | 不可默认替换 |
| 全市场行情/新浪 | `stock_zh_a_spot` | 5,560 行，代码不重复 | 缺关键估值字段；第二次调用 HTTP 500 |
| 北交所行情 | `stock_bj_a_spot_em` | HTTP 500 | 不可替换 |
| 东方财富日线 | 000001、600519、920002 | 3 组均 HTTP 500 | 此窗口不能替换 |
| 东方财富周线/月线 | 000001 | 14 / 3 行 | 需继续验证日期、复权、跨市场和长历史 |
| 腾讯/新浪日线 | `stock_zh_a_hist_tx`、`stock_zh_a_daily` | 各 72 行 | 有接入价值；未替换现有 K 线链路 |
| 个股资料 | `stock_individual_info_em` | HTTP 500 | 不可替换 |
| 主营介绍 | `stock_zyjs_ths` | 1 行 | 不是公司资料全字段替代 |
| 业绩报表 | `stock_yjbb_em` | 11,448 行 | 必须与股票名单取交集，不能直接扩充股票池 |
| 利润表 | `stock_lrb_em` | 5,224 行 | 原仓库未封装；需要字段和单位适配 |
| 资产负债表 | `stock_zcfz_em` | 5,224 行 | 原仓库未封装；摘要缺少债务拆分等字段 |
| 现金流量表 | `stock_xjll_em` | 5,224 行 | 原仓库未封装；项目当前解析漏读经营现金流 |
| 历史利润表/新浪 | `stock_financial_report_sina`，正确参数 | 123 行 | 不是原封装直接可用的结果 |
| 盈利预测 | `stock_profit_forecast_em` | 2,898 行，2,405 个唯一代码 | 493 条超出唯一代码数，需检查重复和预测年份 |
| 深市融资明细 | `stock_margin_detail_szse` | 2,104 行 | 原仓库未封装；需统一日期/单位/代码 |
| 沪市融资明细 | `stock_margin_detail_sse` | 1,999 行 | 同上 |
| 北向持股 | `stock_hsgt_hold_stock_em` | HTTP 500 | 原仓库未封装；上游 result 为空触发异常 |
| 公告 | `stock_notice_report` | 1,486 行 | 原仓库未封装；需映射筛选和公告链接 |
| 个股新闻 | `stock_news_em` | 10 行 | 可以单独适配，但不能替代现有多来源新闻链路 |
| 财经快讯 | `stock_info_global_em` | 200 行 | 同上 |
| 资金流向 | `stock_individual_fund_flow_rank` | HTTP 500 | 不可替换 |
| 行业板块 | `stock_board_industry_name_em` | HTTP 500 | 不可替换 |

历史日线失败并不意味着该函数在所有日期都失败：后续使用 2024-05 的连接检测样本时，同一东方财富历史函数返回了 20 行。因此连接检测必须标明所测窗口，不能据此宣称近期行情也可用。

多个失败的服务日志出现 `RemoteDisconnected`；北向持股为 `result` 为空引发 `TypeError`。这些是当前环境下的实测失败，不断言对所有用户永久不可用。

## 与项目数据契约的差距

### 行情字段不足

新浪返回的字段包括价格、涨跌幅、成交量、成交额、买卖价、开高低昨收等，但缺少项目使用的：

`总市值`、`流通市值`、`PE`、`PB`、`换手率`、`60 日涨跌幅`。

股票代码带 `sh/sz/bj` 前缀，需要标准化。成交量不能沿用所有供应商共用的数量级猜测规则，必须核对股/手/万手。原始首行成交量为 544,475，当前通用解析得到 54.4475 万手，需完成源单位核验后才能采用。

5,560 / 5,561 约为 99.98% 的数量比例，不等于已经完成逐代码覆盖验收，也不代表每只股票都有市值或有效成交。

### 财报行数不等于 A 股覆盖

真实响应与 5,561 个现有上市代码做精确交集后：

- 业绩报表：11,448 行，只有 5,560 个代码属于该名单。
- 利润、资产负债、现金流摘要表：各 5,224 行，各有 5,217 个代码属于该名单，约覆盖 93.81%。
- 不能把 11,448 行直接解释为 11,448 只 A 股。

### 现有外部 AKShare 解析器存在阻塞

使用项目 `mergeAkShareFinancialRows` 直接处理真实响应、关闭股票池扩张并从空指标开始：

| 指标 | 有限数值覆盖 |
| --- | ---: |
| 营业收入 | 5,559 |
| 净利润 | 5,560 |
| 总资产/总负债 | 各 5,217 |
| EPS/BPS | 各 5,560 |
| 经营现金流 | **0** |
| 有息负债/无息负债 | **各 0** |
| 流动比率 | **0** |

具体阻塞：

1. 现金流返回 `经营性现金流-现金流量净额`，当前 `cashFlowKeys` 未覆盖该名称，导致经营现金流全部漏读。
2. `amountToYi` 用正数大小判断单位，负的人民币元金额不被转换。真实样本 002366 净利润为 -22,640,687.66 元，应为约 -0.2264 亿元，当前外部解析结果却是 -22,640,687.66 亿元。
3. 资产负债摘要没有完整的短期借款、长期借款、债券、流动资产和流动负债拆分，不能直接满足 DCF/债务分解计算。
4. 投资性资产、生产性资产虽被当前代码算出数值，但摘要字段不完整；“有数值”不等于与现有完整报表口径一致。

这条离线链路没有任何股票满足项目全部估值字段门槛。测试从无行情指标的股票名单开始，因此不能将这个 0 解释为 AKShare 本身完全没有估值能力；它说明**当前直接组合与解析路径未达可替换标准**。

上述解析问题本轮保留为替换阻塞，没有混入本次连接层修复。未触发实际业务同步，避免错误财务数据进入用户缓存。

## 已落地的改动

1. 新增 `bun-api/services/aktools.ts`，统一外部行数据请求、校验及连接检测。
2. `/api/integration/source-test` 现在实际检测用户选择的地址，不再用 Bun 自己的东方财富请求冒充外部源测试。
3. 新增配置别名 `/akshare-api/api/public`，只指向进程环境变量 `STOCKCHOOSE_AKTOOLS_BASE_URL` 指定的服务。
4. 只有与该变量完全匹配的 `127.0.0.1` / IPv6 loopback 地址可以使用本机 HTTP；未全局放开私网、HTTP 或任意本机端口。
5. 拒绝路径注入、危险参数、凭证型 URL 和重定向，空数据或错误结构不能冒充成功行情。

本次核验的 AKTools 0.0.91 `core/api.py` 使用字符串拼接及 `eval` 处理查询参数。因此代理额外拒绝引号、反斜杠、查询分隔符、百分号、控制字符和非标识符参数名。此约束不是对 AKTools 自身的全面安全审计，服务仍须只监听本机，不能直接对外开放。

**保留不变：** 默认 `/aktools/api/public` 的 Bun 兼容行为、全市场行情入口、腾讯批量报价、K 线回退、财务/新闻调度和用户设置。新配置不会自动把这些链路改成 AKTools。

### 可选入口配置

仅用于受控测试；在财务解析阻塞修复前，不建议把它设为主数据源执行全量同步。

启动项目的 PowerShell 进程可显式设置：

```powershell
$env:STOCKCHOOSE_AKTOOLS_BASE_URL = "http://127.0.0.1:18080/api/public"
```

设置页仍选择原有 AKShare / AKTools 提供方，地址填写 `/akshare-api/api/public`。这是配置别名，不是一个新增的 GET 路由；浏览器经原有 `/api/integration/aktools/rows` POST 入口访问它。

回退：将数据源地址恢复为 `/aktools/api/public`，取消进程环境变量并重启。无需迁移数据或重建缓存。

## 可复现检查

以下命令在项目根目录运行，前提是隔离 AKTools 服务已经在上述本机地址启动。临时测试服务在本次测试结束后停止。

```powershell
uv venv --python 3.12 tmp/akshare-api-audit/venv
uv pip install --native-tls --index-url https://pypi.org/simple --python tmp/akshare-api-audit/venv/Scripts/python.exe aktools==0.0.91 akshare==1.18.94

git clone https://github.com/JoshuaMaoJH/akshare-api.git tmp/akshare-api-audit/upstream
git -C tmp/akshare-api-audit/upstream checkout 8abd17190080c19e6b6f9b697ece0aa972649baf

tmp/akshare-api-audit/venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 18080 --app-dir tmp/akshare-api-audit/venv/Lib/site-packages/aktools
```

若隔离目录已存在，跳过创建和克隆步骤。上述服务命令在单独终端运行；后续检查在另一终端执行。服务可能在启动目录生成 `aktools_log.log`，本次生成的日志已收纳至隔离目录。

```powershell
tmp/akshare-api-audit/venv/Scripts/python.exe scripts/akshare-coverage.py --capture-payloads
tmp/akshare-api-audit/venv/Scripts/python.exe scripts/akshare-coverage.py --wrapper-smoke --inventory-only --output tmp/akshare-api-audit/wrapper-smoke.json
tmp/akshare-api-audit/venv/Scripts/python.exe scripts/akshare-coverage.py --only universe,performance,income,balance,cashflow,forecast,history-tencent --capture-payloads --output tmp/akshare-api-audit/contract-samples.json
bun scripts/akshare-contract-check.ts
node scripts/akshare-integration-smoke.mjs
npm run test:unit
bun test bun-api/lib/outboundSecurity.test.ts
npm run bun:check
npm run build
```

默认测试日期是此次固定窗口；换时间重测须显式传入 `--date`、`--start-date`、`--report-date`。离线契约检查当前也是固定 2026-06-30 样本，换报告期需要同步调整。

### 证据文件

- `tmp/akshare-api-audit/coverage.json`：首轮 27 组结果、完整静态清单。
- `tmp/akshare-api-audit/wrapper-smoke.json`：原仓库 6 个函数的真实结果。
- `tmp/akshare-api-audit/contract-samples.json`、`payloads/`：复测及原始财报响应。
- `tmp/akshare-api-audit/project-contract.json`：现有解析器字段覆盖和负金额问题。
- `tmp/akshare-api-audit/bun-integration.json`：认证 Bun 代理 -> AKTools 的真实 HTTP 结果。
- `tmp/akshare-api-audit/server.err.log`：上游失败堆栈。

验证结果：224 条前端/共享单元测试通过，11 条现有出站安全测试通过，Bun 打包和 TypeScript/Vite 构建通过。两次真实 Bun 集成测试均返回 72 条腾讯历史行情；所选 AKTools 连接检查第一次返回 20 条历史行情，第二次上游 HTTP 500 被正确转为失败（Bun HTTP 502），没有隐式回退。不允许的本机地址及路径穿越均被拒绝。集成脚本通过表示这些代理行为断言通过，不表示所有上游数据都可用。`bun-integration.json` 保留最后一次结果。

## 后续替换门槛

建议继续保留 Bun 数据边界，直接对接经过固定版本验证的官方 AKTools/AKShare，而不是再引入这层有重复定义的 Python 客户端。

1. 先修外部财报的显式字段映射、正负金额单位和披露日期语义，增加真实响应契约测试。
2. 补充完整报表路径。当前 AKShare 存在 `stock_balance_sheet_by_report_em`、`stock_profit_sheet_by_report_em`、`stock_cash_flow_sheet_by_report_em`；本轮只核验函数和签名，未验证其完整响应和批量成本。
3. 行情保留市值/PE/PB 等字段来源，不能只用新浪价格表覆盖既有完整行情。
4. 所有批量表按有效股票名单取交集、校验重复代码、统一时点与复权、保留真实来源标记。
5. 分别验证主板、科创板、创业板、北交所、停牌、亏损及金融行业样本，完成调度/缓存/详情/回测端到端回归。
6. 做至少多个交易日的重复测试，验证限流、失败回退、响应时间和数据新鲜度，再讨论默认源切换。

这些门槛未满足前，本次结论为：**完成覆盖测试与可选接入；整体替换不通过。**
