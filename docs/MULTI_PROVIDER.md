# Multi-provider routing & second-opinion review (Stage 06)

How AI Business OS chooses which AI provider runs a task, and how one
provider can independently critique another's completed work. Builds on
[AI_EXECUTION.md](AI_EXECUTION.md) (execution lifecycle) and
[ARCHITECTURE.md](ARCHITECTURE.md) (provider abstraction); this document is
the routing/review-specific detail.

## Providers, today

| Provider | Transport (default) | Auth | Billing | Status |
|---|---|---|---|---|
| **CLAUDE** | `claude_code_cli` | subscription login (`claude login`) | subscription | live |
| **OPENAI** | `codex_cli` | subscription login (`codex`) | subscription | live |
| **GROK** | — | — | — | not connected (Stage 07) |
| **LOCAL** | `local` | none | none | deterministic logic, no AI |

Both real providers implement the identical `AIProvider` contract (see
[ARCHITECTURE.md](ARCHITECTURE.md#provider-abstraction)). Nothing above the
provider — router, executor, run store, SSE, UI — branches on which one is
running; only `transport`/`billingMode` metadata differs, and both default to
the owner's own subscription login, never an API key.

## Single-provider by default

A normal task, chat message, or run uses **exactly one** provider. The
application never calls two providers for the same piece of work
automatically. A second provider only gets involved when:

1. A person explicitly asks for one, for this run only (`requestedProvider`
   on a task run, chat message, or the Run preview's provider selector), or
2. A person explicitly requests a **second opinion** on a *completed* run, or
3. (Future) a deterministic company review policy requires one for certain
   task types, or a high-value threshold is crossed — `reviewMode` supports
   this (`policy_required`, `high_value_only`) but no automatic enforcement is
   built yet; `reviewMode` today only gates whether the UI/API *offers* a
   manual review action.

## Provider routing

`routeExecution()` (`packages/provider-core/src/router.ts`) is a pure,
deterministic function — no AI participates in choosing a provider. Priority,
in order:

1. **LOCAL** for deterministic-only work (no model needed at all).
2. **Task's hard `providerRequirement`** — if a task type is pinned to a
   provider, that always wins; blocked (not silently substituted) if that
   provider isn't allowed or isn't available.
3. **`requestedProvider`** — an explicit person choice for this one run,
   still checked against company `allowedProviders` and live availability.
   Never applies when the task has a hard requirement.
4. **Agent's primary provider**, then **company's preferred provider** —
   whichever is allowed and usable.
5. **Model tier** (standard/premium/auto) within the chosen provider.
6. **Approved fallback** — only if company policy explicitly permits
   `fallbackAllowed` and the primary is unavailable; the fallback is always a
   *different configured provider*, never an automatic switch from
   subscription to API billing for the same provider.

`company_ai_policies.provider_selection` adds one more layer *before* step 4:
`"fixed"` (default) uses the company's stored preferred provider as-is;
`"auto"` resolves it at request time to whichever of CLAUDE/OPENAI reports
`.available()` (CLAUDE first, a deterministic tie-break — never workload- or
cost-based yet).

A run is re-planned at execution time (worker pickup, retry after a restart)
with the *same* `requestedProvider` it originally resolved to, so recovery
never silently reroutes a run to a different provider than the one a person
saw and expected.

## No automatic fallback between billing modes

Provider unavailability (login expired, usage limit reached, model
unavailable, CLI too old) blocks the run with a clear reason — it never
triggers a silent switch to a different transport or to API-key billing for
the same logical provider. Management decides what happens next (retry later,
switch provider explicitly, wait for the reset).

## Second-opinion review

A **second opinion** is an independent critique of a *completed* run's result
by a *different* provider — never a rewrite, never a merge, never a verdict on
which provider is "better".

### Request → execution → storage

```
POST /v1/runs/:id/review  (permission ai.review.request, body: {reviewerProvider?, force?})
  → requestSecondOpinion()
    - loads and validates the reviewed run (must be a completed, primary,
      TASK run — chat runs and reviews-of-reviews are rejected)
    - blocks a provider reviewing its own result
    - caps context to min(the original run's own viewer clearance, the
      requester's clearance) — a review can never see more than the original
      run was allowed to see, regardless of who asks for it
    - deduplicates: an in-flight review for the same (run, reviewer provider)
      is always reused; a completed one is reused unless `force: true`
      requests a manual rerun; `force` never bypasses an in-flight one
    - enforces company_ai_policies.max_reviews_per_task (a hard cap on total
      stored reviews per run, force included)
    - creates a new agent_runs row (run_purpose = 'second_opinion',
      reviewed_run_id set, same provider-selection/budget path as any run)
      and an agent_run_reviews row (reviewed_run_id, reviewer_run_id,
      reviewer_provider, requested_by_user_id) for fast dedup/history queries
  → enqueued like any other run → executeRun() (same executor, same lifecycle,
    same events) → RunStore.validateStructured() picks providerReviewSchema
    (not agentExecutionResultSchema) because the run's own runPurpose says so
  → on completion, a REVIEW_COMPLETED event is published on the *original*
    run's own event stream (not just the reviewer run's), so a live view of
    the primary run can show "second opinion completed"
```

### What the reviewer sees — and never sees

The reviewer receives the **same isolated Context Pack** the original
provider received (rebuilt fresh, capped as above), the original task, and
the original run's final `summary`/`response` — nothing else. It never
receives:

- the original provider's hidden reasoning (never stored in the first place —
  see [AI_EXECUTION.md](AI_EXECUTION.md) for why reasoning is never persisted
  or streamed for either provider),
- the original provider's identity, reputation, or any instruction to "find
  faults" or rank the two systems,
- any data the original run itself was not cleared to see.

`buildReviewInput()` (`packages/execution-core/src/messages.ts`) uses a
dedicated `REVIEW_FRAME` system prompt — explicitly neutral, explicitly bans
ranking language ("never rank or declare a 'winner'"), and fences the
original task/result exactly like any other untrusted data block (the same
prompt-injection boundary used for task/chat input).

### `ProviderReview` shape

```ts
{
  agreementPoints: string[];
  disagreementPoints: string[];
  possibleErrors: string[];
  missingConsiderations: string[];
  unsupportedClaims: string[];
  risks: string[];
  suggestedCorrections: string[];
  confidence: "low" | "medium" | "high";
  overallReviewSummary: string;
}
```

Deliberately has no ranking/winner field. It is AI-generated analysis, not
company truth: it can propose a correction or flag a risk, but it never
automatically alters approved knowledge, company policy, financial rules, or
sends anything externally, and it never triggers a further review on its own
(no recursive review chains — a review run can itself never be the subject of
`requestSecondOpinion`).

### UI

- A completed primary run shows **"Ask {the other provider} to review"**
  when the viewer holds `ai.review.request` for that company — gated purely
  by permission; there is no "policy required" enforcement yet beyond
  offering the action.
- Once a review exists, the button is replaced by a **review card**, visually
  separated from the original result (own bordered/tinted section, its own
  "Second opinion" heading) — the original result's own text is never edited.
- A **SECOND OPINION** badge marks a review's own run wherever it shows up in
  run history, so it's never mistaken for the primary attempt.
- Company Settings → AI operations policy has a "Second opinion (independent
  review)" section: provider selection mode, review mode, preferred reviewer,
  max reviews per run. Agent Settings has a "Preferred reviewer" field.

### Usage & cost accounting

A review run is billed exactly like any other run on its provider: if the
reviewer is on a subscription transport, `billingMode = 'subscription'`,
`actualCost = null` (N/A), and an optional NOT-BILLED API-equivalent estimate
only. It consumes that provider's own operational limits (runs/day,
concurrency) like any other run — reviews are not exempt from those caps, and
`max_reviews_per_task` exists specifically so a company can bound how much
subscription usage second opinions can consume.

## Cross-company isolation & prompt-injection

A review is planned and context-built exactly the way the original run was —
same `buildContextPack()`, same sensitivity capping, same fenced
`trust="data"` blocks — so the isolation and injection-resistance tests that
apply to a normal run apply identically to a review (see
[SECURITY.md](SECURITY.md)). An EPT review task can never see Opportunitygrad
data; injected "ignore your review instructions" text inside a task
description or the original result stays fenced as data, never reaching
system-prompt authority.

## Future: Grok & three-provider review (Stage 07, not built)

`review-core`'s data model (`sourceRun`, `reviewProvider`, `reviewResult`) is
provider-neutral by construction — nothing hardcodes "Claude vs OpenAI". A
third real provider or a third-way review only needs a new `AIProvider`
implementation and registry entry; the router, executor, `RunStore`, and
review-request/dedup logic need no changes. Not started in this stage.
