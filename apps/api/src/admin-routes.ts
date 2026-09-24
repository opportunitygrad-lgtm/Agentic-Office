import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, companiesWith, effectivePermissions } from "@aibos/access-core";
import {
  ConflictError,
  ForbiddenError,
  addMembership,
  countActivePlatformOwners,
  createRole,
  deleteRole,
  getMembershipRecord,
  getRole,
  getUserDTO,
  inviteUser,
  listPermissions,
  listRoles,
  listUsers,
  resolveCompany,
  getDepartmentsByIds,
  getRoleRecord,
  updateMembership,
  updateRole,
  updateUser,
} from "@aibos/db";
import {
  createRoleSchema,
  inviteUserSchema,
  membershipInputSchema,
  updateMembershipSchema,
  updateRoleSchema,
  updateUserSchema,
  uuidSchema,
  type UserDTO,
} from "@aibos/shared";
import { actorFrom, auditSecurityEvent, principalOf, requirePermission } from "./security";

const idParam = z.object({ id: uuidSchema });

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps.db;

  /** Denies and audits an attempted privilege change. */
  async function deny(
    req: FastifyRequest,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<never> {
    await auditSecurityEvent(req, "security.privilege_change_denied", reason, { metadata });
    throw new ForbiddenError(reason);
  }

  /**
   * Can the caller grant this membership? Enforces: permission in the target
   * scope, role/company consistency, departments belong to the company, and
   * NO ESCALATION — a role's permissions must be a subset of the caller's own
   * permissions in that company (security.manage holders excepted).
   */
  async function authorizeGrant(
    req: FastifyRequest,
    grant: { companyId: string | null; roleId: string; departmentIds?: string[] },
    permission: "user.invite" | "user.role.assign",
  ) {
    const access = principalOf(req).access;
    const role = await getRole(db, grant.roleId).catch(() => null);
    if (!role) throw new ConflictError("Unknown role");
    if (grant.companyId === null) {
      if (!can(access, "security.manage", null))
        await deny(req, "Only security administrators can grant global access", {
          roleId: role.id,
        });
    } else {
      await resolveCompany(db, grant.companyId).catch(() => deny(req, "Unknown company"));
      if (!can(access, permission, grant.companyId))
        await deny(req, "Not allowed to grant access in this company", {
          companyId: grant.companyId,
        });
      if (role.companyId && role.companyId !== grant.companyId)
        throw new ConflictError("Role belongs to another company");
      if (!can(access, "security.manage", null)) {
        const mine = new Set(effectivePermissions(access, grant.companyId));
        const escalation = role.permissions.filter((p) => !mine.has(p));
        if (escalation.length)
          await deny(req, "Cannot grant a role with permissions you do not hold", {
            escalation,
            roleId: role.id,
          });
      }
    }
    if (grant.departmentIds?.length) {
      const rows = await getDepartmentsByIds(db, grant.departmentIds);
      if (
        rows.length !== grant.departmentIds.length ||
        rows.some((d) => d.companyId !== null && d.companyId !== grant.companyId)
      ) {
        throw new ConflictError("Departments must belong to the membership's company");
      }
    }
    return role;
  }

  /**
   * The caller must "dominate" every role the target holds: each role's
   * permissions ⊆ the caller's permissions in that scope (security admins
   * excepted). Prevents lower-ranked admins from acting on higher-ranked users.
   */
  async function requireDominance(req: FastifyRequest, target: UserDTO, permission: string) {
    const access = principalOf(req).access;
    if (can(access, "security.manage", null)) return;
    for (const m of target.memberships) {
      if (m.status === "revoked") continue;
      if (!m.company)
        await deny(req, "User holds global access outside your authority", { userId: target.id });
      else {
        if (!can(access, permission, m.company.id))
          await deny(req, "User belongs to companies outside your authority", {
            userId: target.id,
          });
        const role = await getRole(db, m.role.id);
        const mine = new Set(effectivePermissions(access, m.company.id));
        if (role.permissions.some((p) => !mine.has(p)))
          await deny(req, "User's role exceeds your own authority", {
            userId: target.id,
            roleId: role.id,
          });
      }
    }
  }

  /** IDOR guard: the target user must be visible to the caller. */
  async function visibleUser(
    req: FastifyRequest,
    userId: string,
    permission: string,
  ): Promise<UserDTO> {
    const access = principalOf(req).access;
    const target = await getUserDTO(db, userId).catch(() => null);
    const companyIds = target?.memberships.map((m) => m.company?.id ?? null) ?? [];
    const visible =
      !!target &&
      (can(access, permission, null) ||
        companyIds.some((c) => c !== null && can(access, permission, c)));
    if (!target || !visible) throw new ForbiddenError("User not found or not accessible");
    return target;
  }

  /* ---------- users ---------- */

  app.get("/users", async (req) => {
    const ids = companiesWith(principalOf(req).access, "user.view");
    if (ids !== "all" && !ids.length) throw new ForbiddenError();
    return { data: await listUsers(db, { companyIds: ids, includeGlobal: ids === "all" }) };
  });

  app.post("/users/invitations", async (req, reply) => {
    const body = inviteUserSchema.parse(req.body);
    for (const m of body.memberships) await authorizeGrant(req, m, "user.invite");
    const { user, token, expiresAt } = await inviteUser(db, body, actorFrom(req));
    return reply.status(201).send({
      data: user,
      /** Shown once to the inviter; email delivery arrives in Stage 14. */
      invitationUrl: `${app.deps.webOrigin}/invite/${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.patch("/users/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateUserSchema.parse(req.body);
    const me = principalOf(req);
    const target = await visibleUser(req, id, body.status ? "user.disable" : "user.edit");
    if (id === me.user.id && body.status)
      await deny(req, "You cannot change your own account status");
    // Accounts are global: profile or status changes require authority over every company the user belongs to.
    await requireDominance(req, target, body.status ? "user.disable" : "user.edit");
    if (
      body.status &&
      target.isPlatformOwner &&
      body.status !== "active" &&
      (await countActivePlatformOwners(db, id)) === 0
    ) {
      throw new ConflictError("Cannot disable the last active Platform Owner");
    }
    return { data: await updateUser(db, id, body, actorFrom(req)) };
  });

  app.post("/users/:id/memberships", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = membershipInputSchema.parse(req.body);
    if (id === principalOf(req).user.id) await deny(req, "You cannot change your own access");
    await visibleUser(req, id, "user.role.assign");
    await authorizeGrant(req, body, "user.role.assign");
    return reply.status(201).send({ data: await addMembership(db, id, body, actorFrom(req)) });
  });

  app.patch("/memberships/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateMembershipSchema.parse(req.body);
    const me = principalOf(req);
    const membership = await getMembershipRecord(db, id).catch(() => {
      throw new ForbiddenError("Membership not found or not accessible");
    });
    if (membership.userId === me.user.id) await deny(req, "You cannot change your own access");
    const scopePerm = membership.companyId === null ? "security.manage" : "user.role.assign";
    if (!can(me.access, scopePerm, membership.companyId))
      await deny(req, "Not allowed to change this membership", { membershipId: id });
    // The caller must dominate the CURRENT role (to revoke, suspend or restore it) and any NEW role.
    await authorizeGrant(
      req,
      {
        companyId: membership.companyId,
        roleId: membership.roleId,
        departmentIds: body.departmentIds,
      },
      "user.role.assign",
    );
    if (body.roleId)
      await authorizeGrant(
        req,
        { companyId: membership.companyId, roleId: body.roleId },
        "user.role.assign",
      );

    const currentRole = await getRoleRecord(db, membership.roleId);
    const losesOwner =
      currentRole?.key === "platform_owner" &&
      membership.companyId === null &&
      ((body.status && body.status !== "active") ||
        (body.roleId && body.roleId !== membership.roleId));
    if (losesOwner && (await countActivePlatformOwners(db, membership.userId)) === 0) {
      throw new ConflictError("Cannot remove the last active Platform Owner");
    }
    return { data: await updateMembership(db, id, body, actorFrom(req)) };
  });

  /* ---------- roles & permissions ---------- */

  function requireRoleReader(req: FastifyRequest) {
    const access = principalOf(req).access;
    const ids = companiesWith(access, "user.view");
    if (ids !== "all" && !ids.length && !can(access, "security.manage", null))
      throw new ForbiddenError();
  }

  app.get("/permissions", async (req) => {
    requireRoleReader(req);
    return { data: await listPermissions(db) };
  });

  app.get("/roles", async (req) => {
    requireRoleReader(req);
    return { data: await listRoles(db, companiesWith(principalOf(req).access, "user.view")) };
  });

  app.post("/roles", async (req, reply) => {
    requirePermission(req, "security.manage", null);
    const body = createRoleSchema.parse(req.body);
    return reply.status(201).send({ data: await createRole(db, body, actorFrom(req)) });
  });

  app.patch("/roles/:id", async (req) => {
    requirePermission(req, "security.manage", null);
    const { id } = idParam.parse(req.params);
    return { data: await updateRole(db, id, updateRoleSchema.parse(req.body), actorFrom(req)) };
  });

  app.delete("/roles/:id", async (req, reply) => {
    requirePermission(req, "security.manage", null);
    const { id } = idParam.parse(req.params);
    await deleteRole(db, id, actorFrom(req));
    return reply.status(204).send();
  });
};
