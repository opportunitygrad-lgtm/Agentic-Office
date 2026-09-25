# AI execution (Stage 05 / 05A / 06)

How an agent run goes from a button press to a stored, audited result. The
application is the orchestrator: it compiles instructions, builds context,
routes, checks limits, calls the provider once, validates the output and
records usage. Claude is a replaceable worker behind `AIProvider`.

## Claude transport (Stage 05A): Claude Code subscription by default

**CLAUDE** is one logical provider with two transports, chosen only by
configuration (`CLAUDE_TRANSPORT`), never at runtime:

| `CLAUDE_TRANSPORT`       | Transport         | Authentication                                                          | Billing                         |
| ------------------------ | ----------------- | ----------------------------------------------------------------------- | ------------------------------- |
| `claude_code` (default)  | `CLAUDE_CODE_CLI` | `SUBSCRIPTION_LOGIN` — owner's Claude Pro login in official Claude Code | `SUBSCRIPTION` (included usage) |
| `anthropic_api` (opt-in) | `ANTHROPIC_API`   | `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`                            | `API` (dollar-billed)           |

There is **no fallback** between them. If the subscription limit is reached,
the login expires or Claude Code is unavailable, runs fail with
`SUBSCRIPTION_LIMIT_REACHED`, `LOGIN_EXPIRED`/`LOGIN_REQUIRED` or the matching
provider state — management decides what happens next. No API key is required
for normal operation.

### Runtime flow (local-first)

```
Browser dashboard → API (authorise, route, limits, enqueue — never calls a model)
  → Redis/BullMQ `agent-runs` → Worker (same Mac / user account as `claude login`)
  → ClaudeCodeProvider (packages/provider-core/src/claude-code.ts)
  → spawn("claude", [args…], { shell: false }) — prompt on stdin
  → official Claude Code → Claude Pro subscription
  ← stream-json → normalised run events → Redis → SSE → dashboard
```

### Authentication — owned entirely by Claude Code

The owner authenticates once in Terminal:

```bash
unset ANTHROPIC_API_KEY
unset ANTHROPIC_AUTH_TOKEN
claude logout
claude login        # choose the Claude Pro subscription
```

The Business OS has **no Claude login form**, never asks for a password,
cookies or tokens, never reads `.credentials.json`, the macOS Keychain or
any Claude credential file, and never stores Claude OAuth credentials. The
only interface is executing the official `claude` binary:

- `claude --version` → installed? (`NOT_INSTALLED` otherwise)
- `claude --help` → which isolation flags this version supports
  (`MISCONFIGURED` if `--tools`, `--system-prompt`, `--no-session-persistence`
  … or both `--safe-mode`/`--restricted` are missing → "Run: claude update")
- `claude auth status --json` → `loggedIn`, `authMethod`, `apiProvider`
  (`LOGIN_REQUIRED` when not logged in; `MISCONFIGURED` when signed in with an
  API key or a third-party provider)

Test Connection (**TEST CLAUDE CODE**) runs only these local checks — it
uses no model call and no subscription usage.

### Invocation (reasoning only)

Verified against Claude Code 2.1.282 (`claude --help`); optional flags are
added only when the installed version advertises them:

```
claude --print --output-format stream-json --verbose --include-partial-messages
       --model sonnet --effort medium
       --tools ""  --strict-mcp-config  --safe-mode  --restricted
       --disable-slash-commands  --permission-prompts none
       --no-session-persistence  --system-prompt <compiled rules>
```

- **No tools** (`--tools ""`): no Bash, file access, web, browser, MCP or
  external actions; no hooks, plugins, skills or user/project settings
  (`--safe-mode`, `--restricted`), in a private empty temp working directory.
- **No persistent Claude Code session**: our database is the conversation
  store; chat history is our own window (`CHAT_HISTORY_MAX_MESSAGES`).
- `--system-prompt` carries the compiled system blocks (authority); company
  context, task and chat history are written to **stdin** as fenced data.
  `--system-prompt-file` is used instead when the CLI supports it.
- Model/effort arguments are validated (alias must start alphanumeric, so it
  can never be read as a flag; effort is an enum);
  task/company/user text never appears in argv and is never shell syntax.
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` carries the run's output-detail limit.

### Child environment (API-key precedence and base-URL safety)

The child gets an **allowlisted** environment (PATH, HOME, USER, locale,
TMPDIR, XDG dirs, `CLAUDE_CONFIG_DIR`, proxy/CA settings). Never inherited:
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` (they would override the
subscription login), OAuth token variables, third-party provider switches,
`ANTHROPIC_BASE_URL` (unless `CLAUDE_CODE_ALLOW_BASE_URL=true`) and all
application secrets (`DATABASE_URL`, `SESSION_SECRET`, …). The user's shell
environment is not modified. As a second guard, the run is aborted with
`API_BILLING_REFUSED` if Claude Code's `init` message reports an
`apiKeySource` other than `none`/`oauth` — before any model request.

### Streaming, errors and cancellation

`stream-json` lines are normalised into the existing run events: text deltas →
`OUTPUT_CHUNK`/streaming (thinking deltas are dropped), `result` → usage and
completion. Claude Code's typed errors map to stable codes:
`authentication_failed` → `LOGIN_EXPIRED` (or `LOGIN_REQUIRED` if
`auth status` says logged out), `rate_limit`/`billing_error` →
`SUBSCRIPTION_LIMIT_REACHED` (provider `RATE_LIMITED`, reset time shown),
`model_not_found` → `MODEL_UNAVAILABLE` (premium marked unavailable, Sonnet
unaffected), `overloaded`/`server_error` → degraded. Claude Code's own retry
counts as our one retry; a second internal retry kills the process. Usage
limits are never retried and never trigger a credit purchase or API switch.

**Stop** aborts the run's `AbortSignal` → `SIGTERM` to the child, `SIGKILL`
after 3 s; timeouts do the same. Every child is tracked: worker shutdown and
process exit terminate them (no orphans). Tests verify the process is gone.

### Concurrency and operational limits

`CLAUDE_CODE_MAX_CONCURRENCY` (default **1**): the worker's `agent-runs`
concurrency and an in-process semaphore — other runs wait QUEUED. Instead of
per-call dollars, subscription runs are bounded by runs per task per day
(`CLAUDE_CODE_MAX_RUNS_PER_TASK_DAY`, 10), runs per agent per day
(`CLAUDE_CODE_MAX_RUNS_PER_AGENT_DAY`, 40), request size
(`CLAUDE_CODE_MAX_INPUT_TOKENS`, 60 000), at most one retry and the company
model/premium policy. Dollar budgets and approvals remain for API mode.

### Usage accounting

Subscription runs are **not API spend**: the run's `actual_cost` is NULL
(N/A) and the ledger row has `actual_cost = 0`, `billing_mode =
'subscription'`, `transport = 'claude_code_cli'`, the reported tokens (incl.
cache), duration, resolved model and the rate-limit state. A database check
constraint rejects any subscription row with a non-zero cost. An optional
`api_equivalent_cost` is stored for comparison and always labelled
**NOT BILLED — ESTIMATED API EQUIVALENT**. Dashboards show "CLAUDE ·
Subscription": runs, tokens, usage state — never "API cost".

### Local-first; cloud limitation

V1 runs the worker on the owner's Mac under the account that ran
`claude login`. A fresh server (e.g. DigitalOcean) has no Claude Code login;
it would need its own official authentication, which can expire and require
re-login. A later design may send jobs from a cloud Business OS to a secure
local Claude worker on the owner's Mac — **not built**.

### Product / terms boundary

This is a private, owner-operated system. It does not offer "Login with
Claude" to other users, does not redistribute or share the owner's
subscription, does not give customers subscription access, and is not an
Anthropic-approved third-party login integration. A future commercial or
multi-user product may require Anthropic approval or API-based
authentication.

## Surfaces

| Surface                   | Entry point                                     | Permission                                                                              |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Task → **Run with agent** | `POST /v1/tasks/:id/runs`                       | `task.execute` (company-scoped)                                                         |
| Agent chat                | `POST /v1/conversations/:id/messages`           | `agent.chat` + conversation owner                                                       |
| Live view / history       | `GET /v1/runs`, `/runs/:id`, `/runs/:id/stream` | `agent.run.view`                                                                        |
| Stop                      | `POST /v1/runs/:id/cancel`                      | `agent.run.stop`                                                                        |
| Settings → AI Providers   | `GET/PUT /v1/providers`                         | `provider.view` / `provider.settings.manage` (global)                                   |
| Test Connection           | `POST /v1/providers/:p/test`                    | `provider.test` (global), 5 per 10 min per user — local CLI checks only for Claude Code |

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

| Tier     | Claude Code (default)                                                                                 | Anthropic API (optional)                   | Effort                                                    |
| -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| STANDARD | alias `sonnet` (`CLAUDE_CODE_MODEL`)                                                                  | `claude-sonnet-5` (`CLAUDE_DEFAULT_MODEL`) | `medium` (`CLAUDE_CODE_EFFORT` / `CLAUDE_DEFAULT_EFFORT`) |
| PREMIUM  | alias `opus` (`CLAUDE_CODE_PREMIUM_MODEL`)                                                            | `claude-opus-5-5` (`CLAUDE_PREMIUM_MODEL`) | `high`                                                    |
| AUTO     | PREMIUM only for tasks flagged `high_complexity` when the company permits premium; otherwise STANDARD |                                            |                                                           |

Subscription mode uses Claude Code aliases, not API model IDs; the model the
alias resolved to is recorded from Claude Code's output. The plan may not
include Opus: a `MODEL_UNAVAILABLE` result marks premium unavailable on the
provider card without affecting Sonnet work.

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

API transport: task runs request `output_config.format` JSON schema. Claude
Code transport: the schema is appended to the system instructions ("respond
with ONLY one JSON object…"), the reply is parsed (bare JSON or one code
fence) and validated with the same strict schema — validation is not
weakened. Both
(`AGENT_EXECUTION_RESULT_JSON_SCHEMA`) and validate with the strict Zod schema
`agentExecutionResultSchema`: status `COMPLETED | NEEDS_HUMAN | BLOCKED`,
summary, result, assumptions, open questions, proposed knowledge drafts,
proposed handoffs. Proposals are stored (knowledge as DRAFT/unverified,
handoffs audited) and previewed only — never executed and no multi-agent
cascade. Invalid JSON fails the run (`INVALID_OUTPUT`) without retry.

### Output detail

`SHORT 1,500 · NORMAL 4,000 · DETAILED 12,000` max output tokens, `CUSTOM`
capped at 32,000 and by the company policy's `maxResponseDetail`.

## Cost accounting (API transport; API-equivalent for subscription)

- **Price table** `ai_model_prices`, verified from the official pricing page
  <https://platform.claude.com/docs/en/about-claude/pricing> on **2026-09-25**
  (per million tokens):

  | Model           | Input | Output | Cache write (5 min) | Cache read |
  | --------------- | ----- | ------ | ------------------- | ---------- |
  | Claude Sonnet 5 | $2.00 | $10.00 | $2.50               | $0.20      |
  | Claude Opus 5.5 | $4.00 | $20.00 | $5.00               | $0.20      |

  An API-billed model without a price is blocked ("cost cannot be
  controlled"). Subscription runs do not need a price; aliases map to these
  rows (`sonnet` → Sonnet 5, `opus` → Opus 5.5) only for the NOT BILLED
  estimate.

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

Default (Claude Code): none in this system — Claude Code holds its own login.
Optional API transport only: `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` (bearer), optional
`ANTHROPIC_WORKSPACE_ID`, read only by the API/worker processes from the
environment. Never stored in PostgreSQL, returned by the API, rendered in
HTML, logged or committed. Without a credential the provider reports
`NOT_CONFIGURED` (not an error) with: _"Anthropic credential not configured.
Add ANTHROPIC_API_KEY or an approved bearer credential to the local .env and
restart the services."_

## Provider modes and live tests

- `AIBOS_AI_PROVIDER_MODE=mock` uses the deterministic `MockClaudeProvider` /
  `MockCodexProvider` (refused when `NODE_ENV=production`). Default is `live`.
- `pnpm test` and `pnpm test:e2e` never call a live provider; the E2E
  execution spec skips itself unless the stack runs in mock mode.
- Automated tests use a **fake Claude Code binary**
  (`packages/provider-core/test/fixtures/fake-claude.mjs`) and a **fake Codex
  binary** (`packages/provider-core/test/fixtures/fake-codex.mjs`) — never the
  real `claude` / `codex` — so they consume zero subscription usage.
- `pnpm test:claude-subscription-live` (acceptance, default transport): only
  with `ALLOW_LIVE_AI_TESTS=true` (exit 2 otherwise). Checks binary, login,
  no API-key transport, then one short Sonnet task and one short chat;
  verifies streaming, result persistence, audit, `SUBSCRIPTION` usage and zero
  API cost. Never uses Opus.
- `pnpm test:claude-live`: the same for the optional API transport (needs
  `ALLOW_LIVE_AI_TESTS=true` and an API credential; exit 2 / exit 3).
- `pnpm test:openai-subscription-live` (acceptance, default OpenAI transport):
  only with `ALLOW_LIVE_AI_TESTS=true` (exit 2 otherwise; exit 4 if Codex is
  not installed/authenticated). Checks binary, login, no API-key transport,
  then one short Codex primary task and one short second-opinion review.
  The review's "original" result is a **stored fixture**, never a live Claude
  call — this test spends only Codex/ChatGPT subscription usage, never two
  providers' subscriptions at once.

## Health states

`NOT_CONFIGURED · AVAILABLE · DEGRADED · RATE_LIMITED · AUTH_ERROR · UNAVAILABLE`
plus, for CLI-transported providers (Claude Code, Codex), `NOT_INSTALLED ·
LOGIN_REQUIRED · LOGIN_EXPIRED · MISCONFIGURED`, derived from Test Connection
and call outcomes (`consecutive_failures`). Setup states (not checked, not
installed, login required) do not turn system health red. Routing refuses a
provider while it is in a login/installation/misconfigured state or
rate-limited until the reported reset, with the Terminal instruction as the
reason — never a silent switch to the other provider or to API billing.

## OpenAI Codex transport (Stage 06)

**OPENAI** mirrors CLAUDE's subscription-first design: `OPENAI_TRANSPORT`
selects `codex_cli` (default) — the owner's local, ChatGPT-subscription
authenticated `codex` binary — or `openai_api`, which is declared but **not
implemented**: selecting it registers OPENAI as `NotConnectedProvider`, never
a silent API-key fallback.

### Verified against the installed CLI (`codex-cli 0.157.0`)

- **Health/auth**: `codex doctor --json` — JSON to stdout, warnings to
  stderr; `overallStatus`/exit code are ignored for auth determination (doctor
  exits 1 whenever any unrelated check fails, e.g. network reachability). The
  authoritative signal is `checks["auth.credentials"]`: `status: "fail"` with
  "no Codex credentials were found" → not logged in; `status: "ok"` with
  `details["stored auth mode"] === "chatgpt"` → subscription login; `"api_key"`
  or an API auth env var present → `MISCONFIGURED`, execution blocked.
- **Non-interactive execution**: `codex exec --json` (prompt via stdin, no
  positional argument) with `--skip-git-repo-check --ephemeral
  --ignore-user-config --ignore-rules --strict-config --sandbox read-only -C
  <isolated dir>`; `-m/--model` omitted for AUTO; `-c
  model_reasoning_effort=<low|medium|high>` for effort; `--output-schema
  <file>` for structured output. Never `--dangerously-bypass-approvals-and-sandbox`,
  never `--full-auto`.
- **Event stream**: `ThreadEvent`s tagged by `type` —
  `thread.started`, `turn.started`, `turn.completed { usage }`, `turn.failed {
  error }`, and `item.*` events where item type `reasoning` is never read,
  stored or streamed and `agent_message` (cumulative text) is diffed into
  deltas. No model name and no structured error code appear anywhere in the
  stream, hence the `doctor`-based auth pre-flight and the regex-based error
  classifier below.
- **Cancellation**: SIGINT (Codex's own interrupt signal), not SIGTERM.
- **No per-turn auth signal**: unlike Claude Code's `system.init.apiKeySource`,
  Codex's stream never says which auth mode served a given turn, so
  `CodexCliProvider.stream()` runs the same `doctor --json` check used for
  Test Connection once before every call — not a model call, no subscription
  usage — and blocks with `MISCONFIGURED` on an API-key mismatch.
- **No structured errors**: failures are classified with a best-effort regex
  over the CLI's message text (`classifyCodexError`); a top-level
  `{"type":"error",...}` event observed mid-stream can be a non-fatal
  transient reconnect — only `turn.failed` or a process exit without
  `turn.completed` is treated as a real failure.

### Isolation and sandboxing

Every Codex run gets its own temporary working directory (never the
repository, never user documents) and a sanitised child environment: no
`OPENAI_API_KEY`/`OPENAI_ADMIN_KEY` or any variable that could select an
alternate API backend, org, project or auth mode; no database/queue/other
provider credentials. Sandbox is `--sandbox read-only`; approvals are never
escalated (no `-a`/`--ask-for-approval`, no `--dangerously-bypass-...`), so
anything the sandbox denies simply fails rather than silently running.
Concurrency defaults to `CODEX_MAX_CONCURRENCY=1`, enforced by a per-provider
`Semaphore` inside `CodexCliProvider` — the worker's own concurrency is sized
to the *sum* of Claude's and Codex's limits so neither starves the other.

## Multi-provider routing & second-opinion review (Stage 06)

Full design in [MULTI_PROVIDER.md](MULTI_PROVIDER.md). In short:

- `routeExecution()` gained `requestedProvider`: an explicit, person-chosen
  provider for one run, checked after the task's hard `providerRequirement`
  but still bound by company `allowedProviders` and live availability — a
  policy-checked choice, never a bypass. A run is re-planned with the same
  `requestedProvider` it originally resolved to, so re-execution (after a
  worker restart, say) never silently reroutes to a different provider.
- A completed **primary** run can get an independent **second opinion** from
  the other real provider: `POST /v1/runs/:id/review` (permission
  `ai.review.request`) creates a second run (`run_purpose =
  'second_opinion'`, `reviewed_run_id` set, `agent_run_reviews` row for fast
  dedup) that goes through the *same* `executeRun()` executor as any other
  run — the executor has no special-case code for reviews; the DB-layer
  `RunStore` picks `providerReviewSchema` instead of
  `agentExecutionResultSchema` based on the run's own `runPurpose`, and
  `buildReviewInput()` (in `@aibos/execution-core`) builds a neutral reviewer
  prompt with no provider identity and no ranking language.
- A review never claims or drives the reviewed task's own status/claim (it
  shares `taskId`/`agentId` with the primary run only for budget attribution
  and run-history grouping).
- `GET /v1/runs/:id` (`AgentRunDetailDTO.review`) surfaces the latest
  *completed* review of a primary run; `GET /v1/runs/:id/reviews` lists the
  full review history for that run.

## Known limitations

- Recovery assumes a single worker process; multi-worker lease stealing is
  a later-stage concern.
- Tokens generated before a user presses Stop are not recorded (the aborted
  stream reports no usage).
- The input estimate is character-based (≈4 chars/token); the actual count
  comes from the provider's usage after the call.
- Claude Code: reported output tokens include adaptive thinking, so they can
  exceed the visible-output limit passed as `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
- Claude Code without `--system-prompt-file` receives the compiled system
  rules as one argv element (visible to local process listings on the same
  machine); company context, task text and chat always go through stdin.
- Concurrency and subscription limits are enforced per worker process; run a
  single worker on the Claude Code machine.
- `claude auth status` does not always report the plan type; the card then
  shows "Pro subscription" as configured by the owner.
- Codex's event stream never reports a resolved model name, so the model
  shown/persisted for an AUTO run is the configured alias (`auto` by default),
  not a name the provider confirmed.
- No OpenAI pricing has been seeded (`ai_model_prices` has no OPENAI rows) —
  the Not-Billed API-equivalent estimate stays `null` for Codex subscription
  runs until real Anthropic-style sourced pricing is added; this never blocks
  execution (subscription runs need no price to run).
- Company `provider_selection: "auto"` resolves deterministically (CLAUDE
  first, else OPENAI, else the stored default) from live `.available()`
  checks only — it does not yet weigh enabled/blocked health state, workload,
  or cost the way the full router does for a fixed provider choice.
- The Chat surface accepts an explicit `provider` on send (wired end-to-end
  in the API/DB layers), but the chat UI itself has no provider-selector
  control yet — a person can only choose a provider from a task's Run
  preview today.
- The review-history endpoint (`GET /v1/runs/:id/reviews`) exists and is
  tested at the DB/API layer, but the web UI only surfaces the single latest
  completed review inline; a full review-history list view is not built yet.
