export interface MarketOverviewRow {
  pctChange?: unknown;
  amount?: unknown;
  [key: string]: unknown;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function buildMarketOverview(rows: MarketOverviewRow[], checkedAt = new Date().toISOString()) {
  let advancers = 0;
  let decliners = 0;
  let flatCount = 0;
  let limitUp = 0;
  let limitDown = 0;
  let changeSum = 0;
  let amountSum = 0;
  let valid = 0;

  for (const row of rows) {
    const pct = finiteNumber(row.pctChange ?? row["涨跌幅"]);
    const amount = finiteNumber(row.amount ?? row["成交额"]);
    if (pct === undefined) continue;
    valid += 1;
    changeSum += pct;
    amountSum += amount ?? 0;
    if (pct > 0.01) advancers += 1;
    else if (pct < -0.01) decliners += 1;
    else flatCount += 1;
    if (pct >= 9.8) limitUp += 1;
    if (pct <= -9.8) limitDown += 1;
  }

  const count = valid || 1;
  const avgChange = changeSum / count;
  const breadthScore = clampScore((advancers / count) * 100);
  const momentumScore = clampScore(50 + avgChange * 10);
  const strengthScore = clampScore(50 + ((limitUp - limitDown) / count) * 500);
  const rawScore = breadthScore * 0.4 + momentumScore * 0.35 + strengthScore * 0.25;
  const score = Number.isFinite(rawScore) ? clampScore(Math.round(rawScore)) : 50;
  let label = "低迷";
  if (score >= 80) label = "过热";
  else if (score >= 65) label = "强势";
  else if (score >= 45) label = "中性";
  else if (score >= 30) label = "偏弱";

  return {
    score,
    temperature: score,
    label,
    advancers,
    decliners,
    flatCount,
    limitUp,
    limitDown,
    avgChange,
    totalAmount: amountSum,
    totalStocks: valid,
    checkedAt
  };
}
