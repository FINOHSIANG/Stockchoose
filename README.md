# Stockchoose

本地 Electron 股票策略工作台，包含行情总览、策略选股、交易、舆情、价值核算和右侧 Agent 工作台。

技术栈：React、TypeScript、Vite、Electron 和 Bun。当前版本为 Beta，部分能力依赖外部行情服务和可选的 Agent 运行时。

## 项目截图

当前版本截图与归档说明见 [docs/screenshots/README.md](docs/screenshots/README.md)。

## 本地运行

建议使用 Node.js 24、npm 和 Bun 1.3。开发启动需要在 PATH 中提供 `bun`；Windows 桌面打包脚本面向 x64。

```powershell
git clone https://github.com/FINOHSIANG/Stockchoose.git
cd Stockchoose
npm ci
npm run dev
```

`npm run dev` 启动 Vite 和 Electron，数据代理按需启动本地 Bun 服务。

仅预览网页：

```powershell
npm run dev:web
```

默认地址为 `http://127.0.0.1:5173/`；端口占用时以终端输出为准。网页预览依赖 Vite 的本地数据代理，不能用静态托管替代完整桌面运行环境。

## 验证与构建

```powershell
npm run build:beta
npm run test:smoke
npm run package:beta
```

- `build:beta` 运行单元、Agent、后端测试和生产构建。
- `test:smoke` 运行 Playwright 浏览器测试；首次使用前执行 `npx playwright install chromium`。
- `package:beta` 构建 Windows x64 便携版，输出到 `release/beta/`，不会自动发布。

## 数据与 Agent 配置

- 行情和财报依赖外部数据源，网络、接口变化及数据延迟可能影响结果。界面截图使用固定测试数据，不代表实时行情。
- AKTools 服务可通过启动进程的环境变量 `STOCKCHOOSE_AKTOOLS_BASE_URL` 配置；不需要使用 AKTools 时无需配置该地址。
- Agent 为可选能力，需要单独安装、启动官方 DSH 运行时，并通过 `STOCKCHOOSE_DSH_START_URL` 提供本机启动地址。未配置时工作栏显示未配置状态。
- 仓库不提供 DSH 运行时、模型服务密钥或本机 profile。接入文档中的 `agent/stockchoose-dsh-profile.yml` 是本地配置路径，不是克隆后自带的文件。
- Agent 接口和环境变量说明见 [DSH 后端接入说明](docs/agent-dsh-backend-integration-2026-09-25.md)。该文档记录阶段性联调状态，不代表所有列出的后续工作已交付。
- 本地缓存、认证文件和运行日志不应提交到 Git；不要在 Issue、截图或日志中公开密钥、持仓或个人信息。

## 贡献

欢迎通过 GitHub Issue 报告问题或提交 Pull Request。请描述复现步骤、运行环境和预期结果，并运行与修改相关的测试。

## 许可证与使用边界

项目代码采用 [MIT License](LICENSE)。第三方依赖遵循各自许可证；第三方行情、财报、新闻、模型服务和品牌素材的权利不因本项目开源而转移，使用时应遵守相应服务条款和授权要求。

本项目用于研究和学习，不构成投资建议，也不保证数据准确性、策略收益或交易结果。不要将未经独立核实的输出直接用于实盘决策。
