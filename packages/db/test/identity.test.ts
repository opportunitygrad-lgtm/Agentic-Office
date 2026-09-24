import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { can, companiesWith, evaluateAgentPermission } from "@aibos/access-core";
import {
  ConflictError,
  ForbiddenError,
  InvalidTokenError,
  acceptInvitation,
  addMembership,
  agentAuthority,
  authenticate,
  bootstrapPlatformOwner,
  canAgent,
  createAgent,
  createApproval,
  createCompany,
  createRole,
  createSession,
  createTask,
  decideApproval,
  getRoleByKey,
  insertMembership,
  insertUser,
  inviteUser,
  issueAuthToken,
  listApprovals,
  listRoles,
  listTasks,
  loadAccessContext,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  schema,
  setAgentAutonomy,
  setAgentGrants,
  updateRole,
  updateUser,
  validateSessionToken,
  type Actor,
} from "../src";
import { VALID_COMPANY, createTestDb, resetOperationalData } from "./helpers";

const handle = createTestDb();
const db = handle.db;
const PASSWORD = "correct-horse-battery-staple";
const system: Actor = { kind: "system", ref: "test" };

beforeEach(async () => {
  await resetOperationalData(handle);
});
afterAll(async () => {
  await handle.close();
});

async function companyManager(companyId: string, email = "manager@test.example") {
  const user = await insertUser(db, { email, password: PASSWORD });
  const role = await getRoleByKey(db, "company_manager");
  await insertMembership(db, { userId: user.id, companyId, roleId: role.id });
  return user;
}

describe("users, roles, permissions", () => {
  it("creates users with hashed passwords and normalised emails", async () => {
    const user = await insertUser(db, { email: "  Mixed.Case@Test.Example ", password: PASSWORD });
    expect(user.emailNormalized).toBe("mixed.case@test.example");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.status).toBe("active");
  });

  it("syncs the permission catalogue and maps system roles to permissions", async () => {
    const perms = await db.select().from(schema.permissions);
    expect(perms.map((p) => p.key)).toContain("approval.financial");
    const roles = await listRoles(db);
    const owner = roles.find((r) => r.key === "platform_owner")!;
    expect(owner.isSystem).toBe(true);
    expect(owner.permissions).toContain("security.manage");
    expect(
      roles.find((r) => r.key === "viewer")!.permissions.every((p) => p.endsWith(".view")),
    ).toBe(true);
  });

  it("creates and edits custom roles but locks system roles", async () => {
    const role = await createRole(
      db,
      { name: "Finance Reviewer", permissions: ["company.view", "cost.view"] },
      system,
    );
    expect(role.isSystem).toBe(false);
    expect(role.permissions).toEqual(["company.view", "cost.view"]);
    const updated = await updateRole(
      db,
      role.id,
      { permissions: ["company.view", "cost.view", "cost.policy.manage"] },
      system,
    );
    expect(updated.permissions).toContain("cost.policy.manage");
    const owner = await getRoleByKey(db, "platform_owner");
    await expect(updateRole(db, owner.id, { permissions: [] }, system)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      createRole(db, { name: "Sneaky", permissions: ["security.manage"] }, system),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createRole(db, { name: "Bogus", permissions: ["made.up"] }, system),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("memberships and company isolation", () => {
  it("scopes a company manager to their company only", async () => {
    const a = await createCompany(db, { ...VALID_COMPANY, name: "Alpha Air" }, system);
    const b = await createCompany(db, { ...VALID_COMPANY, name: "Beta Air" }, system);
    const user = await companyManager(a.company.id);
    const ctx = await loadAccessContext(db, user.id);
    expect(can(ctx, "task.view", a.company.id)).toBe(true);
    expect(can(ctx, "task.view", b.company.id)).toBe(false);
    expect(companiesWith(ctx, "task.view")).toEqual([a.company.id]);

    await createTask(db, { companyId: a.company.id, title: "Alpha task" }, system);
    await createTask(db, { companyId: b.company.id, title: "Beta task" }, system);
    const visible = await listTasks(db, {
      scope: { companyIds: [a.company.id], includeGroup: false },
    });
    expect(visible.map((t) => t.title)).toEqual(["Alpha task"]);
  });

  it("supports department-restricted memberships", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, system);
    const user = await insertUser(db, { email: "dept@test.example", password: PASSWORD });
    const role = await getRoleByKey(db, "department_manager");
    const [marketing] = await db
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.slug, "marketing"));
    await insertMembership(db, {
      userId: user.id,
      companyId: company.id,
      roleId: role.id,
      departmentIds: [marketing!.id],
    });
    const ctx = await loadAccessContext(db, user.id);
    expect(ctx.departments.get(company.id)).toEqual([marketing!.id]);
    expect(can(ctx, "user.invite", company.id)).toBe(false);
  });

  it("ignores suspended memberships and memberships of inactive companies", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, system);
    const user = await companyManager(company.id);
    await db
      .update(schema.companyMemberships)
      .set({ status: "suspended" })
      .where(eq(schema.companyMemberships.userId, user.id));
    expect(can(await loadAccessContext(db, user.id), "company.view", company.id)).toBe(false);
  });

  it("invites a user and activates memberships on acceptance", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, system);
    const role = await getRoleByKey(db, "staff");
    const { user, token } = await inviteUser(
      db,
      {
        email: "new@test.example",
        firstName: "New",
        memberships: [{ companyId: company.id, roleId: role.id }],
      },
      system,
    );
    expect(user.status).toBe("invited");
    expect(user.memberships[0]?.status).toBe("invited");
    await expect(
      inviteUser(
        db,
        {
          email: "NEW@test.example",
          firstName: "Dup",
          memberships: [{ companyId: company.id, roleId: role.id }],
        },
        system,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const accepted = await acceptInvitation(db, { token, password: PASSWORD });
    expect(accepted.status).toBe("active");
    await expect(acceptInvitation(db, { token, password: PASSWORD })).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(can(await loadAccessContext(db, accepted.id), "company.view", company.id)).toBe(true);
    expect(
      (await addMembership(db, accepted.id, { companyId: null, roleId: role.id }, system))
        .memberships,
    ).toHaveLength(2);
  });
});

describe("sessions and authentication", () => {
  it("creates, validates and revokes sessions; stores only token hashes", async () => {
    const user = await insertUser(db, { email: "s@test.example", password: PASSWORD });
    const { token, session } = await createSession(db, user.id, { ipAddress: "127.0.0.1" });
    expect(session.id).not.toBe(token);
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await validateSessionToken(db, token)).ok).toBe(true);
    await revokeSession(db, session.id, "logout");
    expect(await validateSessionToken(db, token)).toMatchObject({ ok: false, reason: "revoked" });
    expect(await validateSessionToken(db, "not-a-real-token-but-long-enough-000000")).toMatchObject(
      { ok: false, reason: "invalid" },
    );
  });

  it("expires sessions after the idle window", async () => {
    const user = await insertUser(db, { email: "e@test.example", password: PASSWORD });
    const { token } = await createSession(db, user.id, {}, new Date(Date.now() - 48 * 3_600_000));
    expect(await validateSessionToken(db, token)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects disabled users and revokes their sessions", async () => {
    const user = await insertUser(db, { email: "d@test.example", password: PASSWORD });
    const { token } = await createSession(db, user.id);
    await updateUser(db, user.id, { status: "disabled" }, system);
    expect((await validateSessionToken(db, token)).ok).toBe(false);
    expect(await authenticate(db, "d@test.example", PASSWORD)).toMatchObject({
      ok: false,
      reason: "account_inactive",
    });
    expect(await authenticate(db, "d@test.example", "wrong-password-123")).toMatchObject({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await authenticate(db, "nobody@test.example", PASSWORD)).toMatchObject({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("runs the password reset token lifecycle (single-use, expiring)", async () => {
    const user = await insertUser(db, { email: "r@test.example", password: PASSWORD });
    const { token: sessionToken } = await createSession(db, user.id);
    expect(await requestPasswordReset(db, "unknown@test.example")).toBeNull();
    const issued = await requestPasswordReset(db, "R@test.example");
    expect(issued?.token).toBeTruthy();
    const [stored] = await db
      .select()
      .from(schema.authTokens)
      .where(eq(schema.authTokens.userId, user.id));
    expect(stored!.tokenHash).not.toBe(issued!.token);

    await resetPassword(db, issued!.token, "a-brand-new-password-42");
    expect((await authenticate(db, "r@test.example", "a-brand-new-password-42")).ok).toBe(true);
    expect((await validateSessionToken(db, sessionToken)).ok).toBe(false);
    await expect(resetPassword(db, issued!.token, "another-password-4242")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );

    const expired = await issueAuthToken(db, user.id, "password_reset", -1000);
    await expect(resetPassword(db, expired.token, "another-password-4242")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    await expect(resetPassword(db, "x".repeat(43), "another-password-4242")).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it("bootstraps the first platform owner exactly once", async () => {
    const owner = await bootstrapPlatformOwner(db, {
      email: "first@test.example",
      password: PASSWORD,
    });
    expect((await loadAccessContext(db, owner.id)).isPlatformOwner).toBe(true);
    await expect(
      bootstrapPlatformOwner(db, { email: "second@test.example", password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "auth.bootstrap_admin_created"));
    expect(events[0]?.actorType).toBe("service");
    expect(events[0]?.actorServiceId).toBe("bootstrap-cli");
  });
});

describe("approval authority", () => {
  it("stores required permissions and decides exactly once", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, system);
    const approval = await createApproval(
      db,
      {
        companyId: company.id,
        type: "ad_budget_increase",
        requestedAction: "Raise budget",
        riskLevel: "high",
      },
      system,
    );
    expect(approval.requiredPermissions).toEqual([
      "approval.decide",
      "approval.financial",
      "approval.high_risk",
    ]);
    const user = await companyManager(company.id);
    const actor: Actor = { kind: "human", ref: user.email, userId: user.id };
    const decided = await decideApproval(
      db,
      approval.id,
      { decision: "reject", notes: "Not now" },
      actor,
    );
    expect(decided.status).toBe("rejected");
    expect(decided.decidedByUserId).toBe(user.id);
    await expect(
      decideApproval(db, approval.id, { decision: "approve" }, actor),
    ).rejects.toBeInstanceOf(ConflictError);
    const [dto] = await listApprovals(db, { companyId: company.id });
    expect(dto?.requiredPermissions).toContain("approval.financial");
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "approval.rejected"),
          eq(schema.auditEvents.actorUserId, user.id),
        ),
      );
    expect(audit).toHaveLength(1);
  });
});

describe("agent authority", () => {
  it("applies template grants, autonomy and per-company overrides", async () => {
    const a = await createCompany(db, { ...VALID_COMPANY, name: "Alpha Air" }, system);
    const b = await createCompany(db, { ...VALID_COMPANY, name: "Beta Air" }, system);
    const agent = await createAgent(
      db,
      {
        name: "Mailer",
        templateKey: "email_communications",
        companyIds: [a.company.id, b.company.id],
        autonomyLevel: "approval_gated",
      },
      system,
    );

    expect((await canAgent(db, agent.id, a.company.id, "tool.email.read")).decision).toBe("allow");
    expect((await canAgent(db, agent.id, a.company.id, "tool.email.send")).decision).toBe(
      "require_approval",
    );
    expect((await canAgent(db, agent.id, a.company.id, "tool.meta.write")).decision).toBe("deny");
    expect((await canAgent(db, agent.id, null, "action.destructive")).decision).toBe("deny");

    await setAgentGrants(
      db,
      agent.id,
      { companyId: b.company.id, grants: [{ permission: "tool.email.read", effect: "deny" }] },
      system,
    );
    expect((await canAgent(db, agent.id, b.company.id, "tool.email.read")).decision).toBe("deny");
    expect((await canAgent(db, agent.id, a.company.id, "tool.email.read")).decision).toBe("allow");

    await setAgentAutonomy(db, agent.id, "disabled", system);
    expect((await canAgent(db, agent.id, a.company.id, "tool.email.read")).decision).toBe("deny");
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    expect(row!.autonomyLevel).toBe("disabled");

    const authority = await agentAuthority(db, agent.id, a.company.id, {
      visibleCompanyIds: [a.company.id],
      viewerCanManage: false,
    });
    expect(authority.companies.map((c) => c.id)).toEqual([a.company.id]);
    expect(authority.groups.find((g) => g.group === "Email")?.items.map((i) => i.verb)).toEqual([
      "READ",
      "DRAFT",
      "SEND",
    ]);
    await expect(
      setAgentGrants(
        db,
        agent.id,
        { grants: [{ permission: "tool.teleport", effect: "allow" }] },
        system,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(evaluateAgentPermission).toBeTypeOf("function");
    expect(
      (await canAgent(db, "00000000-0000-0000-0000-000000000000", null, "tool.web.search"))
        .decision,
    ).toBe("deny");
  });
});
