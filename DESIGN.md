---
name: StockChoose Research Workstation
description: A calm, precise A-share strategy and market intelligence workstation.
colors:
  mineral-canvas: "oklch(97.5% 0.009 255)"
  paper-surface: "oklch(99.2% 0.004 255)"
  sunken-surface: "oklch(95.5% 0.012 255)"
  graphite-shell: "oklch(99.4% 0.002 275)"
  primary-text: "oklch(28% 0.026 258)"
  muted-text: "oklch(50% 0.025 258)"
  subtle-line: "oklch(89% 0.014 255)"
  signal-cobalt: "oklch(58% 0.22 292)"
  cobalt-soft: "oklch(94.5% 0.045 292)"
  market-up: "oklch(56% 0.205 28)"
  market-down: "oklch(55% 0.145 153)"
  warning-amber: "oklch(72% 0.15 75)"
typography:
  headline:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.01em"
  data:
    fontFamily: "Cascadia Code, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cobalt}"
    textColor: "{colors.paper-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.primary-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "9px 14px"
    height: "36px"
  input-default:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.primary-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
    height: "36px"
  panel-raised:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.md}"
    padding: "16px"
  nav-active:
    backgroundColor: "{colors.cobalt-soft}"
    textColor: "{colors.signal-cobalt}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
---

# Design System: StockChoose Research Workstation

## Overview

**Creative North Star: "The Analyst's Light Table"**

这是一张为持续研究而照亮的工作台：明亮但不空泛，精密但不压迫，所有层级都帮助用户从系统状态进入结论，再进入参数和证据。主参考来自 Behance 的 `Stock Market insight Dashboard`，借鉴其浅灰画布、白色分层面、主次不对称布局和克制紫蓝强调，但拒绝其海报包装和海外市场语义。

界面以桌面研究为主，不追求交易终端式的黑底霓虹，也不把每个模块做成同尺寸卡片。结构通过画布、分区、数据带、表格和少量抬升面建立，动画只表达状态变化。

**Key Characteristics:**

- 浅色高密度机构研究工作站
- 浅色工具栏与稀缺紫蓝交互强调
- 主分析区优先，辅助信息不对称编排
- A 股红涨绿跌，状态绝不只靠颜色
- 8px 节奏、克制圆角、结构化响应式

## Colors

浅灰画布承托近白内容面，深色只负责文字与必要的对比，紫蓝只服务导航、选择和主要动作。

### Primary

- **Signal Violet:** 主操作、焦点、当前选择和可点击链接，使用必须稀缺。
- **Violet Mist:** 选中背景、轻提示和 hover，不承担大面积装饰。

### Secondary

- **A-Share Up:** 上涨、正收益和正向市场数据。
- **A-Share Down:** 下跌、负收益和负向市场数据。
- **Warning Amber:** 待确认、真实数据不足和需要注意的运行状态。

### Neutral

- **Light Tool Shell:** 顶部工具栏、品牌区与一级导航环境。
- **Mineral Canvas:** 全局背景，带轻微冷灰蓝偏色。
- **Paper Surface:** 主要内容面、输入和表格。
- **Sunken Surface:** 筛选区、次级工具区与空态背景。
- **Subtle Line:** 分隔线和控件边界，不用于制造卡片墙。

**The Ten Percent Rule.** Signal Violet 在单屏内不超过约 10%，它只标记可操作性和当前上下文。

**The China Market Rule.** 上涨永远使用 A-Share Up，下跌永远使用 A-Share Down；禁止套用海外绿涨红跌。

## Typography

**Display Font:** Segoe UI Variable（回退到 Microsoft YaHei UI）
**Body Font:** Segoe UI Variable（回退到 Microsoft YaHei UI）
**Label/Mono Font:** Cascadia Code（回退到 Consolas）

**Character:** 单一人文系统无衬线保证桌面原生感，数值使用窄幅等宽字体稳定列对齐。层级来自字重、尺寸和空间，不来自花哨字体。

### Hierarchy

- **Headline**（700，20px，1.25）：页面标题和重大结论。
- **Title**（650，15px，1.35）：面板标题、表格组标题和关键步骤。
- **Body**（400，13px，1.55）：说明、空态和帮助文本，连续段落不超过 72ch。
- **Label**（600，12px，0.01em）：按钮、字段名、Tab 和状态标签。
- **Data**（600，12px，1.35）：股票代码、金额、比率、时间和表格关键数值。

**The Numeric Rhythm Rule.** 同一数据列必须使用等宽字体和稳定小数位，禁止数字在刷新时横向跳动。

## Elevation

系统以色调分层为主，阴影为辅。画布、下沉工具区和纸面内容区先建立层级；只有顶部壳层、浮动弹窗和 hover 中的可交互面允许出现阴影。

### Shadow Vocabulary

- **Ambient Lift** (`0 10px 30px oklch(20% 0.02 255 / 0.08)`): 顶部导航和关键悬浮面。
- **Floating Dialog** (`0 24px 64px oklch(18% 0.025 255 / 0.18)`): 模态框与股票信息弹窗。
- **Control Hover** (`0 4px 14px oklch(40% 0.12 292 / 0.16)`): 主要按钮或可点击工具项的短暂状态。

**The Flat-at-Rest Rule.** 普通面板静止时保持平坦；如果页面看起来像由许多漂浮白卡组成，阴影使用已经失败。

## Components

### Buttons

- **Shape:** 紧凑、明确的轻圆角（6px），桌面高度 36px。
- **Primary:** Signal Violet 实底、近白文字、左右 14px 内边距。
- **Hover / Focus:** hover 只提高明度和轻微抬升；focus 使用 2px Violet Mist 外环；disabled 降低对比度且取消阴影。
- **Secondary / Ghost:** 近白或透明背景、Subtle Line 边界；危险动作使用语义红但不铺满整屏。

### Chips

- **Style:** 轻底色、1px 边界、4-6px 圆角，文本保持 12px。
- **State:** selected 使用 Violet Mist 与 Signal Violet；涨跌、风险、来源等语义 chip 不混用主色。

### Cards / Containers

- **Corner Style:** 主内容面 10px，紧凑数据块 6px。
- **Background:** Paper Surface 承载结论，Sunken Surface 承载筛选和辅助操作。
- **Shadow Strategy:** 默认无阴影，依靠背景和分隔线分层。
- **Border:** 仅使用 Subtle Line 1px；禁止粗侧边色条。
- **Internal Padding:** 12-16px，主分析面可用 24px。

### Inputs / Fields

- **Style:** 36px 高、近白背景、1px Subtle Line、6px 圆角。
- **Focus:** Signal Violet 边界与 2px 低透明外环，禁止强发光。
- **Error / Disabled:** 错误同时显示图标或文字；disabled 使用 Sunken Surface 和降低对比度。

### Navigation

顶部导航使用近白工具栏与清晰品牌区，六个一级入口保持原有顺序和行为。默认项为低对比文字，hover 提升可见度，active 使用 Violet Mist 或 Signal Violet 指示，不依赖单独下划线。小屏允许横向滚动，但品牌区和设置入口保持可辨识。

### Research Status Strip

系统状态使用连续信息带而不是五张同构卡片。标签、关键值和补充信息形成三层密度；异常状态同时提供文字语义和图标/形状提示。

## Do's and Don'ts

### Do:

- **Do** 用主次不对称网格突出当前页面的第一结论，辅助区保持紧凑。
- **Do** 使用 8px 基础节奏和 12-16px 常规面板内边距，长表格保持 34-38px 行高。
- **Do** 保持 A 股红涨绿跌，并为所有语义色提供文字或图标冗余。
- **Do** 让所有按钮、输入、Tab、表格和空态在六个功能域中使用同一状态词汇。
- **Do** 保留真实数据不足、接口失败和未同步空态，不用样本值填满页面。

### Don't:

- **Don't** 使用“霓虹暗色加密货币终端”的高饱和荧光色、玻璃拟态和无意义发光。
- **Don't** 使用“消费级券商游戏化”的庆祝动效、夸张收益暗示或强推交易视觉。
- **Don't** 制造“通用后台卡片墙”，禁止所有模块使用相同白卡、相同尺寸和相同标题权重。
- **Don't** 复制“Behance 展示包装”的紫色外框、植物插画、设备模型或海报场景。
- **Don't** 使用大于 1px 的彩色 `border-left` / `border-right` 作为卡片强调条。
- **Don't** 使用渐变文字、装饰性玻璃面、弹跳动画或 `transition: all`。
- **Don't** 把无真实行为的控件包装成新能力，或在接口失败时展示伪数据。
