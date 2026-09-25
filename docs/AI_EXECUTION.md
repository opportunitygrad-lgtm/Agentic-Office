# AI execution (Stage 05)

How an agent run goes from a button press to a stored, audited result. The
application is the orchestrator: it compiles instructions, builds context,
routes, checks budgets, reserves cost, calls the provider once, validates the
output and records usage. Claude is a replaceable worker behind `AIProvider`.

## Surfaces

| Surface                   | Entry point                                     | Permission                                            |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Task → **Run with agent** | `POST /v1/tasks/:id/runs`                       | `task.execute` (company-scoped)                       |
| Agent chat                | `POST /v1/conversations/:id/messages`           | `agent.chat` + conversation owner                     |
| Live view / history       | `GET /v1/runs`, `/runs/:id`, `/runs/:id/stream` | `agent.run.view`                                      |
| Stop                      | `POST /v1/runs/:id/cancel`                      | `agent.run.stop`                                      |
| Settings → AI Providers   | `GET/PUT /v1/providers`                         | `provider.view` / `provider.settings.manage` (global) |
| Test Connection           | `POST /v1/providers/:p/test`                    | `provider.test` (global), 5 per 10 min per user       |

The API **only enqueues**. Every provider call happens in `apps/worker`
(BullMQ queue `agent-runs`). No request handler ever calls a model.

## Lifecycle

```
QUEUED → PREPARING → ROUTING → RUNNING → STREAMING → COMPLETED
                                     ↘ WAITING (retry back-off)
any active state → CANCEL_REQUESTED → CANCELLED
any state → FAILED | NEEDS_REVIEW (interrupted after the provider call began)
```

1. **API (`startTaskRun` / `startChatRun`)** — company scope check, eligibility
   (an assigned agent that serves the company, a routable provider, no active
   run), budget preflight, cost reservation, insert run, enqueue. Held under PostgreSQL advisory locks per company and globally so
   concurrent starts cannot both pass the budget or concurrency checks.
2. **Worker (`executeRun`)** — atomic `begin()` (`queued → preparing`; only one
   worker wins), compile instructions (Stage 04 compiler, unchanged), build the
   Context Pack (Stage 03 engine, unchanged) capped at the starting person's
   clearance, construct provider messages, persist `provider_call_started_at`,
   stream from the provider, durably save the raw response, validate, then
   finalize: result, usage-ledger row, reservation release, audit events.
3. **Streaming** — events and text chunks are written to `agent_run_events`
   and published on Redis `aibos:run:<id>`. `GET /runs/:id/stream` (SSE) sends
   a snapshot first, then live messages; the web client falls back to polling.

## Routing (`packages/provider-core/src/router.ts`)

Deterministic priority order, each step recorded in `route.reasons`:

1. **LOCAL** for deterministic work (`data.update`, `analytics.calculate`).
2. Task provider requirement (must be allowed and connected, or blocked).
3. Agent primary provider.
4. Company preferred provider (`companies.default_provider`).
5. Capability (reasoning) and availability.
6. Budget (preflight, below).
7. Model tier.
8. Approved fallback — only when the company AI policy sets `fallbackAllowed`.
   OpenAI and Grok are placeholders that fail with `PROVIDER_NOT_CONFIGURED`;
   nothing ever falls back silently.

### Model tiers

| Tier     | Model (default ID, env-configurable)                                                                  | Effort (env)                       |
| -------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| STANDARD | `claude-sonnet-5` (`CLAUDE_DEFAULT_MODEL`)                                                            | `medium` (`CLAUDE_DEFAULT_EFFORT`) |
| PREMIUM  | `claude-opus-5-5` (`CLAUDE_PREMIUM_MODEL`)                                                            | `high` (`CLAUDE_PREMIUM_EFFORT`)   |
| AUTO     | PREMIUM only for tasks flagged `high_complexity` when the company permits premium; otherwise STANDARD |

Tier is taken from: run request → task → agent → company default. PREMIUM
requires `premiumAllowed` on the company AI policy, otherwise the run is
blocked ("Premium model not permitted by company policy"). The model never
chooses its own model and nothing upgrades to Opus automatically. An agent's
`defaultEffort` may lower effort but never raise it above the tier's effort.

## Provider messages and prompt-injection boundaries

`packages/execution-core/src/messages.ts`:

- **System block 1 (cached):** execution frame + platform/global rules. States
  that only system content carries authority and that everything inside data
  tags is information, never instructions.
- **System block 2 (cached):** company / department / template / agent rules,
  limits and resolved conflicts from the compiled instruction pack.
- **User content:** `<company_context trust="data">` (cached), then the
  `<task>` block, or for chat `<conversation_history>` (last
  `CHAT_HISTORY_MAX_MESSAGES`, default 12) and `<user_message>`.
- `fenceContent` neutralises any data-tag look-alikes inside content.
- No tools are sent. Only text blocks are read; thinking blocks are never
  stored, streamed or shown.

Isolation happens in our software: the Context Pack only ever contains the
run's company, filtered to `min(agent clearance, starting person's
clearance)`. We never rely on the model to refuse leakage.

### Structured result

Task runs request `output_config.format` JSON schema
(`AGENT_EXECUTION_RESULT_JSON_SCHEMA`) and validate with the strict Zod schema
`agentExecutionResultSchema`: status `COMPLETED | NEEDS_HUMAN | BLOCKED`,
summary, result, assumptions, open questions, proposed knowledge drafts,
proposed handoffs. Proposals are stored (knowledge as DRAFT/unverified,
handoffs audited) and previewed only — never executed and no multi-agent
cascade. Invalid JSON fails the run (`INVALID_OUTPUT`) without retry.

### Output detail

`SHORT 1,500 · NORMAL 4,000 · DETAILED 12,000` max output tokens, `CUSTOM`
capped at 32,000 and by the company policy's `maxResponseDetail`.

## Cost accounting

- **Price table** `ai_model_prices`, verified from the official pricing page
  <https://platform.claude.com/docs/en/about-claude/pricing> on **2026-09-25**
  (per million tokens):

  | Model           | Input | Output | Cache write (5 min) | Cache read |
  | --------------- | ----- | ------ | ------------------- | ---------- |
  | Claude Sonnet 5 | $2.00 | $10.00 | $2.50               | $0.20      |
  | Claude Opus 5.5 | $4.00 | $20.00 | $5.00               | $0.20      |

  A model without a price is blocked ("cost cannot be controlled").

- **Estimate before the call:** input ≈ chars/4 of the actual constructed
  request, output = the run's max output tokens (worst case).
- **Budget preflight** (`evaluateBudget`, shared with the Stage 04 delegation
  engine): task max budget, agent daily, company daily and monthly, provider
  daily, global daily (`workforce_policy.global_daily_ai_budget_usd`). Spent =
  live usage + active reservations. Result ALLOW / REQUIRE_APPROVAL (above the
  high-cost threshold → approval request, no run) / BLOCK. The provider is
  never called first.
- **Reservation:** the estimate is reserved on the run and released at
  finalization (`reservation_status`).
- **Actual cost** from the SDK usage (input, output, cache creation, cache
  read) × the price snapshot stored on the usage row. Mock runs are written
  with `origin = 'dev_seed'` and never count as spend.
- **Prompt caching:** `cache_control: ephemeral` on the stable prefix
  (system blocks and company context). Cache tokens are recorded per call.
  Sonnet 5's minimum cacheable prefix is 1,024 tokens.

## Retries, timeouts and cancellation

- SDK `maxRetries: 0`; our loop retries **at most once**, only for
  `RATE_LIMITED`, `OVERLOADED`, `SERVER_ERROR`, `NETWORK_ERROR` (typed SDK
  error classes — no string matching), honouring `retry-after` (capped 30 s).
  Timeouts are not retried.
- Every call has a timeout (`AI_PROVIDER_TIMEOUT_MS`, default 180 s).
- **Stop** sets `CANCEL_REQUESTED`, publishes on `aibos:run-cancel`; the worker
  aborts the in-flight request through its `AbortSignal`, releases the
  reservation and the task claim. An aborted stream returns no usage, so no
  ledger row is written for it (tokens generated before the abort may still be
  billed by Anthropic — see Known limitations).
- **Duplicates:** partial unique indexes allow one active run per task and
  per conversation; idempotency keys return the existing run.
- **Claims/leases:** the worker renews the run lease while it runs.
- **Recovery (single worker assumed):** on start, runs that never reached the
  provider are re-queued; runs whose provider call had started but whose
  response was not saved become `NEEDS_REVIEW` (never re-paid automatically);
  runs with a saved response are finished without a new call.

## Credentials

`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` (bearer), optional
`ANTHROPIC_WORKSPACE_ID`, read only by the API/worker processes from the
environment. Never stored in PostgreSQL, returned by the API, rendered in
HTML, logged or committed. Without a credential the provider reports
`NOT_CONFIGURED` (not an error) with: _"Anthropic credential not configured.
Add ANTHROPIC_API_KEY or an approved bearer credential to the local .env and
restart the services."_

## Provider modes and live tests

- `AIBOS_AI_PROVIDER_MODE=mock` uses the deterministic `MockClaudeProvider`
  (refused when `NODE_ENV=production`). Default is `live`.
- `pnpm test` and `pnpm test:e2e` never call a live provider; the E2E
  execution spec skips itself unless the stack runs in mock mode.
- `pnpm test:claude-live` runs one connection test, one Sonnet smoke task and
  one scoped chat — only with `ALLOW_LIVE_AI_TESTS=true` and a credential
  present (exit 2 / exit 3 otherwise). It never uses Opus.

## Health states

`NOT_CONFIGURED · AVAILABLE · DEGRADED · RATE_LIMITED · AUTH_ERROR · UNAVAILABLE`,
derived from connection tests and call outcomes (`consecutive_failures`).
`NOT_CONFIGURED` does not turn system health red.

## Known limitations

- Recovery assumes a single worker process; multi-worker lease stealing is
  a later-stage concern.
- Tokens generated before a user presses Stop are not recorded (the aborted
  stream reports no usage).
- The input estimate is character-based (≈4 chars/token); the actual count
  comes from the provider's usage after the call.
