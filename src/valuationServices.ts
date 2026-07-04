import type { Stock } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const BUN_VALUATION_ROWS_URL = "/api/valuation/rows";

export type ValuationModel = "DCF现金流" | "PE盈利" | "PB-ROE" | "PS成长" | "股息资产";
export type ValuationStyle = "严苛核算" | "均衡核算" | "保守核算" | "成长核算" | "资产核算";
export type EnterpriseState = "高速成长" | "稳定成熟" | "周期修复" | "困境承压" | "资产防御";
export type ValuationVerdict = "深度低估" | "低估" | "合理" | "偏高" | "高估";
export type ValuationRiskExclusion = "ST" | "*ST" | "退市";

export interface IndustryValuationProfile {
  industry: string;
  model: ValuationModel;
  earningsWeight: number;
  assetWeight: number;
  salesWeight: number;
  cashflowWeight: number;
  targetPe: number;
  targetPb: number;
  targetPs: number;
  cashflowMultiple: number;
  discountRate: number;
  terminalGrowth: number;
  riskBuffer: number;
}

export interface IndustryCashflowPolicy {
  requiredCoverage: number;
  strongCoverage: number;
  floorModifier: number;
  ceilingModifier: number;
  penaltyWeight: number;
  note: string;
}

export interface BalanceSheetBreakdown {
  totalAssets: number;
  productionAssets: number;
  investmentAssets: number;
  totalLiabilities: number;
  interestBearingDebt: number;
  nonInterestBearingDebt: number;
  nonInterestDebtReserveRate: number;
  netInvestmentAssets: number;
  investmentAssetPerShare: number;
  netInvestmentAssetPerShare: number;
  interestDebtRatio: number;
  nonInterestDebtRatio: number;
  productionAssetRatio: number;
}

export interface ValuationFilters {
  boards: ValuationBoardFilter[];
  industries: string[];
  state: "全部" | EnterpriseState;
  style: ValuationStyle;
  stockRiskExclusions: ValuationRiskExclusion[];
  minSafetyMargin: number;
  minGovernanceScore: number;
}

export interface ValuationRow {
  stock: Stock;
  profile: IndustryValuationProfile;
  state: EnterpriseState;
  model: ValuationModel;
  fairValue: number;
  bearValue: number;
  bullValue: number;
  currentPrice: number;
  marketCap: number;
  safetyMargin: number;
  upside: number;
  verdict: ValuationVerdict;
  action: string;
  positionHint: string;
  qualityScore: number;
  growthScore: number;
  solvencyScore: number;
  governanceScore: number;
  industryFitScore: number;
  statusModifier: number;
  governanceModifier: number;
  financialModifier: number;
  riskDiscount: number;
  anchorValue: number;
  drivers: string[];
  warnings: string[];
  components: {
    earningsValue: number;
    assetValue: number;
    salesValue: number;
    cashflowValue: number;
    anchorValue: number;
    weightedValue: number;
    cashCoverage: number;
    cashflowRequirementModifier: number;
    cashflowPolicy: IndustryCashflowPolicy;
    balanceSheet: BalanceSheetBreakdown;
    formulaRows: Array<{
      name: string;
      formula: string;
      substitution: string;
      value: number;
    }>;
  };
}

const round = (value: number, precision = 2) => {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const defaultProfile: IndustryValuationProfile = {
  industry: "通用行业",
  model: "PE盈利",
  earningsWeight: 0.45,
  assetWeight: 0.2,
  salesWeight: 0.15,
  cashflowWeight: 0.2,
  targetPe: 22,
  targetPb: 2.2,
  targetPs: 2.4,
  cashflowMultiple: 16,
  discountRate: 9.5,
  terminalGrowth: 2.2,
  riskBuffer: 12
};

export const industryValuationProfiles: IndustryValuationProfile[] = [
  { industry: "银行", model: "PB-ROE", earningsWeight: 0.15, assetWeight: 0.65, salesWeight: 0, cashflowWeight: 0.2, targetPe: 7, targetPb: 0.9, targetPs: 1, cashflowMultiple: 8, discountRate: 8.5, terminalGrowth: 1.5, riskBuffer: 14 },
  { industry: "非银金融", model: "PB-ROE", earningsWeight: 0.25, assetWeight: 0.5, salesWeight: 0.05, cashflowWeight: 0.2, targetPe: 13, targetPb: 1.3, targetPs: 1.4, cashflowMultiple: 10, discountRate: 9.2, terminalGrowth: 1.8, riskBuffer: 18 },
  { industry: "食品饮料", model: "DCF现金流", earningsWeight: 0.35, assetWeight: 0.1, salesWeight: 0.15, cashflowWeight: 0.4, targetPe: 28, targetPb: 5.5, targetPs: 6, cashflowMultiple: 24, discountRate: 8.8, terminalGrowth: 3, riskBuffer: 10 },
  { industry: "家用电器", model: "DCF现金流", earningsWeight: 0.4, assetWeight: 0.15, salesWeight: 0.1, cashflowWeight: 0.35, targetPe: 18, targetPb: 2.8, targetPs: 1.8, cashflowMultiple: 15, discountRate: 9.2, terminalGrowth: 2.2, riskBuffer: 12 },
  { industry: "电力设备", model: "PS成长", earningsWeight: 0.25, assetWeight: 0.1, salesWeight: 0.35, cashflowWeight: 0.3, targetPe: 30, targetPb: 4, targetPs: 3.6, cashflowMultiple: 22, discountRate: 10.5, terminalGrowth: 3.5, riskBuffer: 20 },
  { industry: "汽车", model: "PS成长", earningsWeight: 0.25, assetWeight: 0.15, salesWeight: 0.35, cashflowWeight: 0.25, targetPe: 24, targetPb: 3, targetPs: 2.2, cashflowMultiple: 18, discountRate: 10.8, terminalGrowth: 3, riskBuffer: 22 },
  { industry: "医药生物", model: "DCF现金流", earningsWeight: 0.35, assetWeight: 0.1, salesWeight: 0.2, cashflowWeight: 0.35, targetPe: 32, targetPb: 4.2, targetPs: 5, cashflowMultiple: 24, discountRate: 10, terminalGrowth: 3.2, riskBuffer: 18 },
  { industry: "电子", model: "PS成长", earningsWeight: 0.25, assetWeight: 0.12, salesWeight: 0.38, cashflowWeight: 0.25, targetPe: 34, targetPb: 4.5, targetPs: 4.2, cashflowMultiple: 24, discountRate: 11, terminalGrowth: 3.5, riskBuffer: 24 },
  { industry: "计算机", model: "PS成长", earningsWeight: 0.22, assetWeight: 0.08, salesWeight: 0.45, cashflowWeight: 0.25, targetPe: 36, targetPb: 4.8, targetPs: 5, cashflowMultiple: 26, discountRate: 11.2, terminalGrowth: 3.8, riskBuffer: 25 },
  { industry: "公用事业", model: "股息资产", earningsWeight: 0.25, assetWeight: 0.35, salesWeight: 0.05, cashflowWeight: 0.35, targetPe: 15, targetPb: 1.7, targetPs: 1.6, cashflowMultiple: 13, discountRate: 7.8, terminalGrowth: 1.8, riskBuffer: 8 },
  { industry: "煤炭", model: "股息资产", earningsWeight: 0.35, assetWeight: 0.25, salesWeight: 0.05, cashflowWeight: 0.35, targetPe: 9, targetPb: 1.2, targetPs: 1.1, cashflowMultiple: 7, discountRate: 10.5, terminalGrowth: 0.8, riskBuffer: 22 },
  { industry: "石油石化", model: "股息资产", earningsWeight: 0.3, assetWeight: 0.3, salesWeight: 0.08, cashflowWeight: 0.32, targetPe: 11, targetPb: 1.1, targetPs: 0.8, cashflowMultiple: 8, discountRate: 10, terminalGrowth: 1, riskBuffer: 20 },
  { industry: "房地产", model: "PB-ROE", earningsWeight: 0.18, assetWeight: 0.62, salesWeight: 0.05, cashflowWeight: 0.15, targetPe: 8, targetPb: 0.75, targetPs: 0.6, cashflowMultiple: 6, discountRate: 12, terminalGrowth: 0.5, riskBuffer: 30 },
  { industry: "有色金属", model: "PB-ROE", earningsWeight: 0.25, assetWeight: 0.35, salesWeight: 0.1, cashflowWeight: 0.3, targetPe: 15, targetPb: 1.9, targetPs: 1.5, cashflowMultiple: 11, discountRate: 11, terminalGrowth: 1.5, riskBuffer: 24 },
  { industry: "机械设备", model: "PE盈利", earningsWeight: 0.38, assetWeight: 0.22, salesWeight: 0.15, cashflowWeight: 0.25, targetPe: 22, targetPb: 2.5, targetPs: 2, cashflowMultiple: 16, discountRate: 10.2, terminalGrowth: 2.4, riskBuffer: 18 },
  { industry: "通信", model: "PS成长", earningsWeight: 0.28, assetWeight: 0.12, salesWeight: 0.35, cashflowWeight: 0.25, targetPe: 28, targetPb: 3.2, targetPs: 3.2, cashflowMultiple: 20, discountRate: 10.8, terminalGrowth: 3, riskBuffer: 22 }
];

export const valuationStyleOptions: ValuationStyle[] = ["严苛核算", "保守核算", "均衡核算", "成长核算", "资产核算"];
export const enterpriseStateOptions: Array<"全部" | EnterpriseState> = ["全部", "高速成长", "稳定成熟", "周期修复", "困境承压", "资产防御"];
export type ValuationBoardFilter = "全部" | "A股" | "沪市" | "深市" | "主板" | "科创板" | "创业板" | "北交所";
export const valuationBoardOptions: ValuationBoardFilter[] = ["全部", "A股", "沪市", "深市", "主板", "科创板", "创业板", "北交所"];

export const defaultValuationFilters: ValuationFilters = {
  boards: ["全部"],
  industries: ["全部"],
  state: "全部",
  style: "严苛核算",
  stockRiskExclusions: ["ST", "*ST", "退市"],
  minSafetyMargin: -999,
  minGovernanceScore: 0
};

const realValuationRequiredFields: Array<{ key: string; label: string; positive?: boolean }> = [
  { key: "price", label: "现价", positive: true },
  { key: "marketCap", label: "市值", positive: true },
  { key: "eps", label: "每股收益EPS" },
  { key: "bps", label: "每股净资产BPS" },
  { key: "revenue", label: "营业收入" },
  { key: "netProfit", label: "净利润" },
  { key: "operatingCashflow", label: "经营现金流" },
  { key: "totalAssets", label: "总资产", positive: true },
  { key: "totalLiabilities", label: "总负债" },
  { key: "investmentAssets", label: "投资性资产" },
  { key: "productionAssets", label: "生产性资产" },
  { key: "interestBearingDebt", label: "有息负债" },
  { key: "nonInterestBearingDebt", label: "无息负债" }
];

export function missingRealValuationFields(stock: Stock) {
  return realValuationRequiredFields
    .filter(({ key, positive }) => {
      const value = stock.metrics[key];
      if (!Number.isFinite(value)) return true;
      return Boolean(positive && value <= 0);
    })
    .map(({ label }) => label);
}

export function hasRequiredRealValuationData(stock: Stock) {
  return missingRealValuationFields(stock).length === 0;
}

function getIndustryProfile(industry: string) {
  return industryValuationProfiles.find((profile) => profile.industry === industry) ?? defaultProfile;
}

function matchesBoardFilter(stock: Stock, board: ValuationBoardFilter) {
  if (board === "全部") return true;
  if (board === "A股") return stock.exchange === "沪市" || stock.exchange === "深市" || stock.exchange === "北交所";
  if (board === "沪市" || board === "深市") return stock.exchange === board;
  return stock.board === board || stock.exchange === board;
}

function styleAdjust(profile: IndustryValuationProfile, style: ValuationStyle): IndustryValuationProfile {
  if (style === "严苛核算") {
    return {
      ...profile,
      targetPe: profile.targetPe * 0.58,
      targetPb: profile.targetPb * 0.62,
      targetPs: profile.targetPs * 0.5,
      cashflowMultiple: profile.cashflowMultiple * 0.55,
      riskBuffer: profile.riskBuffer + 22
    };
  }
  if (style === "保守核算") {
    return {
      ...profile,
      targetPe: profile.targetPe * 0.68,
      targetPb: profile.targetPb * 0.72,
      targetPs: profile.targetPs * 0.62,
      cashflowMultiple: profile.cashflowMultiple * 0.68,
      riskBuffer: profile.riskBuffer + 16
    };
  }
  if (style === "均衡核算") {
    return {
      ...profile,
      targetPe: profile.targetPe * 0.76,
      targetPb: profile.targetPb * 0.78,
      targetPs: profile.targetPs * 0.7,
      cashflowMultiple: profile.cashflowMultiple * 0.74,
      riskBuffer: profile.riskBuffer + 12
    };
  }
  if (style === "成长核算") {
    return {
      ...profile,
      earningsWeight: profile.earningsWeight * 0.9,
      salesWeight: profile.salesWeight + 0.08,
      cashflowWeight: Math.max(0.15, profile.cashflowWeight - 0.04),
      targetPe: profile.targetPe * 0.82,
      targetPb: profile.targetPb * 0.76,
      targetPs: profile.targetPs * 0.78,
      cashflowMultiple: profile.cashflowMultiple * 0.76,
      riskBuffer: profile.riskBuffer + 10
    };
  }
  if (style === "资产核算") {
    return {
      ...profile,
      earningsWeight: Math.max(0.12, profile.earningsWeight - 0.1),
      assetWeight: profile.assetWeight + 0.14,
      salesWeight: Math.max(0, profile.salesWeight - 0.05),
      targetPe: profile.targetPe * 0.7,
      targetPb: profile.targetPb * 0.72,
      targetPs: profile.targetPs * 0.6,
      cashflowMultiple: profile.cashflowMultiple * 0.68,
      riskBuffer: profile.riskBuffer + 14
    };
  }
  return profile;
}

const positive = (value: number | undefined) => Math.max(value ?? 0, 0);

const strictIndustryCaps: Record<string, { pe: number; pb: number; ps: number; cashflow: number }> = {
  银行: { pe: 5.8, pb: 0.75, ps: 0.7, cashflow: 6 },
  非银金融: { pe: 9, pb: 0.95, ps: 0.8, cashflow: 7 },
  食品饮料: { pe: 18, pb: 3, ps: 2.8, cashflow: 15 },
  家用电器: { pe: 13, pb: 1.8, ps: 1.05, cashflow: 10 },
  电力设备: { pe: 15, pb: 1.8, ps: 1.15, cashflow: 10 },
  汽车: { pe: 14, pb: 1.45, ps: 0.8, cashflow: 9 },
  医药生物: { pe: 18, pb: 2.2, ps: 1.8, cashflow: 12 },
  电子: { pe: 16, pb: 2, ps: 1.5, cashflow: 10 },
  计算机: { pe: 18, pb: 2.1, ps: 1.7, cashflow: 11 },
  公用事业: { pe: 11, pb: 1.15, ps: 0.9, cashflow: 9 },
  煤炭: { pe: 7, pb: 0.95, ps: 0.65, cashflow: 6 },
  石油石化: { pe: 8, pb: 0.85, ps: 0.55, cashflow: 6 },
  房地产: { pe: 5.5, pb: 0.5, ps: 0.35, cashflow: 4 },
  有色金属: { pe: 10, pb: 1.25, ps: 0.85, cashflow: 7 },
  机械设备: { pe: 14, pb: 1.6, ps: 1, cashflow: 9 },
  通信: { pe: 16, pb: 1.8, ps: 1.3, cashflow: 10 }
};

function getStrictCaps(industry: string) {
  return strictIndustryCaps[industry] ?? { pe: 12, pb: 1.2, ps: 0.75, cashflow: 8 };
}

const industryCashflowPolicies: Record<string, IndustryCashflowPolicy> = {
  银行: { requiredCoverage: 0.35, strongCoverage: 0.65, floorModifier: 0.42, ceilingModifier: 0.7, penaltyWeight: 0.1, note: "金融行业现金流受资产负债结构影响，低于一般制造业要求" },
  非银金融: { requiredCoverage: 0.45, strongCoverage: 0.75, floorModifier: 0.4, ceilingModifier: 0.72, penaltyWeight: 0.12, note: "金融资产波动较大，现金流只作辅助约束" },
  食品饮料: { requiredCoverage: 1.05, strongCoverage: 1.35, floorModifier: 0.3, ceilingModifier: 0.84, penaltyWeight: 0.24, note: "消费品应具备高利润现金转化，现金流要求高" },
  家用电器: { requiredCoverage: 0.95, strongCoverage: 1.2, floorModifier: 0.32, ceilingModifier: 0.8, penaltyWeight: 0.22, note: "制造+渠道行业要求经营现金流接近利润" },
  电力设备: { requiredCoverage: 0.75, strongCoverage: 1.05, floorModifier: 0.28, ceilingModifier: 0.74, penaltyWeight: 0.2, note: "成长制造行业允许阶段性扩产占款，但低于门槛需重扣" },
  汽车: { requiredCoverage: 0.7, strongCoverage: 1, floorModifier: 0.28, ceilingModifier: 0.74, penaltyWeight: 0.2, note: "汽车产业链资本开支高，现金流按低于消费行业的门槛约束" },
  医药生物: { requiredCoverage: 0.85, strongCoverage: 1.15, floorModifier: 0.3, ceilingModifier: 0.78, penaltyWeight: 0.21, note: "研发投入影响现金流，但成熟企业仍需较高覆盖" },
  电子: { requiredCoverage: 0.68, strongCoverage: 0.95, floorModifier: 0.26, ceilingModifier: 0.72, penaltyWeight: 0.2, note: "半导体和电子扩产周期长，现金流门槛低于消费但低于门槛不放宽" },
  计算机: { requiredCoverage: 0.75, strongCoverage: 1.05, floorModifier: 0.3, ceilingModifier: 0.76, penaltyWeight: 0.2, note: "软件收入需验证回款质量，现金流要求高于硬科技制造" },
  公用事业: { requiredCoverage: 1.15, strongCoverage: 1.45, floorModifier: 0.34, ceilingModifier: 0.84, penaltyWeight: 0.24, note: "稳定分红资产必须用现金流覆盖利润和资本开支压力" },
  煤炭: { requiredCoverage: 1.2, strongCoverage: 1.5, floorModifier: 0.34, ceilingModifier: 0.82, penaltyWeight: 0.25, note: "周期资源品按高现金流覆盖要求，防止周期顶部利润虚高" },
  石油石化: { requiredCoverage: 1.1, strongCoverage: 1.4, floorModifier: 0.32, ceilingModifier: 0.8, penaltyWeight: 0.23, note: "重资产周期行业要求现金流强覆盖" },
  房地产: { requiredCoverage: 1.3, strongCoverage: 1.7, floorModifier: 0.18, ceilingModifier: 0.58, penaltyWeight: 0.3, note: "高杠杆行业要求销售回款强覆盖，否则现金流模型重扣" },
  有色金属: { requiredCoverage: 1.05, strongCoverage: 1.35, floorModifier: 0.3, ceilingModifier: 0.76, penaltyWeight: 0.23, note: "周期行业要求利润有现金支撑" },
  机械设备: { requiredCoverage: 0.9, strongCoverage: 1.2, floorModifier: 0.3, ceilingModifier: 0.78, penaltyWeight: 0.22, note: "订单制造行业关注应收回款，现金流需接近利润" },
  通信: { requiredCoverage: 0.8, strongCoverage: 1.08, floorModifier: 0.3, ceilingModifier: 0.75, penaltyWeight: 0.2, note: "设备与运营链条现金流要求中等偏高" }
};

function getCashflowPolicy(industry: string) {
  return industryCashflowPolicies[industry] ?? {
    requiredCoverage: 0.9,
    strongCoverage: 1.2,
    floorModifier: 0.3,
    ceilingModifier: 0.76,
    penaltyWeight: 0.22,
    note: "通用行业要求经营现金流接近利润"
  };
}

interface BalanceSheetPolicy {
  investmentAssetRatio: number;
  interestBearingDebtRatio: number;
  nonInterestDebtReserveRate: number;
  interestDebtLimit: number;
  nonInterestDebtLimit: number;
}

const balanceSheetPolicies: Record<string, BalanceSheetPolicy> = {
  银行: { investmentAssetRatio: 0.72, interestBearingDebtRatio: 0.76, nonInterestDebtReserveRate: 0.08, interestDebtLimit: 78, nonInterestDebtLimit: 18 },
  非银金融: { investmentAssetRatio: 0.62, interestBearingDebtRatio: 0.58, nonInterestDebtReserveRate: 0.12, interestDebtLimit: 55, nonInterestDebtLimit: 22 },
  食品饮料: { investmentAssetRatio: 0.16, interestBearingDebtRatio: 0.28, nonInterestDebtReserveRate: 0.3, interestDebtLimit: 22, nonInterestDebtLimit: 36 },
  家用电器: { investmentAssetRatio: 0.14, interestBearingDebtRatio: 0.34, nonInterestDebtReserveRate: 0.32, interestDebtLimit: 28, nonInterestDebtLimit: 42 },
  电力设备: { investmentAssetRatio: 0.12, interestBearingDebtRatio: 0.46, nonInterestDebtReserveRate: 0.35, interestDebtLimit: 36, nonInterestDebtLimit: 44 },
  汽车: { investmentAssetRatio: 0.12, interestBearingDebtRatio: 0.44, nonInterestDebtReserveRate: 0.35, interestDebtLimit: 36, nonInterestDebtLimit: 45 },
  医药生物: { investmentAssetRatio: 0.18, interestBearingDebtRatio: 0.34, nonInterestDebtReserveRate: 0.32, interestDebtLimit: 28, nonInterestDebtLimit: 38 },
  电子: { investmentAssetRatio: 0.13, interestBearingDebtRatio: 0.48, nonInterestDebtReserveRate: 0.35, interestDebtLimit: 38, nonInterestDebtLimit: 44 },
  计算机: { investmentAssetRatio: 0.2, interestBearingDebtRatio: 0.28, nonInterestDebtReserveRate: 0.28, interestDebtLimit: 24, nonInterestDebtLimit: 38 },
  公用事业: { investmentAssetRatio: 0.12, interestBearingDebtRatio: 0.56, nonInterestDebtReserveRate: 0.34, interestDebtLimit: 48, nonInterestDebtLimit: 36 },
  煤炭: { investmentAssetRatio: 0.2, interestBearingDebtRatio: 0.42, nonInterestDebtReserveRate: 0.32, interestDebtLimit: 36, nonInterestDebtLimit: 36 },
  石油石化: { investmentAssetRatio: 0.18, interestBearingDebtRatio: 0.48, nonInterestDebtReserveRate: 0.34, interestDebtLimit: 42, nonInterestDebtLimit: 38 },
  房地产: { investmentAssetRatio: 0.28, interestBearingDebtRatio: 0.68, nonInterestDebtReserveRate: 0.42, interestDebtLimit: 45, nonInterestDebtLimit: 50 },
  有色金属: { investmentAssetRatio: 0.18, interestBearingDebtRatio: 0.5, nonInterestDebtReserveRate: 0.36, interestDebtLimit: 40, nonInterestDebtLimit: 40 },
  机械设备: { investmentAssetRatio: 0.13, interestBearingDebtRatio: 0.42, nonInterestDebtReserveRate: 0.35, interestDebtLimit: 34, nonInterestDebtLimit: 42 },
  通信: { investmentAssetRatio: 0.16, interestBearingDebtRatio: 0.42, nonInterestDebtReserveRate: 0.34, interestDebtLimit: 34, nonInterestDebtLimit: 42 }
};

function getBalanceSheetPolicy(industry: string) {
  return balanceSheetPolicies[industry] ?? { investmentAssetRatio: 0.14, interestBearingDebtRatio: 0.42, nonInterestDebtReserveRate: 0.35, interestDebtLimit: 34, nonInterestDebtLimit: 40 };
}

function explicitPositiveMetric(stock: Stock, key: string) {
  const value = stock.metrics[key];
  return Number.isFinite(value) ? Math.max(value, 0) : undefined;
}

function estimateBalanceSheetBreakdown(stock: Stock, shareBase: number, bps: number): BalanceSheetBreakdown {
  const m = stock.metrics;
  const policy = getBalanceSheetPolicy(stock.industry1);
  const totalAssets = positive(m.totalAssets) || positive(bps) * shareBase;
  const totalLiabilities = Math.min(positive(m.totalLiabilities) || totalAssets * positive(m.debtRatio) / 100, totalAssets);
  const explicitInterestDebt = explicitPositiveMetric(stock, "interestBearingDebt");
  const explicitNonInterestDebt = explicitPositiveMetric(stock, "nonInterestBearingDebt");
  const inferredInterestDebt = totalLiabilities * policy.interestBearingDebtRatio;
  let interestBearingDebt = Math.min(explicitInterestDebt ?? inferredInterestDebt, totalLiabilities);
  let nonInterestBearingDebt = explicitNonInterestDebt ?? Math.max(totalLiabilities - interestBearingDebt, 0);
  if (interestBearingDebt + nonInterestBearingDebt > totalLiabilities && totalLiabilities > 0) {
    const scale = totalLiabilities / (interestBearingDebt + nonInterestBearingDebt);
    interestBearingDebt *= scale;
    nonInterestBearingDebt *= scale;
  }

  const explicitInvestmentAssets = explicitPositiveMetric(stock, "investmentAssets");
  const explicitProductionAssets = explicitPositiveMetric(stock, "productionAssets");
  const operatingWorkingAssets = positive(m.inventory) + positive(m.receivables);
  const inferredInvestmentAssets = clamp(totalAssets * policy.investmentAssetRatio - operatingWorkingAssets * 0.18, 0, totalAssets);
  const investmentAssets = Math.min(explicitInvestmentAssets ?? inferredInvestmentAssets, totalAssets);
  const productionAssets = Math.min(explicitProductionAssets ?? Math.max(totalAssets - investmentAssets, 0), totalAssets);
  const nonInterestDebtReserve = nonInterestBearingDebt * policy.nonInterestDebtReserveRate;
  const netInvestmentAssets = Math.max(investmentAssets - interestBearingDebt - nonInterestDebtReserve, 0);

  return {
    totalAssets: round(totalAssets, 2),
    productionAssets: round(productionAssets, 2),
    investmentAssets: round(investmentAssets, 2),
    totalLiabilities: round(totalLiabilities, 2),
    interestBearingDebt: round(interestBearingDebt, 2),
    nonInterestBearingDebt: round(nonInterestBearingDebt, 2),
    nonInterestDebtReserveRate: policy.nonInterestDebtReserveRate,
    netInvestmentAssets: round(netInvestmentAssets, 2),
    investmentAssetPerShare: round(investmentAssets / shareBase, 2),
    netInvestmentAssetPerShare: round(netInvestmentAssets / shareBase, 2),
    interestDebtRatio: round(totalAssets > 0 ? interestBearingDebt / totalAssets * 100 : 0, 2),
    nonInterestDebtRatio: round(totalAssets > 0 ? nonInterestBearingDebt / totalAssets * 100 : 0, 2),
    productionAssetRatio: round(totalAssets > 0 ? productionAssets / totalAssets * 100 : 0, 2)
  };
}

function cashflowQualityModifier(cashCoverage: number, policy: IndustryCashflowPolicy) {
  const lowerBound = policy.requiredCoverage * 0.45;
  const normalized = clamp((cashCoverage - lowerBound) / Math.max(policy.strongCoverage - lowerBound, 0.01), 0, 1);
  return clamp(policy.floorModifier + normalized * (policy.ceilingModifier - policy.floorModifier), policy.floorModifier, policy.ceilingModifier);
}

function strictPbByRoe(roe: number) {
  if (roe < 5) return 0.55;
  if (roe < 8) return 0.75;
  if (roe < 12) return 0.95;
  if (roe < 18) return 1.25;
  if (roe < 25) return 1.55;
  return 1.8;
}

function strictFinancialModifier(stock: Stock, state: EnterpriseState, cashflowPolicy: IndustryCashflowPolicy, balanceSheet: BalanceSheetBreakdown) {
  const m = stock.metrics;
  const isFinancial = stock.industry1 === "银行" || stock.industry1 === "非银金融";
  const debtPolicy = getBalanceSheetPolicy(stock.industry1);
  const interestDebtPenalty = clamp((balanceSheet.interestDebtRatio - debtPolicy.interestDebtLimit) / 140, 0, isFinancial ? 0.1 : 0.26);
  const nonInterestDebtPenalty = clamp((balanceSheet.nonInterestDebtRatio - debtPolicy.nonInterestDebtLimit) / 260, 0, isFinancial ? 0.05 : 0.12);
  const totalDebtPenalty = clamp(((m.debtRatio ?? 50) - (isFinancial ? 92 : 68)) / 200, 0, isFinancial ? 0.04 : 0.08);
  const debtPenalty = interestDebtPenalty + nonInterestDebtPenalty + totalDebtPenalty;
  const currentRatioPenalty = !isFinancial && (m.currentRatio ?? 1) < 1 ? clamp((1 - (m.currentRatio ?? 1)) * 0.16, 0, 0.12) : 0;
  const cashCoverage = positive(m.netProfit) > 0 ? (m.operatingCashflow ?? 0) / Math.max(m.netProfit ?? 0, 0.01) : positive(m.operatingCashflow) > 0 ? 0.45 : 0;
  const cashPenalty = cashCoverage < cashflowPolicy.requiredCoverage
    ? clamp((cashflowPolicy.requiredCoverage - cashCoverage) * cashflowPolicy.penaltyWeight, 0, 0.24)
    : 0;
  const receivableRatio = positive(m.revenue) > 0 ? positive(m.receivables) / positive(m.revenue) : 0;
  const receivablePenalty = receivableRatio > 0.18 ? clamp((receivableRatio - 0.18) * 0.55, 0, 0.14) : 0;
  const pledgePenalty = clamp(((m.pledgeRatio ?? 0) - 12) / 140, 0, 0.22);
  const violationPenalty = clamp((m.violationScore ?? 0) / 260, 0, 0.32);
  const statePenalty = state === "困境承压" ? 0.18 : state === "周期修复" ? 0.08 : 0;
  const stPenalty = stock.isST ? 0.35 : 0;
  return clamp(1 - debtPenalty - currentRatioPenalty - cashPenalty - receivablePenalty - pledgePenalty - violationPenalty - statePenalty - stPenalty, 0.32, 0.88);
}

function strictRiskDiscount(profile: IndustryValuationProfile, stock: Stock) {
  const m = stock.metrics;
  const boardPenalty = stock.board === "科创板" || stock.board === "创业板" ? 5 : stock.board === "北交所" ? 8 : 0;
  const liquidityPenalty = stock.isMargin ? 0 : 4;
  const sizePenalty = (m.marketCap ?? 0) < 80 ? 6 : (m.marketCap ?? 0) < 200 ? 3 : 0;
  const volatilityPenalty = (m.priceAmplitude ?? 0) > 8 ? 4 : 0;
  const totalBuffer = profile.riskBuffer + boardPenalty + liquidityPenalty + sizePenalty + volatilityPenalty;
  return clamp(1 - totalBuffer / 100, 0.38, 0.78);
}

function inferEnterpriseState(stock: Stock): EnterpriseState {
  const m = stock.metrics;
  if ((m.revenueGrowth ?? 0) > 35 && (m.momentum60 ?? 0) > 18 && (m.qualityScore ?? 0) > 58) return "高速成长";
  if ((m.debtRatio ?? 0) > 72 || (m.violationScore ?? 0) > 60 || stock.isST) return "困境承压";
  if ((m.dividendYield ?? 0) > 3.2 && ["银行", "煤炭", "公用事业", "石油石化"].includes(stock.industry1)) return "资产防御";
  if ((m.profitGrowth ?? 0) > 18 && (m.revenueGrowth ?? 0) > 8 && (m.pb ?? 0) < 2.2) return "周期修复";
  return "稳定成熟";
}

function scoreGovernance(stock: Stock) {
  const m = stock.metrics;
  const pledgePenalty = (m.pledgeRatio ?? 0) * 0.65;
  const violationPenalty = (m.violationScore ?? 0) * 0.75;
  const insiderBonus = Math.min((m.insiderHolding ?? 0) * 0.55, 14);
  const fundBonus = Math.min((m.fundHolding ?? 0) * 0.35, 12);
  const ownershipBonus = stock.property === "国企" ? 5 : stock.property === "外资" ? 4 : 0;
  return clamp(78 - pledgePenalty - violationPenalty + insiderBonus + fundBonus + ownershipBonus, 0, 100);
}

function statusModifier(state: EnterpriseState) {
  if (state === "稳定成熟") return 0.94;
  if (state === "高速成长") return 0.9;
  if (state === "资产防御") return 0.88;
  if (state === "周期修复") return 0.82;
  return 0.55;
}

function verdictForMargin(margin: number): ValuationVerdict {
  if (margin >= 60) return "深度低估";
  if (margin >= 35) return "低估";
  if (margin >= 10) return "合理";
  if (margin >= -15) return "偏高";
  return "高估";
}

function actionFor(row: Pick<ValuationRow, "safetyMargin" | "governanceScore" | "state">) {
  if (row.governanceScore < 45 || row.state === "困境承压") return "仅观察，等待治理/现金流拐点";
  if (row.safetyMargin >= 60) return "满足严苛安全边际，可小仓分批验证";
  if (row.safetyMargin >= 35) return "进入候选池，等待价格回撤或业绩确认";
  if (row.safetyMargin >= 10) return "接近严苛价值，仅跟踪不追价";
  return "未满足严苛口径，暂不配置";
}

function positionHintFor(row: Pick<ValuationRow, "safetyMargin" | "governanceScore" | "state">) {
  if (row.governanceScore < 45 || row.state === "困境承压") return "0-2%";
  if (row.safetyMargin >= 60) return "5-8%";
  if (row.safetyMargin >= 35) return "3-5%";
  if (row.safetyMargin >= 10) return "1-3%";
  return "0%";
}

function calculateValuation(stock: Stock, style: ValuationStyle = "严苛核算"): ValuationRow {
  const rawProfile = getIndustryProfile(stock.industry1);
  const profile = styleAdjust(rawProfile, style);
  const m = stock.metrics;
  const price = Math.max(m.price ?? 0, 0.01);
  const shareBase = Math.max((m.marketCap ?? 0) / price, 0.01);
  const eps = m.eps ?? 0;
  const bps = m.bps ?? price / Math.max(m.pb ?? 1, 0.1);
  const cashflowPolicy = getCashflowPolicy(stock.industry1);
  const balanceSheet = estimateBalanceSheetBreakdown(stock, shareBase, bps);
  const revenuePerShare = positive(m.revenue) / shareBase;
  const cashflowPerShare = (m.operatingCashflow ?? 0) / shareBase;
  const qualityScore = clamp(m.qualityScore ?? 50, 0, 100);
  const growthScore = clamp(((m.revenueGrowth ?? 0) * 0.45 + (m.profitGrowth ?? 0) * 0.35 + (m.epsForecastGrowth ?? 0) * 0.2 + 30), 0, 100);
  const solvencyScore = clamp(108 - balanceSheet.interestDebtRatio * 0.9 - balanceSheet.nonInterestDebtRatio * 0.25 + (m.currentRatio ?? 1) * 7, 0, 100);
  const governanceScore = scoreGovernance(stock);
  const industryFitScore = clamp((m.industryMomentum ?? 50) * 0.55 + (m.ratingScore ?? 2.5) * 7 + (m.fundHolding ?? 0) * 0.35, 0, 100);
  const state = inferEnterpriseState(stock);
  const caps = getStrictCaps(stock.industry1);
  const profitGrowth = m.profitGrowth ?? 0;
  const epsStabilityModifier = clamp(0.55 + Math.min(qualityScore, 85) / 360 + clamp(profitGrowth, -40, 35) / 420, 0.42, 0.86);
  const cashCoverage = positive(m.netProfit) > 0 ? (m.operatingCashflow ?? 0) / Math.max(m.netProfit ?? 0, 0.01) : positive(m.operatingCashflow) > 0 ? 0.45 : 0;
  const cashflowRequirementModifier = clamp(cashCoverage / Math.max(cashflowPolicy.requiredCoverage, 0.01), 0, 1);
  const cashConversionModifier = cashflowQualityModifier(cashCoverage, cashflowPolicy);
  const marginModifier = clamp((m.netMargin ?? 0) / 24, 0.08, 0.72);
  const solvencyModifier = clamp(0.48 + solvencyScore / 240, 0.48, 0.86);
  const governanceModifier = clamp(0.5 + governanceScore / 260, 0.5, 0.88);
  const stateModifier = statusModifier(state);
  const financialModifier = strictFinancialModifier(stock, state, cashflowPolicy, balanceSheet);
  const riskDiscount = strictRiskDiscount(profile, stock);
  const strictPe = clamp(Math.min(profile.targetPe, caps.pe) * (profitGrowth < 0 ? 0.78 : profitGrowth < 5 ? 0.9 : 1), 2.5, caps.pe);
  const strictPb = clamp(Math.min(profile.targetPb, caps.pb, strictPbByRoe(m.roe ?? 0)), 0.25, caps.pb);
  const strictPs = clamp(Math.min(profile.targetPs, caps.ps) * ((m.netMargin ?? 0) <= 0 ? 0.35 : 1), 0.05, caps.ps);
  const strictCashflowMultiple = clamp(Math.min(profile.cashflowMultiple, caps.cashflow), 2, caps.cashflow);
  const investmentAssetRecoveryRate = clamp(Math.min(strictPb, stock.industry1 === "银行" || stock.industry1 === "非银金融" ? 0.74 : 0.68), 0.08, 0.74);
  const normalizedEps = positive(eps) * epsStabilityModifier;
  const earningsValue = normalizedEps * strictPe;
  const assetValue = balanceSheet.netInvestmentAssetPerShare * investmentAssetRecoveryRate * solvencyModifier;
  const salesValue = revenuePerShare * strictPs * marginModifier * cashConversionModifier * 0.72;
  const rawOwnerCashflowPerShare =
    cashflowPerShare > 0 ? (positive(eps) > 0 ? Math.min(cashflowPerShare, positive(eps) * 1.05) : cashflowPerShare * 0.35) : 0;
  const ownerCashflowPerShare = rawOwnerCashflowPerShare * cashflowRequirementModifier;
  const cashflowValue = ownerCashflowPerShare * strictCashflowMultiple * cashConversionModifier;
  const modelOutputs = [
    { name: "盈利底线", value: earningsValue },
    { name: "资产折算", value: assetValue },
    { name: "收入折价", value: salesValue },
    { name: "现金流底线", value: cashflowValue }
  ].sort((a, b) => a.value - b.value);
  const eligibleModels = modelOutputs.filter((item) => item.value > 0.01);
  const lowestModel = eligibleModels[0] ?? { name: "最低可用值", value: 0.01 };
  const secondLowestModel = eligibleModels[1] ?? lowestModel;
  const anchorValue = lowestModel.value * 0.7 + secondLowestModel.value * 0.3;
  const fairValue = round(Math.max(0.01, anchorValue * governanceModifier * stateModifier * financialModifier * riskDiscount), 2);
  const bearValue = round(fairValue * 0.72, 2);
  const bullValue = round(fairValue * (1.05 + Math.min(Math.max(growthScore, 0), 60) / 1000), 2);
  const safetyMargin = round(((fairValue - price) / price) * 100, 2);
  const rowBase = {
    safetyMargin,
    governanceScore,
    state
  };
  const drivers = [
    `${rawProfile.industry === "通用行业" ? "通用" : rawProfile.industry}采用严苛${profile.model}参考模型，目标倍数已按行业上限压低`,
    `低位锚定：${lowestModel.name}${round(lowestModel.value, 2)} 与 ${secondLowestModel.name}${round(secondLowestModel.value, 2)} 参与合成`,
    `现金流行业门槛：${stock.industry1}要求经营现金流/净利润≥${round(cashflowPolicy.requiredCoverage * 100, 0)}%，当前${round(cashCoverage * 100, 1)}%`,
    `资产模型只纳入投资性资产：投资性资产${balanceSheet.investmentAssets}亿，生产性资产${balanceSheet.productionAssets}亿不列入资产价值`,
    `负债拆分：有息负债${balanceSheet.interestBearingDebt}亿全额扣减，无息负债${balanceSheet.nonInterestBearingDebt}亿按${round(balanceSheet.nonInterestDebtReserveRate * 100, 0)}%预留`,
    `所有修正均不提供成长溢价：治理${round(governanceModifier, 2)}x / 状态${round(stateModifier, 2)}x / 财务${round(financialModifier, 2)}x / 风险${round(riskDiscount, 2)}x`
  ];
  const warnings = [
    eps <= 0 ? "EPS为负或缺失，盈利模型按0处理" : "",
    cashflowPerShare <= 0 ? "经营现金流为负或缺失，现金流模型按0处理" : "",
    cashCoverage < cashflowPolicy.requiredCoverage ? `现金流覆盖低于${stock.industry1}门槛：${round(cashCoverage * 100, 1)}% < ${round(cashflowPolicy.requiredCoverage * 100, 0)}%` : "",
    balanceSheet.netInvestmentAssets <= 0 ? "投资性资产扣除有息负债与无息负债预留后为0，资产模型按0处理" : "",
    balanceSheet.interestDebtRatio > getBalanceSheetPolicy(stock.industry1).interestDebtLimit ? `有息负债率高于行业严苛线：${round(balanceSheet.interestDebtRatio, 1)}%` : "",
    (m.pledgeRatio ?? 0) > 20 ? `股权质押偏高：${round(m.pledgeRatio ?? 0, 1)}%` : "",
    (m.violationScore ?? 0) > 35 ? `违规风险分偏高：${round(m.violationScore ?? 0, 1)}` : "",
    (m.debtRatio ?? 0) > 68 ? `资产负债率偏高：${round(m.debtRatio ?? 0, 1)}%` : "",
    financialModifier < 0.65 ? `财务扣减较重：${round(financialModifier, 2)}x` : "",
    governanceScore < 45 ? `治理分低于严苛门槛：${round(governanceScore, 1)}` : "",
    safetyMargin < 0 ? "当前价格高于核算价值" : ""
  ].filter(Boolean);

  return {
    stock,
    profile,
    state,
    model: profile.model,
    fairValue,
    bearValue,
    bullValue,
    currentPrice: round(price, 2),
    marketCap: round(m.marketCap ?? 0, 2),
    safetyMargin,
    upside: safetyMargin,
    verdict: verdictForMargin(safetyMargin),
    action: actionFor(rowBase),
    positionHint: positionHintFor(rowBase),
    qualityScore: round(qualityScore, 1),
    growthScore: round(growthScore, 1),
    solvencyScore: round(solvencyScore, 1),
    governanceScore: round(governanceScore, 1),
    industryFitScore: round(industryFitScore, 1),
    statusModifier: round(stateModifier, 2),
    governanceModifier: round(governanceModifier, 2),
    financialModifier: round(financialModifier, 2),
    riskDiscount: round(riskDiscount, 2),
    anchorValue: round(anchorValue, 2),
    drivers,
    warnings,
    components: {
      earningsValue: round(earningsValue, 2),
      assetValue: round(assetValue, 2),
      salesValue: round(salesValue, 2),
      cashflowValue: round(cashflowValue, 2),
      anchorValue: round(anchorValue, 2),
      weightedValue: round(anchorValue, 2),
      cashCoverage: round(cashCoverage, 4),
      cashflowRequirementModifier: round(cashflowRequirementModifier, 2),
      cashflowPolicy,
      balanceSheet,
      formulaRows: [
        {
          name: "盈利底线",
          formula: "max(EPS, 0) × 盈利稳定折扣 × min(目标PE, 行业PE上限)",
          substitution: `${round(positive(eps), 2)} × ${round(epsStabilityModifier, 2)} × ${round(strictPe, 2)}`,
          value: round(earningsValue, 2)
        },
        {
          name: "投资资产折算",
          formula: "max(投资性资产 - 有息负债 - 无息负债×预留比例, 0) / 股本 × 投资资产回收率 × 偿债折扣；生产性资产不计入",
          substitution: `max(${balanceSheet.investmentAssets} - ${balanceSheet.interestBearingDebt} - ${balanceSheet.nonInterestBearingDebt} × ${round(balanceSheet.nonInterestDebtReserveRate, 2)}, 0) / ${round(shareBase, 2)} × ${round(investmentAssetRecoveryRate, 2)} × ${round(solvencyModifier, 2)}`,
          value: round(assetValue, 2)
        },
        {
          name: "收入折价",
          formula: "单股收入 × min(目标PS, 行业PS上限) × 净利率折扣 × 现金含量折扣 × 0.72",
          substitution: `${round(revenuePerShare, 2)} × ${round(strictPs, 2)} × ${round(marginModifier, 2)} × ${round(cashConversionModifier, 2)} × 0.72`,
          value: round(salesValue, 2)
        },
        {
          name: "现金流底线",
          formula: "min(单股经营现金流, EPS×1.05) × 行业现金流门槛折扣 × 现金流倍数上限 × 现金含量折扣",
          substitution: `${round(rawOwnerCashflowPerShare, 2)} × ${round(cashflowRequirementModifier, 2)} × ${round(strictCashflowMultiple, 2)} × ${round(cashConversionModifier, 2)}（${stock.industry1}要求覆盖${round(cashflowPolicy.requiredCoverage * 100, 0)}%）`,
          value: round(cashflowValue, 2)
        },
        {
          name: "严苛锚定",
          formula: "最低可用模型值 × 70% + 次低可用模型值 × 30%",
          substitution: `${lowestModel.name}${round(lowestModel.value, 2)} × 0.70 + ${secondLowestModel.name}${round(secondLowestModel.value, 2)} × 0.30`,
          value: round(anchorValue, 2)
        },
        {
          name: "核算价值",
          formula: "严苛锚定 × 治理折扣 × 状态折扣 × 财务扣减 × 风险折扣",
          substitution: `${round(anchorValue, 2)} × ${round(governanceModifier, 2)} × ${round(stateModifier, 2)} × ${round(financialModifier, 2)} × ${round(riskDiscount, 2)}`,
          value: fairValue
        }
      ]
    }
  };
}

export function buildValuationRows(_stocks: Stock[], _filters: ValuationFilters): ValuationRow[] {
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumberField(row: Record<string, unknown>, key: keyof ValuationRow, index: number) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Bun valuation API returned invalid valuation row ${index}: ${String(key)} must be a finite number`);
  }
}

function valuationRowFromPayloadRow(row: unknown, index: number): ValuationRow {
  if (!isRecord(row)) throw new Error(`Bun valuation API returned invalid valuation row ${index}: row must be an object`);
  if (!isRecord(row.stock) || typeof row.stock.code !== "string" || typeof row.stock.name !== "string") {
    throw new Error(`Bun valuation API returned invalid valuation row ${index}: stock must be a stock object`);
  }
  ["fairValue", "safetyMargin", "governanceScore", "qualityScore"].forEach((key) => finiteNumberField(row, key as keyof ValuationRow, index));
  if (!isRecord(row.profile)) throw new Error(`Bun valuation API returned invalid valuation row ${index}: profile must be an object`);
  if (!isRecord(row.components) || !Array.isArray(row.components.formulaRows)) {
    throw new Error(`Bun valuation API returned invalid valuation row ${index}: components.formulaRows must be an array`);
  }
  return row as unknown as ValuationRow;
}

export async function buildValuationRowsBunFirst(
  stocks: Stock[],
  filters: ValuationFilters,
  fetchImpl?: FetchLike
): Promise<ValuationRow[]> {
  const request = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!request) throw new Error("Bun valuation API unavailable: fetch is not available");

  const response = await request(BUN_VALUATION_ROWS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stocks, filters })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details.trim() ? `: ${details.trim().slice(0, 300)}` : "";
    throw new Error(`Bun valuation API HTTP ${response.status}${suffix}`);
  }
  let rows: unknown;
  try {
    rows = await response.json();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Bun valuation API returned invalid JSON: ${detail}`);
  }
  if (!Array.isArray(rows)) throw new Error("Bun valuation API returned invalid valuation rows");
  return rows.map(valuationRowFromPayloadRow);
}

export function summarizeValuationRows(rows: ValuationRow[]) {
  const count = rows.length || 1;
  const undervalued = rows.filter((row) => row.safetyMargin >= 35).length;
  const overvalued = rows.filter((row) => row.safetyMargin < -15).length;
  const avgSafetyMargin = rows.reduce((sum, row) => sum + row.safetyMargin, 0) / count;
  const avgGovernance = rows.reduce((sum, row) => sum + row.governanceScore, 0) / count;
  const avgQuality = rows.reduce((sum, row) => sum + row.qualityScore, 0) / count;
  const topIndustry = Array.from(
    rows.reduce((map, row) => map.set(row.stock.industry1, (map.get(row.stock.industry1) ?? 0) + 1), new Map<string, number>())
  ).sort((a, b) => b[1] - a[1])[0];
  return {
    undervalued,
    overvalued,
    avgSafetyMargin: round(avgSafetyMargin, 2),
    avgGovernance: round(avgGovernance, 1),
    avgQuality: round(avgQuality, 1),
    topIndustry: topIndustry ? `${topIndustry[0]} ${topIndustry[1]}` : "--"
  };
}
