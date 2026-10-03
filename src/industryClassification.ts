import type { Stock } from "./types";

export const ALL_INDUSTRIES = "全部";

const unusableIndustryTexts = new Set([
  "",
  "-",
  "--",
  "暂无",
  "未分类",
  "未披露",
  "腾讯行情",
  "东方财富行情",
  "鏆傛棤",
  "鏈垎绫?",
  "鏈姭闇?",
  "鑵捐琛屾儏",
  "涓滄柟璐㈠瘜琛屾儏"
]);

export const PRIMARY_INDUSTRIES = [
  "农林牧渔",
  "基础化工",
  "钢铁",
  "有色金属",
  "电子",
  "家用电器",
  "食品饮料",
  "纺织服饰",
  "轻工制造",
  "医药生物",
  "公用事业",
  "交通运输",
  "房地产",
  "商贸零售",
  "社会服务",
  "综合",
  "建筑材料",
  "建筑装饰",
  "电力设备",
  "国防军工",
  "计算机",
  "传媒",
  "通信",
  "银行",
  "非银金融",
  "汽车",
  "机械设备",
  "煤炭",
  "石油石化",
  "环保",
  "美容护理"
] as const;

const secondaryToPrimaryEntries: Array<[string, string[]]> = [
  ["农林牧渔", ["种植业", "养殖业", "渔业", "饲料", "农产品加工", "动物保健"]],
  ["基础化工", ["化学制品", "化学原料", "农化制品", "化学纤维", "塑料", "橡胶", "化工新材料"]],
  ["钢铁", ["普钢", "特钢", "冶钢原料"]],
  ["有色金属", ["贵金属", "工业金属", "能源金属", "小金属", "金属新材料"]],
  ["电子", ["半导体", "消费电子", "光学光电子", "元件", "电子化学品", "其他电子"]],
  ["家用电器", ["白色家电", "黑色家电", "小家电", "厨卫电器", "照明设备", "家电零部件"]],
  ["食品饮料", ["白酒", "啤酒", "乳品", "饮料乳品", "食品加工", "调味发酵品", "休闲食品", "预加工食品", "保健品"]],
  ["纺织服饰", ["纺织制造", "服装家纺", "饰品"]],
  ["轻工制造", ["造纸", "包装印刷", "家居用品", "文娱用品"]],
  ["医药生物", ["化学制药", "中药", "生物制品", "医疗器械", "医疗服务", "医药商业"]],
  ["公用事业", ["电力", "水电", "火电", "新能源发电", "燃气", "水务", "环境治理"]],
  ["交通运输", ["航空机场", "航运港口", "铁路公路", "物流", "公交"]],
  ["房地产", ["房地产开发", "住宅开发", "产业地产", "物业管理", "房产服务"]],
  ["商贸零售", ["贸易", "一般零售", "专业连锁", "互联网电商"]],
  ["社会服务", ["旅游及景区", "酒店餐饮", "教育", "专业服务", "体育"]],
  ["建筑材料", ["水泥", "玻璃玻纤", "装修建材"]],
  ["建筑装饰", ["房屋建设", "基础建设", "专业工程", "工程咨询服务"]],
  ["电力设备", ["电池", "光伏设备", "风电设备", "电网设备", "电机", "其他电源设备"]],
  ["国防军工", ["航天装备", "航空装备", "地面兵装", "航海装备", "军工电子"]],
  ["计算机", ["软件开发", "IT服务", "计算机设备", "人工智能", "云计算"]],
  ["传媒", ["游戏", "广告营销", "影视院线", "出版", "数字媒体"]],
  ["通信", ["通信设备", "通信服务", "运营商"]],
  ["银行", ["国有行", "股份行", "城商行", "农商行", "银行服务"]],
  ["非银金融", ["证券", "保险", "多元金融", "金融服务"]],
  ["汽车", ["乘用车", "商用车", "汽车零部件", "汽车服务", "摩托车"]],
  ["机械设备", ["工程机械", "自动化设备", "专用设备", "通用设备", "轨交设备", "机器人"]],
  ["煤炭", ["动力煤", "焦煤", "焦炭", "煤炭开采"]],
  ["石油石化", ["油气开采", "炼化", "炼油化工", "油服工程", "化工贸易"]],
  ["环保", ["环境治理", "环保设备", "固废治理"]],
  ["美容护理", ["化妆品", "医疗美容", "个护用品"]]
];

const industryAliasEntries: Array<[string, string[]]> = [
  ["基础化工", ["化工"]],
  ["纺织服饰", ["纺织服装"]],
  ["商贸零售", ["商业贸易", "商贸"]],
  ["社会服务", ["休闲服务"]],
  ["建筑装饰", ["建筑"]],
  ["电力设备", ["电气设备", "新能源设备"]],
  ["国防军工", ["军工"]],
  ["非银金融", ["非银行金融", "非银"]],
  ["石油石化", ["石油化工"]],
  ["美容护理", ["美护"]],
  ["白色家电", ["白电"]],
  ["饮料乳品", ["乳品", "饮料制造"]],
  ["IT服务", ["IT服务Ⅱ", "IT 服务"]]
];

export function normalizedIndustryText(value: string | undefined) {
  const text = value?.trim() ?? "";
  return unusableIndustryTexts.has(text) ? "" : text;
}

function rawIndustryKey(value: string | undefined) {
  const text = normalizedIndustryText(value);
  if (!text) return "";
  return text
    .normalize("NFKC")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/申万|中信|证监会|巨潮|东财|东方财富|腾讯|行业|板块|分类|标准|一级|二级|三级|新版|旧版/g, "")
    .replace(/[ⅠⅡⅢ]+$/g, "")
    .replace(/\b(?:i|ii|iii|iv|v)\b$/gi, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
    .toLowerCase();
}

const aliasToCanonical = new Map<string, string>();
const secondaryToPrimary = new Map<string, string>();

function registerIndustryAlias(canonical: string, aliases: string[] = []) {
  [canonical, ...aliases].forEach((item) => {
    const key = rawIndustryKey(item);
    if (key) aliasToCanonical.set(key, canonical);
  });
}

PRIMARY_INDUSTRIES.forEach((industry) => registerIndustryAlias(industry));
secondaryToPrimaryEntries.forEach(([primary, secondaries]) => {
  secondaries.forEach((secondary) => {
    registerIndustryAlias(secondary);
    const secondaryKey = rawIndustryKey(secondary);
    if (secondaryKey) secondaryToPrimary.set(secondaryKey, primary);
  });
});
industryAliasEntries.forEach(([canonical, aliases]) => registerIndustryAlias(canonical, aliases));

function canonicalIndustryText(value: string | undefined) {
  const text = normalizedIndustryText(value);
  if (!text) return "";
  return aliasToCanonical.get(rawIndustryKey(text)) ?? text;
}

export function industryMatchKey(value: string | undefined) {
  return rawIndustryKey(canonicalIndustryText(value));
}

function primaryIndustryText(value: string | undefined) {
  const canonical = canonicalIndustryText(value);
  if (!canonical) return "";
  return secondaryToPrimary.get(industryMatchKey(canonical)) ?? canonical;
}

export function isAllIndustry(value: string | undefined) {
  const text = value?.trim().toLowerCase() ?? "";
  return !text || text === "all" || text === ALL_INDUSTRIES || /^\?+$/.test(text);
}

export function isUsefulIndustryText(value: string | undefined) {
  return Boolean(normalizedIndustryText(value));
}

export function compactIndustryTexts(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const items: string[] = [];
  values.forEach((value) => {
    const text = canonicalIndustryText(value);
    if (!text) return;
    const key = industryMatchKey(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(text);
  });
  return items;
}

export function stockIndustryTexts(stock: Stock) {
  return compactIndustryTexts([stock.industry1, stock.industry2, ...(stock.industryTags ?? [])]);
}

export function inferPrimaryIndustry(stock: Stock) {
  const direct = primaryIndustryText(stock.industry1);
  if (direct) return direct;
  return stockIndustryTexts(stock).map(primaryIndustryText).find(Boolean) || "";
}

export function inferSecondaryIndustry(stock: Stock) {
  const primary = inferPrimaryIndustry(stock);
  const secondary = canonicalIndustryText(stock.industry2);
  if (secondary && industryMatchKey(secondary) !== industryMatchKey(primary)) return secondary;
  return stockIndustryTexts(stock).find((item) => industryMatchKey(item) !== industryMatchKey(primary)) || primary;
}

export function stockMatchesIndustry(stock: Stock, level: "industry1" | "industry2", selected: string | undefined) {
  if (isAllIndustry(selected)) return true;
  const targetKey = industryMatchKey(selected);
  if (!targetKey) return true;
  const texts = stockIndustryTexts(stock);
  const textKeys = texts.map(industryMatchKey);
  if (level === "industry1") {
    const primaryKeys = texts.map(primaryIndustryText).map(industryMatchKey);
    return industryMatchKey(inferPrimaryIndustry(stock)) === targetKey || primaryKeys.includes(targetKey) || textKeys.includes(targetKey);
  }
  return industryMatchKey(inferSecondaryIndustry(stock)) === targetKey || textKeys.includes(targetKey);
}

export function stockIndustryScopeKey(stock: Stock, level: "all" | "industry1" | "industry2") {
  if (level === "industry1") return `industry1:${inferPrimaryIndustry(stock) || "-"}`;
  if (level === "industry2") return `industry2:${inferPrimaryIndustry(stock) || "-"}:${inferSecondaryIndustry(stock) || "-"}`;
  return "all";
}
