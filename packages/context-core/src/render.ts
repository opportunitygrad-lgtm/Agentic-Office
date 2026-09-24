import {
  KNOWLEDGE_SOURCE_LABELS,
  VERIFICATION_LABELS,
  type AgentContextPack,
  type ContextKnowledgeEntry,
  type ContextRuleEntry,
} from "@aibos/shared";

/**
 * Deterministic plain-text rendering of a Context Pack — the exact text a
 * future provider adapter would receive. Budgets are measured against it.
 */

export const renderLine = (label: string, value: string): string => `${label}: ${value}\n`;

export function renderRule(r: ContextRuleEntry): string {
  return `- [${r.severity.toUpperCase()}]${r.global ? " [GLOBAL]" : ""} ${r.title}: ${r.description}${
    r.detail ? ` (${r.detail})` : ""
  }\n`;
}

export function renderKnowledge(k: ContextKnowledgeEntry): string {
  const verified = k.lastVerifiedAt ? `, last verified ${k.lastVerifiedAt.slice(0, 10)}` : "";
  const flags = k.warnings.length ? ` ⚠ ${k.warnings.join("; ")}` : "";
  return `- [${k.id}] ${k.title} — source: ${KNOWLEDGE_SOURCE_LABELS[k.sourceType]}, ${
    VERIFICATION_LABELS[k.verificationStatus]
  }${verified}${flags}\n  ${k.snippet}\n`;
}

const section = (title: string, body: string) => (body ? `## ${title}\n${body}\n` : "");

export function renderAgent(pack: Pick<AgentContextPack, "agent">): string {
  const a = pack.agent;
  return (
    renderLine("Agent", `${a.name} (${a.templateKey})`) +
    renderLine("Department", a.department ?? "—") +
    renderLine("Reports to", a.reportsTo ?? "—") +
    renderLine("Autonomy", a.autonomyLabel) +
    renderLine("Allowed", a.allowed.join(", ") || "none") +
    renderLine("Requires approval", a.approvalRequired.join(", ") || "none")
  );
}

export function renderTask(pack: Pick<AgentContextPack, "task">): string {
  const t = pack.task;
  if (!t) return renderLine("Task", "None — standing context only");
  return (
    renderLine("Task", `${t.title} [${t.type}, ${t.priority} priority, ${t.status}]`) +
    (t.objective ? renderLine("Objective", t.objective) : "") +
    (t.parent ? renderLine("Parent task", t.parent.title) : "") +
    (t.root && t.root.id !== t.id ? renderLine("Root task", t.root.title) : "") +
    renderLine("Expected output", t.expectedOutput)
  );
}

export function renderContextPack(pack: AgentContextPack): string {
  const lines = (list: { label: string; value: string }[]) =>
    list.map((l) => renderLine(l.label, l.value)).join("");
  const rules = [...pack.rules.compliance, ...pack.rules.commercial, ...pack.rules.brand];
  return [
    section("SYSTEM IDENTITY", renderAgent(pack)),
    section(
      "COMPANY",
      lines(pack.company.lines) +
        (pack.company.extendedIncluded ? lines(pack.company.extended) : ""),
    ),
    section("CURRENT TASK", renderTask(pack)),
    section("COMPANY RULES", rules.map(renderRule).join("") + lines(pack.rules.aiPolicy)),
    section("RELEVANT KNOWLEDGE", pack.knowledge.map(renderKnowledge).join("")),
    section(
      "UNVERIFIED CONTEXT (NOT AUTHORITATIVE — verify before relying on it)",
      pack.unverified.map(renderKnowledge).join(""),
    ),
    section(
      "PROHIBITED ACTIONS",
      pack.prohibitedActions.map((p) => `- ${p.action} (${p.source})\n`).join(""),
    ),
    section(
      "REQUIRED APPROVALS",
      pack.requiredApprovals.map((p) => `- ${p.action}: ${p.requirement} (${p.source})\n`).join(""),
    ),
  ].join("");
}

/** Rough token estimate for budgeting (≈ 4 characters per token). */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);
