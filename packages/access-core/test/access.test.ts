import { describe, expect, it } from "vitest";
import {
  AGENT_PERMISSIONS,
  HUMAN_PERMISSIONS,
  SYSTEM_ROLES,
  buildHumanAccess,
  can,
  canDecideApproval,
  companiesWith,
  departmentScope,
  evaluateAgentPermission,
  getSystemRole,
  requiredApprovalPermissions,
  type AgentAuthorityInput,
} from "../src";

const role = (key: string) => getSystemRole(key)!.permissions;

describe("catalogues", () => {
  it("has unique, namespaced human and agent permission keys", () => {
    const human = HUMAN_PERMISSIONS.map((p) => p.key);
    expect(new Set(human).size).toBe(human.length);
    for (const k of human) expect(k).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    for (const a of AGENT_PERMISSIONS) expect(a.key).toMatch(/^(tool|action)\./);
  });

  it("system roles only reference known permissions", () => {
    const known = new Set(HUMAN_PERMISSIONS.map((p) => p.key));
    for (const r of SYSTEM_ROLES)
      for (const perm of r.permissions) expect(known.has(perm)).toBe(true);
    expect(role("platform_owner")).toContain("security.manage");
    expect(role("group_admin")).not.toContain("security.manage");
    expect(role("company_owner")).not.toContain("company.create");
  });
});

describe("human access evaluation", () => {
  const ept = "c-ept";
  const pa = "c-pa";

  it("isolates company memberships", () => {
    const ctx = buildHumanAccess("u1", [
      {
        membershipId: "m1",
        companyId: ept,
        roleKey: "company_manager",
        permissions: role("company_manager"),
        departmentIds: [],
      },
    ]);
    expect(can(ctx, "task.view", ept)).toBe(true);
    expect(can(ctx, "task.view", pa)).toBe(false);
    expect(can(ctx, "task.view", null)).toBe(false);
    expect(companiesWith(ctx, "task.view")).toEqual([ept]);
    expect(ctx.isPlatformOwner).toBe(false);
  });

  it("grants everything everywhere to a global platform owner", () => {
    const ctx = buildHumanAccess("u0", [
      {
        membershipId: "m0",
        companyId: null,
        roleKey: "platform_owner",
        permissions: role("platform_owner"),
        departmentIds: [],
      },
    ]);
    expect(ctx.isPlatformOwner).toBe(true);
    expect(can(ctx, "approval.financial", pa)).toBe(true);
    expect(companiesWith(ctx, "audit.view")).toBe("all");
  });

  it("records department restrictions", () => {
    const ctx = buildHumanAccess("u2", [
      {
        membershipId: "m2",
        companyId: ept,
        roleKey: "department_manager",
        permissions: role("department_manager"),
        departmentIds: ["d-mkt"],
      },
    ]);
    expect(departmentScope(ctx, ept, "agent.view")).toEqual(["d-mkt"]);
    expect(can(ctx, "user.invite", ept)).toBe(false);
  });

  it("derives approval authority from type and risk", () => {
    expect(
      requiredApprovalPermissions({ type: "email_send", riskLevel: "medium", companyId: ept }),
    ).toEqual(["approval.decide", "approval.external_send"]);
    expect(
      requiredApprovalPermissions({
        type: "ad_budget_increase",
        riskLevel: "high",
        companyId: ept,
      }),
    ).toEqual(["approval.decide", "approval.financial", "approval.high_risk"]);
    const manager = buildHumanAccess("u1", [
      {
        membershipId: "m1",
        companyId: ept,
        roleKey: "company_manager",
        permissions: role("company_manager"),
        departmentIds: [],
      },
    ]);
    expect(
      canDecideApproval(manager, {
        companyId: ept,
        requiredPermissions: ["approval.decide", "approval.external_send"],
      }).allowed,
    ).toBe(true);
    const financial = canDecideApproval(manager, {
      companyId: ept,
      requiredPermissions: ["approval.decide", "approval.financial", "approval.high_risk"],
    });
    expect(financial.allowed).toBe(false);
    expect(financial.missing).toEqual(["approval.financial", "approval.high_risk"]);
    expect(
      canDecideApproval(manager, { companyId: pa, requiredPermissions: ["approval.decide"] })
        .allowed,
    ).toBe(false);
  });
});

describe("agent authority evaluation", () => {
  const base = (
    autonomyLevel: AgentAuthorityInput["agent"]["autonomyLevel"],
    extra: Partial<AgentAuthorityInput["agent"]> = {},
  ): AgentAuthorityInput => ({
    agent: {
      id: "a1",
      status: "sleeping",
      autonomyLevel,
      scope: "company",
      companyIds: ["c1"],
      approvalRequirements: [],
      ...extra,
    },
    grants: [
      { permission: "tool.email.read", effect: "allow", companyId: null },
      { permission: "tool.email.draft", effect: "allow", companyId: null },
      { permission: "tool.email.send", effect: "require_approval", companyId: null },
      { permission: "tool.meta.write", effect: "allow", companyId: null },
      { permission: "action.financial_change", effect: "allow", companyId: null },
      { permission: "tool.browser.use", effect: "allow", companyId: null },
      { permission: "tool.browser.use", effect: "deny", companyId: "c2" },
    ],
  });

  it("denies by default and when disabled or unassigned", () => {
    expect(
      evaluateAgentPermission(base("approval_gated"), "c1", "tool.wordpress.write").decision,
    ).toBe("deny");
    expect(evaluateAgentPermission(base("disabled"), "c1", "tool.email.read").decision).toBe(
      "deny",
    );
    expect(evaluateAgentPermission(base("approval_gated"), "c9", "tool.email.read").decision).toBe(
      "deny",
    );
    expect(
      evaluateAgentPermission(base("approval_gated", { status: "paused" }), "c1", "tool.email.read")
        .decision,
    ).toBe("deny");
  });

  it("Observe agents may only read", () => {
    expect(evaluateAgentPermission(base("observe"), "c1", "tool.email.read").decision).toBe(
      "allow",
    );
    expect(evaluateAgentPermission(base("observe"), "c1", "tool.email.draft").decision).toBe(
      "deny",
    );
  });

  it("Limited operators never perform high-risk actions", () => {
    expect(
      evaluateAgentPermission(base("limited_operator"), "c1", "tool.email.draft").decision,
    ).toBe("allow");
    expect(
      evaluateAgentPermission(base("limited_operator"), "c1", "tool.meta.write").decision,
    ).toBe("deny");
  });

  it("Approval-gated agents need a human for high-risk actions", () => {
    const d = evaluateAgentPermission(base("approval_gated"), "c1", "tool.email.send");
    expect(d.decision).toBe("require_approval");
    if (d.decision === "require_approval") expect(d.approvalType).toBe("email_send");
    expect(evaluateAgentPermission(base("approval_gated"), "c1", "tool.meta.write").decision).toBe(
      "require_approval",
    );
  });

  it("Trusted automation is still bounded", () => {
    expect(
      evaluateAgentPermission(base("trusted_automation"), "c1", "tool.meta.write").decision,
    ).toBe("allow");
    expect(
      evaluateAgentPermission(base("trusted_automation"), "c1", "action.financial_change").decision,
    ).toBe("require_approval");
    expect(
      evaluateAgentPermission(
        base("trusted_automation", { approvalRequirements: ["email_send"] }),
        "c1",
        "tool.email.send",
      ).decision,
    ).toBe("require_approval");
  });

  it("company-specific grants override global grants", () => {
    const input = base("approval_gated", { companyIds: ["c1", "c2"] });
    expect(evaluateAgentPermission(input, "c1", "tool.browser.use").decision).toBe("allow");
    expect(evaluateAgentPermission(input, "c2", "tool.browser.use").decision).toBe("deny");
  });
});
