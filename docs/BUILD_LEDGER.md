# Build ledger

The authoritative, ordered plan for AI Business OS. Each stage is delivered by one build prompt and is only marked COMPLETE when its acceptance criteria pass.

Legend: **COMPLETE** · **IN PROGRESS** · **PLANNED**

| #   | Stage                                                               | Status   |
| --- | ------------------------------------------------------------------- | -------- |
| 01  | Foundation                                                          | COMPLETE |
| 02  | Authentication, Users, Roles & Permission Engine                    | COMPLETE |
| 03  | Company Profiles, Knowledge, Brand Rules & Agent Context Engine     | COMPLETE |
| 04  | Agent Roles, Permanent Instructions, Teams & Delegation Engine      | COMPLETE |
| 05  | AI Provider Router, Claude Integration & First Real Agent Execution | PLANNED  |
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

- **Status:** PLANNED
- **Objective:** Route compiled instruction packs and context packs to AI providers; Claude integration; first real, governed agent execution.
- **Dependencies:** Stage 04
- **Completion notes:** —

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
