import { eq, isNull, or, sql } from "drizzle-orm";
import {
  aiPolicySchema,
  knowledgeFreshness,
  profileSectionSchemas,
  KNOWLEDGE_STATUSES,
  type AiPolicyInput,
  type AuditEventDTO,
  type CompanyAiPolicyDTO,
  type CompanyProfileDTO,
  type CompanyProfileFields,
  type KnowledgeStatus,
  type ProfileSection,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { NotFoundError } from "../errors";
import {
  brandRules,
  commercialRules,
  companies,
  companyAiPolicies,
  complianceRules,
  knowledgeItems,
  type Company,
  type CompanyAiPolicy,
} from "../schema";
import { listAuditEvents, recordAuditEvent } from "./audit";
import { toCompanyDTO } from "./companies";
import { countKnowledgeConflicts } from "./knowledge";
import { actorAuditFields, type Actor } from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function toProfileFields(c: Company): CompanyProfileFields {
  return {
    tradingName: c.tradingName,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    contactAddress: c.contactAddress,
    registrationNumber: c.registrationNumber,
    taxIdentifier: c.taxIdentifier,
    products: c.products,
    revenueModel: c.revenueModel,
    secondaryObjectives: c.secondaryObjectives,
    salesChannels: c.salesChannels,
    marketingChannels: c.marketingChannels,
    brandPersonality: c.brandPersonality,
    brandVoice: c.brandVoice,
    visualGuidance: c.visualGuidance,
    approvedPhrases: c.approvedPhrases,
    prohibitedPhrases: c.prohibitedPhrases,
    claimsAllowed: c.claimsAllowed,
    claimsRequiringEvidence: c.claimsRequiringEvidence,
    jurisdictions: c.jurisdictions,
    regulators: c.regulators,
    legalDisclaimers: c.legalDisclaimers,
    dataHandlingRules: c.dataHandlingRules,
  };
}

export const DEFAULT_AI_POLICY: Omit<CompanyAiPolicyDTO, "defaultProvider" | "updatedAt"> = {
  allowedProviders: ["CLAUDE", "OPENAI", "GROK", "LOCAL"],
  defaultResearchLimit: 20,
  deepResearchPolicy: "approval_required",
  externalActionPolicy: "approval_required",
  browserPolicy: "approval_required",
  autoSendPolicy: "disabled",
  staleKnowledgePolicy: "exclude",
  customRules: [],
};

function toAiPolicyDTO(company: Company, row: CompanyAiPolicy | undefined): CompanyAiPolicyDTO {
  return {
    defaultProvider: company.defaultProvider,
    ...(row
      ? {
          allowedProviders: row.allowedProviders,
          defaultResearchLimit: row.defaultResearchLimit,
          deepResearchPolicy: row.deepResearchPolicy,
          externalActionPolicy: row.externalActionPolicy,
          browserPolicy: row.browserPolicy,
          autoSendPolicy: row.autoSendPolicy,
          staleKnowledgePolicy: row.staleKnowledgePolicy,
          customRules: row.customRules,
        }
      : DEFAULT_AI_POLICY),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function getCompanyRecord(db: Database | Tx, companyId: string): Promise<Company> {
  const [row] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!row) throw new NotFoundError("Company", companyId);
  return row;
}

export async function getAiPolicy(db: Database, companyId: string): Promise<CompanyAiPolicyDTO> {
  const company = await getCompanyRecord(db, companyId);
  const [row] = await db
    .select()
    .from(companyAiPolicies)
    .where(eq(companyAiPolicies.companyId, companyId));
  return toAiPolicyDTO(company, row);
}

export async function getCompanyProfile(
  db: Database,
  companyId: string,
  viewer: CompanyProfileDTO["viewer"],
  now = new Date(),
): Promise<CompanyProfileDTO> {
  const company = await getCompanyRecord(db, companyId);
  const [aiPolicy, knowledgeRows, ruleCounts, conflicts] = await Promise.all([
    getAiPolicy(db, companyId),
    db
      .select({
        status: knowledgeItems.status,
        effectiveAt: knowledgeItems.effectiveAt,
        reviewAt: knowledgeItems.reviewAt,
        expiresAt: knowledgeItems.expiresAt,
      })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.companyId, companyId)),
    Promise.all(
      [brandRules, commercialRules, complianceRules].map((t) =>
        db
          .select({
            total: sql<number>`count(*) filter (where ${t.status} <> 'archived')::int`,
            critical: sql<number>`count(*) filter (where ${t.status} = 'approved' and ${t.active} and ${t.severity} = 'critical')::int`,
          })
          .from(t)
          // GLOBAL rules bind this company too.
          .where(or(eq(t.companyId, companyId), isNull(t.companyId))),
      ),
    ),
    countKnowledgeConflicts(db, companyId, now),
  ]);
  const knowledge = Object.fromEntries(KNOWLEDGE_STATUSES.map((s) => [s, 0])) as Record<
    KnowledgeStatus,
    number
  >;
  let stale = 0;
  for (const k of knowledgeRows) {
    knowledge[k.status]++;
    if (k.status === "approved") {
      const f = knowledgeFreshness(k, now);
      if (f === "expired" || f === "review_due") stale++;
    }
  }
  const [b, c, p] = ruleCounts.map((r) => r[0]!);
  return {
    company: { ...toCompanyDTO(company), ...toProfileFields(company) },
    aiPolicy,
    stats: {
      knowledge,
      stale,
      conflicts,
      rules: {
        brand: b!.total,
        commercial: c!.total,
        compliance: p!.total,
        critical: b!.critical + c!.critical + p!.critical,
      },
    },
    viewer,
  };
}

/**
 * Updates one profile section. Section schemas are strict, so fields outside
 * the section (status, slug, budgets...) can never be changed through here.
 * The audit event lists changed field names only (no values).
 */
export async function updateCompanyProfileSection<S extends ProfileSection>(
  db: Database,
  companyId: string,
  section: S,
  input: z.input<(typeof profileSectionSchemas)[S]>,
  actor: Actor,
): Promise<void> {
  const data = profileSectionSchemas[section].parse(input) as Record<string, unknown>;
  await db.transaction(async (tx) => {
    const before = await getCompanyRecord(tx, companyId);
    const changed = Object.keys(data).filter(
      (k) =>
        JSON.stringify((before as Record<string, unknown>)[k] ?? null) !==
        JSON.stringify(data[k] ?? null),
    );
    if (!changed.length) return;
    await tx.update(companies).set(data).where(eq(companies.id, companyId));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId,
      resourceType: "company",
      resourceId: companyId,
      action: "company.profile_updated",
      description: `${section[0]!.toUpperCase()}${section.slice(1)} profile updated for "${before.name}" (${changed.length} field${changed.length === 1 ? "" : "s"})`,
      metadata: { section, changedFields: changed },
    });
  });
}

export async function updateAiPolicy(
  db: Database,
  companyId: string,
  input: AiPolicyInput,
  actor: Actor,
): Promise<CompanyAiPolicyDTO> {
  const data = aiPolicySchema.parse(input);
  await db.transaction(async (tx) => {
    const company = await getCompanyRecord(tx, companyId);
    const [row] = await tx
      .select()
      .from(companyAiPolicies)
      .where(eq(companyAiPolicies.companyId, companyId));
    const before = toAiPolicyDTO(company, row);
    const { defaultProvider, ...policy } = data;
    await tx
      .insert(companyAiPolicies)
      .values({ companyId, ...policy, updatedByUserId: actor.userId ?? null })
      .onConflictDoUpdate({
        target: companyAiPolicies.companyId,
        set: { ...policy, updatedByUserId: actor.userId ?? null },
      });
    if (defaultProvider !== company.defaultProvider)
      await tx.update(companies).set({ defaultProvider }).where(eq(companies.id, companyId));
    const { updatedAt: _u, ...beforeValues } = before;
    const changed = Object.keys(data).filter(
      (k) =>
        JSON.stringify(beforeValues[k as keyof typeof beforeValues]) !==
        JSON.stringify(data[k as keyof typeof data]),
    );
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId,
      resourceType: "company",
      resourceId: companyId,
      action: "company.ai_policy_updated",
      description: `AI operations policy updated for "${company.name}"`,
      metadata: { changedFields: changed },
      before: beforeValues,
      after: data,
    });
  });
  return getAiPolicy(db, companyId);
}

/** Actions shown in the company History feed (a curated view of the audit log). */
const HISTORY_ACTIONS = [
  "company.%",
  "brand_rule.%",
  "commercial_rule.%",
  "compliance_rule.%",
  "knowledge.approved",
  "knowledge.rejected",
  "knowledge.superseded",
  "knowledge.archived",
  "knowledge.version_created",
  "knowledge_access.%",
];

export async function listCompanyHistory(
  db: Database,
  companyId: string,
  limit = 100,
): Promise<AuditEventDTO[]> {
  return listAuditEvents(db, {
    companyId,
    limit,
    actionLike: HISTORY_ACTIONS,
    outcome: "success",
  });
}
