import type { ApprovalType, RiskLevel } from "@aibos/shared";

/** An active membership with its role's resolved permission keys. */
export interface MembershipGrant {
  membershipId: string;
  /** null = global membership (applies to every company). */
  companyId: string | null;
  roleKey: string;
  permissions: readonly string[];
  /** Non-empty = access restricted to these departments within the company. */
  departmentIds: readonly string[];
}

export interface HumanAccessContext {
  userId: string;
  isPlatformOwner: boolean;
  /** Permissions granted everywhere via global memberships. */
  global: ReadonlySet<string>;
  /** Permissions per company via company memberships. */
  byCompany: ReadonlyMap<string, ReadonlySet<string>>;
  /** Department restrictions per company (absent = whole company). */
  departments: ReadonlyMap<string, readonly string[]>;
}

export function buildHumanAccess(
  userId: string,
  grants: readonly MembershipGrant[],
): HumanAccessContext {
  const global = new Set<string>();
  const byCompany = new Map<string, Set<string>>();
  const departments = new Map<string, string[]>();
  let isPlatformOwner = false;
  for (const g of grants) {
    if (g.companyId === null) {
      g.permissions.forEach((x) => global.add(x));
      if (g.roleKey === "platform_owner") isPlatformOwner = true;
      continue;
    }
    const set = byCompany.get(g.companyId) ?? new Set<string>();
    g.permissions.forEach((x) => set.add(x));
    byCompany.set(g.companyId, set);
    if (g.departmentIds.length)
      departments.set(g.companyId, [...(departments.get(g.companyId) ?? []), ...g.departmentIds]);
  }
  return { userId, isPlatformOwner, global, byCompany, departments };
}

/** Does the user hold `permission` for `companyId` (null = group/global level)? */
export function can(
  ctx: HumanAccessContext,
  permission: string,
  companyId: string | null,
): boolean {
  if (ctx.global.has(permission)) return true;
  if (companyId === null) return false;
  return ctx.byCompany.get(companyId)?.has(permission) ?? false;
}

/** Companies in which the user holds `permission`: "all" via global access, else explicit ids. */
export function companiesWith(ctx: HumanAccessContext, permission: string): "all" | string[] {
  if (ctx.global.has(permission)) return "all";
  return [...ctx.byCompany.entries()]
    .filter(([, perms]) => perms.has(permission))
    .map(([id]) => id);
}

/** Effective permissions for a company (or group level when null). */
export function effectivePermissions(ctx: HumanAccessContext, companyId: string | null): string[] {
  const out = new Set(ctx.global);
  if (companyId) ctx.byCompany.get(companyId)?.forEach((x) => out.add(x));
  return [...out].sort();
}

/**
 * Department restriction for a company: null = unrestricted. Global access
 * for the permission always means unrestricted.
 */
export function departmentScope(
  ctx: HumanAccessContext,
  companyId: string,
  permission: string,
): readonly string[] | null {
  if (ctx.global.has(permission)) return null;
  return ctx.departments.get(companyId) ?? null;
}

/* ---------- approval authority ---------- */

export interface ApprovalRequirementRule {
  approvalType: ApprovalType | "*";
  /** Rule applies at or above this risk level (null = any). */
  minRiskLevel: RiskLevel | null;
  requiredPermission: string;
  /** null = platform default; otherwise company-specific additional rule. */
  companyId: string | null;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Default, data-driven approval authority rules (synced to `approval_requirements`). */
export const DEFAULT_APPROVAL_REQUIREMENTS: readonly ApprovalRequirementRule[] = [
  { approvalType: "*", minRiskLevel: null, requiredPermission: "approval.decide", companyId: null },
  {
    approvalType: "*",
    minRiskLevel: "high",
    requiredPermission: "approval.high_risk",
    companyId: null,
  },
  {
    approvalType: "email_send",
    minRiskLevel: null,
    requiredPermission: "approval.external_send",
    companyId: null,
  },
  {
    approvalType: "ad_launch",
    minRiskLevel: null,
    requiredPermission: "approval.financial",
    companyId: null,
  },
  {
    approvalType: "ad_budget_increase",
    minRiskLevel: null,
    requiredPermission: "approval.financial",
    companyId: null,
  },
  {
    approvalType: "financial_action",
    minRiskLevel: null,
    requiredPermission: "approval.financial",
    companyId: null,
  },
  {
    approvalType: "website_deployment",
    minRiskLevel: null,
    requiredPermission: "approval.deployment",
    companyId: null,
  },
  {
    approvalType: "code_deployment",
    minRiskLevel: null,
    requiredPermission: "approval.deployment",
    companyId: null,
  },
  {
    approvalType: "legal_commercial_action",
    minRiskLevel: null,
    requiredPermission: "approval.high_risk",
    companyId: null,
  },
  {
    approvalType: "destructive_action",
    minRiskLevel: null,
    requiredPermission: "approval.high_risk",
    companyId: null,
  },
];

export function requiredApprovalPermissions(
  approval: { type: ApprovalType; riskLevel: RiskLevel; companyId: string | null },
  rules: readonly ApprovalRequirementRule[] = DEFAULT_APPROVAL_REQUIREMENTS,
): string[] {
  const out = new Set<string>(["approval.decide"]);
  for (const r of rules) {
    if (r.approvalType !== "*" && r.approvalType !== approval.type) continue;
    if (r.companyId !== null && r.companyId !== approval.companyId) continue;
    if (r.minRiskLevel && RISK_ORDER[approval.riskLevel] < RISK_ORDER[r.minRiskLevel]) continue;
    out.add(r.requiredPermission);
  }
  return [...out].sort();
}

export function canDecideApproval(
  ctx: HumanAccessContext,
  approval: { companyId: string | null; requiredPermissions: readonly string[] },
): { allowed: boolean; missing: string[] } {
  const missing = approval.requiredPermissions.filter(
    (perm) => !can(ctx, perm, approval.companyId),
  );
  return { allowed: missing.length === 0, missing };
}
