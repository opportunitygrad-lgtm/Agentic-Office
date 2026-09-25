import { eq, isNull, notInArray, sql } from "drizzle-orm";
import {
  DEFAULT_APPROVAL_REQUIREMENTS,
  HUMAN_PERMISSIONS,
  SERVICE_IDENTITIES,
  SYSTEM_ROLES,
} from "@aibos/access-core";
import {
  AGENT_TEMPLATES,
  DEFAULT_DEPARTMENTS,
  TEMPLATE_CAPABILITIES,
  TEMPLATE_ROLES,
} from "@aibos/agent-core";
import { INTEGRATION_CATALOG } from "@aibos/integration-core";
import type { Database } from "../client";
import {
  agentTemplates,
  approvalRequirements,
  workforcePolicy,
  departments,
  integrations,
  permissions,
  rolePermissions,
  roles,
  serviceIdentities,
} from "../schema";

/**
 * REFERENCE DATA — required in every environment (not demo data):
 * global departments, agent template definitions and platform-wide
 * integration placeholders. Idempotent upserts keyed on natural keys.
 */
export async function syncReferenceData(db: Database): Promise<void> {
  await db
    .insert(departments)
    .values(
      DEFAULT_DEPARTMENTS.map((d) => ({
        slug: d.slug,
        name: d.name,
        description: d.description,
        color: d.color,
        mission: d.mission ?? null,
        instructions: d.instructions ?? [],
        handoffDestinations: d.handoffDestinations ?? [],
        concurrencyLimit: d.concurrencyLimit ?? null,
        companyId: null,
      })),
    )
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
        agentCapabilities: TEMPLATE_CAPABILITIES[t.key],
        definition: { source: "code", version: 2, role: TEMPLATE_ROLES[t.key] },
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
        defaultAutonomy: sql`excluded.autonomy`,
        responsibilities: sql`excluded.responsibilities`,
        defaultTools: sql`excluded.default_tools`,
        prohibitedActions: sql`excluded.prohibited_actions`,
        approvalRequirements: sql`excluded.approval_requirements`,
        capabilities: sql`excluded.capabilities`,
        agentCapabilities: sql`excluded.agent_capabilities`,
        definition: sql`excluded.definition`,
      },
    });

  // Agents without capabilities inherit their template's (never overwrites edits).
  await db.execute(sql`update agents set capabilities = t.agent_capabilities
    from agent_templates t where agents.template_key = t.key and agents.capabilities = '{}'::text[]`);
  await db.insert(workforcePolicy).values({ id: 1 }).onConflictDoNothing();

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

  await syncAccessReferenceData(db);
}

/**
 * Human permission catalogue, code-owned system roles (their permission sets
 * are overwritten from code), default approval authority rules and internal
 * service identities. Custom roles are never modified here.
 */
export async function syncAccessReferenceData(db: Database): Promise<void> {
  await db
    .insert(permissions)
    .values(
      HUMAN_PERMISSIONS.map((p) => ({
        key: p.key,
        category: p.category,
        label: p.label,
        description: p.description,
        scope: p.scope,
        sensitive: !!p.sensitive,
      })),
    )
    .onConflictDoUpdate({
      target: permissions.key,
      set: {
        category: sql`excluded.category`,
        label: sql`excluded.label`,
        description: sql`excluded.description`,
        scope: sql`excluded.scope`,
        sensitive: sql`excluded.sensitive`,
      },
    });
  await db.delete(permissions).where(
    notInArray(
      permissions.key,
      HUMAN_PERMISSIONS.map((p) => p.key),
    ),
  );

  for (const def of SYSTEM_ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, def.key));
    if (!def.isSystem) {
      // Editable starter role (e.g. "Custom"): created once, never overwritten.
      if (existing) continue;
      const [role] = await db
        .insert(roles)
        .values({
          key: def.key,
          name: def.name,
          description: def.description,
          scope: def.scope,
          isSystem: false,
          rank: def.rank,
        })
        .returning();
      if (role && def.permissions.length) {
        await db
          .insert(rolePermissions)
          .values(def.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })));
      }
      continue;
    }
    const [role] = await db
      .insert(roles)
      .values({
        key: def.key,
        name: def.name,
        description: def.description,
        scope: def.scope,
        isSystem: true,
        rank: def.rank,
      })
      .onConflictDoUpdate({
        target: roles.key,
        set: {
          name: def.name,
          description: def.description,
          scope: def.scope,
          rank: def.rank,
          isSystem: true,
        },
      })
      .returning();
    if (!role) continue;
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    await db
      .insert(rolePermissions)
      .values(def.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })));
  }

  const existingRules = await db
    .select()
    .from(approvalRequirements)
    .where(isNull(approvalRequirements.companyId));
  const missing = DEFAULT_APPROVAL_REQUIREMENTS.filter(
    (r) =>
      !existingRules.some(
        (e) =>
          e.approvalType === r.approvalType &&
          e.minRiskLevel === r.minRiskLevel &&
          e.requiredPermission === r.requiredPermission,
      ),
  );
  if (missing.length) {
    await db.insert(approvalRequirements).values(
      missing.map((r) => ({
        approvalType: r.approvalType,
        minRiskLevel: r.minRiskLevel,
        requiredPermission: r.requiredPermission,
        companyId: null,
      })),
    );
  }

  await db
    .insert(serviceIdentities)
    .values(
      SERVICE_IDENTITIES.map((x) => ({ key: x.key, name: x.name, description: x.description })),
    )
    .onConflictDoUpdate({
      target: serviceIdentities.key,
      set: { name: sql`excluded.name`, description: sql`excluded.description` },
    });
}
