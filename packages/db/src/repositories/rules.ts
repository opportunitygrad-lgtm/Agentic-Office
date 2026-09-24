import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import {
  RULE_SCHEMAS,
  type BrandRuleDTO,
  type CommercialRuleDTO,
  type CompanyRulesDTO,
  type ComplianceRuleDTO,
  type PersonRef,
  type RuleAction,
  type RuleDTO,
  type RuleKind,
} from "@aibos/shared";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import {
  brandRules,
  commercialRules,
  complianceRules,
  type BrandRule,
  type CommercialRule,
  type ComplianceRule,
} from "../schema";
import { recordAuditEvent } from "./audit";
import { loadPeople } from "./knowledge";
import { actorAuditFields, type Actor } from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const TABLES = {
  brand: brandRules,
  commercial: commercialRules,
  compliance: complianceRules,
} as const;
type AnyRule = BrandRule | CommercialRule | ComplianceRule;

const EDITABLE: Record<RuleKind, string[]> = {
  brand: ["title", "description", "severity", "active", "category", "channel"],
  commercial: [
    "title",
    "description",
    "severity",
    "active",
    "category",
    "appliesTo",
    "effect",
    "limitAmount",
    "currency",
    "period",
    "requiredPermission",
  ],
  compliance: [
    "title",
    "description",
    "severity",
    "active",
    "action",
    "jurisdiction",
    "effect",
    "disclosureText",
    "requiredPermission",
  ],
};

function toRuleDTO(kind: RuleKind, r: AnyRule, people: Map<string, PersonRef>): RuleDTO {
  const base = {
    id: r.id,
    companyId: r.companyId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    active: r.active,
    status: r.status,
    createdBy: r.createdByUserId ? (people.get(r.createdByUserId) ?? null) : null,
    approvedBy: r.approvedByUserId ? (people.get(r.approvedByUserId) ?? null) : null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    origin: r.origin,
  };
  if (kind === "brand") {
    const b = r as BrandRule;
    return { ...base, kind, category: b.category, channel: b.channel } satisfies BrandRuleDTO;
  }
  if (kind === "commercial") {
    const c = r as CommercialRule;
    return {
      ...base,
      kind,
      category: c.category,
      appliesTo: c.appliesTo,
      effect: c.effect,
      limitAmount: c.limitAmount,
      currency: c.currency,
      period: c.period,
      requiredPermission: c.requiredPermission,
    } satisfies CommercialRuleDTO;
  }
  const p = r as ComplianceRule;
  return {
    ...base,
    kind,
    action: p.action,
    jurisdiction: p.jurisdiction,
    effect: p.effect,
    disclosureText: p.disclosureText,
    requiredPermission: p.requiredPermission,
  } satisfies ComplianceRuleDTO;
}

/** Raw rule rows for a company (company + global). Used by the Context Engine. */
export async function loadRuleRows(db: Database, companyId: string) {
  const where = <T extends typeof brandRules | typeof commercialRules | typeof complianceRules>(
    t: T,
  ) => or(eq(t.companyId, companyId), isNull(t.companyId));
  const [brand, commercial, compliance] = await Promise.all([
    db.select().from(brandRules).where(where(brandRules)),
    db.select().from(commercialRules).where(where(commercialRules)),
    db.select().from(complianceRules).where(where(complianceRules)),
  ]);
  return { brand, commercial, compliance };
}

/** Company rules plus GLOBAL rules (companyId null), newest first within severity. */
export async function listCompanyRules(
  db: Database,
  companyId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CompanyRulesDTO> {
  const filter = (t: typeof brandRules | typeof commercialRules | typeof complianceRules) =>
    and(
      or(eq(t.companyId, companyId), isNull(t.companyId)),
      opts.includeArchived ? undefined : or(eq(t.status, "draft"), eq(t.status, "approved")),
    );
  const [brand, commercial, compliance] = await Promise.all([
    db
      .select()
      .from(brandRules)
      .where(filter(brandRules))
      .orderBy(desc(brandRules.severity), asc(brandRules.title)),
    db
      .select()
      .from(commercialRules)
      .where(filter(commercialRules))
      .orderBy(desc(commercialRules.severity), asc(commercialRules.title)),
    db
      .select()
      .from(complianceRules)
      .where(filter(complianceRules))
      .orderBy(desc(complianceRules.severity), asc(complianceRules.title)),
  ]);
  const people = await loadPeople(
    db,
    [...brand, ...commercial, ...compliance].flatMap((r) => [
      r.createdByUserId,
      r.approvedByUserId,
    ]),
  );
  return {
    brand: brand.map((r) => toRuleDTO("brand", r, people) as BrandRuleDTO),
    commercial: commercial.map((r) => toRuleDTO("commercial", r, people) as CommercialRuleDTO),
    compliance: compliance.map((r) => toRuleDTO("compliance", r, people) as ComplianceRuleDTO),
  };
}

export async function getRuleRecord(
  db: Database | Tx,
  kind: RuleKind,
  id: string,
): Promise<AnyRule> {
  const t = TABLES[kind];
  const [row] = await db.select().from(t).where(eq(t.id, id));
  if (!row) throw new NotFoundError("Rule", id);
  return row;
}

function ruleAudit(
  tx: Tx,
  actor: Actor,
  kind: RuleKind,
  rule: AnyRule,
  verb: string,
  description: string,
  extra: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  } = {},
) {
  return recordAuditEvent(
    tx,
    {
      ...actorAuditFields(actor),
      companyId: rule.companyId ?? undefined,
      resourceType: `${kind}_rule`,
      resourceId: rule.id,
      action: `${kind}_rule.${verb}`,
      description,
      metadata: { severity: rule.severity, status: rule.status, ...extra.metadata },
      before: extra.before,
      after: extra.after,
    },
    rule.origin,
  );
}

const pickEditable = (kind: RuleKind, r: AnyRule) =>
  Object.fromEntries(EDITABLE[kind].map((k) => [k, (r as Record<string, unknown>)[k] ?? null]));

/**
 * Creates a rule. Rules start as DRAFT (they do not bind agents) unless the
 * caller may approve rules and asked to approve immediately.
 */
export async function createRule(
  db: Database,
  kind: RuleKind,
  companyId: string | null,
  input: unknown,
  actor: Actor,
  opts: { approve?: boolean; origin?: "live" | "dev_seed" } = {},
): Promise<RuleDTO> {
  const data = RULE_SCHEMAS[kind].parse(input) as Record<string, unknown>;
  return db.transaction(async (tx) => {
    const t = TABLES[kind];
    const now = new Date();
    const [row] = (await tx
      .insert(t)
      .values({
        ...(data as object),
        companyId,
        status: opts.approve ? "approved" : "draft",
        approvedAt: opts.approve ? now : null,
        approvedByUserId: opts.approve ? (actor.userId ?? null) : null,
        createdByUserId: actor.userId ?? null,
        updatedByUserId: actor.userId ?? null,
        origin: opts.origin ?? "live",
      } as typeof t.$inferInsert)
      .returning()) as AnyRule[];
    await ruleAudit(
      tx,
      actor,
      kind,
      row!,
      "created",
      `${kind[0]!.toUpperCase()}${kind.slice(1)} rule "${row!.title}" created${opts.approve ? " and approved" : " as draft"}`,
      {
        after: pickEditable(kind, row!),
      },
    );
    return toRuleDTO(
      kind,
      row!,
      await loadPeople(tx, [row!.createdByUserId, row!.approvedByUserId]),
    );
  });
}

/**
 * Edits a rule. The merged rule is re-validated against the full schema.
 * Editing an APPROVED rule keeps it approved only when the editor may approve
 * rules; otherwise it returns to DRAFT and stops binding agents until re-approved.
 */
export async function updateRule(
  db: Database,
  kind: RuleKind,
  id: string,
  patch: Record<string, unknown>,
  actor: Actor,
  opts: { canApprove: boolean },
): Promise<RuleDTO> {
  const unknownKeys = Object.keys(patch).filter((k) => !EDITABLE[kind].includes(k));
  if (unknownKeys.length)
    throw new ConflictError(`Fields cannot be edited: ${unknownKeys.join(", ")}`);
  return db.transaction(async (tx) => {
    const t = TABLES[kind];
    const before = await getRuleRecord(tx, kind, id);
    if (before.status === "archived") throw new ConflictError("Archived rules cannot be edited");
    const merged = RULE_SCHEMAS[kind].parse({ ...pickEditable(kind, before), ...patch }) as Record<
      string,
      unknown
    >;
    const revertToDraft = before.status === "approved" && !opts.canApprove;
    const [row] = (await tx
      .update(t)
      .set({
        ...(merged as object),
        updatedByUserId: actor.userId ?? null,
        ...(revertToDraft ? { status: "draft", approvedAt: null, approvedByUserId: null } : {}),
      } as Partial<typeof t.$inferInsert>)
      .where(eq(t.id, id))
      .returning()) as AnyRule[];
    await ruleAudit(
      tx,
      actor,
      kind,
      row!,
      "updated",
      `${kind[0]!.toUpperCase()}${kind.slice(1)} rule "${row!.title}" updated${revertToDraft ? " (returned to draft for approval)" : ""}`,
      {
        before: pickEditable(kind, before),
        after: pickEditable(kind, row!),
        metadata: { revertedToDraft: revertToDraft },
      },
    );
    return toRuleDTO(
      kind,
      row!,
      await loadPeople(tx, [row!.createdByUserId, row!.approvedByUserId]),
    );
  });
}

export async function ruleLifecycle(
  db: Database,
  kind: RuleKind,
  id: string,
  action: RuleAction,
  actor: Actor,
): Promise<RuleDTO> {
  return db.transaction(async (tx) => {
    const t = TABLES[kind];
    const before = await getRuleRecord(tx, kind, id);
    const patch: Record<string, unknown> = { updatedByUserId: actor.userId ?? null };
    if (action === "approve") {
      if (before.status !== "draft")
        throw new ConflictError(`Only draft rules can be approved (rule is ${before.status})`);
      Object.assign(patch, {
        status: "approved",
        approvedAt: new Date(),
        approvedByUserId: actor.userId ?? null,
      });
    } else if (action === "archive") {
      if (before.status === "archived") throw new ConflictError("Rule is already archived");
      Object.assign(patch, { status: "archived", active: false });
    } else {
      if (before.status !== "archived")
        throw new ConflictError("Only archived rules can be restored");
      Object.assign(patch, {
        status: "draft",
        active: true,
        approvedAt: null,
        approvedByUserId: null,
      });
    }
    const [row] = (await tx.update(t).set(patch).where(eq(t.id, id)).returning()) as AnyRule[];
    const verb = action === "approve" ? "approved" : action === "archive" ? "archived" : "restored";
    await ruleAudit(
      tx,
      actor,
      kind,
      row!,
      verb,
      `${kind[0]!.toUpperCase()}${kind.slice(1)} rule "${row!.title}" ${verb}`,
      {
        metadata: { previousStatus: before.status },
      },
    );
    return toRuleDTO(
      kind,
      row!,
      await loadPeople(tx, [row!.createdByUserId, row!.approvedByUserId]),
    );
  });
}
