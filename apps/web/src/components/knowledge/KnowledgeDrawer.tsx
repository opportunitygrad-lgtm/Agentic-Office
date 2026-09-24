"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, GitBranch, History, Link2, Trash2 } from "lucide-react";
import {
  AI_SOURCE_TYPES,
  KNOWLEDGE_TYPE_LABELS,
  type AgentDTO,
  type KnowledgeDetailDTO,
  type SensitivityLevel,
  type TaskDTO,
} from "@aibos/shared";
import { Button, Skeleton, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";
import {
  ConfidenceMeter,
  FreshnessBadge,
  LifecycleBadge,
  PrecedenceTier,
  ScopeBadge,
  SensitivityBadge,
  SourceTag,
  VerificationBadge,
} from "./badges";
import { KnowledgeForm } from "./KnowledgeForm";
import { VERIFICATION_OPTIONS, shortDate } from "./labels";

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line/70 px-5 py-4 last:border-0">
      <h3 className="eyebrow mb-2.5 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-[12.5px] font-medium">{children}</dd>
    </div>
  );
}

export function KnowledgeDrawer({
  id,
  companySlug,
  departments,
  allowedSensitivity,
  onChanged,
  onNavigate,
}: {
  id: string;
  companySlug: string | null;
  departments: { id: string; name: string }[];
  allowedSensitivity: SensitivityLevel[];
  onChanged: () => void;
  onNavigate: (id: string) => void;
}) {
  const [detail, setDetail] = useState<{ id: string; data: KnowledgeDetailDTO } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [verification, setVerification] = useState("");
  const [linkTargets, setLinkTargets] = useState<{ tasks: TaskDTO[]; agents: AgentDTO[] } | null>(
    null,
  );
  const [linkChoice, setLinkChoice] = useState("");

  useEffect(() => {
    let active = true;
    void clientApi<{ data: KnowledgeDetailDTO }>(`/v1/knowledge/${id}`).then((res) => {
      if (!active) return;
      if (res.ok) setDetail({ id, data: res.data.data });
      else setError({ id, message: res.message });
    });
    return () => {
      active = false;
    };
  }, [id, version]);

  useEffect(() => {
    if (!companySlug) return;
    let active = true;
    void Promise.all([
      clientApi<{ data: TaskDTO[] }>("/v1/tasks", {
        params: { company: companySlug, limit: "100" },
      }),
      clientApi<{ data: AgentDTO[] }>("/v1/agents", { params: { company: companySlug } }),
    ]).then(([t, a]) => {
      if (active)
        setLinkTargets({ tasks: t.ok ? t.data.data : [], agents: a.ok ? a.data.data : [] });
    });
    return () => {
      active = false;
    };
  }, [companySlug]);

  if (error?.id === id)
    return (
      <p className="p-5 text-[13px] text-fg-muted" role="alert">
        {error.message}
      </p>
    );
  if (!detail || detail.id !== id)
    return (
      <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading knowledge item">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-16" />
      </div>
    );

  const { item, versions, links, history, conflicts, viewer } = detail.data;
  const aiSource = AI_SOURCE_TYPES.includes(item.sourceType);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  async function act(action: string, body: Record<string, unknown> = {}, success?: string) {
    setBusy(true);
    setNotice(null);
    const res = await clientApi(`/v1/knowledge/${item.id}/${action}`, { method: "POST", body });
    setBusy(false);
    if (!res.ok) return setNotice(res.message);
    if (success) setNotice(success);
    refresh();
  }

  async function addLink() {
    if (!linkChoice) return;
    const [kind, targetId] = linkChoice.split(":");
    setBusy(true);
    const res = await clientApi(`/v1/knowledge/${item.id}/links`, {
      method: "POST",
      body: kind === "task" ? { taskId: targetId } : { agentId: targetId },
    });
    setBusy(false);
    setLinkChoice("");
    if (!res.ok) return setNotice(res.message);
    refresh();
  }

  async function removeLink(linkId: string) {
    const res = await clientApi(`/v1/knowledge/${item.id}/links/${linkId}`, { method: "DELETE" });
    if (!res.ok) return setNotice(res.message);
    refresh();
  }

  if (editing)
    return (
      <KnowledgeForm
        companyId={item.company?.id ?? null}
        item={item}
        departments={departments}
        allowedSensitivity={allowedSensitivity}
        onCancel={() => setEditing(false)}
        onDone={(updated, newVersion) => {
          setEditing(false);
          onChanged();
          if (newVersion) {
            setNotice(
              `Draft v${updated.version} created — the approved version stays in force until it is approved.`,
            );
            onNavigate(updated.id);
          } else setVersion((v) => v + 1);
        }}
      />
    );

  const canSubmit = item.status === "draft" && viewer.canEdit;
  const canDecide = (item.status === "draft" || item.status === "review") && viewer.canApprove;
  return (
    <div data-testid="knowledge-drawer">
      <div className="space-y-3 px-5 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <LifecycleBadge status={item.status} />
          <VerificationBadge value={item.verificationStatus} />
          <FreshnessBadge value={item.freshness} />
          <SensitivityBadge value={item.sensitivity} />
          <ScopeBadge global={item.scope === "global"} />
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted ring-1 ring-inset ring-line">
            {KNOWLEDGE_TYPE_LABELS[item.type]}
          </span>
          <span className="num rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted ring-1 ring-inset ring-line">
            v{item.version}
          </span>
        </div>
        {item.summary && (
          <p className="text-[13.5px] font-medium leading-relaxed">{item.summary}</p>
        )}
        {item.conflictsWith.length > 0 && (
          <p
            className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-800 dark:text-amber-300"
            role="status"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Potential conflict with {item.conflictsWith.length} other approved item
            {item.conflictsWith.length === 1 ? "" : "s"}. A human must resolve it — agents are told
            not to choose.
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-muted"
          >
            {notice}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pb-4">
          {canSubmit && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act("submit", {}, "Submitted for review.")}
            >
              Submit for review
            </Button>
          )}
          {canDecide && (
            <>
              {aiSource && (
                <label className="flex items-center gap-1.5 text-[12px]">
                  <span className="text-fg-muted">Verified as</span>
                  <select
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                    className="focus-ring h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]"
                    aria-label="Verification level for approval"
                  >
                    <option value="">Choose…</option>
                    {VERIFICATION_OPTIONS.filter(
                      (o) => o.value === "partially_verified" || o.value === "verified",
                    ).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={busy || (aiSource && !verification)}
                onClick={() =>
                  act(
                    "approve",
                    verification ? { verificationStatus: verification } : {},
                    "Approved.",
                  )
                }
              >
                Approve
              </Button>
              {item.status === "review" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act("reject", {}, "Returned to draft.")}
                >
                  Return to draft
                </Button>
              )}
            </>
          )}
          {viewer.canEdit &&
            (item.status === "draft" || item.status === "review" || item.status === "approved") && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {item.status === "approved" ? "Edit (new version)" : "Edit"}
              </Button>
            )}
          {item.status === "approved" && viewer.canApprove && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act("supersede", {}, "Marked superseded.")}
            >
              Supersede
            </Button>
          )}
          {item.status !== "archived" && viewer.canArchive && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act("archive", {}, "Archived.")}
            >
              Archive
            </Button>
          )}
        </div>
      </div>

      <Section title="Content">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted">
          {item.content}
        </p>
        {item.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
            {item.tags.map((t) => (
              <li
                key={t}
                className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11.5px] font-medium text-accent"
              >
                #{t}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Where did this come from?">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Source">
            <SourceTag source={item.sourceType} />
          </Fact>
          <Fact label="Precedence">
            <PrecedenceTier tier={item.precedence.tier} label={item.precedence.label} />
          </Fact>
          {item.sourceReference && <Fact label="Reference">{item.sourceReference}</Fact>}
          {item.sourceOwner && <Fact label="Owner">{item.sourceOwner}</Fact>}
          {item.sourceUrl && (
            <Fact label="URL">
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {new URL(item.sourceUrl).hostname}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </Fact>
          )}
          {item.sourceFileRef && <Fact label="Document reference">{item.sourceFileRef}</Fact>}
          <Fact label="Confidence">
            <ConfidenceMeter value={item.confidence} />
          </Fact>
          <Fact label="Last verified">{shortDate(item.lastVerifiedAt)}</Fact>
        </dl>
        {item.provenanceNotes && (
          <p className="mt-3 text-[12.5px] text-fg-muted">{item.provenanceNotes}</p>
        )}
      </Section>

      <Section title="Validity & approval">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Effective">{shortDate(item.effectiveAt)}</Fact>
          <Fact label="Review by">{shortDate(item.reviewAt)}</Fact>
          <Fact label="Expires">{shortDate(item.expiresAt)}</Fact>
          <Fact label="Created by">{item.createdBy?.name ?? "System"}</Fact>
          <Fact label="Approved by">{item.approvedBy?.name ?? "—"}</Fact>
          <Fact label="Approved">{shortDate(item.approvedAt)}</Fact>
        </dl>
      </Section>

      <Section title="Versions" icon={<GitBranch className="size-3.5" aria-hidden="true" />}>
        <ol className="space-y-1.5">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onNavigate(v.id)}
                aria-current={v.id === item.id ? "true" : undefined}
                className={cn(
                  "focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]",
                  v.id === item.id ? "bg-accent-soft/60" : "hover:bg-surface-2",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="num font-semibold">v{v.version}</span>
                  <LifecycleBadge status={v.status} />
                  {v.status === "approved" && (
                    <span className="text-[11px] text-fg-faint">Current version</span>
                  )}
                </span>
                <span className="text-[11.5px] text-fg-faint">
                  {v.createdBy?.name ?? "System"}
                  {v.approvedBy ? ` · approved by ${v.approvedBy.name}` : ""} ·{" "}
                  {shortDate(v.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Section>

      {conflicts.length > 0 && (
        <Section
          title="Potential conflicts"
          icon={<AlertTriangle className="size-3.5" aria-hidden="true" />}
        >
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <li key={c.id} className="rounded-lg border border-amber-500/30 p-2.5">
                <button
                  type="button"
                  onClick={() => onNavigate(c.id)}
                  className="focus-ring text-left text-[12.5px] font-medium hover:underline"
                >
                  {c.title}
                </button>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">
                  {c.summary ?? c.content}
                </p>
                {viewer.canApprove && item.status === "approved" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        act("supersede", { replacementId: c.id }, "Resolved: this item superseded.")
                      }
                    >
                      Keep the other item
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await clientApi(`/v1/knowledge/${c.id}/supersede`, {
                          method: "POST",
                          body: { replacementId: item.id },
                        });
                        setBusy(false);
                        if (!res.ok) return setNotice(res.message);
                        setNotice("Resolved: the other item was superseded.");
                        refresh();
                      }}
                    >
                      Keep this item
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Used by" icon={<Link2 className="size-3.5" aria-hidden="true" />}>
        {links.length ? (
          <ul className="space-y-1.5">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                <Link
                  href={
                    l.target === "task"
                      ? `/tasks/item/${l.targetId}`
                      : `/workforce/agents/${l.targetId}`
                  }
                  className="focus-ring min-w-0 truncate hover:underline"
                >
                  <span className="mr-1.5 rounded bg-surface-2 px-1 text-[10.5px] uppercase text-fg-muted">
                    {l.target}
                  </span>
                  {l.label}
                </Link>
                {viewer.canEdit && (
                  <button
                    type="button"
                    onClick={() => removeLink(l.id)}
                    aria-label={`Unlink ${l.label}`}
                    className="focus-ring rounded p-1 text-fg-faint hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-fg-faint">
            Not explicitly linked. Agents may still receive it through relevance rules.
          </p>
        )}
        {viewer.canEdit && linkTargets && (
          <div className="mt-3 flex gap-2">
            <select
              value={linkChoice}
              onChange={(e) => setLinkChoice(e.target.value)}
              aria-label="Link to a task or agent"
              className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[12.5px]"
            >
              <option value="">Link to a task or agent…</option>
              <optgroup label="Tasks">
                {linkTargets.tasks.map((t) => (
                  <option key={t.id} value={`task:${t.id}`}>
                    {t.title}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Agents">
                {linkTargets.agents.map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <Button size="sm" disabled={!linkChoice || busy} onClick={addLink}>
              Link
            </Button>
          </div>
        )}
      </Section>

      <Section title="History" icon={<History className="size-3.5" aria-hidden="true" />}>
        {history.length ? (
          <ol className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="text-[12.5px]">
                <p>{h.description}</p>
                <p className="text-[11.5px] text-fg-faint" suppressHydrationWarning>
                  {h.actorUser ?? h.actorType} · {relativeTime(h.occurredAt)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-fg-faint">No recorded changes.</p>
        )}
      </Section>
    </div>
  );
}
