import { sql } from "drizzle-orm";
import { AGENT_TEMPLATES, DEFAULT_DEPARTMENTS } from "@aibos/agent-core";
import { INTEGRATION_CATALOG } from "@aibos/integration-core";
import type { Database } from "../client";
import { agentTemplates, departments, integrations } from "../schema";

/**
 * REFERENCE DATA — required in every environment (not demo data):
 * global departments, agent template definitions and platform-wide
 * integration placeholders. Idempotent upserts keyed on natural keys.
 */
export async function syncReferenceData(db: Database): Promise<void> {
  await db
    .insert(departments)
    .values(DEFAULT_DEPARTMENTS.map((d) => ({ ...d, companyId: null })))
    .onConflictDoUpdate({
      target: [departments.companyId, departments.slug],
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        color: sql`excluded.color`,
      },
    });

  await db
    .insert(agentTemplates)
    .values(
      AGENT_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        departmentSlug: t.department,
        defaultProvider: t.defaultProvider,
        fallbackProvider: t.fallbackProvider,
        defaultAutonomy: t.defaultAutonomy,
        responsibilities: t.responsibilities,
        defaultTools: t.defaultTools,
        prohibitedActions: t.prohibitedActions,
        approvalRequirements: t.approvalRequirements,
        capabilities: t.capabilities,
        promptVersion: t.promptVersion,
        definition: { source: "code", version: 1 },
      })),
    )
    .onConflictDoUpdate({
      target: agentTemplates.key,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        departmentSlug: sql`excluded.department_slug`,
        defaultProvider: sql`excluded.default_provider`,
        fallbackProvider: sql`excluded.fallback_provider`,
        defaultAutonomy: sql`excluded.default_autonomy`,
        responsibilities: sql`excluded.responsibilities`,
        defaultTools: sql`excluded.default_tools`,
        prohibitedActions: sql`excluded.prohibited_actions`,
        approvalRequirements: sql`excluded.approval_requirements`,
        capabilities: sql`excluded.capabilities`,
      },
    });

  await db
    .insert(integrations)
    .values(
      INTEGRATION_CATALOG.filter((d) => !d.perCompany).map((d) => ({
        kind: d.kind,
        companyId: null,
        name: d.name,
        capabilities: d.capabilities,
      })),
    )
    .onConflictDoNothing();
}
