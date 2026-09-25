"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlugZap } from "lucide-react";
import { EFFORT_LEVELS, formatUsd, type EffortLevel, type ProviderStatusDTO } from "@aibos/shared";
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
};

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
      title={p.label}
      eyebrow={p.provider}
      actions={
        <>
          {p.isMock && <MockBadge label="Mock" />}
          <StatusPill tone={meta.tone} label={meta.label} />
        </>
      }
    >
      <div className="space-y-3 text-[12.5px]" data-testid={`provider-${p.provider}`}>
        {p.detail && <p className="text-fg-muted">{p.detail}</p>}
        {configurable ? (
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
            <caption className="sr-only">Model prices (USD per million tokens)</caption>
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
                {k === "standardModel" ? "Standard model id" : "Premium model id"}
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
            <label className="text-[12px] text-fg-muted">
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
            disabled={!p.connected}
          >
            Test Claude connection
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
