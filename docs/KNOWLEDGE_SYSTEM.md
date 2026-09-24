# Knowledge system & Agent Context Engine (Stage 03)

The company's permanent memory lives in the database. AI conversations are
**not** a source of truth, and agents never receive the whole database or a
conversation history: they receive an **Agent Context Pack** assembled
deterministically for one `COMPANY + AGENT + TASK + PERMISSIONS`.

```
Task ─► Context Engine (@aibos/context-core) ─► AgentContextPack ─► AI provider (Stage 07+)
            ▲
            │ loadContextSources (@aibos/db): company profile, AI policy, rules,
            │ agent authority, knowledge (company + GLOBAL only), links, access policies
```

Providers must never query company tables themselves; they receive the pack
(`renderContextPack(pack)` is the exact provider text).

## Source-of-truth rule

- The database holds authoritative company state.
- AI output does not become authoritative because an AI produced it. It enters
  as **DRAFT** knowledge with verification **UNVERIFIED**.
- AI/system sources (`claude_research`, `openai_research`, `grok_research`,
  `system_generated`) can never be `management_confirmed` (Zod + a database
  check constraint), and cannot be approved until a human sets an explicit
  verification level (`partially_verified` or `verified`).

## Knowledge items

`knowledge_items` — one row per version. Scope `company` (with `company_id`)
or `GLOBAL` (`company_id` NULL; only `knowledge.global.manage` can create,
approve or archive it).

| Field group | Fields                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Content     | title, summary (used as the agent snippet), content, type (25), category, tags, department                     |
| Provenance  | source type (13), source reference / URL / file reference, owner, provenance notes                             |
| Trust       | confidence (low/medium/high), verification (unverified → management_confirmed), sensitivity                    |
| Lifecycle   | status, version, lineage, supersedes / superseded by, created / updated / approved by, submitted / archived at |
| Freshness   | effective at, review at, expires at, last verified at                                                          |
| Conflicts   | conflict key (subject such as `pricing:training-fees`)                                                         |

### Lifecycle

```
DRAFT ──submit──► REVIEW ──approve──► APPROVED ──(new version approved)──► SUPERSEDED
  ▲                  │ reject                │ supersede / archive
  └──────────────────┘                       ▼
                                          ARCHIVED
```

Only **APPROVED** items instruct agents. DRAFT/REVIEW research explicitly
marked `usable_as_unverified` may appear — in a separate, clearly-labelled
**UNVERIFIED CONTEXT** section — only when the task allows it
(`tasks.allow_unverified_context`).

### Versioning

- Drafts and review items are edited in place (editing a review item returns it to draft).
- A **material** change (title, summary, content, type, source, sensitivity,
  validity, conflict key, department) to an APPROVED item creates a new DRAFT
  version in the same lineage. The approved version stays in force until the
  new one is approved; it then becomes SUPERSEDED automatically.
- Non-material edits to an approved item (tags, review date…) happen in place
  and require `knowledge.approve`.
- Database guarantees: at most one APPROVED and one open (draft/review)
  version per lineage (partial unique indexes).
- Task/agent links follow the lineage to the current approved version.

### Freshness

Derived, never stored: `current`, `review_due` (review date passed),
`expired` (expiry passed), `not_yet_effective`. The company AI policy decides
whether expired items are **excluded** or included **clearly marked STALE**.
Review-due items are included with a "Review overdue" warning.

### Precedence

| Tier | Meaning                                   |
| ---- | ----------------------------------------- |
| P1   | Management-approved rule or policy        |
| P2   | Approved company profile                  |
| P3   | Approved official company document / data |
| P4   | Approved operating procedure              |
| P5   | Verified company research                 |
| P6   | Verified external information             |
| P7   | Unverified research                       |
| P8   | Agent / model inference                   |

Rules tables and the company profile are always P1/P2. Tiers break ties in
the context budget and are shown on every item.

### Conflicts

Two APPROVED items with the same conflict key, same company (or both global),
different lineages, overlapping validity and different content are a
**POTENTIAL CONFLICT**. The UI surfaces them and offers "keep this / keep the
other" (supersede). The engine never chooses: conflicting items carry a warning
telling the agent to escalate to a human.

## Rules

- **Brand rules** — category (voice, tone, claims…), channel, severity.
- **Commercial rules** — category, `applies_to` action key, effect
  (`info` / `limit` / `require_approval` / `prohibit`), limit amount, currency,
  period, required approval permission. Example (dev seed): Opportunitygrad
  `meta.budget_increase` limit INR 100 per day → above requires `approval.financial`.
- **Compliance rules** — IF `action` (exact, `domain.*` or `*`) [jurisdiction]
  THEN `require_approval` / `prohibit` / `require_disclosure` / `info`.

Rules are DRAFT until approved (`policy.approve`); only approved + active
rules bind agents. Editing an approved rule without approval rights returns it
to draft. `evaluateCompanyAction(rules, { companyId, action, amount, currency, periodTotal })`
gives future execution controllers (Meta, email…) a deterministic decision.

## Sensitivity & agent knowledge access

`PUBLIC` · `INTERNAL` · `CONFIDENTIAL` · `RESTRICTED`.

- Agents read PUBLIC + INTERNAL approved knowledge of their company by default.
  CONFIDENTIAL/RESTRICTED needs a `knowledge_access_policies` row for the
  agent, its department, or all company agents.
- Humans need `knowledge.confidential.read` / `knowledge.restricted.read`.
  Items above a viewer's clearance are hidden from lists, return 403 (audited)
  on direct access, and are **redacted** in context previews even when the
  agent may see them. Nobody can grant agents more than their own clearance.

## Context assembly

1. **Isolation.** Candidates come only from the retriever (company + GLOBAL +
   explicit links). Any item or rule of another company — even if linked to
   the task — is blocked and reported without its title.
2. **Eligibility.** Status, freshness policy, effective date and agent sensitivity clearance.
3. **Relevance (deterministic, with reasons).** Explicit task link (+100),
   explicit request (+100), agent link (+80), required type for the agent
   (+40), requested category (+30), matching department (+20), matching tags
   (+10 each, max 30), task-type fit (+15), task wording (+5 each, max 20),
   company-wide rule (+10) / global policy (+15). Threshold 15 unless explicit.
4. **Rules.** Critical rules and restrictions (commercial/compliance effects
   other than `info`) are **mandatory**; other rules are included when they
   match the agent profile, channel or area of work.
5. **Budget.** SMALL ≈ 6k, STANDARD ≈ 16k, LARGE ≈ 40k characters (≈ 4
   chars/token) or CUSTOM. Mandatory content (identity, task, permissions,
   prohibitions, approvals, mandatory rules) is never dropped — if it alone
   exceeds the budget the pack is flagged `overBudget`. Droppable content is
   added in priority order: company business detail → required rules →
   task-linked knowledge → agent-linked → verified relevant → other relevant →
   unverified research → informational rules. Once one item does not fit,
   everything of lower priority is dropped.
6. **Metadata.** Generated at, context version, approximate size, included
   ids, excluded count, stale count, dropped-for-budget, blocked cross-company.

Agent default knowledge comes from the template profile
(`TEMPLATE_KNOWLEDGE` in `@aibos/agent-core`) plus optional per-agent additions
(`agent_knowledge_profiles`).

## Future contracts (interfaces only)

- `KnowledgeRetriever` — the Postgres deterministic retriever ships now;
  embeddings / vector search can replace candidate generation later without
  changing the engine, and must keep the company isolation guarantee.
- `KnowledgeIngestionAdapter` — `ingest()`, `normalize()`, `extractMetadata()`,
  `createKnowledgeDraft()` for files, Outlook, Drive/Sheets, websites, Meta,
  WordPress and Claude/OpenAI/Grok research. Adapters only ever create DRAFTs.
  No live ingestion, scraping or file parsing exists in Stage 03.
