import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  MATERIAL_KNOWLEDGE_FIELDS,
  createKnowledgeSchema,
  isAiSource,
  knowledgeApproveSchema,
  knowledgeFreshness,
  knowledgeLinkSchema,
  knowledgePrecedence,
  updateKnowledgeSchema,
  type CreateKnowledgeInput,
  type FreshnessState,
  type KnowledgeConflictDTO,
  type KnowledgeDetailDTO,
  type KnowledgeItemDTO,
  type KnowledgeLinkDTO,
  type KnowledgeVersionDTO,
  type ListKnowledgeQuery,
  type PersonRef,
  type SensitivityLevel,
  type UpdateKnowledgeInput,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agents,
  companies,
  departments,
  knowledgeItems,
  knowledgeLinks,
  tasks,
  users,
  type KnowledgeItem,
} from "../schema";
import { listAuditEvents, recordAuditEvent } from "./audit";
import { displayNameOf } from "./identity";
import { actorAuditFields, scopeWhere, type AccessScope, type Actor } from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

/** Can the viewer read an item of this company (null = global) and sensitivity? */
export type KnowledgeReadCheck = (
  companyId: string | null,
  sensitivity: SensitivityLevel,
) => boolean;

/** Human visibility of knowledge: company scope + department restriction + global items. */
export interface KnowledgeVisibility {
  scope: AccessScope;
  /** Viewer may see GLOBAL knowledge (holds knowledge.view somewhere). */
  includeGlobal: boolean;
  canRead: KnowledgeReadCheck;
}

/* ---------- helpers ---------- */

export async function loadPeople(
  db: Db,
  ids: (string | null | undefined)[],
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((u) => [u.id, { id: u.id, name: displayNameOf(u) }]));
}

/** Description-safe label: confidential/restricted titles never enter the audit log. */
export function auditLabel(item: Pick<KnowledgeItem, "title" | "sensitivity">): string {
  return item.sensitivity === "confidential" || item.sensitivity === "restricted"
    ? `(${item.sensitivity} knowledge item)`
    : `"${item.title}"`;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function overlaps(a: KnowledgeItem, b: KnowledgeItem): boolean {
  const start = (x: KnowledgeItem) => x.effectiveAt?.getTime() ?? -Infinity;
  const end = (x: KnowledgeItem) => x.expiresAt?.getTime() ?? Infinity;
  return start(a) < end(b) && start(b) < end(a);
}

/**
 * Simple conflict detection: APPROVED items with the same conflict key, in
 * the same company (or both global), from different lineages, with
 * overlapping validity windows and different content. Never auto-resolved.
 */
export function detectConflicts(items: KnowledgeItem[], now = new Date()): Map<string, string[]> {
  const byKey = new Map<string, KnowledgeItem[]>();
  for (const i of items) {
    if (i.status !== "approved" || !i.conflictKey) continue;
    if (knowledgeFreshness(i, now) === "expired") continue;
    const key = `${i.companyId ?? "global"}|${i.conflictKey}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  const out = new Map<string, string[]>();
  for (const group of byKey.values()) {
    for (const a of group)
      for (const b of group) {
        if (a.id === b.id || a.lineageId === b.lineageId) continue;
        if (!overlaps(a, b) || a.content.trim() === b.content.trim()) continue;
        out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
      }
  }
  return out;
}

async function approvedWithKeys(db: Db, companyIds: (string | null)[]): Promise<KnowledgeItem[]> {
  const ids = companyIds.filter((c): c is string => !!c);
  const conds: SQL[] = [];
  if (ids.length) conds.push(inArray(knowledgeItems.companyId, ids));
  if (companyIds.includes(null)) conds.push(isNull(knowledgeItems.companyId));
  if (!conds.length) return [];
  return db
    .select()
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.status, "approved"),
        isNotNull(knowledgeItems.conflictKey),
        conds.length === 1 ? conds[0] : or(...conds),
      ),
    );
}

export async function countKnowledgeConflicts(
  db: Db,
  companyId: string,
  now = new Date(),
): Promise<number> {
  const rows = await approvedWithKeys(db, [companyId]);
  const conflicts = detectConflicts(rows, now);
  // Count conflict groups (subjects), not the items inside them.
  return new Set(rows.filter((r) => conflicts.has(r.id)).map((r) => r.conflictKey)).size;
}

type Row = {
  k: KnowledgeItem;
  company: { id: string; name: string; slug: string; accentColor: string | null } | null;
  departmentName: string | null;
};

function toDTO(
  r: Row,
  people: Map<string, PersonRef>,
  conflicts: Map<string, string[]>,
  now: Date,
): KnowledgeItemDTO {
  const k = r.k;
  return {
    id: k.id,
    company: r.company?.id ? r.company : null,
    scope: k.scope,
    department:
      k.departmentId && r.departmentName ? { id: k.departmentId, name: r.departmentName } : null,
    title: k.title,
    summary: k.summary,
    content: k.content,
    type: k.type,
    category: k.category,
    tags: k.tags,
    sourceType: k.sourceType,
    sourceReference: k.sourceReference,
    sourceUrl: k.sourceUrl,
    sourceFileRef: k.sourceFileRef,
    sourceOwner: k.sourceOwner,
    provenanceNotes: k.provenanceNotes,
    confidence: k.confidence,
    verificationStatus: k.verificationStatus,
    status: k.status,
    sensitivity: k.sensitivity,
    usableAsUnverified: k.usableAsUnverified,
    effectiveAt: iso(k.effectiveAt),
    reviewAt: iso(k.reviewAt),
    expiresAt: iso(k.expiresAt),
    lastVerifiedAt: iso(k.lastVerifiedAt),
    freshness: knowledgeFreshness(k, now),
    precedence: knowledgePrecedence(k),
    version: k.version,
    lineageId: k.lineageId,
    supersedesId: k.supersedesId,
    supersededById: k.supersededById,
    conflictKey: k.conflictKey,
    createdBy: k.createdByUserId ? (people.get(k.createdByUserId) ?? null) : null,
    updatedBy: k.updatedByUserId ? (people.get(k.updatedByUserId) ?? null) : null,
    approvedBy: k.approvedByUserId ? (people.get(k.approvedByUserId) ?? null) : null,
    approvedAt: iso(k.approvedAt),
    submittedAt: iso(k.submittedAt),
    archivedAt: iso(k.archivedAt),
    createdAt: k.createdAt.toISOString(),
    updatedAt: k.updatedAt.toISOString(),
    origin: k.origin,
    conflictsWith: conflicts.get(k.id) ?? [],
  };
}

function baseSelect(db: Db) {
  return db
    .select({
      k: knowledgeItems,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      departmentName: departments.name,
    })
    .from(knowledgeItems)
    .leftJoin(companies, eq(companies.id, knowledgeItems.companyId))
    .leftJoin(departments, eq(departments.id, knowledgeItems.departmentId));
}

async function toDTOs(db: Db, rows: Row[], now: Date): Promise<KnowledgeItemDTO[]> {
  const people = await loadPeople(
    db,
    rows.flatMap((r) => [r.k.createdByUserId, r.k.updatedByUserId, r.k.approvedByUserId]),
  );
  const companyIds = [...new Set(rows.map((r) => r.k.companyId))];
  const conflicts = detectConflicts(await approvedWithKeys(db, companyIds), now);
  return rows.map((r) => toDTO(r, people, conflicts, now));
}

function visibilityWhere(v: KnowledgeVisibility): SQL | undefined {
  const company = scopeWhere(knowledgeItems.companyId, { ...v.scope, includeGroup: false });
  const global = v.includeGlobal ? eq(knowledgeItems.scope, "global") : undefined;
  return global ? or(company, global) : company;
}

/** Department restriction: department-scoped viewers see company-wide items + their departments. */
function departmentAllows(v: KnowledgeVisibility, k: KnowledgeItem): boolean {
  if (!k.companyId || !k.departmentId || !v.scope.departments) return true;
  const allowed = v.scope.departments.get(k.companyId);
  return !allowed || allowed.includes(k.departmentId);
}

export function canSeeKnowledge(v: KnowledgeVisibility, k: KnowledgeItem): boolean {
  const inScope =
    k.companyId === null
      ? v.includeGlobal
      : v.scope.companyIds === "all" || v.scope.companyIds.includes(k.companyId);
  return inScope && departmentAllows(v, k) && v.canRead(k.companyId, k.sensitivity);
}

/* ---------- queries ---------- */

export async function listKnowledge(
  db: Database,
  opts: {
    companyId: string | null;
    query: Partial<ListKnowledgeQuery>;
    visibility: KnowledgeVisibility;
    now?: Date;
  },
): Promise<{
  items: KnowledgeItemDTO[];
  hiddenBySensitivity: number;
  tags: string[];
  categories: string[];
}> {
  const q = opts.query;
  const now = opts.now ?? new Date();
  const where: (SQL | undefined)[] = [visibilityWhere(opts.visibility)];
  if (q.scope === "global") where.push(eq(knowledgeItems.scope, "global"));
  else if (opts.companyId) {
    where.push(
      q.scope === "company"
        ? eq(knowledgeItems.companyId, opts.companyId)
        : or(eq(knowledgeItems.companyId, opts.companyId), eq(knowledgeItems.scope, "global")),
    );
  } else if (q.scope === "company") where.push(eq(knowledgeItems.scope, "company"));
  if (q.type?.length) where.push(inArray(knowledgeItems.type, q.type));
  if (q.status?.length) where.push(inArray(knowledgeItems.status, q.status));
  if (q.confidence?.length) where.push(inArray(knowledgeItems.confidence, q.confidence));
  if (q.verification?.length)
    where.push(inArray(knowledgeItems.verificationStatus, q.verification));
  if (q.source?.length) where.push(inArray(knowledgeItems.sourceType, q.source));
  if (q.sensitivity?.length) where.push(inArray(knowledgeItems.sensitivity, q.sensitivity));
  if (q.tag) where.push(sql`${q.tag} = any(${knowledgeItems.tags})`);
  if (q.category) where.push(eq(knowledgeItems.category, q.category));
  let rank: SQL | undefined;
  if (q.q) {
    const tsq = sql`websearch_to_tsquery('english', ${q.q})`;
    const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        sql`${knowledgeItems.searchVector} @@ ${tsq}`,
        sql`${knowledgeItems.title} ilike ${like}`,
        sql`${like.toLowerCase()} ilike any(select '%' || t || '%' from unnest(${knowledgeItems.tags}) t)`,
      ),
    );
    rank = sql`ts_rank(${knowledgeItems.searchVector}, ${tsq})`;
  }
  const rows = await baseSelect(db)
    .where(and(...where))
    .orderBy(
      ...(rank ? [desc(rank)] : []),
      sql`case ${knowledgeItems.status} when 'review' then 0 when 'draft' then 1 when 'approved' then 2 when 'superseded' then 3 else 4 end`,
      desc(knowledgeItems.updatedAt),
    )
    .limit(q.limit ?? 200);

  let hidden = 0;
  const visible = rows.filter((r) => {
    if (!departmentAllows(opts.visibility, r.k)) return false;
    if (!opts.visibility.canRead(r.k.companyId, r.k.sensitivity)) {
      hidden++;
      return false;
    }
    return true;
  });
  // Never report hidden matches for a text search: that would reveal what restricted items contain.
  if (q.q) hidden = 0;
  let items = await toDTOs(db, visible, now);
  if (q.freshness?.length)
    items = items.filter((i) => q.freshness!.includes(i.freshness as FreshnessState));
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort();
  const categories = [
    ...new Set(items.map((i) => i.category).filter((c): c is string => !!c)),
  ].sort();
  return { items, hiddenBySensitivity: hidden, tags, categories };
}

export async function getKnowledgeRecord(db: Db, id: string): Promise<KnowledgeItem> {
  const [row] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id));
  if (!row) throw new NotFoundError("Knowledge item", id);
  return row;
}

export async function getKnowledgeDTO(
  db: Db,
  id: string,
  now = new Date(),
): Promise<KnowledgeItemDTO> {
  const rows = await baseSelect(db).where(eq(knowledgeItems.id, id));
  if (!rows[0]) throw new NotFoundError("Knowledge item", id);
  return (await toDTOs(db, rows, now))[0]!;
}

export async function getKnowledgeDetail(
  db: Database,
  id: string,
  opts: { visibility: KnowledgeVisibility; viewer: KnowledgeDetailDTO["viewer"]; now?: Date },
): Promise<KnowledgeDetailDTO> {
  const now = opts.now ?? new Date();
  const item = await getKnowledgeDTO(db, id, now);
  const versionRows = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.lineageId, item.lineageId))
    .orderBy(desc(knowledgeItems.version));
  const people = await loadPeople(
    db,
    versionRows.flatMap((v) => [v.createdByUserId, v.approvedByUserId]),
  );
  const versions: KnowledgeVersionDTO[] = versionRows.map((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    title: v.title,
    createdBy: v.createdByUserId ? (people.get(v.createdByUserId) ?? null) : null,
    approvedBy: v.approvedByUserId ? (people.get(v.approvedByUserId) ?? null) : null,
    approvedAt: iso(v.approvedAt),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }));

  const linkRows = await db
    .select({
      l: knowledgeLinks,
      taskTitle: tasks.title,
      taskCompanyId: tasks.companyId,
      agentName: agents.name,
    })
    .from(knowledgeLinks)
    .leftJoin(tasks, eq(tasks.id, knowledgeLinks.taskId))
    .leftJoin(agents, eq(agents.id, knowledgeLinks.agentId))
    .where(
      inArray(
        knowledgeLinks.knowledgeId,
        versionRows.map((v) => v.id),
      ),
    );
  const links: KnowledgeLinkDTO[] = linkRows.map(({ l, taskTitle, agentName }) => ({
    id: l.id,
    target: l.target,
    targetId: (l.taskId ?? l.agentId)!,
    label: (l.target === "task" ? taskTitle : agentName) ?? "—",
    note: l.note,
    createdAt: l.createdAt.toISOString(),
  }));

  const history = await listAuditEvents(db, {
    limit: 50,
    actionLike: ["knowledge.%"],
    resourceIdIn: versionRows.map((v) => v.id),
  });

  const conflictRows = item.conflictsWith.length
    ? await baseSelect(db).where(inArray(knowledgeItems.id, item.conflictsWith))
    : [];
  const conflicts = (await toDTOs(db, conflictRows, now)).filter((c) =>
    canSeeKnowledge(opts.visibility, conflictRows.find((r) => r.k.id === c.id)!.k),
  );
  return { item, versions, links, history, conflicts, viewer: opts.viewer };
}

export async function listKnowledgeConflicts(
  db: Database,
  companyId: string,
  visibility: KnowledgeVisibility,
  now = new Date(),
): Promise<KnowledgeConflictDTO[]> {
  const rows = await approvedWithKeys(db, [companyId]);
  const conflicts = detectConflicts(rows, now);
  if (!conflicts.size) return [];
  const involved = rows.filter((r) => conflicts.has(r.id) && canSeeKnowledge(visibility, r));
  const dtoRows = await baseSelect(db).where(
    inArray(
      knowledgeItems.id,
      involved.map((r) => r.id),
    ),
  );
  const dtos = await toDTOs(db, dtoRows, now);
  const groups = new Map<string, KnowledgeItemDTO[]>();
  for (const d of dtos) groups.set(d.conflictKey!, [...(groups.get(d.conflictKey!) ?? []), d]);
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([conflictKey, items]) => ({ conflictKey, items }));
}

/* ---------- writes ---------- */

/** A department must be global or belong to the item's company. */
export async function assertDepartmentFor(
  db: Db,
  companyId: string | null,
  departmentId: string | null | undefined,
) {
  if (!departmentId) return;
  const [d] = await db
    .select({ companyId: departments.companyId })
    .from(departments)
    .where(eq(departments.id, departmentId));
  if (!d) throw new NotFoundError("Department", departmentId);
  if (d.companyId !== null && d.companyId !== companyId)
    throw new ForbiddenError("The department belongs to another company");
}

function audit(
  tx: Tx,
  actor: Actor,
  item: KnowledgeItem,
  action: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  return recordAuditEvent(
    tx,
    {
      ...actorAuditFields(actor),
      companyId: item.companyId ?? undefined,
      resourceType: "knowledge",
      resourceId: item.id,
      action,
      description,
      metadata: {
        scope: item.scope,
        type: item.type,
        sensitivity: item.sensitivity,
        version: item.version,
        status: item.status,
        ...metadata,
      },
    },
    item.origin,
  );
}

export async function createKnowledge(
  db: Database,
  input: CreateKnowledgeInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed" } = {},
): Promise<KnowledgeItem> {
  const data = createKnowledgeSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertDepartmentFor(tx, data.companyId, data.departmentId);
    const id = randomUUID();
    const [row] = await tx
      .insert(knowledgeItems)
      .values({
        ...data,
        id,
        lineageId: id,
        version: 1,
        status: "draft",
        createdByUserId: actor.userId ?? null,
        updatedByUserId: actor.userId ?? null,
        origin: opts.origin ?? "live",
      })
      .returning();
    await audit(
      tx,
      actor,
      row!,
      "knowledge.created",
      `Knowledge ${auditLabel(row!)} created as draft`,
      {
        sourceType: row!.sourceType,
      },
    );
    return row!;
  });
}

export interface UpdateKnowledgeResult {
  item: KnowledgeItem;
  /** true when an approved item was changed materially and a new draft version was created. */
  newVersion: boolean;
}

/** Which fields an update would change, and whether any is material. */
export function knowledgeChanges(item: KnowledgeItem, input: UpdateKnowledgeInput) {
  const data = updateKnowledgeSchema.parse(input) as Record<string, unknown>;
  const changed = Object.keys(data).filter((k) => {
    const before = (item as Record<string, unknown>)[k];
    const after = data[k];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));
    return norm(before) !== norm(after);
  });
  const material = changed.some((f) =>
    (MATERIAL_KNOWLEDGE_FIELDS as readonly string[]).includes(f),
  );
  return { data, changed, material };
}

/**
 * Edits knowledge without silently overwriting authoritative facts:
 *  - draft/review → edited in place (review returns to draft);
 *  - approved + material change → a NEW draft version (old stays approved
 *    until the new one is approved, then becomes superseded);
 *  - approved + non-material change (tags, review date...) → in place;
 *  - superseded/archived → read-only.
 */
export async function updateKnowledge(
  db: Database,
  id: string,
  input: UpdateKnowledgeInput,
  actor: Actor,
): Promise<UpdateKnowledgeResult> {
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    if (item.status === "superseded" || item.status === "archived")
      throw new ConflictError(`A ${item.status} knowledge item cannot be edited`);
    const { data, changed, material } = knowledgeChanges(item, input);
    if (!changed.length) return { item, newVersion: false };
    if (changed.includes("departmentId"))
      await assertDepartmentFor(tx, item.companyId, data.departmentId as string | null);
    const merged = { ...item, ...data } as KnowledgeItem;
    if (isAiSource(merged.sourceType) && merged.verificationStatus === "management_confirmed")
      throw new ConflictError("AI or system generated information cannot be management confirmed");
    if (merged.effectiveAt && merged.expiresAt && merged.expiresAt <= merged.effectiveAt)
      throw new ConflictError("Expiry must be after the effective date");

    if (item.status === "approved" && material) {
      const [open] = await tx
        .select({ id: knowledgeItems.id })
        .from(knowledgeItems)
        .where(
          and(
            eq(knowledgeItems.lineageId, item.lineageId),
            inArray(knowledgeItems.status, ["draft", "review"]),
          ),
        );
      if (open)
        throw new ConflictError("A newer draft version already exists — edit that version instead");
      const [{ maxVersion }] = (await tx
        .select({ maxVersion: sql<number>`max(${knowledgeItems.version})::int` })
        .from(knowledgeItems)
        .where(eq(knowledgeItems.lineageId, item.lineageId))) as [{ maxVersion: number }];
      const {
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        searchVector: _s,
        approvedAt: _a,
        approvedByUserId: _ab,
        submittedAt: _sa,
        archivedAt: _ar,
        supersededById: _sb,
        ...copy
      } = merged;
      const [row] = await tx
        .insert(knowledgeItems)
        .values({
          ...copy,
          id: randomUUID(),
          version: maxVersion + 1,
          supersedesId: item.id,
          status: "draft",
          createdByUserId: actor.userId ?? null,
          updatedByUserId: actor.userId ?? null,
          origin: "live",
        })
        .returning();
      await audit(
        tx,
        actor,
        row!,
        "knowledge.version_created",
        `New version v${row!.version} of ${auditLabel(row!)} drafted`,
        {
          changedFields: changed,
          previousVersionId: item.id,
        },
      );
      return { item: row!, newVersion: true };
    }

    const patch: Partial<KnowledgeItem> = {
      ...(data as Partial<KnowledgeItem>),
      updatedByUserId: actor.userId ?? null,
    };
    if (item.status === "review") patch.status = "draft";
    const [row] = await tx
      .update(knowledgeItems)
      .set(patch)
      .where(eq(knowledgeItems.id, id))
      .returning();
    await audit(tx, actor, row!, "knowledge.updated", `Knowledge ${auditLabel(row!)} updated`, {
      changedFields: changed,
      returnedToDraft: item.status === "review",
    });
    return { item: row!, newVersion: false };
  });
}

export async function submitKnowledge(
  db: Database,
  id: string,
  actor: Actor,
): Promise<KnowledgeItem> {
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    if (item.status !== "draft")
      throw new ConflictError(`Only drafts can be submitted (item is ${item.status})`);
    const [row] = await tx
      .update(knowledgeItems)
      .set({ status: "review", submittedAt: new Date(), updatedByUserId: actor.userId ?? null })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await audit(
      tx,
      actor,
      row!,
      "knowledge.submitted",
      `Knowledge ${auditLabel(row!)} submitted for review`,
    );
    return row!;
  });
}

/**
 * Approves a draft/review item. AI-sourced knowledge needs an explicit human
 * verification level (it never becomes a fact silently). Approving a new
 * version supersedes the previously approved version of the same lineage.
 */
export async function approveKnowledge(
  db: Database,
  id: string,
  input: z.input<typeof knowledgeApproveSchema>,
  actor: Actor,
): Promise<KnowledgeItem> {
  const data = knowledgeApproveSchema.parse(input);
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    if (item.status !== "draft" && item.status !== "review")
      throw new ConflictError(
        `Only draft or in-review knowledge can be approved (item is ${item.status})`,
      );
    const verification = data.verificationStatus ?? item.verificationStatus;
    if (isAiSource(item.sourceType)) {
      if (verification === "management_confirmed")
        throw new ConflictError(
          "AI or system generated information cannot be management confirmed",
        );
      if (verification === "unverified")
        throw new ConflictError(
          "AI-sourced knowledge must be verified by a human before approval — set a verification level",
        );
    }
    const now = new Date();
    const [previous] = await tx
      .select()
      .from(knowledgeItems)
      .where(
        and(
          eq(knowledgeItems.lineageId, item.lineageId),
          eq(knowledgeItems.status, "approved"),
          ne(knowledgeItems.id, id),
        ),
      );
    if (previous) {
      await tx
        .update(knowledgeItems)
        .set({ status: "superseded", supersededById: id })
        .where(eq(knowledgeItems.id, previous.id));
      await audit(
        tx,
        actor,
        { ...previous, status: "superseded" },
        "knowledge.superseded",
        `Knowledge ${auditLabel(previous)} v${previous.version} superseded by v${item.version}`,
        {
          supersededById: id,
        },
      );
    }
    const [row] = await tx
      .update(knowledgeItems)
      .set({
        status: "approved",
        verificationStatus: verification,
        approvedByUserId: actor.userId ?? null,
        approvedAt: now,
        lastVerifiedAt: verification === "unverified" ? item.lastVerifiedAt : now,
        updatedByUserId: actor.userId ?? null,
      })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await audit(
      tx,
      actor,
      row!,
      "knowledge.approved",
      `Knowledge ${auditLabel(row!)} v${row!.version} approved`,
      {
        verificationStatus: verification,
        notes: data.notes ?? null,
        supersededId: previous?.id ?? null,
      },
    );
    return row!;
  });
}

export async function rejectKnowledge(
  db: Database,
  id: string,
  notes: string | undefined,
  actor: Actor,
): Promise<KnowledgeItem> {
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    if (item.status !== "review" && item.status !== "draft")
      throw new ConflictError(
        `Only draft or in-review knowledge can be rejected (item is ${item.status})`,
      );
    const [row] = await tx
      .update(knowledgeItems)
      .set({ status: "draft", updatedByUserId: actor.userId ?? null })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await audit(
      tx,
      actor,
      row!,
      "knowledge.rejected",
      `Knowledge ${auditLabel(row!)} returned to draft`,
      {
        notes: notes ?? null,
      },
    );
    return row!;
  });
}

/** Manually supersedes an approved item, optionally by an approved replacement (conflict resolution). */
export async function supersedeKnowledge(
  db: Database,
  id: string,
  replacementId: string | undefined,
  notes: string | undefined,
  actor: Actor,
): Promise<KnowledgeItem> {
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    if (item.status !== "approved")
      throw new ConflictError("Only approved knowledge can be superseded");
    if (replacementId) {
      const replacement = await getKnowledgeRecord(tx, replacementId);
      if (replacement.id === item.id || replacement.status !== "approved")
        throw new ConflictError("The replacement must be a different approved item");
      if (replacement.companyId !== item.companyId)
        throw new ForbiddenError("The replacement must belong to the same company");
    }
    const [row] = await tx
      .update(knowledgeItems)
      .set({
        status: "superseded",
        supersededById: replacementId ?? null,
        updatedByUserId: actor.userId ?? null,
      })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await audit(
      tx,
      actor,
      row!,
      "knowledge.superseded",
      `Knowledge ${auditLabel(row!)} superseded`,
      {
        replacementId: replacementId ?? null,
        notes: notes ?? null,
      },
    );
    return row!;
  });
}

export async function archiveKnowledge(
  db: Database,
  id: string,
  notes: string | undefined,
  actor: Actor,
): Promise<KnowledgeItem> {
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    if (item.status === "archived") return item;
    const [row] = await tx
      .update(knowledgeItems)
      .set({ status: "archived", archivedAt: new Date(), updatedByUserId: actor.userId ?? null })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await audit(tx, actor, row!, "knowledge.archived", `Knowledge ${auditLabel(row!)} archived`, {
      previousStatus: item.status,
      notes: notes ?? null,
    });
    return row!;
  });
}

/* ---------- explicit links ---------- */

/**
 * Links knowledge to a task or agent. The target must belong to the same
 * company as the knowledge (GLOBAL knowledge may be linked anywhere).
 */
export async function linkKnowledge(
  db: Database,
  id: string,
  input: z.input<typeof knowledgeLinkSchema>,
  actor: Actor,
): Promise<KnowledgeLinkDTO> {
  const data = knowledgeLinkSchema.parse(input);
  return db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    let label: string;
    if (data.taskId) {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, data.taskId));
      if (!task) throw new NotFoundError("Task", data.taskId);
      if (item.companyId !== null && task.companyId !== item.companyId)
        throw new ForbiddenError("Knowledge can only be linked to tasks of the same company");
      label = task.title;
    } else {
      const [agent] = await tx.select().from(agents).where(eq(agents.id, data.agentId!));
      if (!agent) throw new NotFoundError("Agent", data.agentId!);
      if (item.companyId !== null && agent.scope !== "global") {
        const [assigned] = await tx
          .select()
          .from(agentCompanyAssignments)
          .where(
            and(
              eq(agentCompanyAssignments.agentId, agent.id),
              eq(agentCompanyAssignments.companyId, item.companyId),
            ),
          );
        if (!assigned)
          throw new ForbiddenError("The agent does not serve this knowledge item's company");
      }
      label = agent.name;
    }
    const [row] = await tx
      .insert(knowledgeLinks)
      .values({
        knowledgeId: id,
        target: data.taskId ? "task" : "agent",
        taskId: data.taskId ?? null,
        agentId: data.agentId ?? null,
        note: data.note ?? null,
        createdByUserId: actor.userId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError("This link already exists");
    await audit(
      tx,
      actor,
      item,
      "knowledge.linked",
      `Knowledge ${auditLabel(item)} linked to ${row.target}`,
      {
        target: row.target,
        targetId: data.taskId ?? data.agentId,
      },
    );
    return {
      id: row.id,
      target: row.target,
      targetId: (row.taskId ?? row.agentId)!,
      label,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function unlinkKnowledge(
  db: Database,
  id: string,
  linkId: string,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    const item = await getKnowledgeRecord(tx, id);
    const [row] = await tx
      .delete(knowledgeLinks)
      .where(and(eq(knowledgeLinks.id, linkId), eq(knowledgeLinks.knowledgeId, id)))
      .returning();
    if (!row) throw new NotFoundError("Knowledge link", linkId);
    await audit(
      tx,
      actor,
      item,
      "knowledge.unlinked",
      `Knowledge ${auditLabel(item)} unlinked from ${row.target}`,
      {
        target: row.target,
      },
    );
  });
}

/** Links for a task / agent (context loading). */
export async function knowledgeLinksFor(
  db: Db,
  target: { taskId?: string | null; agentId: string },
): Promise<{ knowledgeId: string; target: "task" | "agent" }[]> {
  const conds: SQL[] = [eq(knowledgeLinks.agentId, target.agentId)];
  if (target.taskId) conds.push(eq(knowledgeLinks.taskId, target.taskId));
  const rows = await db
    .select({ knowledgeId: knowledgeLinks.knowledgeId, target: knowledgeLinks.target })
    .from(knowledgeLinks)
    .where(or(...conds));
  return rows;
}

/** Company + sensitivity per knowledge id (used to redact previews for the viewer). */
export async function knowledgeSensitivities(
  db: Db,
  ids: readonly string[],
): Promise<{ id: string; companyId: string | null; sensitivity: SensitivityLevel }[]> {
  if (!ids.length) return [];
  return db
    .select({
      id: knowledgeItems.id,
      companyId: knowledgeItems.companyId,
      sensitivity: knowledgeItems.sensitivity,
    })
    .from(knowledgeItems)
    .where(inArray(knowledgeItems.id, [...ids]));
}
