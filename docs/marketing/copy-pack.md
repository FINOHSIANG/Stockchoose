# StockChoose 发布文案包

以下文案可以直接复制，再根据渠道字数限制和配图调整。所有文案都保留 Beta、外部依赖和投资风险边界。

## GitHub 简介

### 中文短描述

Agent 驱动的 A 股研究与调度工作站：行情、策略、财报、舆情、估值与交易计划集中在一个 Windows 优先的 Electron + React + Bun 应用中。

### English short description

Agent-driven A-share research workstation for market data, strategies, filings, sentiment, valuation, and trade planning.

### 主题标签

`A-shares` `stock-research` `electron` `react` `typescript` `bun` `mcp` `agent` `open-source`

## GitHub Release / 社区公告

### 标题

StockChoose Beta：把 A 股研究工作流放进一个 Agent 工作台

### 正文

StockChoose 是一个 MIT 开源的 A 股研究与调度工作站，面向 Windows 桌面使用。

它把行情、策略、财报、公告、舆情、价值核算和交易计划放进同一套研究工作区，并提供统一的 Agent 入口。当前已支持：

- 查询市场、个股、公司资料、财报和公告；
- 创建策略、股票池和自定义因子；
- 在多个业务频道之间保持工作区上下文；
- 使用本地 Bun API、Electron 和 React 继续扩展数据源与 MCP 工具。

项目仍处于 Beta：行情和新闻需要联网，Agent 需要单独配置外部运行时；当前规则模拟不是基于逐日历史价格的真实回测，交易计划也不连接券商实盘。

欢迎 Star、反馈可复现问题，或从数据适配、字段映射、错误恢复和测试开始贡献：

https://github.com/FINOHSIANG/Stockchoose

## X / 微博短文案

### 版本 A：产品定位

研究行情、财报、策略和新闻时，不必在多个窗口之间反复搬运上下文。StockChoose 把它们放进一个 Windows 优先的 Agent 研究工作站：可查数据、建股票池和策略、切换业务频道、回到界面核对结果。MIT 开源，Beta 中。  
https://github.com/FINOHSIANG/Stockchoose

### 版本 B：开发者角度

一个把 Agent、MCP、本地 Bun API 和 Electron 工作区接起来的 A 股研究项目。当前重点不是“喊出一个预测”，而是让数据来源、策略资源和下一步操作更容易被核查。欢迎用真实复现步骤参与贡献。  
https://github.com/FINOHSIANG/Stockchoose

### 版本 C：边界透明

StockChoose 的规则模拟不是历史回测，交易计划不是券商实盘，Agent 也需要额外配置。它更适合做可核查的研究工作台和扩展实验，而不是收益承诺。代码与测试已公开，欢迎一起把边界做实。  
https://github.com/FINOHSIANG/Stockchoose

## 知乎 / 掘金长文开头

### 标题候选

1. 我做了一个 Agent 驱动的 A 股研究工作站
2. 如何把行情、策略、财报和 MCP 工具放进同一套桌面工作流
3. 一个不把规则模拟包装成历史回测的股票研究开源项目

### 开头

做股票研究时，真正消耗时间的往往不是再打开一个行情页面，而是把同一只股票、同一套策略和同一批证据在不同工具之间重新搬运。StockChoose 从这个问题出发：让 Agent 负责连接可用的数据工具和工作区操作，人工仍然在界面里核查数据来源、报告期、缺失字段、策略条件和下一步动作。

它不是自动投顾，也不是券商交易终端。当前版本更像一张可以持续扩展的研究工作台：一侧是行情、财报、公告和新闻，另一侧是策略、估值、交易计划和 Agent 调度。项目把“已经实现”“需要外部配置”和“仍在规划”分开写清楚，方便使用者判断它是否适合自己的研究流程。

## English community post

### Title

StockChoose: an open-source Agent workstation for A-share research

### Body

StockChoose is a Windows-first Electron + React + Bun workstation for A-share research. It brings market data, strategies, company filings, announcements, sentiment, valuation, and trade planning into one inspectable workspace.

The built-in Agent entry can query supported data tools, create strategies, stock pools, and custom factors, and open the relevant workspace section. The project is intentionally transparent about its limits: market/news sources require network access, the Agent runtime is configured separately, rule simulation is not a historical backtest, and trade planning is not broker execution.

MIT licensed. Contributions around data adapters, field mappings, error recovery, cross-platform support, and tests are welcome.

https://github.com/FINOHSIANG/Stockchoose

## 配图顺序

1. [社交卡片](../../public/marketing/stockchoose-social-card.svg)：用于首图或链接预览。
2. [Agent 工作台桌面截图](../screenshots/current/agent-workbench-desktop.png)：展示统一入口和工作区。
3. [财报详情截图](../screenshots/current/financial-report-desktop.png)：展示数据核查与缺失字段。
4. [移动端 Agent 截图](../screenshots/current/agent-workbench-mobile.png)：展示窄屏覆盖抽屉。

截图说明、采集日期和使用边界见 [截图目录](../screenshots/README.md)。
