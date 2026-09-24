import { and, eq, isNull, or, sql } from "drizzle-orm";
import { AGENT_TEMPLATES } from "@aibos/agent-core";
import { INTEGRATION_CATALOG } from "@aibos/integration-core";
import type { AgentTemplateDTO, DepartmentDTO, IntegrationDTO } from "@aibos/shared";
import type { Database } from "../client";
import { agentTemplates, agents, companies, departments, integrations } from "../schema";
import { FULL_SCOPE, iso, scopeWhere, type AccessScope } from "./util";

export async function listDepartments(
  db: Database,
  companyId?: string | null,
  scope: AccessScope = FULL_SCOPE,
): Promise<DepartmentDTO[]> {
  const rows = await db
    .select({
      d: departments,
      agentCount: sql<number>`(select count(*)::int from ${agents} where ${agents.departmentId} = ${departments.id})`,
    })
    .from(departments)
    .where(
      and(
        companyId
          ? or(isNull(departments.companyId), eq(departments.companyId, companyId))
          : undefined,
        // Global departments are shared reference data; company departments follow isolation.
        scopeWhere(departments.companyId, { ...scope, includeGroup: true }),
      ),
    )
    .orderBy(departments.name);
  return rows.map(({ d, agentCount }) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    description: d.description,
    companyId: d.companyId,
    color: d.color,
    agentCount,
  }));
}

export async function listAgentTemplates(db: Database): Promise<AgentTemplateDTO[]> {
  const rows = await db.select().from(agentTemplates);
  const order = new Map(AGENT_TEMPLATES.map((t, i) => [t.key, i]));
  return rows
    .sort((a, b) => (order.get(a.key as never) ?? 99) - (order.get(b.key as never) ?? 99))
    .map((t) => ({
      key: t.key as AgentTemplateDTO["key"],
      name: t.name,
      description: t.description,
      department: t.departmentSlug,
      defaultProvider: t.defaultProvider,
      fallbackProvider: t.fallbackProvider,
      defaultAutonomy: t.defaultAutonomy,
      responsibilities: t.responsibilities,
      defaultTools: t.defaultTools,
      prohibitedActions: t.prohibitedActions,
      approvalRequirements: t.approvalRequirements,
      capabilities: t.capabilities,
      promptVersion: t.promptVersion,
    }));
}

export async function listIntegrations(
  db: Database,
  companyId?: string | null,
  scope: AccessScope = FULL_SCOPE,
): Promise<IntegrationDTO[]> {
  const rows = await db
    .select({
      i: integrations,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
    })
    .from(integrations)
    .leftJoin(companies, eq(companies.id, integrations.companyId))
    .where(
      and(
        companyId
          ? or(isNull(integrations.companyId), eq(integrations.companyId, companyId))
          : undefined,
        // Platform-wide integrations are visible to anyone with integration access.
        scopeWhere(integrations.companyId, { ...scope, includeGroup: true }),
      ),
    )
    .orderBy(integrations.kind);
  const catalog = new Map(INTEGRATION_CATALOG.map((d) => [d.kind, d]));
  return rows.map(({ i, company }) => {
    const def = catalog.get(i.kind);
    return {
      id: i.id,
      kind: i.kind,
      name: i.name,
      category: def?.category ?? "automation",
      description: def?.description ?? "",
      company: company?.id ? company : null,
      status: i.status,
      authState: i.authState,
      capabilities: i.capabilities,
      lastHealthCheckAt: iso(i.lastHealthCheckAt),
      lastSuccessfulSyncAt: iso(i.lastSuccessfulSyncAt),
      lastError: i.lastError,
      plannedStage: def?.plannedStage ?? null,
    };
  });
}
