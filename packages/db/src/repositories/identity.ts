import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  buildHumanAccess,
  type HumanAccessContext,
  type MembershipGrant,
} from "@aibos/access-core";
import {
  inviteUserSchema,
  membershipInputSchema,
  updateMembershipSchema,
  updateUserSchema,
  type CompanyRef,
  type MembershipDTO,
  type UserDTO,
} from "@aibos/shared";
import type { z } from "zod";
import { generateToken, hashPassword, sha256 } from "../auth/crypto";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import {
  authTokens,
  companies,
  companyMemberships,
  departments,
  membershipDepartments,
  rolePermissions,
  roles,
  sessions,
  users,
  type User,
} from "../schema";
import { recordAuditEvent } from "./audit";
import { actorAuditFields, iso, type Actor } from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const INVITATION_TTL_MS = 7 * 24 * 3_600_000;

export function displayNameOf(
  u: Pick<User, "displayName" | "firstName" | "lastName" | "email">,
): string {
  return u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, normalizeEmail(email)));
  return row ?? null;
}

export async function getUserRecord(db: Db, id: string): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) throw new NotFoundError("User", id);
  return row;
}

export interface NewUserInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  password?: string;
  status?: User["status"];
  origin?: "live" | "dev_seed";
}

/** Low-level user creation (hashes the password if given). */
export async function insertUser(db: Db, input: NewUserInput): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email.trim(),
      emailNormalized: normalizeEmail(input.email),
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      passwordChangedAt: input.password ? new Date() : null,
      status: input.status ?? (input.password ? "active" : "invited"),
      origin: input.origin ?? "live",
    })
    .returning();
  if (!row) throw new Error("User insert failed");
  return row;
}

export async function getRoleByKey(db: Db, key: string) {
  const [row] = await db.select().from(roles).where(eq(roles.key, key));
  if (!row) throw new NotFoundError("Role", key);
  return row;
}

export async function insertMembership(
  db: Db,
  input: {
    userId: string;
    companyId: string | null;
    roleId: string;
    departmentIds?: readonly string[];
    status?: "invited" | "active";
    invitedByUserId?: string | null;
    origin?: "live" | "dev_seed";
  },
) {
  const [m] = await db
    .insert(companyMemberships)
    .values({
      userId: input.userId,
      companyId: input.companyId,
      roleId: input.roleId,
      status: input.status ?? "active",
      joinedAt: input.status === "invited" ? null : new Date(),
      invitedByUserId: input.invitedByUserId ?? null,
      origin: input.origin ?? "live",
    })
    .returning();
  if (!m) throw new Error("Membership insert failed");
  if (input.departmentIds?.length) {
    await db
      .insert(membershipDepartments)
      .values(input.departmentIds.map((departmentId) => ({ membershipId: m.id, departmentId })));
  }
  return m;
}

/* ---------- access context ---------- */

/** Active memberships of an active user, with each role's permission keys. */
export async function loadMembershipGrants(db: Db, userId: string): Promise<MembershipGrant[]> {
  const rows = await db
    .select({
      id: companyMemberships.id,
      companyId: companyMemberships.companyId,
      roleKey: roles.key,
      roleId: roles.id,
      permissions: sql<
        string[]
      >`coalesce(array_agg(distinct ${rolePermissions.permissionKey}) filter (where ${rolePermissions.permissionKey} is not null), '{}')`,
      departmentIds: sql<
        string[]
      >`coalesce(array_agg(distinct ${membershipDepartments.departmentId}) filter (where ${membershipDepartments.departmentId} is not null), '{}')`,
    })
    .from(companyMemberships)
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(membershipDepartments, eq(membershipDepartments.membershipId, companyMemberships.id))
    .leftJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(
      and(
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.status, "active"),
        // Memberships of inactive companies grant nothing.
        or(isNull(companyMemberships.companyId), eq(companies.status, "active")),
      ),
    )
    .groupBy(companyMemberships.id, roles.key, roles.id);
  return rows.map((r) => ({
    membershipId: r.id,
    companyId: r.companyId,
    roleKey: r.roleKey,
    permissions: r.permissions,
    departmentIds: r.departmentIds,
  }));
}

export async function loadAccessContext(db: Db, userId: string): Promise<HumanAccessContext> {
  return buildHumanAccess(userId, await loadMembershipGrants(db, userId));
}

/* ---------- DTOs ---------- */

async function membershipsFor(db: Db, userIds: string[]): Promise<Map<string, MembershipDTO[]>> {
  const out = new Map<string, MembershipDTO[]>();
  if (!userIds.length) return out;
  const rows = await db
    .select({
      m: companyMemberships,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      role: { id: roles.id, key: roles.key, name: roles.name, isSystem: roles.isSystem },
    })
    .from(companyMemberships)
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .leftJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(inArray(companyMemberships.userId, userIds))
    .orderBy(sql`${companyMemberships.companyId} nulls first`, asc(companies.createdAt));
  const deptRows = await db
    .select({
      membershipId: membershipDepartments.membershipId,
      id: departments.id,
      name: departments.name,
    })
    .from(membershipDepartments)
    .innerJoin(departments, eq(departments.id, membershipDepartments.departmentId))
    .where(
      inArray(
        membershipDepartments.membershipId,
        rows.map((r) => r.m.id).concat(["00000000-0000-0000-0000-000000000000"]),
      ),
    );
  const depts = new Map<string, { id: string; name: string }[]>();
  for (const d of deptRows)
    depts.set(d.membershipId, [...(depts.get(d.membershipId) ?? []), { id: d.id, name: d.name }]);
  for (const { m, company, role } of rows) {
    const list = out.get(m.userId) ?? [];
    list.push({
      id: m.id,
      company: company?.id ? (company as CompanyRef) : null,
      role,
      status: m.status,
      departments: depts.get(m.id) ?? [],
      joinedAt: iso(m.joinedAt),
      createdAt: m.createdAt.toISOString(),
    });
    out.set(m.userId, list);
  }
  return out;
}

function toUserDTO(u: User, memberships: MembershipDTO[]): UserDTO {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: displayNameOf(u),
    avatarUrl: u.avatarUrl,
    status: u.status,
    timezone: u.timezone,
    locale: u.locale,
    isPlatformOwner: memberships.some(
      (m) => m.company === null && m.role.key === "platform_owner" && m.status === "active",
    ),
    lastLoginAt: iso(u.lastLoginAt),
    disabledAt: iso(u.disabledAt),
    createdAt: u.createdAt.toISOString(),
    memberships,
    origin: u.origin,
  };
}

export async function getUserDTO(db: Db, id: string): Promise<UserDTO> {
  const u = await getUserRecord(db, id);
  return toUserDTO(u, (await membershipsFor(db, [id])).get(id) ?? []);
}

/**
 * Users visible to a caller. Company admins only see users who belong to
 * their companies, and only the memberships in those companies.
 */
export async function listUsers(
  db: Db,
  visibility: { companyIds: "all" | readonly string[]; includeGlobal: boolean },
): Promise<UserDTO[]> {
  const all = visibility.companyIds === "all";
  const ids = all ? [] : [...visibility.companyIds];
  const visibleUserIds = all
    ? null
    : (
        await db
          .selectDistinct({ userId: companyMemberships.userId })
          .from(companyMemberships)
          .where(ids.length ? inArray(companyMemberships.companyId, ids) : sql`false`)
      ).map((r) => r.userId);
  if (visibleUserIds && !visibleUserIds.length) return [];
  const rows = await db
    .select()
    .from(users)
    .where(visibleUserIds ? inArray(users.id, visibleUserIds) : undefined)
    .orderBy(asc(users.createdAt));
  const ms = await membershipsFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((u) => {
    const own = ms.get(u.id) ?? [];
    const visible = own.filter((m) =>
      m.company === null ? visibility.includeGlobal : all || ids.includes(m.company.id),
    );
    const dto = toUserDTO(u, own);
    return { ...dto, memberships: visible };
  });
}

/* ---------- mutations ---------- */

export async function getMembershipRecord(db: Db, id: string) {
  const [row] = await db.select().from(companyMemberships).where(eq(companyMemberships.id, id));
  if (!row) throw new NotFoundError("Membership", id);
  return row;
}

/**
 * Invites a user: creates an `invited` account with `invited` memberships and
 * a single-use invitation token (returned once, stored only as a hash).
 */
export async function inviteUser(
  db: Database,
  input: z.input<typeof inviteUserSchema>,
  actor: Actor,
): Promise<{ user: UserDTO; token: string; expiresAt: Date }> {
  const data = inviteUserSchema.parse(input);
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const userId = await db.transaction(async (tx) => {
    if (await findUserByEmail(tx, data.email))
      throw new ConflictError("An account with this email already exists");
    const user = await insertUser(tx, {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName ?? null,
      status: "invited",
    });
    for (const m of data.memberships) {
      await insertMembership(tx, {
        ...m,
        userId: user.id,
        status: "invited",
        invitedByUserId: actor.userId ?? null,
      });
    }
    await tx.insert(authTokens).values({
      userId: user.id,
      type: "invitation",
      tokenHash: sha256(token),
      expiresAt,
      createdByUserId: actor.userId ?? null,
    });
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: data.memberships.find((m) => m.companyId)?.companyId ?? undefined,
      resourceType: "user",
      resourceId: user.id,
      action: "user.invited",
      description: `Invited ${data.email}`,
      metadata: { memberships: data.memberships },
    });
    return user.id;
  });
  return { user: await getUserDTO(db, userId), token, expiresAt };
}

export async function addMembership(
  db: Database,
  userId: string,
  input: z.input<typeof membershipInputSchema>,
  actor: Actor,
): Promise<UserDTO> {
  const data = membershipInputSchema.parse(input);
  await db.transaction(async (tx) => {
    const user = await getUserRecord(tx, userId);
    const existing = await tx
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.userId, userId),
          data.companyId
            ? eq(companyMemberships.companyId, data.companyId)
            : isNull(companyMemberships.companyId),
        ),
      );
    if (existing.length) throw new ConflictError("User already has a membership for this scope");
    const m = await insertMembership(tx, {
      ...data,
      userId,
      status: user.status === "invited" ? "invited" : "active",
      invitedByUserId: actor.userId ?? null,
    });
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: data.companyId ?? undefined,
      resourceType: "membership",
      resourceId: m.id,
      action: "user.role_assigned",
      description: `Membership added for ${user.email}`,
      after: { companyId: data.companyId, roleId: data.roleId, departmentIds: data.departmentIds },
    });
  });
  return getUserDTO(db, userId);
}

export async function updateMembership(
  db: Database,
  membershipId: string,
  input: z.input<typeof updateMembershipSchema>,
  actor: Actor,
): Promise<UserDTO> {
  const data = updateMembershipSchema.parse(input);
  const userId = await db.transaction(async (tx) => {
    const before = await getMembershipRecord(tx, membershipId);
    const patch: Partial<typeof companyMemberships.$inferInsert> = {};
    if (data.roleId) patch.roleId = data.roleId;
    if (data.status) patch.status = data.status;
    if (Object.keys(patch).length)
      await tx.update(companyMemberships).set(patch).where(eq(companyMemberships.id, membershipId));
    if (data.departmentIds) {
      await tx
        .delete(membershipDepartments)
        .where(eq(membershipDepartments.membershipId, membershipId));
      if (data.departmentIds.length) {
        await tx
          .insert(membershipDepartments)
          .values(data.departmentIds.map((departmentId) => ({ membershipId, departmentId })));
      }
    }
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: before.companyId ?? undefined,
      resourceType: "membership",
      resourceId: membershipId,
      action: data.roleId
        ? "user.role_assigned"
        : data.status === "revoked"
          ? "user.membership_revoked"
          : "user.membership_changed",
      description: "Membership updated",
      before: { roleId: before.roleId, status: before.status },
      after: { ...data },
    });
    return before.userId;
  });
  return getUserDTO(db, userId);
}

export async function updateUser(
  db: Database,
  userId: string,
  input: z.input<typeof updateUserSchema>,
  actor: Actor,
): Promise<UserDTO> {
  const data = updateUserSchema.parse(input);
  await db.transaction(async (tx) => {
    const before = await getUserRecord(tx, userId);
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.firstName !== undefined) patch.firstName = data.firstName;
    if (data.lastName !== undefined) patch.lastName = data.lastName;
    if (data.displayName !== undefined) patch.displayName = data.displayName;
    if (data.status && data.status !== before.status) {
      if (before.status === "invited" && data.status === "active") {
        throw new ConflictError("Invited users become active by accepting their invitation");
      }
      patch.status = data.status;
      patch.disabledAt = data.status === "active" ? null : new Date();
    }
    if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, userId));
    if (patch.status && patch.status !== "active") {
      // Disabling or suspending an account immediately invalidates every session.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: `account_${patch.status}` })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    }
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      resourceType: "user",
      resourceId: userId,
      action: patch.status
        ? patch.status === "active"
          ? "user.enabled"
          : `user.${patch.status}`
        : "user.updated",
      description: `User ${before.email} ${patch.status ? `set to ${patch.status}` : "updated"}`,
      before: { status: before.status },
      after: { ...data },
    });
  });
  return getUserDTO(db, userId);
}

/** Number of other active platform owners (prevents locking everyone out). */
export async function countActivePlatformOwners(db: Db, excludingUserId?: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(companyMemberships)
    .innerJoin(roles, eq(roles.id, companyMemberships.roleId))
    .innerJoin(users, eq(users.id, companyMemberships.userId))
    .where(
      and(
        eq(roles.key, "platform_owner"),
        isNull(companyMemberships.companyId),
        eq(companyMemberships.status, "active"),
        eq(users.status, "active"),
        excludingUserId ? sql`${users.id} <> ${excludingUserId}` : undefined,
      ),
    );
  return row?.n ?? 0;
}

export async function getRoleRecord(db: Db, id: string) {
  const [row] = await db.select().from(roles).where(eq(roles.id, id));
  if (!row) throw new NotFoundError("Role", id);
  return row;
}

export async function getDepartmentsByIds(db: Db, ids: readonly string[]) {
  if (!ids.length) return [];
  return db
    .select()
    .from(departments)
    .where(inArray(departments.id, [...ids]));
}
