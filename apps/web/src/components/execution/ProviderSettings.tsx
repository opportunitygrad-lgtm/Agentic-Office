"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlugZap } from "lucide-react";
import {
  API_EQUIVALENT_LABEL,
  EFFORT_LEVELS,
  TRANSPORT_LABELS,
  formatUsd,
  type EffortLevel,
  type ProviderStatusDTO,
} from "@aibos/shared";
import { Button, MockBadge, Panel, StatusPill, type Tone } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { useMe } from "../shell/SessionContext";

const STATE: Record<ProviderStatusDTO["state"], { label: string; tone: Tone }> = {
  not_configured: { label: "Not configured", tone: "idle" },
  available: { label: "Connected", tone: "live" },
  degraded: { label: "Degraded", tone: "attention" },
  rate_limited: { label: "Rate limited", tone: "attention" },
  auth_error: { label: "Auth error", tone: "danger" },
  unavailable: { label: "Unavailable", tone: "danger" },
  not_installed: { label: "Not installed", tone: "attention" },
  login_required: { label: "Login required", tone: "attention" },
  login_expired: { label: "Login expired", tone: "attention" },
  misconfigured: { label: "Misconfigured", tone: "danger" },
};

/** Claude Code states where the owner still has to act in Terminal. */
const NEEDS_SETUP = new Set<ProviderStatusDTO["state"]>([
  "not_configured",
  "not_installed",
  "login_required",
  "login_expired",
  "misconfigured",
]);

const ALIAS_LABEL: Record<string, string> = { sonnet: "Sonnet", opus: "Opus" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The Business OS never collects Claude credentials: authentication happens in
 * the official Claude Code CLI on the owner's machine.
 */
function ClaudeCodeSetup({ state }: { state: ProviderStatusDTO["state"] }) {
  const heading =
    state === "login_expired"
      ? "Claude login expired."
      : state === "not_installed"
        ? "Claude Code is not installed on this machine."
        : state === "not_configured"
          ? "Claude Code has not been checked yet."
          : "Claude Code is not authenticated.";
  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/40 dark:bg-amber-500/10"
      data-testid="claude-code-setup"
    >
      <p className="font-semibold">{heading}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Install Claude Code if necessary.</li>
        <li>Open Terminal.</li>
        <li>
          Run{" "}
          <code className="rounded bg-surface px-1 ring-1 ring-inset ring-line">claude login</code>
        </li>
        <li>Sign in using your Claude Pro account.</li>
        <li>Return here and click TEST CLAUDE CODE.</li>
      </ol>
      <p className="mt-2 text-[11.5px] text-fg-muted">
        This app never asks for your Claude password, cookies or tokens — sign-in happens only in
        the official Claude Code app.
      </p>
    </div>
  );
}

const selectCls = "focus-ring h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px]";

function ProviderCard({ p }: { p: ProviderStatusDTO }) {
  const me = useMe();
  const router = useRouter();
  const canManage = !!me?.globalPermissions.includes("provider.settings.manage");
  const canTest = !!me?.globalPermissions.includes("provider.test");
  const [form, setForm] = useState({
    standardModel: p.standardModel ?? "",
    premiumModel: p.premiumModel ?? "",
    standardEffort: (p.standardEffort ?? "medium") as EffortLevel,
    premiumEffort: (p.premiumEffort ?? "high") as EffortLevel,
    dailyBudgetUsd: p.dailyBudgetUsd?.toString() ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const meta = STATE[p.state];
  const configurable = p.provider === "CLAUDE";
  const subscription = p.transport === "claude_code_cli";

  async function test() {
    setMsg("Testing…");
    const r = await clientApi<{ data: { state: string; detail: string | null } }>(
      `/v1/providers/${p.provider}/test`,
      { method: "POST", body: {} },
    );
    setMsg(
      r.ok
        ? `Test result: ${r.data.data.state}${r.data.data.detail ? ` — ${r.data.data.detail}` : ""}`
        : r.message,
    );
    router.refresh();
  }
  async function save() {
    const r = await clientApi(`/v1/providers/${p.provider}`, {
      method: "PUT",
      body: {
        standardModel: form.standardModel,
        premiumModel: form.premiumModel,
        standardEffort: form.standardEffort,
        premiumEffort: form.premiumEffort,
        dailyBudgetUsd: form.dailyBudgetUsd ? Number(form.dailyBudgetUsd) : null,
      },
    });
    setMsg(r.ok ? "Saved." : r.message);
    router.refresh();
  }

  return (
    <Panel
      title={subscription ? "Claude Code" : p.label}
      eyebrow={subscription ? "CLAUDE · Pro subscription" : p.provider}
      actions={
        <>
          {p.isMock && <MockBadge label="Mock" />}
          <StatusPill tone={meta.tone} label={meta.label} />
        </>
      }
    >
      <div className="space-y-3 text-[12.5px]" data-testid={`provider-${p.provider}`}>
        {p.detail && <p className="text-fg-muted">{p.detail}</p>}
        {subscription && NEEDS_SETUP.has(p.state) && <ClaudeCodeSetup state={p.state} />}
        {subscription ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2" data-testid="claude-code-facts">
            <div>
              <dt className="text-fg-faint">Authentication</dt>
              <dd className="font-medium">
                {p.state === "login_required" || p.state === "not_installed"
                  ? "Not signed in"
                  : p.cli?.subscriptionType
                    ? `${cap(p.cli.subscriptionType)} subscription`
                    : "Pro subscription"}{" "}
                <span className="text-fg-faint">(claude login)</span>
              </dd>
            </div>
            <div>
              <dt className="text-fg-faint">Transport</dt>
              <dd className="font-medium">{TRANSPORT_LABELS[p.transport]}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Status</dt>
              <dd className="font-medium">{meta.label}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Model</dt>
              <dd className="font-medium">
                {ALIAS_LABEL[p.standardModel ?? ""] ?? p.standardModel}
                <span className="text-fg-faint">
                  {" "}
                  · premium {ALIAS_LABEL[p.premiumModel ?? ""] ?? p.premiumModel}
                  {p.premiumAvailable === false
                    ? " (not available on this plan)"
                    : p.premiumAvailable === null
                      ? " (availability unknown)"
                      : ""}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-fg-faint">Billing</dt>
              <dd className="font-medium">Included subscription usage</dd>
            </div>
            <div>
              <dt className="text-fg-faint">API key</dt>
              <dd className="font-medium">Not used</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Last successful execution</dt>
              <dd className="font-medium">{formatDateTime(p.lastSuccessAt)}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Runs today</dt>
              <dd className="num font-medium">{p.runsToday}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Usage state</dt>
              <dd className="font-medium">
                {p.rateLimit
                  ? p.rateLimit.status === "rejected"
                    ? `Claude Pro usage limit reached${p.rateLimit.resetsAt ? ` · resets ${formatDateTime(p.rateLimit.resetsAt)}` : ""}`
                    : p.rateLimit.status === "allowed_warning"
                      ? "Approaching the usage limit"
                      : "Within usage limits"
                  : "Not reported yet"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-faint">Claude Code</dt>
              <dd className="font-medium">
                {p.cli?.version
                  ? /^\d/.test(p.cli.version)
                    ? `v${p.cli.version}`
                    : p.cli.version
                  : "—"}
                <span className="text-fg-faint"> · max {p.cli?.maxConcurrency ?? 1} at a time</span>
              </dd>
            </div>
          </dl>
        ) : configurable ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt className="text-fg-faint">Default model (standard)</dt>
              <dd className="font-medium">{p.standardModel}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Premium model</dt>
              <dd className="font-medium">{p.premiumModel}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Last health check</dt>
              <dd className="font-medium">{formatDateTime(p.lastHealthCheckAt)}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Last successful call</dt>
              <dd className="font-medium">{formatDateTime(p.lastSuccessAt)}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Calls today</dt>
              <dd className="num font-medium">{p.callsToday}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Spend today</dt>
              <dd className="num font-medium">{formatUsd(p.spendTodayUsd)}</dd>
            </div>
          </dl>
        ) : p.provider === "LOCAL" ? (
          <p className="text-fg-faint">
            Deterministic in-process logic for work that needs no AI — no model, no cost.
          </p>
        ) : (
          <p className="text-fg-faint">
            Not connected — arrives in a later stage. Never used as a silent fallback.
          </p>
        )}
        {p.prices.length > 0 && (
          <table className="w-full text-[11.5px]">
            <caption className={subscription ? "pb-1 text-left text-fg-faint" : "sr-only"}>
              {subscription
                ? `API list prices (USD / million tokens) — used only for the ${API_EQUIVALENT_LABEL}`
                : "Model prices (USD per million tokens)"}
            </caption>
            <thead className="text-fg-faint">
              <tr>
                <th className="text-left font-medium">Model</th>
                <th className="text-right font-medium">Input</th>
                <th className="text-right font-medium">Output</th>
                <th className="text-right font-medium">Cache write</th>
                <th className="text-right font-medium">Cache read</th>
              </tr>
            </thead>
            <tbody>
              {p.prices.map((x) => (
                <tr key={x.model + x.effectiveFrom}>
                  <td>{x.model}</td>
                  <td className="num text-right">${x.inputPerMTok}</td>
                  <td className="num text-right">${x.outputPerMTok}</td>
                  <td className="num text-right">${x.cacheWritePerMTok}</td>
                  <td className="num text-right">${x.cacheReadPerMTok}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {configurable && canManage && (
          <fieldset className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 sm:grid-cols-2">
            <legend className="px-1 text-[12px] font-medium">Model policy</legend>
            {(["standardModel", "premiumModel"] as const).map((k) => (
              <label key={k} className="text-[12px] text-fg-muted">
                {subscription
                  ? k === "standardModel"
                    ? "Standard model (Claude Code alias)"
                    : "Premium model (Claude Code alias)"
                  : k === "standardModel"
                    ? "Standard model id"
                    : "Premium model id"}
                <input
                  className={selectCls}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            {(["standardEffort", "premiumEffort"] as const).map((k) => (
              <label key={k} className="text-[12px] text-fg-muted">
                {k === "standardEffort" ? "Standard effort" : "Premium effort"}
                <select
                  className={selectCls}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value as EffortLevel })}
                >
                  {EFFORT_LEVELS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className={subscription ? "hidden" : "text-[12px] text-fg-muted"}>
              Provider daily budget (USD)
              <input
                className={selectCls}
                type="number"
                min={0}
                step="0.5"
                placeholder="No provider cap"
                value={form.dailyBudgetUsd}
                onChange={(e) => setForm({ ...form, dailyBudgetUsd: e.target.value })}
              />
            </label>
            <div className="flex items-end">
              <Button size="sm" onClick={() => void save()}>
                Save policy
              </Button>
            </div>
          </fieldset>
        )}
        {configurable && canTest && (
          <Button
            size="sm"
            icon={<PlugZap className="size-3.5" aria-hidden="true" />}
            onClick={() => void test()}
            disabled={!subscription && !p.connected}
          >
            {subscription ? "Test Claude Code" : "Test Claude connection"}
          </Button>
        )}
        {msg && (
          <p role="status" className="text-fg-muted">
            {msg}
          </p>
        )}
      </div>
    </Panel>
  );
}

export function ProviderSettings({ providers }: { providers: ProviderStatusDTO[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {providers.map((p) => (
        <ProviderCard key={p.provider} p={p} />
      ))}
    </div>
  );
}
