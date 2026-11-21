# StockChoose 发布检查清单

每次发布推广内容前，按下面顺序检查。完成后再复制 [发布文案包](copy-pack.md)。

## 1. 事实与版本

- [ ] `README.md` 中的版本号与实际发布版本一致。
- [ ] 发布文案只描述当前已实现能力，没有把路线图当成现成功能。
- [ ] 规则模拟明确写成“当前快照/规则模拟”，没有写成真实历史回测。
- [ ] Agent 的 DSH、模型服务和本地配置依赖已在文案中说明。
- [ ] 交易计划明确不是券商实盘委托。

## 2. 资产

- [ ] 首图使用 [社交卡片](../../public/marketing/stockchoose-social-card.svg) 或最新真实截图。
- [ ] 截图来自 `docs/screenshots/current/`，并核对 [截图目录](../screenshots/README.md) 的采集日期和说明。
- [ ] 品牌图使用 `public/brand/stockchoose-wordmark.png`，没有替换成未经许可的第三方素材。
- [ ] 图片在目标平台预览后没有裁切标题、数据表或品牌字标。

## 3. 文案与链接

- [ ] 项目链接统一指向 `https://github.com/FINOHSIANG/Stockchoose`。
- [ ] CTA 只邀请 Star、分享、Issue 或代码贡献，不承诺收益。
- [ ] 中文渠道使用中文短描述；英文渠道使用英文短描述。
- [ ] 长文附上快速开始、能力边界和许可证入口。
- [ ] 不在公开内容中出现 token、API Key、认证文件、个人持仓或私有接口地址。

## 4. 发布后

- [ ] 用无痕窗口打开项目主页和关键文档链接。
- [ ] 检查 README 图片、社交卡片和相对路径在 GitHub 上正常加载。
- [ ] 保存最终发布地址和日期，便于之后更新文案。
- [ ] 收到问题后优先要求系统版本、复现步骤、预期/实际表现和脱敏日志。

## 推荐的最小验证

```powershell
npm run build
npm run test:unit
git diff --check
```

如果发布涉及 Agent、Bun、后端或浏览器流程，再按根目录 `README.md` 的测试表补跑对应检查。测试通过只说明代码和固定流程通过，不代表外部行情源、模型服务或券商链路已经可用。
