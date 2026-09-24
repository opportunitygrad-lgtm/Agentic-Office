"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Loader2, Pencil, Sparkles } from "lucide-react";
import type { ZodType } from "zod";
import {
  PROVIDER_LABELS,
  companyAiSchema,
  companyBrandSchema,
  companyBusinessSchema,
  companyIdentitySchema,
  formatUsd,
  slugify,
  titleCase,
  type AgentTemplateKey,
  type ApiErrorBody,
  type CompanyDTO,
  type CreateCompanyInput,
  type ProviderType,
} from "@aibos/shared";
import { Button, Monogram, cn } from "@aibos/ui";
import { SelectField, Switch, TagInput, TextArea, TextField } from "./fields";
import { COUNTRIES, CURRENCIES, PROVIDER_OPTIONS, TIMEZONES, TONES } from "./options";

export interface WizardTemplate {
  key: AgentTemplateKey;
  name: string;
  description: string;
  department: string;
}

export interface WizardState {
  name: string;
  legalName: string;
  website: string;
  industry: string;
  primaryCountry: string;
  timezone: string;
  defaultCurrency: string;
  productsServices: string[];
  targetAudiences: string[];
  targetMarkets: string[];
  primaryObjective: string;
  revenueObjective: string;
  description: string;
  brandPositioning: string;
  brandTone: string;
  companyRules: string[];
  prohibitedClaims: string[];
  competitorNotes: string;
  defaultProvider: ProviderType;
  dailyAiBudget: string;
  monthlyAiBudget: string;
  concurrencyLimit: string;
  requireApprovalHighCost: boolean;
  requireApprovalDeepResearch: boolean;
  initialAgents: AgentTemplateKey[];
}

export const INITIAL_STATE: WizardState = {
  name: "",
  legalName: "",
  website: "",
  industry: "",
  primaryCountry: "IE",
  timezone: "Europe/Dublin",
  defaultCurrency: "EUR",
  productsServices: [],
  targetAudiences: [],
  targetMarkets: [],
  primaryObjective: "",
  revenueObjective: "",
  description: "",
  brandPositioning: "",
  brandTone: "",
  companyRules: [],
  prohibitedClaims: [],
  competitorNotes: "",
  defaultProvider: "CLAUDE",
  dailyAiBudget: "20",
  monthlyAiBudget: "400",
  concurrencyLimit: "2",
  requireApprovalHighCost: true,
  requireApprovalDeepResearch: true,
  initialAgents: ["company_manager", "research", "email_communications"],
};

const opt = (v: string) => (v.trim() ? v.trim() : undefined);
const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

export function toPayload(s: WizardState): CreateCompanyInput {
  return {
    name: s.name,
    legalName: opt(s.legalName),
    website: opt(s.website),
    industry: s.industry,
    primaryCountry: s.primaryCountry,
    timezone: s.timezone,
    defaultCurrency: s.defaultCurrency,
    productsServices: s.productsServices,
    targetAudiences: s.targetAudiences,
    targetMarkets: s.targetMarkets,
    primaryObjective: opt(s.primaryObjective),
    revenueObjective: opt(s.revenueObjective),
    description: opt(s.description),
    brandPositioning: opt(s.brandPositioning),
    brandTone: opt(s.brandTone),
    companyRules: s.companyRules,
    prohibitedClaims: s.prohibitedClaims,
    competitorNotes: opt(s.competitorNotes),
    defaultProvider: s.defaultProvider,
    dailyAiBudget: num(s.dailyAiBudget),
    monthlyAiBudget: num(s.monthlyAiBudget),
    concurrencyLimit: num(s.concurrencyLimit),
    requireApprovalHighCost: s.requireApprovalHighCost,
    requireApprovalDeepResearch: s.requireApprovalDeepResearch,
    initialAgents: s.initialAgents,
  };
}

const STEPS: { title: string; subtitle: string; schema?: ZodType }[] = [
  {
    title: "Company identity",
    subtitle: "Name, web presence and locale",
    schema: companyIdentitySchema,
  },
  { title: "Business", subtitle: "Offer, customers and objectives", schema: companyBusinessSchema },
  { title: "Brand", subtitle: "Positioning, tone and rules", schema: companyBrandSchema },
  { title: "AI & cost", subtitle: "Providers, budgets and guardrails", schema: companyAiSchema },
  { title: "Initial agents", subtitle: "Starter workforce from templates" },
  { title: "Review", subtitle: "Confirm and create" },
];

type Errors = Partial<Record<keyof WizardState, string>>;

const FIELD_STEP: Partial<Record<keyof WizardState, number>> = {
  name: 0,
  legalName: 0,
  website: 0,
  industry: 0,
  primaryCountry: 0,
  timezone: 0,
  defaultCurrency: 0,
  productsServices: 1,
  targetAudiences: 1,
  targetMarkets: 1,
  primaryObjective: 1,
  revenueObjective: 1,
  description: 1,
  brandPositioning: 2,
  brandTone: 2,
  companyRules: 2,
  prohibitedClaims: 2,
  competitorNotes: 2,
  defaultProvider: 3,
  dailyAiBudget: 3,
  monthlyAiBudget: 3,
  concurrencyLimit: 3,
  initialAgents: 4,
};

function issuesToErrors(issues: { path: PropertyKey[] | string; message: string }[]): Errors {
  const errors: Errors = {};
  for (const i of issues) {
    const key = (
      Array.isArray(i.path) ? String(i.path[0] ?? "") : String(i.path).split(".")[0]
    ) as keyof WizardState;
    if (key && !errors[key]) errors[key] = i.message;
  }
  return errors;
}

export function AddCompanyWizard({ templates }: { templates: WizardTemplate[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ company: CompanyDTO; agents: number } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) headingRef.current?.focus();
    mounted.current = true;
  }, [step, created]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function validateStep(i: number): boolean {
    const schema = STEPS[i]?.schema;
    if (!schema) return true;
    const r = schema.safeParse(toPayload(state));
    if (r.success) return true;
    setErrors(issuesToErrors(r.error.issues));
    return false;
  }

  function goTo(i: number) {
    setSubmitError(null);
    setStep(i);
    setMaxStep((m) => Math.max(m, i));
  }

  function next() {
    if (!validateStep(step)) return;
    goTo(step + 1);
  }

  async function submit() {
    for (let i = 0; i < 4; i++) {
      if (!validateStep(i)) {
        goTo(i);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/v1/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(state)),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { data: CompanyDTO; agentsCreated: number };
        setCreated({ company: body.data, agents: body.agentsCreated });
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
      if (res.status === 400 && body?.error.issues) {
        const errs = issuesToErrors(body.error.issues);
        setErrors(errs);
        const first = Math.min(
          ...Object.keys(errs).map((k) => FIELD_STEP[k as keyof WizardState] ?? 5),
        );
        goTo(Number.isFinite(first) ? first : 5);
      } else if (res.status === 409) {
        setErrors({ name: body?.error.message ?? "A company with this name already exists" });
        goTo(0);
      }
      setSubmitError(body?.error.message ?? `Could not create company (HTTP ${res.status})`);
    } catch {
      setSubmitError("Could not reach the API. Is it running?");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div
        className="mx-auto max-w-xl animate-fade-up rounded-2xl border border-line bg-surface p-8 text-center shadow-panel"
        role="status"
      >
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CircleCheck className="size-7" aria-hidden="true" />
        </div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 text-xl font-semibold tracking-tight outline-none"
        >
          {created.company.name} is ready
        </h2>
        <p className="mt-1.5 text-[13.5px] text-fg-muted">
          Company created with {created.agents} initial agent{created.agents === 1 ? "" : "s"},
          budget policies and an audit record.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href={`/?company=${created.company.slug}`}
            className="focus-ring inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Open command centre
          </Link>
          <Link
            href={`/workforce/agents?company=${created.company.slug}`}
            className="focus-ring inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium ring-1 ring-inset ring-line hover:bg-surface-2"
          >
            View agents
          </Link>
        </div>
      </div>
    );
  }

  const current = STEPS[step]!;
  const previewName = state.name.trim() || "New company";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[272px_minmax(0,1fr)] lg:items-start">
      {/* stepper */}
      <aside className="rounded-2xl border border-line bg-surface p-4 shadow-panel lg:sticky lg:top-20">
        <div className="flex items-center gap-3 border-b border-line/70 pb-4">
          <Monogram name={previewName} color="#2f5bea" size="lg" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{previewName}</p>
            <p className="truncate font-mono text-[11px] text-fg-faint">
              /{slugify(previewName) || "slug"}
            </p>
          </div>
        </div>
        <ol
          className="mt-3 flex gap-1 overflow-x-auto lg:block lg:space-y-0.5"
          aria-label="Wizard progress"
        >
          {STEPS.map((s, i) => {
            const done = i < step || (i <= maxStep && i !== step);
            const reachable = i <= maxStep;
            return (
              <li key={s.title} className="shrink-0">
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => reachable && goTo(i)}
                  className={cn(
                    "focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors disabled:cursor-not-allowed",
                    i === step ? "bg-accent-soft" : reachable && "hover:bg-surface-2",
                  )}
                >
                  <span
                    className={cn(
                      "num grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                      i === step
                        ? "bg-accent text-white"
                        : done
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-surface-3 text-fg-faint",
                    )}
                  >
                    {done && i !== step ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                  </span>
                  <span className="hidden min-w-0 lg:block">
                    <span
                      className={cn(
                        "block text-[13px] font-medium",
                        i === step ? "text-fg" : "text-fg-muted",
                      )}
                    >
                      {s.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-fg-faint">{s.subtitle}</span>
                  </span>
                  <span className="sr-only lg:hidden">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* form */}
      <form
        className="min-w-0 rounded-2xl border border-line bg-surface shadow-panel"
        noValidate
        aria-labelledby="wizard-step-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === STEPS.length - 1) void submit();
          else next();
        }}
      >
        <div className="border-b border-line/70 px-5 py-4 sm:px-6">
          <p className="eyebrow">
            Step {step + 1} of {STEPS.length}
          </p>
          <h2
            id="wizard-step-title"
            ref={headingRef}
            tabIndex={-1}
            className="mt-0.5 text-[17px] font-semibold tracking-tight outline-none"
          >
            {current.title}
          </h2>
          <p className="text-[13px] text-fg-muted">{current.subtitle}</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          {step === 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Company name"
                required
                value={state.name}
                error={errors.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. SkyBridge Academy"
                autoComplete="organization"
              />
              <TextField
                label="Legal name"
                value={state.legalName}
                error={errors.legalName}
                onChange={(e) => set("legalName", e.target.value)}
                placeholder="SkyBridge Academy Ltd"
              />
              <TextField
                label="Website"
                type="url"
                value={state.website}
                error={errors.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://example.com"
              />
              <TextField
                label="Industry"
                required
                value={state.industry}
                error={errors.industry}
                onChange={(e) => set("industry", e.target.value)}
                placeholder="Aviation training"
              />
              <SelectField
                label="Primary country"
                required
                value={state.primaryCountry}
                error={errors.primaryCountry}
                onChange={(e) => set("primaryCountry", e.target.value)}
                options={COUNTRIES}
              />
              <SelectField
                label="Timezone"
                required
                value={state.timezone}
                error={errors.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                options={TIMEZONES}
              />
              <SelectField
                label="Default currency"
                required
                value={state.defaultCurrency}
                error={errors.defaultCurrency}
                onChange={(e) => set("defaultCurrency", e.target.value)}
                options={CURRENCIES}
              />
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TagInput
                className="sm:col-span-2"
                label="Products / services"
                values={state.productsServices}
                onChange={(v) => set("productsServices", v)}
                placeholder="Integrated ATPL placement"
                error={errors.productsServices}
              />
              <TagInput
                label="Target customers"
                values={state.targetAudiences}
                onChange={(v) => set("targetAudiences", v)}
                placeholder="Aspiring pilots"
                error={errors.targetAudiences}
              />
              <TagInput
                label="Target markets"
                values={state.targetMarkets}
                onChange={(v) => set("targetMarkets", v)}
                placeholder="Ireland"
                error={errors.targetMarkets}
              />
              <TextField
                label="Primary business objective"
                value={state.primaryObjective}
                error={errors.primaryObjective}
                onChange={(e) => set("primaryObjective", e.target.value)}
                placeholder="Become the trusted route into…"
              />
              <TextField
                label="Revenue objective"
                value={state.revenueObjective}
                error={errors.revenueObjective}
                onChange={(e) => set("revenueObjective", e.target.value)}
                placeholder="Grow placements 20% QoQ"
              />
              <TextArea
                className="sm:col-span-2"
                label="Description"
                value={state.description}
                error={errors.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="What the company does, for whom, and how."
              />
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextArea
                className="sm:col-span-2"
                label="Positioning"
                value={state.brandPositioning}
                error={errors.brandPositioning}
                onChange={(e) => set("brandPositioning", e.target.value)}
                placeholder="Independent, expert guidance for…"
              />
              <div className="sm:col-span-2">
                <TextField
                  label="Tone of voice"
                  value={state.brandTone}
                  error={errors.brandTone}
                  onChange={(e) => set("brandTone", e.target.value)}
                  placeholder="Professional, precise, encouraging"
                />
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Tone suggestions">
                  {TONES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        set(
                          "brandTone",
                          state.brandTone ? `${state.brandTone}, ${t.toLowerCase()}` : t,
                        )
                      }
                      className="focus-ring rounded-full border border-line px-2.5 py-0.5 text-[12px] text-fg-muted hover:border-accent hover:text-accent"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              </div>
              <TagInput
                label="Brand rules"
                values={state.companyRules}
                onChange={(v) => set("companyRules", v)}
                placeholder="Never guarantee outcomes"
                error={errors.companyRules}
              />
              <TagInput
                label="Prohibited claims"
                values={state.prohibitedClaims}
                onChange={(v) => set("prohibitedClaims", v)}
                placeholder="Guaranteed job"
                error={errors.prohibitedClaims}
              />
              <TextArea
                className="sm:col-span-2"
                label="Competitor / reference notes"
                value={state.competitorNotes}
                error={errors.competitorNotes}
                onChange={(e) => set("competitorNotes", e.target.value)}
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-[12.5px] font-medium">Preferred AI provider</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PROVIDER_OPTIONS.map((p) => {
                    const checked = state.defaultProvider === p.value;
                    return (
                      <label
                        key={p.value}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                          checked
                            ? "border-accent bg-accent-soft/50"
                            : "border-line hover:border-line-strong",
                        )}
                      >
                        <input
                          type="radio"
                          name="provider"
                          value={p.value}
                          checked={checked}
                          onChange={() => set("defaultProvider", p.value)}
                          className="mt-0.5 accent-[var(--accent)]"
                        />
                        <span>
                          <span className="block text-[13px] font-semibold">{p.label}</span>
                          <span className="block text-[12px] text-fg-muted">{p.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextField
                  label="Daily AI budget"
                  prefix="USD"
                  inputMode="decimal"
                  type="number"
                  min={0}
                  step="1"
                  value={state.dailyAiBudget}
                  error={errors.dailyAiBudget}
                  onChange={(e) => set("dailyAiBudget", e.target.value)}
                  hint="Hard ceiling per day"
                />
                <TextField
                  label="Monthly AI budget"
                  prefix="USD"
                  inputMode="decimal"
                  type="number"
                  min={0}
                  step="10"
                  value={state.monthlyAiBudget}
                  error={errors.monthlyAiBudget}
                  onChange={(e) => set("monthlyAiBudget", e.target.value)}
                  hint="Must cover the daily budget"
                />
                <TextField
                  label="Normal concurrency"
                  inputMode="numeric"
                  type="number"
                  min={1}
                  max={50}
                  step="1"
                  value={state.concurrencyLimit}
                  error={errors.concurrencyLimit}
                  onChange={(e) => set("concurrencyLimit", e.target.value)}
                  hint="Agents working at once (1–50)"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Switch
                  label="Approve high-cost tasks"
                  description="Ask before tasks that exceed their budget estimate."
                  checked={state.requireApprovalHighCost}
                  onChange={(v) => set("requireApprovalHighCost", v)}
                />
                <Switch
                  label="Approve deep research"
                  description="Ask before long, search-heavy research runs."
                  checked={state.requireApprovalDeepResearch}
                  onChange={(v) => set("requireApprovalDeepResearch", v)}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <fieldset>
              <legend className="mb-3 text-[13px] text-fg-muted">
                Choose the starter workforce. Agents are created asleep and wake when tasks are
                assigned. You can add more later.
              </legend>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {templates.map((t) => {
                  const checked = state.initialAgents.includes(t.key);
                  return (
                    <label
                      key={t.key}
                      className={cn(
                        "flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                        checked
                          ? "border-accent bg-accent-soft/50"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          set(
                            "initialAgents",
                            checked
                              ? state.initialAgents.filter((k) => k !== t.key)
                              : [...state.initialAgents, t.key],
                          )
                        }
                        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold">{t.name}</span>
                          <span className="rounded bg-surface-3 px-1.5 text-[10.5px] text-fg-muted">
                            {titleCase(t.department)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">
                          {t.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-fg-faint">
                {state.initialAgents.length} selected
              </p>
            </fieldset>
          )}

          {step === 5 && <Review state={state} templates={templates} onEdit={goTo} />}

          {submitError && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-300"
            >
              {submitError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line/70 px-5 py-4 sm:px-6">
          <Button
            variant="ghost"
            icon={<ArrowLeft className="size-4" />}
            onClick={() => goTo(step - 1)}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="submit" variant="primary">
              Continue <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              icon={
                submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )
              }
            >
              {submitting ? "Creating…" : "Create company"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function ReviewSection({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: number;
  onEdit: (i: number) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line p-4" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-accent hover:underline"
        >
          <Pencil className="size-3" aria-hidden="true" /> Edit
        </button>
      </div>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-2">
          <dt className="w-32 shrink-0 text-fg-faint">{k}</dt>
          <dd className="min-w-0 break-words font-medium">
            {v || <span className="font-normal text-fg-faint">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Review({
  state,
  templates,
  onEdit,
}: {
  state: WizardState;
  templates: WizardTemplate[];
  onEdit: (i: number) => void;
}) {
  const list = (v: string[]) => (v.length ? v.join(", ") : "");
  return (
    <div className="space-y-3">
      <ReviewSection title="Company identity" step={0} onEdit={onEdit}>
        <Rows
          rows={[
            ["Name", state.name],
            ["Legal name", state.legalName],
            ["Website", state.website],
            ["Industry", state.industry],
            ["Country", state.primaryCountry],
            ["Timezone", state.timezone],
            ["Currency", state.defaultCurrency],
          ]}
        />
      </ReviewSection>
      <ReviewSection title="Business" step={1} onEdit={onEdit}>
        <Rows
          rows={[
            ["Products", list(state.productsServices)],
            ["Customers", list(state.targetAudiences)],
            ["Markets", list(state.targetMarkets)],
            ["Objective", state.primaryObjective],
            ["Revenue goal", state.revenueObjective],
            ["Description", state.description],
          ]}
        />
      </ReviewSection>
      <ReviewSection title="Brand" step={2} onEdit={onEdit}>
        <Rows
          rows={[
            ["Positioning", state.brandPositioning],
            ["Tone", state.brandTone],
            ["Rules", list(state.companyRules)],
            ["Prohibited", list(state.prohibitedClaims)],
            ["Competitors", state.competitorNotes],
          ]}
        />
      </ReviewSection>
      <ReviewSection title="AI & cost" step={3} onEdit={onEdit}>
        <Rows
          rows={[
            ["Provider", PROVIDER_LABELS[state.defaultProvider]],
            ["Daily budget", formatUsd(Number(state.dailyAiBudget) || 0)],
            ["Monthly budget", formatUsd(Number(state.monthlyAiBudget) || 0)],
            ["Concurrency", state.concurrencyLimit],
            ["High-cost approval", state.requireApprovalHighCost ? "Required" : "Not required"],
            [
              "Deep research approval",
              state.requireApprovalDeepResearch ? "Required" : "Not required",
            ],
          ]}
        />
      </ReviewSection>
      <ReviewSection
        title={`Initial agents (${state.initialAgents.length})`}
        step={4}
        onEdit={onEdit}
      >
        {state.initialAgents.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {state.initialAgents.map((k) => (
              <li
                key={k}
                className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ring-line"
              >
                {templates.find((t) => t.key === k)?.name ?? titleCase(k)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-fg-faint">No agents — you can add them later.</p>
        )}
      </ReviewSection>
    </div>
  );
}
