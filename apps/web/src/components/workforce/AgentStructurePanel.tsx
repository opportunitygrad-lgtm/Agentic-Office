"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AGENT_CAPABILITIES,
  CAPABILITY_LABELS,
  type AgentCapability,
  type AgentDTO,
} from "@aibos/shared";
import { Button, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";

const selectCls =
  "focus-ring h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg";

/**
 * Reporting lines and capabilities. Capabilities describe what an agent can
 * do; they never grant permission — Access & Authority governs that.
 */
export function AgentStructurePanel({
  agent,
  canEditHierarchy,
  canEditCapabilities,
}: {
  agent: AgentDTO;
  canEditHierarchy: boolean;
  canEditCapabilities: boolean;
}) {
  const router = useRouter();
  const [peers, setPeers] = useState<AgentDTO[]>([]);
  const [lines, setLines] = useState({
    reportsToAgentId: agent.reportsTo?.id ?? "",
    escalationAgentId: agent.escalationAgent?.id ?? "",
    fallbackManagerId: agent.fallbackManager?.id ?? "",
  });
  const [caps, setCaps] = useState<AgentCapability[]>(agent.capabilities);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canEditHierarchy) return;
    void clientApi<{ data: AgentDTO[] }>("/v1/agents").then((r) => {
      if (r.ok)
        setPeers(
          r.data.data.filter(
            (a) => a.id !== agent.id && !a.isTemporary && a.status !== "terminated",
          ),
        );
    });
  }, [agent.id, canEditHierarchy]);

  async function saveLines() {
    setMessage(null);
    const r = await clientApi(`/v1/agents/${agent.id}/hierarchy`, {
      method: "PUT",
      body: {
        reportsToAgentId: lines.reportsToAgentId || null,
        escalationAgentId: lines.escalationAgentId || null,
        fallbackManagerId: lines.fallbackManagerId || null,
      },
    });
    setMessage(r.ok ? "Reporting lines saved." : r.message);
    if (r.ok) router.refresh();
  }

  async function saveCaps() {
    setMessage(null);
    const r = await clientApi(`/v1/agents/${agent.id}/capabilities`, {
      method: "PUT",
      body: { capabilities: caps },
    });
    setMessage(r.ok ? "Capabilities saved." : r.message);
    if (r.ok) router.refresh();
  }

  const field = (key: keyof typeof lines, label: string, current: { name: string } | null) =>
    canEditHierarchy ? (
      <label className="block text-[12px] text-fg-muted">
        <span className="mb-1 block">{label}</span>
        <select
          className={selectCls}
          value={lines[key]}
          onChange={(e) => setLines({ ...lines, [key]: e.target.value })}
        >
          <option value="">None</option>
          {peers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    ) : (
      <div className="text-[12.5px]">
        <dt className="text-fg-faint">{label}</dt>
        <dd className="font-medium">{current?.name ?? "—"}</dd>
      </div>
    );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="eyebrow mb-2">Reporting hierarchy</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field("reportsToAgentId", "Reports to", agent.reportsTo)}
          {field("escalationAgentId", "Escalates to", agent.escalationAgent)}
          {field("fallbackManagerId", "Fallback manager", agent.fallbackManager)}
        </dl>
        {canEditHierarchy && (
          <Button size="sm" className="mt-2" onClick={() => void saveLines()}>
            Save reporting lines
          </Button>
        )}
      </div>
      <div>
        <h3 className="eyebrow mb-1">Capabilities</h3>
        <p className="mb-2 text-[11.5px] text-fg-faint">
          What the agent is able to do — separate from what it is permitted to do.
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Capabilities">
          {(canEditCapabilities ? AGENT_CAPABILITIES : caps).map((c) => {
            const on = caps.includes(c);
            return (
              <li key={c}>
                {canEditCapabilities ? (
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCaps(on ? caps.filter((x) => x !== c) : [...caps, c])}
                    className={cn(
                      "focus-ring rounded-md px-2 py-0.5 text-[12px] ring-1 ring-inset",
                      on
                        ? "bg-accent-soft text-accent ring-accent/40"
                        : "text-fg-faint ring-line hover:text-fg",
                    )}
                  >
                    {CAPABILITY_LABELS[c]}
                  </button>
                ) : (
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] ring-1 ring-inset ring-line">
                    {CAPABILITY_LABELS[c]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {canEditCapabilities && (
          <Button size="sm" className="mt-2" onClick={() => void saveCaps()}>
            Save capabilities
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="text-[12.5px] text-fg-muted">
          {message}
        </p>
      )}
    </div>
  );
}
