import type { Factor, Stock, StockPool } from "./types";

const factor = (
  key: string,
  name: string,
  group: Factor["group"],
  description: string,
  defaultOrder: Factor["defaultOrder"] = "desc",
  unit = "",
  precision = 2
): Factor => ({ key, name, group, description, defaultOrder, unit, precision });

export const FACTORS: Factor[] = [
  factor("price", "股票价格", "行情", "复权收盘价。", "desc", "元"),
  factor("amount", "成交额", "行情", "最近交易日成交金额。", "desc", "亿"),
  factor("volume", "成交量", "行情", "最近交易日成交量。", "desc", "万手"),
  factor("pctChange", "股价涨幅", "行情", "最近交易日涨跌幅。", "desc", "%"),
  factor("relativeChange", "股价相对涨幅", "行情", "相对沪深300涨跌幅。", "desc", "%"),
  factor("turnover", "换手率", "行情", "最近交易日换手率。", "desc", "%"),
  factor("limitFlag", "涨跌停标记", "行情", "涨跌停状态的数值化标记。", "desc", ""),
  factor("marketCap", "股本和市值", "行情", "总市值。", "desc", "亿"),
  factor("floatMarketCap", "流通市值", "行情", "流通股本对应市值。", "desc", "亿"),
  factor("netInflow", "资金净流入", "行情", "主力资金净流入估计。", "desc", "亿"),
  factor("marginBalance", "融资融券", "行情", "两融余额。", "desc", "亿"),
  factor("northHold", "港资持股", "行情", "北向资金持股比例。", "desc", "%"),
  factor("intradayStrength", "日内行情", "行情", "日内强弱指标。", "desc", ""),
  factor("min15Momentum", "15分钟行情", "行情", "15分钟级别动量。", "desc", "%"),
  factor("newStockScore", "新股指标", "行情", "上市时间与活跃度综合指标。", "desc", ""),
  factor("ahPremium", "AH股溢价率", "行情", "A/H 股价格溢价率。", "asc", "%"),
  factor("priceAmplitude", "股价振幅", "行情", "最近交易日振幅。", "desc", "%"),
  factor("listingDays", "上市天数", "行情", "从上市至今交易日估计。", "desc", "天", 0),
  factor("tradingDays", "交易天数", "行情", "最近一年有效交易天数。", "desc", "天", 0),

  factor("ma20Distance", "20日均线偏离", "技术指标", "收盘价相对20日均线偏离。", "desc", "%"),
  factor("ma60Distance", "60日均线偏离", "技术指标", "收盘价相对60日均线偏离。", "desc", "%"),
  factor("momentum60", "60日动量", "技术指标", "近60日价格动量。", "desc", "%"),
  factor("volatility20", "20日波动率", "技术指标", "近20日年化波动率。", "asc", "%"),
  factor("macd", "MACD", "技术指标", "趋势动能指标。", "desc", ""),
  factor("kdj", "KDJ", "技术指标", "随机指标综合值。", "desc", ""),
  factor("rsi", "RSI", "技术指标", "相对强弱指标。", "desc", ""),
  factor("bias", "乖离率", "技术指标", "价格偏离均线程度。", "desc", "%"),
  factor("bollWidth", "布林带宽度", "技术指标", "布林带宽度。", "asc", "%"),
  factor("wqAlpha", "WorldQuant短周期因子", "技术指标", "短周期价量合成因子。", "desc", ""),

  factor("pe", "市盈率PE", "财务指标", "滚动市盈率。", "asc", "x"),
  factor("pb", "市净率PB", "财务指标", "市净率。", "asc", "x"),
  factor("ps", "市销率PS", "财务指标", "市销率。", "asc", "x"),
  factor("roe", "净资产收益率ROE", "财务指标", "净资产收益率。", "desc", "%"),
  factor("roa", "总资产收益率ROA", "财务指标", "总资产收益率。", "desc", "%"),
  factor("grossMargin", "毛利率", "财务指标", "销售毛利率。", "desc", "%"),
  factor("netMargin", "净利率", "财务指标", "销售净利率。", "desc", "%"),
  factor("revenueGrowth", "营收增长率", "财务指标", "营业收入同比增速。", "desc", "%"),
  factor("profitGrowth", "净利润增长率", "财务指标", "净利润同比增速。", "desc", "%"),
  factor("debtRatio", "资产负债率", "财务指标", "总负债/总资产。", "asc", "%"),
  factor("currentRatio", "流动比率", "财务指标", "流动资产/流动负债。", "desc", "x"),
  factor("assetTurnover", "总资产周转率", "财务指标", "收入/平均总资产。", "desc", "x"),
  factor("qualityScore", "业绩评分", "财务指标", "盈利质量、成长和稳定性的综合评分。", "desc", ""),
  factor("dividendYield", "股息率", "财务指标", "近12个月现金分红收益率。", "desc", "%"),

  factor("revenue", "营业收入", "财报条目", "利润表营业收入。", "desc", "亿"),
  factor("netProfit", "净利润", "财报条目", "归母净利润。", "desc", "亿"),
  factor("operatingCashflow", "经营现金流", "财报条目", "经营活动现金流净额。", "desc", "亿"),
  factor("totalAssets", "总资产", "财报条目", "资产负债表总资产。", "desc", "亿"),
  factor("totalLiabilities", "总负债", "财报条目", "资产负债表总负债。", "asc", "亿"),
  factor("inventory", "存货", "财报条目", "资产负债表存货。", "asc", "亿"),
  factor("receivables", "应收账款", "财报条目", "资产负债表应收账款。", "asc", "亿"),
  factor("eps", "每股收益EPS", "财报条目", "基本每股收益。", "desc", "元"),
  factor("bps", "每股净资产BPS", "财报条目", "每股净资产。", "desc", "元"),

  factor("employeeCount", "员工人数", "公司", "员工人数。", "desc", "人", 0),
  factor("pledgeRatio", "股权质押比例", "公司", "大股东质押比例。", "asc", "%"),
  factor("violationScore", "重大违规", "公司", "违规风险评分，越低越好。", "asc", ""),
  factor("insiderHolding", "股东高管持股", "公司", "高管和重要股东持股比例。", "desc", "%"),
  factor("fundHolding", "重仓基金统计", "公司", "基金重仓持股比例。", "desc", "%"),
  factor("indexWeight", "指数成分权重", "公司", "主要宽基指数权重估计。", "desc", "%"),

  factor("ratingScore", "评级机构统计", "分析师", "卖方评级综合分。", "desc", ""),
  factor("targetUpside", "预期目标价空间", "分析师", "目标价相对现价空间。", "desc", "%"),
  factor("epsForecastGrowth", "盈利增长预期", "分析师", "未来一年EPS增长预期。", "desc", "%"),
  factor("recommendationCount", "评级覆盖数量", "分析师", "近90天覆盖机构数。", "desc", "家", 0),
  factor("surpriseScore", "超预期指标", "分析师", "业绩超预期概率评分。", "desc", ""),

  factor("hs300Trend", "指数指标", "大盘指标", "沪深300趋势分。", "desc", ""),
  factor("industryMomentum", "行业数据", "大盘指标", "行业相对动量。", "desc", ""),
  factor("futureBasis", "股指贴水", "大盘指标", "股指期货贴水率。", "desc", "%"),
  factor("macroPulse", "宏观数据", "大盘指标", "宏观流动性和景气度综合分。", "desc", ""),
  factor("tradeCalendarScore", "交易日历", "大盘指标", "节假日和月末效应评分。", "desc", "")
];

export const STOCKS: Stock[] = [];
export const SYSTEM_POOLS: StockPool[] = [];

export const SAMPLE_ASSETS: Array<{ id: string; name: string; type: "策略" | "ETF" }> = [];

export const INDEX_OPTIONS = ["全部", "沪深300", "中证500", "创业板指", "科创50", "北证50", "高股息"];
export const BOARD_OPTIONS = ["全部", "主板", "创业板", "科创板", "北交所"];
export const PROPERTY_OPTIONS = ["全部", "国企", "民企", "外资"];
export const EXCHANGE_OPTIONS = ["全部", "沪市", "深市", "北交所"];
