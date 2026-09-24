import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createTestDb, resetOperationalData } from "@aibos/db/testing";
import { seedDev } from "@aibos/db/dev-seed";
import type { AgentDTO, ApprovalDTO, MeDTO, RoleDTO, TaskDTO, UserDTO } from "@aibos/shared";
import { buildApp } from "../src/app";
import { healthStub, loginCookie } from "./helpers";

const handle = createTestDb();
let app: FastifyInstance;
const cookies: Record<string, string> = {};
const as = (who: string) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, cookie: cookies[who] } });

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(handle.db);
  app = await buildApp({ db: handle, health: healthStub });
  for (const who of ["owner", "ept.manager", "pa.manager", "og.marketing", "group.admin"]) {
    cookies[who] = await loginCookie(app, `${who}@aibos.example`);
  }
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

const tasksOf = async (who: string, company?: string) =>
  await as(who)({ method: "GET", url: `/v1/tasks${company ? `?company=${company}` : ""}` });

describe("authorization matrix — EPT Manager", () => {
  it("can read EPT tasks only", async () => {
    const res = await tasksOf("ept.manager", "euro-pilot-training");
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ data: TaskDTO[] }>().data.every((t) => t.company?.slug === "euro-pilot-training"),
    ).toBe(true);
    expect((await tasksOf("ept.manager", "pilotsassist")).statusCode).toBe(403);
    expect((await tasksOf("ept.manager", "opportunitygrad")).statusCode).toBe(403);
  });

  it("global listings never include other companies or group-level rows", async () => {
    const all = (await tasksOf("ept.manager")).json<{ data: TaskDTO[] }>().data;
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => t.company?.slug === "euro-pilot-training")).toBe(true);
    const shell = (await as("ept.manager")({ method: "GET", url: "/v1/shell" })).json<{
      companies: { slug: string }[];
    }>();
    expect(shell.companies.map((c) => c.slug)).toEqual(["euro-pilot-training"]);
    const audit = (await as("ept.manager")({ method: "GET", url: "/v1/audit-events" })).json<{
      data: { company: { slug: string } | null }[];
    }>().data;
    expect(audit.every((e) => e.company?.slug === "euro-pilot-training")).toBe(true);
  });

  it("does not leak other companies through global agents' current tasks", async () => {
    const agents = (await as("pa.manager")({ method: "GET", url: "/v1/agents" })).json<{
      data: AgentDTO[];
    }>().data;
    const email = agents.find((a) => a.name === "Email & Communications")!;
    expect(email.companies.map((c) => c.slug)).toEqual(["pilotsassist"]);
    expect(email.currentTask).toBeNull(); // its current task belongs to EPT
    expect(agents.some((a) => a.name.startsWith("EPT "))).toBe(false);
  });

  it("cannot administer users outside their company or approve financial actions", async () => {
    const users = (await as("ept.manager")({ method: "GET", url: "/v1/users" })).json<{
      data: UserDTO[];
    }>().data;
    expect(
      users.every((u) => u.memberships.every((m) => m.company?.slug === "euro-pilot-training")),
    ).toBe(true);
    expect(users.some((u) => u.email === "pa.manager@aibos.example")).toBe(false);
  });
});

describe("authorization matrix — Opportunitygrad Marketing Manager", () => {
  it("sees only Opportunitygrad marketing-department agents", async () => {
    const res = await as("og.marketing")({
      method: "GET",
      url: "/v1/agents?company=opportunitygrad",
    });
    expect(res.statusCode).toBe(200);
    const agents = res.json<{ data: AgentDTO[] }>().data;
    expect(agents.map((a) => a.name)).toEqual(["Opportunitygrad Marketing / Meta"]);
    expect(agents.every((a) => a.department?.slug === "marketing")).toBe(true);
  });

  it("holds Meta/marketing permissions but not user administration", async () => {
    const me = (await as("og.marketing")({ method: "GET", url: "/v1/auth/me" })).json<MeDTO>();
    const og = me.accessibleCompanies.find((c) => c.slug === "opportunitygrad")!;
    expect(me.companyPermissions[og.id]).toEqual(
      expect.arrayContaining(["meta.view", "meta.edit", "marketing.view"]),
    );
    expect(me.companyPermissions[og.id]).not.toContain("user.invite");
    expect((await as("og.marketing")({ method: "GET", url: "/v1/users" })).statusCode).toBe(403);
    expect((await as("og.marketing")({ method: "GET", url: "/v1/audit-events" })).statusCode).toBe(
      403,
    );
  });

  it("cannot approve high-risk financial actions (API enforced)", async () => {
    const approvals = (
      await as("og.marketing")({ method: "GET", url: "/v1/approvals?company=opportunitygrad" })
    ).json<{ data: ApprovalDTO[] }>().data;
    const budget = approvals.find(
      (a) => a.type === "ad_budget_increase" && a.status === "pending",
    )!;
    expect(budget.viewerCanDecide).toBe(false);
    expect(budget.viewerMissingPermissions).toEqual(["approval.financial", "approval.high_risk"]);
    const res = await as("og.marketing")({
      method: "POST",
      url: `/v1/approvals/${budget.id}/decision`,
      payload: { decision: "approve" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("authorization matrix — Platform Owner & Group Admin", () => {
  it("platform owner accesses every company", async () => {
    for (const c of ["euro-pilot-training", "pilotsassist", "opportunitygrad"]) {
      expect((await tasksOf("owner", c)).statusCode).toBe(200);
    }
    const nonexistent = await tasksOf("owner", "does-not-exist");
    expect(nonexistent.statusCode).toBe(404);
  });

  it("group admin is limited to authorised companies", async () => {
    expect((await tasksOf("group.admin", "opportunitygrad")).statusCode).toBe(200);
    expect((await tasksOf("group.admin", "pilotsassist")).statusCode).toBe(403);
  });

  it("unknown and forbidden companies are indistinguishable for scoped users", async () => {
    const forbidden = await tasksOf("ept.manager", "pilotsassist");
    const unknown = await tasksOf("ept.manager", "does-not-exist");
    expect(forbidden.statusCode).toBe(403);
    expect(unknown.statusCode).toBe(403);
    expect(forbidden.json()).toEqual(unknown.json());
  });
});

describe("approval decisions", () => {
  it("company manager approves routine email in their company; cannot touch another company's approval", async () => {
    const ept = (
      await as("ept.manager")({ method: "GET", url: "/v1/approvals?company=euro-pilot-training" })
    ).json<{ data: ApprovalDTO[] }>().data;
    const email = ept.find((a) => a.type === "email_send")!;
    expect(email.viewerCanDecide).toBe(true);
    const ok = await as("ept.manager")({
      method: "POST",
      url: `/v1/approvals/${email.id}/decision`,
      payload: { decision: "approve", notes: "Looks good" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: ApprovalDTO }>().data.status).toBe("approved");
    const again = await as("owner")({
      method: "POST",
      url: `/v1/approvals/${email.id}/decision`,
      payload: { decision: "reject" },
    });
    expect(again.statusCode).toBe(409);

    const og = (
      await as("owner")({ method: "GET", url: "/v1/approvals?company=opportunitygrad" })
    ).json<{ data: ApprovalDTO[] }>().data;
    const foreign = og.find((a) => a.status === "pending")!;
    const denied = await as("ept.manager")({
      method: "POST",
      url: `/v1/approvals/${foreign.id}/decision`,
      payload: { decision: "approve" },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("rejects tampered decision payloads", async () => {
    const og = (
      await as("owner")({ method: "GET", url: "/v1/approvals?company=opportunitygrad" })
    ).json<{ data: ApprovalDTO[] }>().data;
    const pending = og.find((a) => a.status === "pending")!;
    const tampered = await as("owner")({
      method: "POST",
      url: `/v1/approvals/${pending.id}/decision`,
      payload: {
        decision: "approve",
        status: "approved",
        decidedByUserId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(tampered.statusCode).toBe(400);
    const owner = await as("owner")({
      method: "POST",
      url: `/v1/approvals/${pending.id}/decision`,
      payload: { decision: "approve" },
    });
    expect(owner.statusCode).toBe(200);
  });
});

describe("role assignment", () => {
  const rolesOf = async () =>
    (await as("owner")({ method: "GET", url: "/v1/roles" })).json<{ data: RoleDTO[] }>().data;

  it("company manager invites staff in their company but cannot escalate or cross companies", async () => {
    const roles = await rolesOf();
    const staff = roles.find((r) => r.key === "staff")!;
    const owner = roles.find((r) => r.key === "company_owner")!;
    const me = (await as("ept.manager")({ method: "GET", url: "/v1/auth/me" })).json<MeDTO>();
    const ept = me.accessibleCompanies[0]!;

    const invited = await as("ept.manager")({
      method: "POST",
      url: "/v1/users/invitations",
      payload: {
        email: "new.staff@aibos.example",
        firstName: "New",
        memberships: [{ companyId: ept.id, roleId: staff.id }],
      },
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json().invitationUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    const escalate = await as("ept.manager")({
      method: "POST",
      url: "/v1/users/invitations",
      payload: {
        email: "boss@aibos.example",
        firstName: "Boss",
        memberships: [{ companyId: ept.id, roleId: owner.id }],
      },
    });
    expect(escalate.statusCode).toBe(403);

    const all = (await as("owner")({ method: "GET", url: "/v1/companies" })).json<{
      data: { id: string; slug: string }[];
    }>().data;
    const pa = all.find((c) => c.slug === "pilotsassist")!;
    const cross = await as("ept.manager")({
      method: "POST",
      url: "/v1/users/invitations",
      payload: {
        email: "spy@aibos.example",
        firstName: "Spy",
        memberships: [{ companyId: pa.id, roleId: staff.id }],
      },
    });
    expect(cross.statusCode).toBe(403);

    const global = await as("ept.manager")({
      method: "POST",
      url: "/v1/users/invitations",
      payload: {
        email: "g@aibos.example",
        firstName: "G",
        memberships: [{ companyId: null, roleId: staff.id }],
      },
    });
    expect(global.statusCode).toBe(403);
  });

  it("platform owner assigns roles; managers cannot change memberships or their own access", async () => {
    const roles = await rolesOf();
    const users = (await as("owner")({ method: "GET", url: "/v1/users" })).json<{
      data: UserDTO[];
    }>().data;
    const pa = users.find((u) => u.email === "pa.manager@aibos.example")!;
    const viewer = roles.find((r) => r.key === "viewer")!;
    const membership = pa.memberships[0]!;

    const denied = await as("ept.manager")({
      method: "PATCH",
      url: `/v1/memberships/${membership.id}`,
      payload: { roleId: viewer.id },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await as("owner")({
      method: "PATCH",
      url: `/v1/memberships/${membership.id}`,
      payload: { roleId: viewer.id },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: UserDTO }>().data.memberships[0]?.role.key).toBe("viewer");

    const ownerUser = users.find((u) => u.email === "owner@aibos.example")!;
    const self = await as("owner")({
      method: "PATCH",
      url: `/v1/memberships/${ownerUser.memberships[0]!.id}`,
      payload: { status: "revoked" },
    });
    expect(self.statusCode).toBe(403);
    const tamper = await as("owner")({
      method: "PATCH",
      url: `/v1/memberships/${membership.id}`,
      payload: { userId: ownerUser.id },
    });
    expect(tamper.statusCode).toBe(400);
  });

  it("only security admins manage roles; system roles are locked", async () => {
    const roles = await rolesOf();
    const po = roles.find((r) => r.key === "platform_owner")!;
    expect(
      (
        await as("ept.manager")({
          method: "POST",
          url: "/v1/roles",
          payload: { name: "Hacker", permissions: ["company.view"] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await as("owner")({
          method: "PATCH",
          url: `/v1/roles/${po.id}`,
          payload: { permissions: [] },
        })
      ).statusCode,
    ).toBe(403);
    const created = await as("owner")({
      method: "POST",
      url: "/v1/roles",
      payload: { name: "Campaign Reviewer", permissions: ["company.view", "meta.view"] },
    });
    expect(created.statusCode).toBe(201);
  });

  it("disables a user and their sessions stop working", async () => {
    const victim = await loginCookie(app, "group.admin@aibos.example");
    const users = (await as("owner")({ method: "GET", url: "/v1/users" })).json<{
      data: UserDTO[];
    }>().data;
    const target = users.find((u) => u.email === "group.admin@aibos.example")!;
    expect(
      (
        await as("ept.manager")({
          method: "PATCH",
          url: `/v1/users/${target.id}`,
          payload: { status: "disabled" },
        })
      ).statusCode,
    ).toBe(403);
    const res = await as("owner")({
      method: "PATCH",
      url: `/v1/users/${target.id}`,
      payload: { status: "disabled" },
    });
    expect(res.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: victim },
    });
    expect(after.statusCode).toBe(401);
    const owner = users.find((u) => u.email === "owner@aibos.example")!;
    expect(
      (
        await as("owner")({
          method: "PATCH",
          url: `/v1/users/${owner.id}`,
          payload: { status: "disabled" },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("privilege escalation guards", () => {
  it("a company owner cannot act on users whose roles exceed their own", async () => {
    const roles = (await as("owner")({ method: "GET", url: "/v1/roles" })).json<{
      data: RoleDTO[];
    }>().data;
    const users = (await as("owner")({ method: "GET", url: "/v1/users" })).json<{
      data: UserDTO[];
    }>().data;
    const eptManager = users.find((u) => u.email === "ept.manager@aibos.example")!;
    const companyOwner = roles.find((r) => r.key === "company_owner")!;
    const promoted = await as("owner")({
      method: "PATCH",
      url: `/v1/memberships/${eptManager.memberships[0]!.id}`,
      payload: { roleId: companyOwner.id },
    });
    expect(promoted.statusCode).toBe(200);

    const groupAdmin = users.find((u) => u.email === "group.admin@aibos.example")!;
    const eptMembership = groupAdmin.memberships.find(
      (m) => m.company?.slug === "euro-pilot-training",
    )!;
    expect(
      (
        await as("ept.manager")({
          method: "PATCH",
          url: `/v1/users/${groupAdmin.id}`,
          payload: { status: "suspended" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await as("ept.manager")({
          method: "PATCH",
          url: `/v1/memberships/${eptMembership.id}`,
          payload: { status: "revoked" },
        })
      ).statusCode,
    ).toBe(403);

    const staff = users.find((u) => u.email === "disabled@aibos.example")!;
    const ok = await as("ept.manager")({
      method: "PATCH",
      url: `/v1/users/${staff.id}`,
      payload: { firstName: "Formerly" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("never exposes password hashes in user listings", async () => {
    const res = await as("owner")({ method: "GET", url: "/v1/users" });
    expect(res.body).not.toMatch(/passwordHash|password_hash|\$argon2/);
  });
});

describe("agent authority API", () => {
  it("returns an authority matrix and only lets authorised humans change autonomy", async () => {
    const agents = (await as("owner")({ method: "GET", url: "/v1/agents" })).json<{
      data: AgentDTO[];
    }>().data;
    const email = agents.find((a) => a.name === "Email & Communications")!;
    const authority = (
      await as("owner")({ method: "GET", url: `/v1/agents/${email.id}/authority` })
    ).json();
    expect(authority.data.viewerCanManage).toBe(true);
    const emailGroup = authority.data.groups.find((g: { group: string }) => g.group === "Email");
    expect(emailGroup.items.map((i: { decision: string }) => i.decision)).toEqual([
      "allow",
      "allow",
      "require_approval",
    ]);

    expect(
      (
        await as("ept.manager")({
          method: "PUT",
          url: `/v1/agents/${email.id}/autonomy`,
          payload: { autonomyLevel: "trusted_automation" },
        })
      ).statusCode,
    ).toBe(403);
    const ok = await as("owner")({
      method: "PUT",
      url: `/v1/agents/${email.id}/autonomy`,
      payload: { autonomyLevel: "limited_operator" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: AgentDTO }>().data.autonomyLevel).toBe("limited_operator");

    const foreign = agents.find((a) => a.name === "PilotsAssist Marketing")!;
    expect(
      (await as("ept.manager")({ method: "GET", url: `/v1/agents/${foreign.id}/authority` }))
        .statusCode,
    ).toBe(404);
  });
});
