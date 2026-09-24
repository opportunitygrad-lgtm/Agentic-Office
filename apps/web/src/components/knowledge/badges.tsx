import {
  BadgeCheck,
  Bot,
  Building2,
  Clock3,
  FileText,
  Globe,
  Handshake,
  HelpCircle,
  Import,
  Lock,
  Mail,
  Search,
  Sheet,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import {
  KNOWLEDGE_SOURCE_LABELS,
  VERIFICATION_LABELS,
  type ConfidenceLevel,
  type FreshnessState,
  type KnowledgeSourceType,
  type KnowledgeStatus,
  type RuleSeverity,
  type SensitivityLevel,
  type VerificationStatus,
} from "@aibos/shared";
import { TONE_CLASSES, cn, type Tone } from "@aibos/ui";

function Pill({
  tone,
  icon: Icon,
  children,
  title,
  className,
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONE_CLASSES[tone].pill,
        className,
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

const STATUS: Record<KnowledgeStatus, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  review: { tone: "approval", label: "In review" },
  approved: { tone: "live", label: "Approved" },
  superseded: { tone: "idle", label: "Superseded" },
  archived: { tone: "idle", label: "Archived" },
};

export function LifecycleBadge({ status }: { status: KnowledgeStatus }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

const VERIFICATION: Record<VerificationStatus, { tone: Tone; icon: LucideIcon }> = {
  unverified: { tone: "attention", icon: ShieldQuestion },
  partially_verified: { tone: "info", icon: ShieldAlert },
  verified: { tone: "live", icon: ShieldCheck },
  management_confirmed: { tone: "done", icon: BadgeCheck },
};

export function VerificationBadge({ value }: { value: VerificationStatus }) {
  const v = VERIFICATION[value];
  return (
    <Pill tone={v.tone} icon={v.icon}>
      {VERIFICATION_LABELS[value]}
    </Pill>
  );
}

const FRESHNESS: Record<FreshnessState, { tone: Tone; label: string }> = {
  current: { tone: "live", label: "Current" },
  review_due: { tone: "attention", label: "Review due" },
  expired: { tone: "danger", label: "Expired" },
  not_yet_effective: { tone: "info", label: "Not yet effective" },
};

export function FreshnessBadge({ value }: { value: FreshnessState }) {
  const f = FRESHNESS[value];
  return (
    <Pill tone={f.tone} icon={Clock3}>
      {f.label}
    </Pill>
  );
}

const SENSITIVITY: Record<SensitivityLevel, { tone: Tone; label: string }> = {
  public: { tone: "idle", label: "Public" },
  internal: { tone: "info", label: "Internal" },
  confidential: { tone: "attention", label: "Confidential" },
  restricted: { tone: "danger", label: "Restricted" },
};

export function SensitivityBadge({
  value,
  compact,
}: {
  value: SensitivityLevel;
  compact?: boolean;
}) {
  const s = SENSITIVITY[value];
  if (compact && (value === "public" || value === "internal")) return null;
  return (
    <Pill
      tone={s.tone}
      icon={value === "confidential" || value === "restricted" ? Lock : undefined}
    >
      {s.label}
    </Pill>
  );
}

const SOURCE_ICON: Record<KnowledgeSourceType, LucideIcon> = {
  management_entry: UserRoundCheck,
  company_document: FileText,
  company_website: Globe,
  partner_document: Handshake,
  email: Mail,
  google_sheet: Sheet,
  web_research: Search,
  grok_research: Sparkles,
  claude_research: Sparkles,
  openai_research: Sparkles,
  system_generated: Bot,
  import: Import,
  unknown: HelpCircle,
};

export function SourceTag({
  source,
  reference,
}: {
  source: KnowledgeSourceType;
  reference?: string | null;
}) {
  const Icon = SOURCE_ICON[source];
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-fg-muted"
      title={reference ?? undefined}
    >
      <Icon className="size-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
      <span className="truncate">{KNOWLEDGE_SOURCE_LABELS[source]}</span>
    </span>
  );
}

const CONFIDENCE_BARS: Record<ConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };

export function ConfidenceMeter({ value }: { value: ConfidenceLevel }) {
  const n = CONFIDENCE_BARS[value];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted"
      title={`${value} confidence`}
    >
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn("w-[3px] rounded-sm", i <= n ? "bg-fg-muted" : "bg-surface-3")}
            style={{ height: 4 + i * 3 }}
          />
        ))}
      </span>
      <span className="capitalize">{value}</span>
      <span className="sr-only"> confidence</span>
    </span>
  );
}

export function ScopeBadge({ global }: { global: boolean }) {
  return global ? (
    <Pill tone="info" icon={Globe}>
      Global
    </Pill>
  ) : (
    <Pill tone="idle" icon={Building2}>
      Company
    </Pill>
  );
}

const SEVERITY: Record<RuleSeverity, { tone: Tone; label: string }> = {
  critical: { tone: "danger", label: "Critical" },
  required: { tone: "attention", label: "Required" },
  info: { tone: "idle", label: "Info" },
};

export function SeverityBadge({ value }: { value: RuleSeverity }) {
  const s = SEVERITY[value];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function PrecedenceTier({ tier, label }: { tier: number; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-line"
      title={`Knowledge precedence ${tier}/8: ${label}`}
    >
      <span className="num text-fg">P{tier}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
