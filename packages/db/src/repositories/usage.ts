import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { claudeTransportFromEnv } from "@aibos/provider-core";
import {
  PROVIDER_TYPES,
  type BillingMode,
  type ProviderType,
  type UsageSummaryDTO,
} from "@aibos/shared";
import type { Database } from "../client";
import { aiUsageRecords, companies } from "../schema";
import {
  FULL_SCOPE,
  scopeWhere,
  startOfUtcDay,
  startOfUtcMonth,
  ts,
  type AccessScope,
} from "./util";

const TREND_DAYS = 14;

/** How each provider is billed right now (CLAUDE follows CLAUDE_TRANSPORT). */
function currentBilling(): Record<ProviderType, BillingMode> {
  return {
    CLAUDE: claudeTransportFromEnv() === "anthropic_api" ? "api" : "subscription",
    OPENAI: "none",
    GROK: "none",
    LOCAL: "none",
  };
}

/**
 * Aggregates the cost ledger. Day/month boundaries are UTC until per-company
 * timezone accounting arrives with the Cost Governor (Stage 11). Only
 * API-billed usage is money spent: Claude subscription runs are counted as
 * runs, with a separate NOT BILLED API-equivalent estimate.
 */
export async function usageSummary(
  db: Database,
  companyId?: string | null,
  accessScope: AccessScope = FULL_SCOPE,
): Promise<UsageSummaryDTO> {
  const now = new Date();
  const today = startOfUtcDay(now);
  const month = startOfUtcMonth(now);
  const trendStart = new Date(today.getTime() - (TREND_DAYS - 1) * 86_400_000);
  const since = trendStart < month ? trendStart : month;

  const scope: SQL[] = [gte(aiUsageRecords.occurredAt, since)];
  if (companyId) scope.push(eq(aiUsageRecords.companyId, companyId));
  const visible = scopeWhere(aiUsageRecords.companyId, accessScope);
  if (visible) scope.push(visible);

  const [rows, daily, originRows, budgets] = await Promise.all([
    db
      .select({
        provider: aiUsageRecords.provider,
        live: sql<boolean>`${aiUsageRecords.origin} = 'live'`,
        today: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(today)} and ${aiUsageRecords.billingMode} <> 'subscription'), 0)::float8`,
        month: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)} and ${aiUsageRecords.billingMode} <> 'subscription'), 0)::float8`,
        apiCalls: sql<number>`count(*) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)} and ${aiUsageRecords.billingMode} <> 'subscription')::int`,
        subToday: sql<number>`count(*) filter (where ${aiUsageRecords.occurredAt} >= ${ts(today)} and ${aiUsageRecords.billingMode} = 'subscription')::int`,
        subMonth: sql<number>`count(*) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)} and ${aiUsageRecords.billingMode} = 'subscription')::int`,
        apiEquivalent: sql<number>`coalesce(sum(${aiUsageRecords.apiEquivalentCost}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)} and ${aiUsageRecords.billingMode} = 'subscription'), 0)::float8`,
        calls: sql<number>`count(*) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)})::int`,
        callsToday: sql<number>`count(*) filter (where ${aiUsageRecords.occurredAt} >= ${ts(today)})::int`,
        input: sql<number>`coalesce(sum(${aiUsageRecords.inputTokens}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
        output: sql<number>`coalesce(sum(${aiUsageRecords.outputTokens}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
        cacheRead: sql<number>`coalesce(sum(${aiUsageRecords.cacheReadTokens}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
        cacheWrite: sql<number>`coalesce(sum(${aiUsageRecords.cacheCreationTokens}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
      })
      .from(aiUsageRecords)
      .where(and(...scope))
      .groupBy(aiUsageRecords.provider, sql`2`),
    db
      .select({
        provider: aiUsageRecords.provider,
        day: sql<string>`to_char(date_trunc('day', ${aiUsageRecords.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        live: sql<boolean>`${aiUsageRecords.origin} = 'live'`,
        total: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.billingMode} <> 'subscription'), 0)::float8`,
      })
      .from(aiUsageRecords)
      .where(and(...scope, gte(aiUsageRecords.occurredAt, trendStart)))
      .groupBy(aiUsageRecords.provider, sql`2`, sql`3`),
    db
      .select({ live: sql<number>`count(*) filter (where ${aiUsageRecords.origin} = 'live')::int` })
      .from(aiUsageRecords)
      .where(and(companyId ? eq(aiUsageRecords.companyId, companyId) : undefined, visible)),
    db
      .select({
        daily: sql<number>`coalesce(sum(${companies.dailyAiBudget}), 0)::float8`,
        monthly: sql<number>`coalesce(sum(${companies.monthlyAiBudget}), 0)::float8`,
      })
      .from(companies)
      .where(
        and(
          companyId ? eq(companies.id, companyId) : eq(companies.status, "active"),
          scopeWhere(companies.id, accessScope),
        ),
      ),
  ]);

  const days: string[] = [];
  for (let i = 0; i < TREND_DAYS; i++) {
    days.push(new Date(trendStart.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  }
  // CLAUDE is real (live rows only). Providers not yet connected keep labelled mock rows.
  const isLiveProvider = (p: ProviderType) => p === "CLAUDE";
  const keep = (p: ProviderType, live: boolean) => (isLiveProvider(p) ? live : !live);
  const trendMap = new Map<string, number>();
  for (const d of daily)
    if (keep(d.provider, d.live)) trendMap.set(`${d.provider}|${d.day}`, d.total);

  const round = (n: number) => Math.round(n * 100) / 100;
  const billing = currentBilling();
  const providers = PROVIDER_TYPES.map((p: ProviderType) => {
    const r = rows.find((x) => x.provider === p && keep(p, x.live));
    return {
      provider: p,
      isMock: !isLiveProvider(p),
      todayUsd: round(r?.today ?? 0),
      monthUsd: round(r?.month ?? 0),
      calls: r?.calls ?? 0,
      callsToday: r?.callsToday ?? 0,
      inputTokens: r?.input ?? 0,
      outputTokens: r?.output ?? 0,
      cacheReadTokens: r?.cacheRead ?? 0,
      cacheCreationTokens: r?.cacheWrite ?? 0,
      averageCallUsd: r && r.apiCalls ? Math.round((r.month / r.apiCalls) * 10_000) / 10_000 : null,
      billingMode: billing[p],
      subscriptionRunsToday: r?.subToday ?? 0,
      subscriptionRunsMonth: r?.subMonth ?? 0,
      apiEquivalentMonthUsd: round(r?.apiEquivalent ?? 0),
      trend: days.map((d) => round(trendMap.get(`${p}|${d}`) ?? 0)),
    };
  });
  const liveRows = rows.filter((x) => x.live);

  return {
    isMock: (originRows[0]?.live ?? 0) === 0,
    currency: "USD",
    dailyBudgetUsd: budgets[0]?.daily ?? 0,
    monthlyBudgetUsd: budgets[0]?.monthly ?? 0,
    todayUsd: round(providers.reduce((s, p) => s + p.todayUsd, 0)),
    monthUsd: round(providers.reduce((s, p) => s + p.monthUsd, 0)),
    liveTodayUsd: round(liveRows.reduce((s, r) => s + r.today, 0)),
    liveMonthUsd: round(liveRows.reduce((s, r) => s + r.month, 0)),
    providers,
  };
}
