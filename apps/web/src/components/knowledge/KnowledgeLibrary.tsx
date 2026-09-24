"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpenCheck, Filter, Lock, Plus, Search, X } from "lucide-react";
import {
  KNOWLEDGE_TYPE_LABELS,
  SENSITIVITY_LEVELS,
  SENSITIVITY_READ_PERMISSION,
  type KnowledgeConflictDTO,
  type KnowledgeItemDTO,
  type KnowledgeListDTO,
} from "@aibos/shared";
import { Button, EmptyState, Skeleton, cn } from "@aibos/ui";
import { Dialog } from "../common/Dialog";
import { hasPermission, useMe } from "../shell/SessionContext";
import { clientApi } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";
import {
  FreshnessBadge,
  LifecycleBadge,
  ScopeBadge,
  SensitivityBadge,
  SourceTag,
  VerificationBadge,
} from "./badges";
import { KnowledgeDrawer } from "./KnowledgeDrawer";
import { KnowledgeForm } from "./KnowledgeForm";
import {
  CONFIDENCE_OPTIONS,
  FRESHNESS_OPTIONS,
  SENSITIVITY_OPTIONS,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  VERIFICATION_OPTIONS,
} from "./labels";

interface Filters {
  q: string;
  type: string;
  status: string;
  verification: string;
  confidence: string;
  freshness: string;
  source: string;
  sensitivity: string;
  tag: string;
}

const EMPTY: Filters = {
  q: "",
  type: "",
  status: "",
  verification: "",
  confidence: "",
  freshness: "",
  source: "",
  sensitivity: "",
  tag: "",
};

const FILTERS: {
  key: keyof Filters;
  label: string;
  options: { value: string; label: string }[];
}[] = [
  { key: "type", label: "Type", options: TYPE_OPTIONS },
  { key: "status", label: "Status", options: STATUS_OPTIONS },
  { key: "verification", label: "Verification", options: VERIFICATION_OPTIONS },
  { key: "confidence", label: "Confidence", options: CONFIDENCE_OPTIONS },
  { key: "freshness", label: "Freshness", options: FRESHNESS_OPTIONS },
  { key: "source", label: "Source", options: SOURCE_OPTIONS },
  { key: "sensitivity", label: "Sensitivity", options: SENSITIVITY_OPTIONS },
];

const selectCls =
  "focus-ring h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-fg hover:border-line-strong";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-[11px] text-fg-faint">{label}</p>
      <p
        className={cn(
          "num text-[18px] font-semibold leading-tight",
          tone === "warn" && value > 0 && "text-amber-600 dark:text-amber-400",
          tone === "danger" && value > 0 && "text-rose-600 dark:text-rose-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function KnowledgeLibrary({
  company,
  departments,
  initialItemId,
}: {
  /** null = GLOBAL knowledge library. */
  company: { id: string; slug: string; name: string } | null;
  departments: { id: string; name: string }[];
  initialItemId?: string;
}) {
  const me = useMe();
  const companyId = company?.id ?? null;
  const canCreate = companyId
    ? hasPermission(me, "knowledge.create", companyId)
    : (me?.globalPermissions.includes("knowledge.global.manage") ?? false);
  const allowedSensitivity = SENSITIVITY_LEVELS.filter((s) => {
    const perm = SENSITIVITY_READ_PERMISSION[s];
    return !perm || hasPermission(me, perm, companyId);
  });

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [query, setQuery] = useState<Filters>(EMPTY);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: KnowledgeListDTO | null;
    error?: string;
  } | null>(null);
  const [conflicts, setConflicts] = useState<KnowledgeConflictDTO[]>([]);
  const [openId, setOpenId] = useState<string | null>(initialItemId ?? null);
  const [adding, setAdding] = useState(false);

  // Debounce free-text search; other filters apply immediately.
  useEffect(() => {
    const t = setTimeout(() => setQuery(filters), filters.q === query.q ? 0 : 250);
    return () => clearTimeout(t);
  }, [filters, query.q]);

  const params = useMemo(
    () => ({
      company: company?.slug,
      scope: company ? "all" : "global",
      q: query.q || undefined,
      type: query.type || undefined,
      status: query.status || undefined,
      verification: query.verification || undefined,
      confidence: query.confidence || undefined,
      freshness: query.freshness || undefined,
      source: query.source || undefined,
      sensitivity: query.sensitivity || undefined,
      tag: query.tag || undefined,
    }),
    [company, query],
  );
  const key = `${JSON.stringify(params)}#${version}`;

  useEffect(() => {
    let active = true;
    void clientApi<KnowledgeListDTO>("/v1/knowledge", { params }).then((res) => {
      if (active)
        setResult({ key, data: res.ok ? res.data : null, error: res.ok ? undefined : res.message });
    });
    if (company)
      void clientApi<{ data: KnowledgeConflictDTO[] }>("/v1/knowledge/conflicts", {
        params: { company: company.slug },
      }).then((res) => {
        if (active && res.ok) setConflicts(res.data.data);
      });
    return () => {
      active = false;
    };
  }, [key, params, company]);

  const loading = !result || result.key !== key;
  const data = result?.data;
  const items = data?.data ?? [];
  const active = Object.entries(filters).filter(([k, v]) => k !== "q" && v).length;
  const refresh = () => setVersion((v) => v + 1);
  const counts = {
    approved: items.filter((i) => i.status === "approved").length,
    review: items.filter((i) => i.status === "review").length,
  };

  return (
    <div className="space-y-4" data-testid="knowledge-library">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Showing" value={data?.facets.total ?? 0} />
        <Stat label="Approved" value={counts.approved} />
        <Stat label="In review" value={counts.review} />
        <Stat label="Stale" value={data?.facets.stale ?? 0} tone="warn" />
        <Stat label="Conflicts" value={conflicts.length} tone="danger" />
        <Stat label="Hidden (clearance)" value={data?.facets.hiddenBySensitivity ?? 0} />
      </div>

      {conflicts.length > 0 && (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"
          role="region"
          aria-label="Potential conflicts"
        >
          <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {conflicts.length} potential conflict{conflicts.length === 1 ? "" : "s"} need a human
            decision
          </p>
          <ul className="mt-2 space-y-1.5">
            {conflicts.map((c) => (
              <li key={c.conflictKey} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <code className="rounded bg-surface px-1.5 py-0.5 text-[11.5px] ring-1 ring-line">
                  {c.conflictKey}
                </code>
                {c.items.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setOpenId(i.id)}
                    className="focus-ring rounded text-accent hover:underline"
                  >
                    {i.title}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface shadow-panel">
        <div className="space-y-3 border-b border-line/70 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search knowledge</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
                aria-hidden="true"
              />
              <input
                type="search"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Search title, summary, content and tags…"
                className="focus-ring h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13.5px] placeholder:text-fg-faint"
              />
            </label>
            {canCreate && (
              <Button
                variant="primary"
                icon={<Plus className="size-4" aria-hidden="true" />}
                onClick={() => setAdding(true)}
              >
                Add knowledge
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
            <Filter className="size-3.5 text-fg-faint" aria-hidden="true" />
            {FILTERS.map((f) => (
              <select
                key={f.key}
                aria-label={f.label}
                value={filters[f.key]}
                onChange={(e) => setFilters((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className={cn(selectCls, filters[f.key] && "border-accent text-accent")}
              >
                <option value="">{f.label}: all</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ))}
            {!!data?.facets.tags.length && (
              <select
                aria-label="Tag"
                value={filters.tag}
                onChange={(e) => setFilters((prev) => ({ ...prev, tag: e.target.value }))}
                className={cn(selectCls, filters.tag && "border-accent text-accent")}
              >
                <option value="">Tag: all</option>
                {[
                  ...new Set([...(data?.facets.tags ?? []), ...(filters.tag ? [filters.tag] : [])]),
                ].map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            )}
            {active > 0 && (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...EMPTY, q: f.q }))}
                className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-fg-muted hover:bg-surface-2"
              >
                <X className="size-3" aria-hidden="true" /> Clear {active}
              </button>
            )}
          </div>
        </div>

        {loading && !data ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading knowledge">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : result?.error ? (
          <p className="p-6 text-[13px] text-fg-muted" role="alert">
            {result.error}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BookOpenCheck className="size-5" />}
            title="No knowledge matches"
            description={
              canCreate
                ? "Add approved facts, policies and procedures so agents stop guessing."
                : "Try clearing filters."
            }
          />
        ) : (
          <>
            <div
              className="hidden grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_90px] gap-4 border-b border-line/70 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-faint lg:grid"
              aria-hidden="true"
            >
              <span>Knowledge</span>
              <span>Status</span>
              <span>Verification</span>
              <span>Source</span>
              <span className="text-right">Updated</span>
            </div>
            <ul
              className={cn("divide-y divide-line/70", loading && "opacity-60")}
              aria-busy={loading}
            >
              {items.map((i) => (
                <KnowledgeRow
                  key={i.id}
                  item={i}
                  showCompany={!company}
                  onOpen={() => setOpenId(i.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <Dialog open={!!openId} onClose={() => setOpenId(null)} title="Knowledge item" side="right">
        {openId && (
          <KnowledgeDrawer
            id={openId}
            companySlug={company?.slug ?? null}
            departments={departments}
            allowedSensitivity={allowedSensitivity}
            onChanged={refresh}
            onNavigate={setOpenId}
          />
        )}
      </Dialog>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={company ? `Add knowledge — ${company.name}` : "Add GLOBAL knowledge"}
        description="New knowledge starts as a draft and does not instruct agents until it is approved."
        className="w-[min(760px,calc(100vw-2rem))]"
      >
        {adding && (
          <KnowledgeForm
            companyId={companyId}
            departments={departments}
            allowedSensitivity={allowedSensitivity}
            onCancel={() => setAdding(false)}
            onDone={(item) => {
              setAdding(false);
              refresh();
              setOpenId(item.id);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

export function KnowledgeRow({
  item: i,
  showCompany,
  onOpen,
}: {
  item: KnowledgeItemDTO;
  showCompany?: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="focus-ring grid w-full grid-cols-1 gap-x-4 gap-y-2 px-5 py-3 text-left transition-colors hover:bg-surface-2/60 lg:grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_90px] lg:items-center"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            {(i.sensitivity === "confidential" || i.sensitivity === "restricted") && (
              <Lock className="size-3.5 shrink-0 text-amber-600" aria-label={i.sensitivity} />
            )}
            <span className="truncate text-[13.5px] font-medium">{i.title}</span>
            {i.conflictsWith.length > 0 && (
              <AlertTriangle
                className="size-3.5 shrink-0 text-amber-600"
                aria-label="Potential conflict"
              />
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-faint">
            <span className="font-medium text-fg-muted">{KNOWLEDGE_TYPE_LABELS[i.type]}</span>
            {i.scope === "global" && <ScopeBadge global />}
            {showCompany && i.company && <span>· {i.company.name}</span>}
            {i.department && <span>· {i.department.name}</span>}
            <span className="num">· v{i.version}</span>
            {i.tags.slice(0, 3).map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <LifecycleBadge status={i.status} />
          <SensitivityBadge value={i.sensitivity} compact />
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <VerificationBadge value={i.verificationStatus} />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <SourceTag source={i.sourceType} reference={i.sourceReference} />
          {i.freshness !== "current" && <FreshnessBadge value={i.freshness} />}
        </span>
        <span className="text-[11.5px] text-fg-faint lg:text-right" suppressHydrationWarning>
          {relativeTime(i.updatedAt)}
        </span>
      </button>
    </li>
  );
}
