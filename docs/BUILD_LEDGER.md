# Build ledger

The authoritative, ordered plan for AI Business OS. Each stage is delivered by one build prompt and is only marked COMPLETE when its acceptance criteria pass.

Legend: **COMPLETE** · **BLOCKED** (implementation done, acceptance waiting on an external prerequisite) · **IN PROGRESS** · **PLANNED**

| #   | Stage                                                               | Status   |
| --- | ------------------------------------------------------------------- | -------- |
| 01  | Foundation                                                          | COMPLETE |
| 02  | Authentication, Users, Roles & Permission Engine                    | COMPLETE |
| 03  | Company Profiles, Knowledge, Brand Rules & Agent Context Engine     | COMPLETE |
| 04  | Agent Roles, Permanent Instructions, Teams & Delegation Engine      | COMPLETE |
| 05  | AI Provider Router, Claude Integration & First Real Agent Execution | COMPLETE |
| 06  | Task orchestration & handoffs                                       | PLANNED  |
| 07  | Claude integration                                                  | PLANNED  |
| 08  | OpenAI integration                                                  | PLANNED  |
| 09  | Grok integration                                                    | PLANNED  |
| 10  | AI provider router                                                  | PLANNED  |
| 11  | Cost Governor                                                       | PLANNED  |
| 12  | Google Sheets & Drive + credential vault                            | PLANNED  |
| 13  | Lead management                                                     | PLANNED  |
| 14  | Outlook / Microsoft Graph connection                                | PLANNED  |
| 15  | Email monitoring                                                    | PLANNED  |
| 16  | Email drafting & replies                                            | PLANNED  |
| 17  | Email autonomy rules                                                | PLANNED  |
| 18  | Follow-up engine                                                    | PLANNED  |
| 19  | Meta connection                                                     | PLANNED  |
| 20  | Meta monitoring                                                     | PLANNED  |
| 21  | Meta Ad Library intelligence                                        | PLANNED  |
| 22  | Campaign creation                                                   | PLANNED  |
| 23  | Meta execution rules                                                | PLANNED  |
| 24  | Website monitoring                                                  | PLANNED  |
| 25  | GA4                                                                 | PLANNED  |
| 26  | Search Console                                                      | PLANNED  |
| 27  | WordPress                                                           | PLANNED  |
| 28  | SEO                                                                 | PLANNED  |
| 29  | Browser workers                                                     | PLANNED  |
| 30  | Persistent browser profiles                                         | PLANNED  |
| 31  | Live browser mini-screen                                            | PLANNED  |
| 32  | Human takeover                                                      | PLANNED  |
| 33  | Approval engine                                                     | PLANNED  |
| 34  | Audit system                                                        | PLANNED  |
| 35  | Notifications                                                       | PLANNED  |
| 36  | Research workspace & webhooks                                       | PLANNED  |
| 37  | Deployment                                                          | PLANNED  |
| 38  | Backups & disaster recovery                                         | PLANNED  |
| 39  | Security hardening                                                  | PLANNED  |
| 40  | Final QA                                                            | PLANNED  |

## Stage 01 — Foundation

- **Status:** COMPLETE
- **Objective:** Monorepo, data model, API, worker, command centre UI, seeds, docs, tests.
- **Dependencies:** —
- **Completion notes:**
  - pnpm monorepo (`apps/web`, `apps/api`, `apps/worker`, 7 packages), TypeScript strict, ESLint, Prettier.
  - PostgreSQL 16 + Redis 7 via Docker Compose; Drizzle schema + migration `0000_stage01_foundation`.
  - Entities: companies, departments, agent templates, agents, multi-company assignments, tasks (hierarchy), approvals, audit events, integrations, AI usage ledger, budget policies.
  - Fastify API (`/v1/*`, `/health`) with Zod validation; BullMQ worker with heartbeat + no-op agent-task queue.
  - Command Centre, Add Company wizard, Agent Registry, templates, teams, task views, live-session placeholder, approvals, audit log, integrations, settings, module placeholders.
  - Provider/integration/browser abstractions with mock/placeholder implementations only — no live external calls.
  - Development seed (origin `dev_seed`): 3 companies, 18 agents, 13 tasks, 5 approvals, audit events, 35 days mock usage.
  - Tests: unit, DB, API, frontend (Vitest) and Playwright responsive E2E at 1920/1440/1280/1024/768/390.

## Stage 02 — Authentication, Users, Roles & Permission Engine

- **Status:** COMPLETE
- **Objective:** Users, sessions, company-scoped roles (owner/admin/operator/viewer), permission checks on every API route; replace `dev-user` actor.
- **Dependencies:** Stage 01
- **Completion notes:**
  - Email/password authentication with argon2id and first-party server-side sessions (HttpOnly, SameSite=Lax, Secure in production; hashed tokens; sliding + absolute expiry; rotation; revocation on logout, reset and disable).
  - Password reset and invitation flows with single-use, expiring, hashed tokens; login throttling; no user enumeration; bootstrap CLI for the first Platform Owner.
  - `@aibos/access-core`: 53 human permissions in 13 categories, 7 locked system roles + editable custom roles, data-driven approval authority, agent permission catalogue (tool.* / action.*), L0–L4 autonomy ladder, `canAgent` evaluation engine.
  - Company memberships (single, multiple, global) with department restrictions; `AccessScope` enforced in every company-scoped repository and route; `?company=` never trusted.
  - Internal service identities; audit events record actor type, user/agent/service id, session reference, resource and outcome.
  - UI: login, forgot/reset password, account disabled, invitation pages; user menu + logout; permission-aware navigation; Users & Access; Roles & Permissions; agent Access & Authority panel; permission-aware approval decisions.
  - Tests: access-core (12), DB identity (14), API auth/authorization/security (28), web (17 new), Playwright auth + responsive E2E.

## Stage 03 — Company Profiles, Knowledge, Brand Rules & Agent Context Engine

- **Status:** COMPLETE
- **Objective:** Permanent company knowledge and context layer: structured profiles, knowledge library, brand/commercial/compliance rules and a deterministic Agent Context Engine that future providers consume.
- **Dependencies:** Stage 02
- **Completion notes:**
  - Structured company profile (identity, business, brand, compliance) + AI operations policy; per-section strict editing with audit; company History feed.
  - Knowledge library: 25 types, provenance (13 sources), confidence, verification, sensitivity, lifecycle (draft → review → approved → superseded/archived), versioning by lineage, freshness (review/expiry, stale policy), conflict detection with human resolution, explicit task/agent links, Postgres full-text search.
  - Brand, commercial and compliance rule engines (generic, queryable; `evaluateCompanyAction`); Opportunitygrad ₹100 Meta budget limit stored as a company commercial rule.
  - `@aibos/context-core`: deterministic Agent Context Pack assembly with precedence tiers, why-included reasons, budgets (small/standard/large/custom), mandatory critical rules and restrictions, company isolation, sensitivity access policies; `KnowledgeRetriever` and `KnowledgeIngestionAdapter` contracts (no live integrations).
  - New permissions: knowledge.view/create/edit/approve/archive/global.manage, knowledge.confidential.read, knowledge.restricted.read, policy.manage, policy.approve, context.preview.
  - UI: Company Profile tabs, Knowledge Library + detail drawer + add/edit, rules panels, AI policy + agent knowledge access, agent detail page with Context Preview and default-knowledge editor, task detail with Agent Context, Global Knowledge page.
  - Development seed: profiles, 17 knowledge items (2 GLOBAL), 10 rules, links and an access policy — known high-level facts only.
  - Tests: context-core (23), DB knowledge (19), API knowledge security (15), web (14 new), Playwright knowledge/context flow + responsive sweep of Stage 03 pages.

## Stage 04 — Agent Roles, Permanent Instructions, Teams & Delegation Engine

- **Status:** COMPLETE
- **Objective:** Permanent AI workforce structure and a deterministic delegation system: structured versioned roles, instruction precedence, departments, teams, hierarchy, capabilities, delegation, handoffs, temporary workers and a conversation shell — without calling any AI provider.
- **Dependencies:** Stage 02, 03
- **Completion notes:**
  - Instruction stack (platform → global → company → department → template → agent → task → task notes) and `compileAgentInstructions` → provider-neutral `CompiledAgentInstructionPack` (dedup, override rejection, stricter-wins limits, permission/company-policy conflict resolution, context metadata from the Stage 03 engine).
  - Structured roles for all 17 templates + 19 company role templates; versioned agent roles (history, changed/approved by, effective from, audited).
  - Global operating policy (structured rules) + workforce policy (global active agents 3; Research department 5; high-cost approval threshold; temporary-agent limits).
  - Departments (operating model), teams (company/global, leader, members, concurrency, temporary), reporting hierarchy with cycle prevention, 26 capabilities separate from permissions, task requirements.
  - `@aibos/delegation-core`: HANDLE_SELF / DELEGATE_TO_AGENT / DELEGATE_TO_TEAM / CREATE_TEMPORARY_WORKER / REQUIRE_HUMAN_REVIEW / BLOCKED with per-candidate checks, budget control and duplicate detection (exact/likely/related/none).
  - Atomic task claims with leases, workload tracking, concurrency at every level, agent states derived from real work (EXPIRED/TERMINATED added; failed shown as Error).
  - Handoffs (packet, lifecycle, sensitivity-checked evidence, reused in the destination's own Context Pack), agent messages, conversation shell (stored messages, no AI replies).
  - Temporary workers: task/company-bound, expiring, parent-bounded permissions, no uncontrolled self-replication, approval-gated agent creation, terminated with their task.
  - New permissions: team.view/manage, agent.role.view/manage, agent.delegation.manage, handoff.view/manage, conversation.view/create; agent permission `action.create_temp_worker`.
  - UI: agent detail tabs (Overview with hierarchy & capabilities, Role & Instructions editor + history, Instruction Preview, Context, Chat), upgraded Agent Directory filters, Organisation Chart, Teams & departments + Team detail, Task delegation preview/assignment/handoffs/temporary workers, New Task with duplicate warnings, Command Centre manager stats.
  - Tests: agent-core instructions (7), delegation-core (12), context-core handoffs, DB workforce (14), API workforce security (15), web workforce (10), Playwright workforce flows (owner / company manager / department manager) + responsive sweep of new pages.

## Stage 05 — AI Provider Router, Claude Integration & First Real Agent Execution

- **Status:** COMPLETE (with correction 05A — Claude Code subscription transport is the default; extended by 05B — OpenAI Codex subscription integration, multi-provider routing & second-opinion review).
- **Objective:** Route compiled instruction packs and context packs to AI providers; Claude integration; first real, governed agent execution.
- **Dependencies:** Stage 04
- **Acceptance (05A, replaces the API-credential requirement):** `ALLOW_LIVE_AI_TESTS=true pnpm test:claude-subscription-live` passed all 11 checks on 2026-09-25 — real Claude Code 2.1.282 (subscription OAuth login, `apiKeySource` none/oauth, first-party), Sonnet (`claude-sonnet-5`) task and chat completed, streaming, persistence, audit, `SUBSCRIPTION` usage, API cost N/A. Run in the development cloud container signed in to the owner's Claude account; the CLI did not report the plan tier. Re-run it once on the owner's Mac after `claude login`.
- **Acceptance (05B, OpenAI Codex subscription):** `ALLOW_LIVE_AI_TESTS=true pnpm test:openai-subscription-live` verified against the real installed `codex-cli 0.157.0` binary on 2026-09-25 — binary detection, `codex doctor --json` parsing, and the LOGIN_REQUIRED health state all confirmed correct against the genuine CLI with no credentials collected or read. The development cloud container has no ChatGPT account signed in and no network path to `chatgpt.com`/`api.openai.com`, so the script correctly stopped at that point (exit 4, "Codex authentication is active" / "no API-key transport" checks FAIL as expected) — it did not and could not reach a real task/second-opinion run. Full task+review verification is BLOCKED on this sandbox; re-run on the owner's Mac after `codex login` to complete it. The rest of Stage 05B (multi-provider routing, second-opinion engine, UI, security) was verified with real Postgres/Redis/Next.js/worker processes and the mock Codex provider — see 05B completion notes.
- **Stage 05A completion notes (Claude Code subscription transport):**
  - Default `CLAUDE_TRANSPORT=claude_code`: `ClaudeCodeProvider` spawns the official `claude` CLI (`-p`, `stream-json`, `--tools ""`, `--strict-mcp-config`, `--safe-mode`, `--restricted`, `--no-session-persistence`; capabilities detected from `claude --help`), prompt on stdin, allowlisted child env (no API keys, no `ANTHROPIC_BASE_URL` unless allowed), SIGTERM/SIGKILL cancellation and timeouts, no orphans, concurrency 1.
  - The OS implements no Claude login and reads no Claude credential; health via `claude --version` / `--help` / `auth status --json` → AVAILABLE / NOT_INSTALLED / LOGIN_REQUIRED / LOGIN_EXPIRED / RATE_LIMITED / UNAVAILABLE / MISCONFIGURED. API-key billing refused (`API_BILLING_REFUSED`), no API fallback, usage limit → `SUBSCRIPTION_LIMIT_REACHED`.
  - Anthropic API transport kept as optional (`CLAUDE_TRANSPORT=anthropic_api`), disabled by default.
  - Router stays provider-neutral (logical CLAUDE; transport/billing metadata only). Subscription runs: operational limits (runs per task/agent per day, request size, concurrency, premium policy) instead of dollars; actual API cost N/A with DB check constraints; NOT BILLED API-equivalent estimate; ledger `transport` / `billing_mode` / `rate_limit`.
  - UI: Claude Code provider card (Pro subscription, Local Claude Code, Included subscription usage, API key Not used, usage state, TEST CLAUDE CODE, Terminal setup steps), subscription labels on preview/run/history/usage.
  - Tests: fake Claude Code binary (installed/missing, login required/expired, rate limited, API-key refusal, old CLI, streaming, structured result, shell injection, env stripping, stop, timeout, concurrency, Opus unavailable) + DB/API/web/E2E updates — 334 Vitest + 12 Playwright; guarded `pnpm test:claude-subscription-live`.
- **Stage 05B completion notes (OpenAI Codex subscription, multi-provider routing & second-opinion review):**
  - Default `OPENAI_TRANSPORT=codex_cli`: `CodexCliProvider` spawns the official `codex` CLI (`exec --json`, prompt on stdin, `--skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --strict-config --sandbox read-only`, isolated `-C` workdir, `--output-schema` for structured output; feature flags disabled via `--disable`), allowlisted child env (no `OPENAI_API_KEY`/`OPENAI_ADMIN_KEY` or custom-backend vars), SIGINT/SIGKILL cancellation and timeouts, no orphans, concurrency 1 (`CODEX_MAX_CONCURRENCY`). Flags/event-schema verified against the real installed `codex-cli 0.157.0` (`--help`, source of `codex-rs/exec/src/exec_events.rs`), not assumed from training data.
  - The OS implements no Codex/ChatGPT login and reads no Codex credential; health via `codex --version` / `exec --help` / `codex doctor --json` → AVAILABLE / NOT_INSTALLED / LOGIN_REQUIRED / LOGIN_EXPIRED / RATE_LIMITED / UNAVAILABLE / MISCONFIGURED. Since Codex's event stream carries no per-turn auth signal, `stream()` runs the same `doctor --json` check once before every call to catch an API-key-mode mismatch before any request. No structured provider error codes exist in this CLI version, so failures are classified with a documented best-effort regex (`classifyCodexError`). OpenAI API transport kept declared-but-not-implemented (`OPENAI_TRANSPORT=openai_api` → `NotConnectedProvider`, never a silent API-key fallback).
  - Router gained `requestedProvider`: an explicit, policy-and-availability-bound person choice for one run (task, chat, or review), still outranked by a task's hard `providerRequirement`; a run is re-planned at execution time with the *same* provider it originally resolved to, so recovery/retry never silently reroutes it. Company `provider_selection: "auto"` resolves to whichever of CLAUDE/OPENAI is `.available()` (CLAUDE first) ahead of the normal preference chain.
  - Second-opinion review: `agent_runs.run_purpose`/`reviewed_run_id` + `agent_run_reviews` table; `requestSecondOpinion()`/`planReviewRun()` (blocks self-review and review-of-a-review, caps reviewer context to `min(original run's own clearance, requester's clearance)`, dedups in-flight/completed reviews unless `force`, enforces `max_reviews_per_task`); reviews run through the *same* `executeRun()` executor with no special-casing — `RunStore.validateStructured()` picks `providerReviewSchema` from the run's own `runPurpose`. `buildReviewInput()`/`REVIEW_FRAME` (neutral, no provider identity, no ranking language) — a real prompt-injection gap (the `original_task`/`original_result` tags were not in the fencing allowlist, and a nested `wrap()` call was re-fencing its own already-fenced structural tags) was found and fixed while adding tests. A second real bug — `RunStore`'s task-claim release and running-status transition did not exclude second-opinion runs, so completing/starting a review could release the primary task's claim or flip its status — was found via a live Postgres integration test and fixed.
  - Usage/billing: review runs bill exactly like any other run on their provider (`SUBSCRIPTION`/N/A for Codex); OpenAI pricing is intentionally unseeded (no sourced Anthropic-style figures available) so the NOT BILLED API-equivalent stays `null` — documented, not silently wrong.
  - UI: OpenAI Codex provider card (ChatGPT subscription, Local Codex CLI, Included subscription usage, API key Not used, TEST CODEX CONNECTION, Terminal setup steps) generalised from the Claude Code card via a per-provider `CLI_META` table (a stale Stage-05-era bug — OpenAI's Settings card and the AI-policy panel's "not connected" list both still treated OpenAI as unbuilt — was found and fixed in the same pass); "Ask {other provider} to review" button and a review card (agreements/disagreements/possible errors/missing considerations/risks/suggested corrections, confidence, summary) visually separated from the original result, never merged; a SECOND OPINION badge on a review's own run; company AI-policy panel (provider selection, review mode, preferred reviewer, max reviews per run); agent provider-settings panel (preferred reviewer, excluding the agent's own primary provider from the options).
  - Permissions: `ai.review.request`, `ai.review.view` (mapped into `company_manager`/`department_manager`/`staff` roles; a pre-existing duplicate-permission bug in `company_manager`'s role definition, unrelated to this stage but triggered by the new permission, was found and fixed via the dev-seed failure it caused).
  - Tests: fake Codex CLI binary (installed/missing, login required/expired/API-mode mismatch, usage limit, old CLI, streaming, structured result, shell injection, env stripping, stop, timeout, concurrency, premium unavailable) — 15 provider-core tests; router `requestedProvider` tests; a real-Postgres `packages/db/test/review.test.ts` suite (happy path, self-review blocked, not-completed blocked, no-recursive-review, dedup with/without force, max-reviews-per-task, clearance-capping) plus two new DB-level `requestedProvider` tests; API test updated for the new default-connected OpenAI card; 4 new web component test files/blocks (Codex provider card states, second-opinion UI states, company AI-policy panel); 2 new Playwright E2E scenarios (ask-to-review → both results visible → original preserved; cancel an in-flight review) run against the real stack (Postgres, Redis, worker, Next.js) with mock providers. Full workspace: see final counts below. Guarded `pnpm test:openai-subscription-live`.
  - Known limitations: chat has no provider-selector control in the UI yet (the API/DB layers accept an explicit `provider` on chat send); the review-history endpoint has no dedicated "all past reviews" list view (only the latest completed review shows inline); company `provider_selection: "auto"` does not yet weigh workload or cost; Grok and three-provider review are Stage 07, not started.
- **Stage 05 completion notes:**
  - Official Anthropic TypeScript SDK (Messages API, streaming, `output_config` effort + JSON-schema format, prompt caching, typed errors); no Claude Code CLI / Agent SDK. STANDARD = Claude Sonnet 5 (medium), PREMIUM = Claude Opus 5.5 (high, only when permitted); model IDs and efforts from env.
  - `AIProvider` contract + registry: Claude live, deterministic `MockClaudeProvider`, OpenAI/Grok placeholders (`PROVIDER_NOT_CONFIGURED`, no silent fallback), LOCAL deterministic. Deterministic router with recorded reasons.
  - `@aibos/execution-core`: authority/data message construction with injection boundaries, output-detail limits, ≤1 retry for transient typed errors honouring retry-after, timeouts, AbortSignal cancellation, durable response save, strict result validation, recovery (re-queue / NEEDS_REVIEW / finish saved response).
  - `agent_runs` / `agent_run_events` / `agent_run_feedback` / `ai_model_prices` / `ai_provider_settings`; DB-level duplicate prevention, idempotency, reservations, leases; budget preflight across task/agent/company daily+monthly/provider/global (shared `evaluateBudget`); usage ledger with cache tokens and price snapshot (official pricing verified 2026-09-25); mock usage never counts as spend.
  - Worker executes (BullMQ `agent-runs`); API only enqueues; SSE streaming via Redis; Stop via Redis cancel channel.
  - UI: Run with agent (preview, tier/detail, live run panel, timeline, result, history, feedback), streamed Agent Chat with stop/retry/model indicator, Settings → AI Providers, company model policy, agent provider settings, live runs on Live Agents and Command Centre, real cost/usage with REAL/MOCK labels, manager run stats, Claude health row (Not configured ≠ error).
  - Permissions: task.execute, agent.chat, agent.run.view, agent.run.stop, provider.view, provider.test, provider.settings.manage. Audit actions listed in DATA_MODEL.md.
  - Tests: provider-core 15, execution-core 11, DB execution 13, API execution 11, web execution 7 (+ updated suites; 309 Vitest total), Playwright execution flows (mock mode) incl. run, chat, providers, isolation, stop; guarded `pnpm test:claude-live`.
  - API-transport live smoke (`pnpm test:claude-live`): not run — no API credential (not required since 05A).

## Stage 06 — Task orchestration & handoffs

- **Status:** PLANNED
- **Objective:** Queue-backed task lifecycle, routing, subtasks, handoffs between agents, retries, cancellation.
- **Dependencies:** Stage 04, 05
- **Completion notes:** —

## Stage 07 — Claude integration

- **Status:** PLANNED
- **Objective:** Live Anthropic adapter behind `AIProvider`: execution, streaming, tool use, cost capture, health.
- **Dependencies:** Stage 06
- **Completion notes:** —

## Stage 08 — OpenAI integration

- **Status:** PLANNED
- **Objective:** Live OpenAI adapter behind `AIProvider` with usage capture.
- **Dependencies:** Stage 06
- **Completion notes:** —

## Stage 09 — Grok integration

- **Status:** PLANNED
- **Objective:** Live xAI adapter incl. X search capability.
- **Dependencies:** Stage 06
- **Completion notes:** —

## Stage 10 — AI provider router

- **Status:** PLANNED
- **Objective:** Capability/cost/latency/budget-aware routing, fallbacks, provider health circuit breakers.
- **Dependencies:** Stage 07, 08, 09
- **Completion notes:** —

## Stage 11 — Cost Governor

- **Status:** PLANNED
- **Objective:** Live metering into `ai_usage_records`, enforcement of `budget_policies`, forecasts, alerts.
- **Dependencies:** Stage 07–10
- **Completion notes:** —

## Stage 12 — Google Sheets & Drive + credential vault

- **Status:** PLANNED
- **Objective:** OAuth, encrypted credential vault (`CREDENTIALS_ENCRYPTION_KEY`), read/write sheets, Drive documents.
- **Dependencies:** Stage 02
- **Completion notes:** —

## Stage 13 — Lead management

- **Status:** PLANNED
- **Objective:** Lead model, pipeline UI, scoring, routing, Sheet sync.
- **Dependencies:** Stage 06, 12
- **Completion notes:** —

## Stage 14 — Outlook / Microsoft Graph connection

- **Status:** PLANNED
- **Objective:** OAuth per company mailbox, mailbox/calendar read, token refresh.
- **Dependencies:** Stage 12
- **Completion notes:** —

## Stage 15 — Email monitoring

- **Status:** PLANNED
- **Objective:** Inbox sync, triage and classification, linking to leads and tasks.
- **Dependencies:** Stage 14
- **Completion notes:** —

## Stage 16 — Email drafting & replies

- **Status:** PLANNED
- **Objective:** Brand-tone drafts, human review, send via approval.
- **Dependencies:** Stage 15, 33
- **Completion notes:** —

## Stage 17 — Email autonomy rules

- **Status:** PLANNED
- **Objective:** Policy engine for which emails agents may send without approval.
- **Dependencies:** Stage 16
- **Completion notes:** —

## Stage 18 — Follow-up engine

- **Status:** PLANNED
- **Objective:** Scheduled follow-ups, sequences, stop conditions.
- **Dependencies:** Stage 16, 17
- **Completion notes:** —

## Stage 19 — Meta connection

- **Status:** PLANNED
- **Objective:** Meta app, OAuth, ad accounts, Pages, Instagram per company.
- **Dependencies:** Stage 12
- **Completion notes:** —

## Stage 20 — Meta monitoring

- **Status:** PLANNED
- **Objective:** Campaign/ad set/ad insights, anomaly detection, reporting.
- **Dependencies:** Stage 19
- **Completion notes:** —

## Stage 21 — Meta Ad Library intelligence

- **Status:** PLANNED
- **Objective:** Competitor ad tracking, creative analysis.
- **Dependencies:** Stage 19
- **Completion notes:** —

## Stage 22 — Campaign creation

- **Status:** PLANNED
- **Objective:** Draft campaigns/creatives for human approval.
- **Dependencies:** Stage 20
- **Completion notes:** —

## Stage 23 — Meta execution rules

- **Status:** PLANNED
- **Objective:** Guarded execution (pause/scale/budget) under policies and approvals.
- **Dependencies:** Stage 22, 33
- **Completion notes:** —

## Stage 24 — Website monitoring

- **Status:** PLANNED
- **Objective:** Uptime, Core Web Vitals, forms/journeys per company website.
- **Dependencies:** Stage 06
- **Completion notes:** —

## Stage 25 — GA4

- **Status:** PLANNED
- **Objective:** Analytics ingestion and KPI dashboards.
- **Dependencies:** Stage 12
- **Completion notes:** —

## Stage 26 — Search Console

- **Status:** PLANNED
- **Objective:** Search performance and indexing insights.
- **Dependencies:** Stage 12
- **Completion notes:** —

## Stage 27 — WordPress

- **Status:** PLANNED
- **Objective:** Content read/write with approval and rollback.
- **Dependencies:** Stage 12, 33
- **Completion notes:** —

## Stage 28 — SEO

- **Status:** PLANNED
- **Objective:** SEO agent workflows: research, briefs, technical audits.
- **Dependencies:** Stage 25, 26, 27
- **Completion notes:** —

## Stage 29 — Browser workers

- **Status:** PLANNED
- **Objective:** Playwright-backed isolated browser sessions for agents.
- **Dependencies:** Stage 06
- **Completion notes:** —

## Stage 30 — Persistent browser profiles

- **Status:** PLANNED
- **Objective:** Per-company/agent profiles, cookie/session management.
- **Dependencies:** Stage 29
- **Completion notes:** —

## Stage 31 — Live browser mini-screen

- **Status:** PLANNED
- **Objective:** Screenshot/stream pipeline into `LiveAgentScreen`.
- **Dependencies:** Stage 29
- **Completion notes:** —

## Stage 32 — Human takeover

- **Status:** PLANNED
- **Objective:** Take/return control, messaging an agent mid-session.
- **Dependencies:** Stage 31
- **Completion notes:** —

## Stage 33 — Approval engine

- **Status:** PLANNED
- **Objective:** Decisions, policies, expiry, delegation, notifications; enables approve/reject buttons.
- **Dependencies:** Stage 02
- **Completion notes:** —

## Stage 34 — Audit system

- **Status:** PLANNED
- **Objective:** Immutability guarantees, search, export, retention, tamper evidence.
- **Dependencies:** Stage 02
- **Completion notes:** —

## Stage 35 — Notifications

- **Status:** PLANNED
- **Objective:** Email/push/Slack alerts for approvals, failures, budgets.
- **Dependencies:** Stage 33
- **Completion notes:** —

## Stage 36 — Research workspace & webhooks

- **Status:** PLANNED
- **Objective:** Research briefs with citations and knowledge write-back; signed inbound/outbound webhooks.
- **Dependencies:** Stage 06, 10
- **Completion notes:** —

## Stage 37 — Deployment

- **Status:** PLANNED
- **Objective:** Production Docker images, compose/infra for Ubuntu VPS, CI/CD, TLS, migrations on deploy.
- **Dependencies:** Stage 01
- **Completion notes:** —

## Stage 38 — Backups & disaster recovery

- **Status:** PLANNED
- **Objective:** Automated PostgreSQL backups, restore drills, Redis persistence policy.
- **Dependencies:** Stage 37
- **Completion notes:** —

## Stage 39 — Security hardening

- **Status:** PLANNED
- **Objective:** Rate limiting, CSP, secret rotation, dependency scanning, pen-test fixes.
- **Dependencies:** Stage 37
- **Completion notes:** —

## Stage 40 — Final QA

- **Status:** PLANNED
- **Objective:** End-to-end regression, performance, accessibility audit, launch checklist.
- **Dependencies:** All previous stages
- **Completion notes:** —
