import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { HUMAN_PERMISSION_KEYS } from "@aibos/access-core";
import {
  createRoleSchema,
  slugify,
  updateRoleSchema,
  type PermissionDTO,
  type RoleDTO,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { companyMemberships, permissions, rolePermissions, roles, type Role } from "../schema";
import { recordAuditEvent } from "./audit";
import { actorAuditFields, type Actor } from "./util";

export async function listPermissions(db: Database): Promise<PermissionDTO[]> {
  const rows = await db.select().from(permissions);
  const order = [...HUMAN_PERMISSION_KEYS];
  return rows
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map((p) => ({
      key: p.key,
      category: p.category,
      label: p.label,
      description: p.description,
      scope: p.scope,
      sensitive: p.sensitive,
    }));
}

async function toRoleDTOs(
  db: Database,
  rows: Role[],
  countIn: "all" | readonly string[] = "all",
): Promise<RoleDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [perms, counts] = await Promise.all([
    db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids)),
    db
      .select({ roleId: companyMemberships.roleId, n: count() })
      .from(companyMemberships)
      .where(
        and(
          inArray(companyMemberships.roleId, ids),
          inArray(companyMemberships.status, ["active", "invited"]),
          // Callers without global user visibility only count members of their own companies.
          countIn === "all"
            ? undefined
            : countIn.length
              ? inArray(companyMemberships.companyId, [...countIn])
              : sql`false`,
        ),
      )
      .groupBy(companyMemberships.roleId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    scope: r.scope,
    companyId: r.companyId,
    isSystem: r.isSystem,
    rank: r.rank,
    permissions: perms
      .filter((p) => p.roleId === r.id)
      .map((p) => p.permissionKey)
      .sort(),
    userCount: counts.find((c) => c.roleId === r.id)?.n ?? 0,
  }));
}

export async function listRoles(
  db: Database,
  countIn: "all" | readonly string[] = "all",
): Promise<RoleDTO[]> {
  const rows = await db.select().from(roles).orderBy(asc(roles.isSystem), asc(roles.rank));
  const dtos = await toRoleDTOs(db, rows, countIn);
  return dtos.sort(
    (a, b) =>
      Number(b.isSystem) - Number(a.isSystem) || b.rank - a.rank || a.name.localeCompare(b.name),
  );
}

export async function getRole(db: Database, id: string): Promise<RoleDTO> {
  const [row] = await db.select().from(roles).where(eq(roles.id, id));
  if (!row) throw new NotFoundError("Role", id);
  return (await toRoleDTOs(db, [row]))[0]!;
}

function validatePermissionKeys(keys: readonly string[], scope: "global" | "company") {
  const unknown = keys.filter((k) => !HUMAN_PERMISSION_KEYS.has(k));
  if (unknown.length) throw new ConflictError(`Unknown permissions: ${unknown.join(", ")}`);
  if (
    scope === "company" &&
    keys.some((k) => ["system.manage", "security.manage", "company.create"].includes(k))
  ) {
    throw new ConflictError("Company-scoped roles cannot hold platform-level permissions");
  }
}

export async function createRole(
  db: Database,
  input: z.input<typeof createRoleSchema>,
  actor: Actor,
): Promise<RoleDTO> {
  const data = createRoleSchema.parse(input);
  const permissionsSet = [...new Set(data.permissions)];
  validatePermissionKeys(permissionsSet, data.scope);
  const key = `custom_${slugify(data.name).replace(/-/g, "_")}`.slice(0, 64);
  const id = await db.transaction(async (tx) => {
    const clash = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    if (clash.length) throw new ConflictError("A role with this name already exists");
    const [role] = await tx
      .insert(roles)
      .values({
        key,
        name: data.name,
        description: data.description,
        scope: data.scope,
        companyId: data.companyId ?? null,
        isSystem: false,
        rank: 5,
      })
      .returning();
    if (!role) throw new Error("Role insert failed");
    if (permissionsSet.length)
      await tx
        .insert(rolePermissions)
        .values(permissionsSet.map((permissionKey) => ({ roleId: role.id, permissionKey })));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: role.companyId ?? undefined,
      resourceType: "role",
      resourceId: role.id,
      action: "role.created",
      description: `Custom role "${role.name}" created`,
      after: { permissions: permissionsSet },
    });
    return role.id;
  });
  return getRole(db, id);
}

/** Custom roles only: system roles are code-owned and read-only. */
export async function updateRole(
  db: Database,
  id: string,
  input: z.input<typeof updateRoleSchema>,
  actor: Actor,
): Promise<RoleDTO> {
  const data = updateRoleSchema.parse(input);
  await db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for("update");
    if (!role) throw new NotFoundError("Role", id);
    if (role.isSystem)
      throw new ForbiddenError("System roles are locked. Duplicate the role to customise it.");
    const before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, id)))
      .map((p) => p.permissionKey)
      .sort();
    if (data.name || data.description !== undefined) {
      await tx
        .update(roles)
        .set({
          ...(data.name ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        })
        .where(eq(roles.id, id));
    }
    if (data.permissions) {
      const next = [...new Set(data.permissions)].sort();
      validatePermissionKeys(next, role.scope);
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      if (next.length)
        await tx
          .insert(rolePermissions)
          .values(next.map((permissionKey) => ({ roleId: id, permissionKey })));
      await recordAuditEvent(tx, {
        ...actorAuditFields(actor),
        companyId: role.companyId ?? undefined,
        resourceType: "role",
        resourceId: id,
        action: "role.permissions_changed",
        description: `Permissions changed for role "${role.name}"`,
        before: { permissions: before },
        after: { permissions: next },
      });
    }
  });
  return getRole(db, id);
}

export async function deleteRole(db: Database, id: string, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id));
    if (!role) throw new NotFoundError("Role", id);
    if (role.isSystem) throw new ForbiddenError("System roles cannot be deleted");
    const [used] = await tx
      .select({ n: count() })
      .from(companyMemberships)
      .where(eq(companyMemberships.roleId, id));
    if ((used?.n ?? 0) > 0)
      throw new ConflictError("Role is assigned to members; reassign them first");
    await tx.delete(roles).where(eq(roles.id, id));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      resourceType: "role",
      resourceId: id,
      action: "role.deleted",
      description: `Custom role "${role.name}" deleted`,
    });
  });
}
