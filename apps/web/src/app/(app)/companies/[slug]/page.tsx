import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BookOpenCheck, Gavel, Globe2, ShieldAlert, Timer } from "lucide-react";
import type {
  AgentDTO,
  AuditEventDTO,
  CompanyProfileDTO,
  CompanyRulesDTO,
  DepartmentDTO,
  KnowledgeAccessPolicyDTO,
  RuleDTO,
} from "@aibos/shared";
import { Monogram, MockBadge, Panel, StatusPill, cn } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { AiPolicyPanel, KnowledgeAccessPanel } from "@/components/company/AiPolicyPanel";
import { HistoryFeed } from "@/components/company/HistoryFeed";
import { ProfileSection } from "@/components/company/ProfileSection";
import { RulesPanel } from "@/components/company/RulesPanel";
import { SeverityBadge } from "@/components/knowledge/badges";
import { KnowledgeLibrary } from "@/components/knowledge/KnowledgeLibrary";
import { apiGet, apiTry, type SearchParams } from "@/lib/api";

export const metadata = { title: "Company profile" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "business", label: "Business" },
  { key: "brand", label: "Brand" },
  { key: "commercial", label: "Commercial" },
  { key: "compliance", label: "Compliance" },
  { key: "ai", label: "AI Policy" },
  { key: "knowledge", label: "Knowledge" },
  { key: "history", label: "History" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function StatTile({
  icon: Icon,
  label,
  value,
  href,
  tone,
}: {
  icon: typeof BookOpenCheck;
  label: string;
  value: number;
  href: string;
  tone?: "warn" | "danger";
}) {
  return (
    <Link
      href={href}
      className="focus-ring group flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-panel transition-colors hover:border-line-strong"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-fg-muted",
          tone === "warn" && value > 0 && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          tone === "danger" && value > 0 && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11.5px] text-fg-faint">{label}</span>
        <span className="num block text-[18px] font-semibold leading-tight">{value}</span>
      </span>
    </Link>
  );
}

export default async function CompanyProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "overview";
  const itemId = typeof sp.item === "string" ? sp.item : undefined;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();

  let profile: CompanyProfileDTO;
  try {
    profile = (await apiGet<{ data: CompanyProfileDTO }>(`/v1/companies/${slug}/profile`)).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  const c = profile.company;
  const v = profile.viewer;
  const needsRules = ["overview", "brand", "commercial", "compliance"].includes(tab);
  const [rules, history, departments, access, agents] = await Promise.all([
    needsRules ? apiTry<{ data: CompanyRulesDTO }>(`/v1/companies/${slug}/rules`) : null,
    tab === "history" || tab === "overview"
      ? apiTry<{ data: AuditEventDTO[] }>(`/v1/companies/${slug}/history`, {
          limit: tab === "overview" ? "6" : "100",
        })
      : null,
    tab === "knowledge" || tab === "ai"
      ? apiTry<{ data: DepartmentDTO[] }>("/v1/departments", { company: slug })
      : null,
    tab === "ai"
      ? apiTry<{ data: KnowledgeAccessPolicyDTO[] }>(`/v1/companies/${slug}/knowledge-access`)
      : null,
    tab === "ai" ? apiTry<{ data: AgentDTO[] }>("/v1/agents", { company: slug }) : null,
  ]);
  const deptOptions = (departments?.data ?? []).map((d) => ({ id: d.id, name: d.name }));
  const critical: RuleDTO[] = rules
    ? [...rules.data.brand, ...rules.data.commercial, ...rules.data.compliance].filter(
        (r) => r.severity === "critical" && r.status === "approved" && r.active,
      )
    : [];
  const base = `/companies/${slug}`;

  return (
    <div className="mx-auto max-w-[1480px]">
      {/* header */}
      <div className="relative mb-5 overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-panel">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: c.accentColor ?? "var(--accent)" }}
        />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Monogram name={c.name} color={c.accentColor} size="lg" />
            <div className="min-w-0">
              <p className="eyebrow">Company profile</p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight">{c.name}</h1>
                <StatusPill
                  tone={c.status === "active" ? "live" : "neutral"}
                  label={c.status === "active" ? "Active" : "Inactive"}
                />
                {c.origin === "dev_seed" && <MockBadge label="Dev seed profile" />}
              </div>
              <p className="mt-0.5 text-[13px] text-fg-muted">
                {c.industry ?? "—"}
                {c.website && (
                  <>
                    {" · "}
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <Globe2 className="size-3.5" aria-hidden="true" />
                      {new URL(c.website).hostname}
                    </a>
                  </>
                )}
              </p>
              {c.brandPositioning && (
                <p className="mt-1.5 max-w-2xl text-[13.5px]">{c.brandPositioning}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/?company=${slug}`}
              className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-line hover:bg-surface-2"
            >
              Command centre
            </Link>
            <Link
              href={`/workforce/agents?company=${slug}`}
              className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-line hover:bg-surface-2"
            >
              Agents
            </Link>
          </div>
        </div>
      </div>

      {/* tabs */}
      <nav
        aria-label="Company profile sections"
        className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? base : `${base}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "focus-ring shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium",
              tab === t.key ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.key === "knowledge" && profile.stats.conflicts > 0 && (
              <span className="ml-1.5 rounded bg-rose-500/15 px-1 text-[10.5px] text-rose-700 dark:text-rose-300">
                {profile.stats.conflicts}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatTile
              icon={BookOpenCheck}
              label="Approved knowledge"
              value={profile.stats.knowledge.approved}
              href={`${base}?tab=knowledge`}
            />
            <StatTile
              icon={ShieldAlert}
              label="Awaiting review"
              value={profile.stats.knowledge.review}
              href={`${base}?tab=knowledge`}
              tone="warn"
            />
            <StatTile
              icon={Timer}
              label="Stale items"
              value={profile.stats.stale}
              href={`${base}?tab=knowledge`}
              tone="warn"
            />
            <StatTile
              icon={AlertTriangle}
              label="Potential conflicts"
              value={profile.stats.conflicts}
              href={`${base}?tab=knowledge`}
              tone="danger"
            />
            <StatTile
              icon={Gavel}
              label="Critical rules"
              value={profile.stats.rules.critical}
              href={`${base}?tab=brand`}
            />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ProfileSection
              section="identity"
              title="Identity"
              eyebrow="Overview"
              companySlug={slug}
              values={c as unknown as Record<string, unknown>}
              canEdit={v.canEdit}
            />
            <div className="space-y-5">
              <Panel title="Always in agent context" eyebrow="Critical rules">
                {critical.length ? (
                  <ul className="space-y-2.5">
                    {critical.map((r) => (
                      <li key={r.id}>
                        <div className="flex items-center gap-1.5">
                          <SeverityBadge value={r.severity} />
                          <span className="text-[13px] font-medium">{r.title}</span>
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-fg-muted">{r.description}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-fg-faint">No critical rules.</p>
                )}
              </Panel>
              {history && <HistoryFeed events={history.data} />}
            </div>
          </div>
        </div>
      )}
      {tab === "business" && (
        <ProfileSection
          section="business"
          title="Business"
          eyebrow="Products, markets & objectives"
          companySlug={slug}
          values={c as unknown as Record<string, unknown>}
          canEdit={v.canEdit}
        />
      )}
      {tab === "brand" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <ProfileSection
            section="brand"
            title="Brand"
            eyebrow="Voice, claims & positioning"
            companySlug={slug}
            values={c as unknown as Record<string, unknown>}
            canEdit={v.canEdit}
          />
          <RulesPanel
            kind="brand"
            rules={rules?.data.brand ?? []}
            companySlug={slug}
            canManage={v.canManagePolicy}
            canApprove={v.canApprovePolicy}
          />
        </div>
      )}
      {tab === "commercial" && (
        <RulesPanel
          kind="commercial"
          rules={rules?.data.commercial ?? []}
          companySlug={slug}
          canManage={v.canManagePolicy}
          canApprove={v.canApprovePolicy}
        />
      )}
      {tab === "compliance" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <ProfileSection
            section="compliance"
            title="Compliance"
            eyebrow="Jurisdictions, disclaimers & data"
            companySlug={slug}
            values={c as unknown as Record<string, unknown>}
            canEdit={v.canManagePolicy}
          />
          <RulesPanel
            kind="compliance"
            rules={rules?.data.compliance ?? []}
            companySlug={slug}
            canManage={v.canManagePolicy}
            canApprove={v.canApprovePolicy}
          />
        </div>
      )}
      {tab === "ai" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <AiPolicyPanel
            companySlug={slug}
            policy={profile.aiPolicy}
            canEdit={v.canManageSettings}
          />
          <KnowledgeAccessPanel
            companySlug={slug}
            policies={access?.data ?? []}
            agents={agents?.data ?? []}
            departments={deptOptions}
            canManage={v.canManageAgentAccess}
            companyId={c.id}
          />
        </div>
      )}
      {tab === "knowledge" && (
        <KnowledgeLibrary
          company={{ id: c.id, slug, name: c.name }}
          departments={deptOptions}
          initialItemId={itemId}
        />
      )}
      {tab === "history" && history && <HistoryFeed events={history.data} />}
    </div>
  );
}
