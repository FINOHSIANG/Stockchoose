import type { Stock } from "../../src/types";

const baseStocks: Array<Omit<Stock, "metrics"> & { seed: number }> = [
  { code: "600519", name: "贵州茅台", exchange: "沪市", board: "主板", industry1: "食品饮料", industry2: "白酒", region: "贵州", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "中证500"], seed: 91 },
  { code: "000858", name: "五粮液", exchange: "深市", board: "主板", industry1: "食品饮料", industry2: "白酒", region: "四川", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 84 },
  { code: "601318", name: "中国平安", exchange: "沪市", board: "主板", industry1: "非银金融", industry2: "保险", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 76 },
  { code: "600036", name: "招商银行", exchange: "沪市", board: "主板", industry1: "银行", industry2: "股份行", region: "广东", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 72 },
  { code: "000333", name: "美的集团", exchange: "深市", board: "主板", industry1: "家用电器", industry2: "白色家电", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 68 },
  { code: "300750", name: "宁德时代", exchange: "深市", board: "创业板", industry1: "电力设备", industry2: "电池", region: "福建", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "创业板指"], seed: 89 },
  { code: "002594", name: "比亚迪", exchange: "深市", board: "主板", industry1: "汽车", industry2: "乘用车", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 88 },
  { code: "601012", name: "隆基绿能", exchange: "沪市", board: "主板", industry1: "电力设备", industry2: "光伏设备", region: "陕西", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 64 },
  { code: "300760", name: "迈瑞医疗", exchange: "深市", board: "创业板", industry1: "医药生物", industry2: "医疗器械", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "创业板指"], seed: 81 },
  { code: "600276", name: "恒瑞医药", exchange: "沪市", board: "主板", industry1: "医药生物", industry2: "化学制药", region: "江苏", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 63 },
  { code: "600887", name: "伊利股份", exchange: "沪市", board: "主板", industry1: "食品饮料", industry2: "乳品", region: "内蒙古", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 67 },
  { code: "601899", name: "紫金矿业", exchange: "沪市", board: "主板", industry1: "有色金属", industry2: "贵金属", region: "福建", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 73 },
  { code: "600030", name: "中信证券", exchange: "沪市", board: "主板", industry1: "非银金融", industry2: "证券", region: "广东", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 61 },
  { code: "601088", name: "中国神华", exchange: "沪市", board: "主板", industry1: "煤炭", industry2: "动力煤", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 65 },
  { code: "600900", name: "长江电力", exchange: "沪市", board: "主板", industry1: "公用事业", industry2: "水电", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 79 },
  { code: "000651", name: "格力电器", exchange: "深市", board: "主板", industry1: "家用电器", industry2: "白色家电", region: "广东", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 57 },
  { code: "002415", name: "海康威视", exchange: "深市", board: "主板", industry1: "计算机", industry2: "安防设备", region: "浙江", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 66 },
  { code: "603259", name: "药明康德", exchange: "沪市", board: "主板", industry1: "医药生物", industry2: "医疗服务", region: "江苏", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 70 },
  { code: "688981", name: "中芯国际", exchange: "沪市", board: "科创板", industry1: "电子", industry2: "半导体", region: "上海", property: "国企", isST: false, isSuspended: false, isSTAR: true, isMargin: true, indexes: ["沪深300", "科创50"], seed: 83 },
  { code: "688111", name: "金山办公", exchange: "沪市", board: "科创板", industry1: "计算机", industry2: "软件开发", region: "北京", property: "民企", isST: false, isSuspended: false, isSTAR: true, isMargin: true, indexes: ["科创50"], seed: 78 },
  { code: "300059", name: "东方财富", exchange: "深市", board: "创业板", industry1: "非银金融", industry2: "证券", region: "上海", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "创业板指"], seed: 75 },
  { code: "300124", name: "汇川技术", exchange: "深市", board: "创业板", industry1: "机械设备", industry2: "自动化设备", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "创业板指"], seed: 74 },
  { code: "002475", name: "立讯精密", exchange: "深市", board: "主板", industry1: "电子", industry2: "消费电子", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 77 },
  { code: "000568", name: "泸州老窖", exchange: "深市", board: "主板", industry1: "食品饮料", industry2: "白酒", region: "四川", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 69 },
  { code: "601166", name: "兴业银行", exchange: "沪市", board: "主板", industry1: "银行", industry2: "股份行", region: "福建", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 59 },
  { code: "600031", name: "三一重工", exchange: "沪市", board: "主板", industry1: "机械设备", industry2: "工程机械", region: "湖南", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 55 },
  { code: "601398", name: "工商银行", exchange: "沪市", board: "主板", industry1: "银行", industry2: "国有行", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 49 },
  { code: "601288", name: "农业银行", exchange: "沪市", board: "主板", industry1: "银行", industry2: "国有行", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 47 },
  { code: "601857", name: "中国石油", exchange: "沪市", board: "主板", industry1: "石油石化", industry2: "油气开采", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 52 },
  { code: "600028", name: "中国石化", exchange: "沪市", board: "主板", industry1: "石油石化", industry2: "炼化", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300", "高股息"], seed: 51 },
  { code: "000002", name: "万科A", exchange: "深市", board: "主板", industry1: "房地产", industry2: "住宅开发", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 43 },
  { code: "600048", name: "保利发展", exchange: "沪市", board: "主板", industry1: "房地产", industry2: "住宅开发", region: "广东", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 46 },
  { code: "000063", name: "中兴通讯", exchange: "深市", board: "主板", industry1: "通信", industry2: "通信设备", region: "广东", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 62 },
  { code: "002230", name: "科大讯飞", exchange: "深市", board: "主板", industry1: "计算机", industry2: "人工智能", region: "安徽", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["中证500"], seed: 71 },
  { code: "600745", name: "闻泰科技", exchange: "沪市", board: "主板", industry1: "电子", industry2: "半导体", region: "湖北", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["中证500"], seed: 56 },
  { code: "600438", name: "通威股份", exchange: "沪市", board: "主板", industry1: "电力设备", industry2: "光伏设备", region: "四川", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 60 },
  { code: "002714", name: "牧原股份", exchange: "深市", board: "主板", industry1: "农林牧渔", industry2: "养殖业", region: "河南", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 58 },
  { code: "300015", name: "爱尔眼科", exchange: "深市", board: "创业板", industry1: "医药生物", industry2: "医疗服务", region: "湖南", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["创业板指"], seed: 70 },
  { code: "002371", name: "北方华创", exchange: "深市", board: "主板", industry1: "电子", industry2: "半导体", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 82 },
  { code: "688008", name: "澜起科技", exchange: "沪市", board: "科创板", industry1: "电子", industry2: "半导体", region: "上海", property: "民企", isST: false, isSuspended: false, isSTAR: true, isMargin: true, indexes: ["科创50"], seed: 80 },
  { code: "301236", name: "软通动力", exchange: "深市", board: "创业板", industry1: "计算机", industry2: "软件开发", region: "北京", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: false, indexes: ["中证500"], seed: 54 },
  { code: "833575", name: "康乐卫士", exchange: "北交所", board: "北交所", industry1: "医药生物", industry2: "生物制品", region: "北京", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: false, indexes: ["北证50"], seed: 53 },
  { code: "430047", name: "诺思兰德", exchange: "北交所", board: "北交所", industry1: "医药生物", industry2: "生物制品", region: "北京", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: false, indexes: ["北证50"], seed: 50 },
  { code: "000625", name: "长安汽车", exchange: "深市", board: "主板", industry1: "汽车", industry2: "乘用车", region: "重庆", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["沪深300"], seed: 66 },
  { code: "601669", name: "中国电建", exchange: "沪市", board: "主板", industry1: "建筑装饰", industry2: "基础建设", region: "北京", property: "国企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["中证500", "高股息"], seed: 45 },
  { code: "002027", name: "分众传媒", exchange: "深市", board: "主板", industry1: "传媒", industry2: "广告营销", region: "广东", property: "民企", isST: false, isSuspended: false, isSTAR: false, isMargin: true, indexes: ["中证500"], seed: 48 },
  { code: "600703", name: "三安光电", exchange: "沪市", board: "主板", industry1: "电子", industry2: "光学光电子", region: "湖北", property: "民企", isST: false, isSuspended: true, isSTAR: false, isMargin: true, indexes: ["中证500"], seed: 44 },
  { code: "000982", name: "中银绒业", exchange: "深市", board: "主板", industry1: "纺织服饰", industry2: "纺织制造", region: "宁夏", property: "民企", isST: true, isSuspended: false, isSTAR: false, isMargin: false, indexes: [], seed: 32 }
];

function wave(seed: number, amp = 1, shift = 0) {
  return Math.sin(seed * 1.618 + shift) * amp;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, precision = 2) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function buildMetrics(seed: number, index: number, stock: Omit<Stock, "metrics">): Record<string, number> {
  const sizeBoost = stock.indexes.includes("沪深300") ? 1.8 : stock.indexes.includes("中证500") ? 1.15 : 0.65;
  const growthBias = ["电力设备", "电子", "计算机", "医药生物", "汽车"].includes(stock.industry1) ? 1 : -0.2;
  const defensive = ["银行", "公用事业", "煤炭", "石油石化"].includes(stock.industry1) ? 1 : 0;
  const starRisk = stock.board === "科创板" || stock.board === "创业板" ? 1 : 0;
  const price = clamp(8 + seed * 1.9 + wave(seed, 22, index), 3, 260);
  const marketCap = clamp(seed * 42 * sizeBoost + wave(seed, 220, 2), 18, 24000);
  const floatMarketCap = marketCap * clamp(0.42 + seed / 220 + wave(seed, 0.1, 4), 0.35, 0.92);
  const amount = clamp(marketCap / 100 + seed / 6 + wave(seed, 5, 9), 0.4, 260);
  const volume = clamp(amount * 90 / price, 3, 1200);
  const pctChange = clamp(wave(seed, 5.6, 0.7) + growthBias * 0.7 - defensive * 0.3, -9.8, 10);
  const pe = clamp(5 + seed * 0.45 + growthBias * 15 + starRisk * 22 + wave(seed, 10, 2.1), 3, 120);
  const pb = clamp(0.4 + seed / 28 + growthBias * 1.1 + wave(seed, 0.6, 3.5), 0.35, 18);
  const roe = clamp(4 + seed / 3.6 + defensive * 2 + growthBias * 2 + wave(seed, 5, 4.2), -8, 42);
  const revenueGrowth = clamp(-10 + seed / 2.7 + growthBias * 11 + wave(seed, 18, 5.5), -35, 95);
  const profitGrowth = clamp(-15 + seed / 2.4 + growthBias * 14 + wave(seed, 22, 6.2), -60, 140);
  const debtRatio = clamp(22 + seed / 1.8 + (stock.industry1 === "银行" ? 38 : 0) + wave(seed, 9, 1.3), 8, 92);
  const grossMargin = clamp(12 + seed / 2.2 + growthBias * 8 + wave(seed, 8, 2.9), 3, 86);
  const netMargin = clamp(grossMargin / 3 + roe / 4 + wave(seed, 3, 1.1), -10, 45);
  const totalAssets = clamp(marketCap * (stock.industry1 === "银行" ? 8 : 1.2) + seed * 12, 30, 280000);
  const totalLiabilities = totalAssets * debtRatio / 100;
  const revenue = clamp(marketCap / 2.8 + seed * 3 + wave(seed, 70, 8.4), 5, 12000);
  const netProfit = clamp(revenue * netMargin / 100, -40, 3600);
  const qualityScore = clamp(roe * 1.2 + netMargin * 0.9 + revenueGrowth * 0.25 - debtRatio * 0.12 + wave(seed, 6, 10), 0, 100);
  const listingDays = clamp(260 + seed * 78 + index * 31, 120, 9200);
  const targetUpside = clamp(8 + growthBias * 10 + qualityScore / 5 - pe / 8 + wave(seed, 12, 11), -35, 80);
  const metrics: Record<string, number> = {
    price,
    amount,
    volume,
    pctChange,
    relativeChange: pctChange - wave(50, 1.4, index),
    turnover: clamp(amount / floatMarketCap * 100, 0.05, 38),
    limitFlag: pctChange > 9 ? 1 : pctChange < -9 ? -1 : 0,
    marketCap,
    floatMarketCap,
    netInflow: round(amount * wave(seed, 0.12, 4.8), 2),
    marginBalance: clamp(floatMarketCap / 42 + seed / 3, 0, 650),
    northHold: clamp(1 + seed / 4 + (stock.indexes.includes("沪深300") ? 7 : 0) + wave(seed, 5, 4.2), 0, 45),
    intradayStrength: clamp(50 + pctChange * 3 + wave(seed, 18, 5.1), 0, 100),
    min15Momentum: clamp(pctChange / 2 + wave(seed, 4.5, 3.6), -12, 12),
    newStockScore: clamp(100 - listingDays / 60 + starRisk * 20, 0, 100),
    ahPremium: clamp(10 + wave(seed, 18, 1.9), -25, 80),
    priceAmplitude: clamp(Math.abs(pctChange) + Math.abs(wave(seed, 5, 1.2)) + 1.2, 0.2, 20),
    listingDays,
    tradingDays: Math.round(clamp(165 + seed / 1.8 + wave(seed, 18, 2.6), 80, 252)),
    ma20Distance: clamp(pctChange * 1.3 + wave(seed, 7, 6.6), -28, 40),
    ma60Distance: clamp(pctChange * 2 + growthBias * 5 + wave(seed, 10, 7.7), -38, 58),
    momentum60: clamp(revenueGrowth / 2 + pctChange * 2 + wave(seed, 16, 8.1), -55, 110),
    volatility20: clamp(12 + starRisk * 12 + wave(seed, 8, 5.8) + Math.abs(pctChange) * 1.4, 5, 78),
    macd: round(wave(seed, 2.8, 9.6) + growthBias * 0.8, 2),
    kdj: clamp(42 + pctChange * 4 + wave(seed, 25, 1.1), 0, 100),
    rsi: clamp(50 + pctChange * 3.5 + wave(seed, 20, 2.1), 0, 100),
    bias: clamp(pctChange * 1.6 + wave(seed, 6, 2.9), -30, 30),
    bollWidth: clamp(6 + starRisk * 8 + Math.abs(wave(seed, 14, 1.4)), 2, 45),
    wqAlpha: round(wave(seed, 1.5, 13) + pctChange / 8 + amount / 120, 3),
    pe,
    pb,
    ps: clamp(pe / 5 + wave(seed, 1.5, 1.7), 0.2, 35),
    roe,
    roa: clamp(roe / (stock.industry1 === "银行" ? 10 : 2.6), -4, 18),
    grossMargin,
    netMargin,
    revenueGrowth,
    profitGrowth,
    debtRatio,
    currentRatio: clamp(0.65 + (100 - debtRatio) / 45 + wave(seed, 0.4, 2.2), 0.35, 5),
    assetTurnover: clamp(revenue / totalAssets, 0.02, 2.5),
    qualityScore,
    dividendYield: clamp(defensive * 3 + (100 - pe) / 45 + wave(seed, 1.3, 4.8), 0, 9),
    revenue,
    netProfit,
    operatingCashflow: clamp(netProfit * (0.8 + seed / 180) + wave(seed, 28, 7.8), -60, 3200),
    totalAssets,
    totalLiabilities,
    inventory: clamp(revenue * (0.04 + Math.abs(wave(seed, 0.06, 2.4))), 0, 900),
    receivables: clamp(revenue * (0.05 + Math.abs(wave(seed, 0.07, 3.4))), 0, 1200),
    eps: clamp(netProfit * 100 / Math.max(marketCap, 1) * price / 100, -2, 18),
    bps: clamp(price / Math.max(pb, 0.1), 0.5, 95),
    employeeCount: Math.round(clamp(seed * 450 + marketCap * 8 + wave(seed, 5000, 1), 300, 420000)),
    pledgeRatio: clamp(6 + (stock.property === "民企" ? 8 : 2) + wave(seed, 9, 0.4), 0, 65),
    violationScore: clamp(stock.isST ? 88 : 10 + wave(seed, 8, 4.4), 0, 100),
    insiderHolding: clamp(2 + (stock.property === "民企" ? 12 : 3) + wave(seed, 8, 5.2), 0, 65),
    fundHolding: clamp(2 + qualityScore / 5 + (stock.indexes.includes("沪深300") ? 7 : 0) + wave(seed, 5, 6.2), 0, 55),
    indexWeight: clamp(marketCap / 2800 + (stock.indexes.includes("沪深300") ? 0.2 : 0), 0, 9),
    ratingScore: clamp(2.5 + qualityScore / 36 + wave(seed, 0.6, 8.4), 0, 5),
    targetUpside,
    epsForecastGrowth: clamp(profitGrowth / 1.8 + wave(seed, 12, 3.7), -45, 120),
    recommendationCount: Math.round(clamp(1 + seed / 8 + (stock.indexes.includes("沪深300") ? 10 : 2), 0, 45)),
    surpriseScore: clamp(45 + qualityScore / 2 + wave(seed, 18, 6.6), 0, 100),
    hs300Trend: clamp(50 + wave(seed, 22, 3.3) + growthBias * 8, 0, 100),
    industryMomentum: clamp(52 + wave(seed + stock.industry1.length, 20, 2.1) + growthBias * 10, 0, 100),
    futureBasis: clamp(-2 + wave(seed, 2.4, 7.1), -9, 7),
    macroPulse: clamp(48 + wave(seed, 16, 5.6) + defensive * 6, 0, 100),
    tradeCalendarScore: clamp(50 + wave(seed + index, 18, 1.4), 0, 100)
  };

  Object.keys(metrics).forEach((key) => {
    metrics[key] = round(metrics[key], key === "listingDays" || key === "employeeCount" || key === "recommendationCount" ? 0 : 2);
  });
  return metrics;
}

export const STOCKS: Stock[] = baseStocks.map(({ seed, ...stock }, index) => ({
  ...stock,
  metrics: buildMetrics(seed, index, stock)
}));
