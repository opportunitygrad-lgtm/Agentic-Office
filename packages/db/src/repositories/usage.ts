import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { PROVIDER_TYPES, type ProviderType, type UsageSummaryDTO } from "@aibos/shared";
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

/**
 * Aggregates the cost ledger. Day/month boundaries are UTC until per-company
 * timezone accounting arrives with the Cost Governor (Stage 11).
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
        today: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(today)}), 0)::float8`,
        month: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
        calls: sql<number>`count(*) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)})::int`,
        input: sql<number>`coalesce(sum(${aiUsageRecords.inputTokens}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
        output: sql<number>`coalesce(sum(${aiUsageRecords.outputTokens}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(month)}), 0)::float8`,
      })
      .from(aiUsageRecords)
      .where(and(...scope))
      .groupBy(aiUsageRecords.provider),
    db
      .select({
        provider: aiUsageRecords.provider,
        day: sql<string>`to_char(date_trunc('day', ${aiUsageRecords.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        total: sql<number>`sum(${aiUsageRecords.actualCost})::float8`,
      })
      .from(aiUsageRecords)
      .where(and(...scope, gte(aiUsageRecords.occurredAt, trendStart)))
      .groupBy(aiUsageRecords.provider, sql`2`),
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
  const trendMap = new Map<string, number>();
  for (const d of daily) trendMap.set(`${d.provider}|${d.day}`, d.total);
  const byProvider = new Map(rows.map((r) => [r.provider, r] as const));

  const round = (n: number) => Math.round(n * 100) / 100;
  const providers = PROVIDER_TYPES.map((p: ProviderType) => {
    const r = byProvider.get(p);
    return {
      provider: p,
      todayUsd: round(r?.today ?? 0),
      monthUsd: round(r?.month ?? 0),
      calls: r?.calls ?? 0,
      inputTokens: r?.input ?? 0,
      outputTokens: r?.output ?? 0,
      trend: days.map((d) => round(trendMap.get(`${p}|${d}`) ?? 0)),
    };
  });

  return {
    isMock: (originRows[0]?.live ?? 0) === 0,
    currency: "USD",
    dailyBudgetUsd: budgets[0]?.daily ?? 0,
    monthlyBudgetUsd: budgets[0]?.monthly ?? 0,
    todayUsd: round(providers.reduce((s, p) => s + p.todayUsd, 0)),
    monthUsd: round(providers.reduce((s, p) => s + p.monthUsd, 0)),
    providers,
  };
}
