# Architecture

AI Business OS is a multi-company operating system in which AI providers are
**replaceable workers**. The application owns companies, agents, tasks,
approvals, budgets and the audit trail; Claude, OpenAI, Grok and local logic
are interchangeable executors behind one interface.

```
USER / MANAGEMENT
  ↓
VISUAL COMMAND CENTRE            apps/web      (Next.js App Router)
  ↓
COMPANY CONTEXT                  ?company=<slug> scope, companies table
  ↓
TASK ROUTER                      packages/agent-core   (RuleBasedTaskRouter)
  ↓
AGENT REGISTRY                   agents + agent_company_assignments + templates
  ↓
AI PROVIDER ROUTER               packages/provider-core (ProviderRouter)
  ├── Claude   ─┐
  ├── OpenAI    │  AIProvider interface — mock + unconfigured adapters in Stage 01
  ├── Grok      │
  └── Local    ─┘
  ↓
TOOLS / INTEGRATIONS             packages/integration-core, packages/browser-core
  ↓
SHARED DATABASE                  packages/db (PostgreSQL + Drizzle)
  ↓
AUDIT LOG                        audit_events (append-only)
```

## Repository layout

| Path                        | Responsibility                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                  | Next.js 16 command centre. Server components fetch the API; `/api/*` is rewritten to the API so the browser is same-origin.                                 |
| `apps/api`                  | Fastify 5 HTTP API (`/v1/*`, `/health`). Thin: validates with Zod, calls repositories, maps errors.                                                         |
| `apps/worker`               | BullMQ workers. Stage 01: heartbeat (drives worker health) and a no-op `agent-tasks` processor.                                                             |
| `packages/shared`           | Enums (single source of truth for every status vocabulary), Zod schemas, API DTO types, formatting helpers. Browser-safe.                                   |
| `packages/db`               | Drizzle schema, migrations, repositories (data-access layer returning DTOs), reference data sync, development seed.                                         |
| `packages/agent-core`       | Agent template definitions, departments, task-routing contract + reference router.                                                                          |
| `packages/provider-core`    | `AIProvider` contract, mock providers, unconfigured live adapters, provider router, placeholder pricing.                                                    |
| `packages/integration-core` | Integration catalogue (16 systems), adapter contract, placeholder adapter.                                                                                  |
| `packages/browser-core`     | Browser-worker contracts and the mock live-session generator behind `LiveAgentScreen`.                                                                      |
| `packages/context-core`     | Stage 03 Agent Context Engine: deterministic context-pack assembly, relevance, budgets, rule evaluation, retriever/ingestion contracts. Pure, browser-safe. |
| `packages/ui`               | Accessible UI primitives (buttons, status pills, progress, panels, sparkline, skeletons) and status-tone mapping.                                           |
| `infrastructure`            | Docker Compose for PostgreSQL 16 and Redis 7 (development).                                                                                                 |

## Key decisions

1. **Drizzle ORM over Prisma.** TypeScript-native schema (no separate DSL or
   generated client / query-engine binary), SQL-transparent queries for the
   aggregation-heavy dashboard, first-class PostgreSQL features we rely on
   (`NULLS NOT DISTINCT`, check constraints, arrays, JSONB, `inet`), and plain
   SQL migrations that can be reviewed. Enums are generated from
   `@aibos/shared` tuples so DB, API and UI can never drift.
2. **Fastify for the API.** Small, fast, TypeScript-friendly, `inject()` makes
   API tests hermetic without opening ports. No framework-level DI needed.
3. **Repositories in `@aibos/db`.** Both API and worker use the same data
   access functions; they return DTOs defined in `@aibos/shared`, so the web
   app is typed end-to-end without a code generator.
4. **Just-in-time internal packages.** Workspace packages export TypeScript
   source (`exports: ./src/index.ts`). Next.js transpiles them
   (`transpilePackages`), `tsx` runs the API/worker, Vitest reads TS directly.
   No build step or watch processes for packages. Production bundling of
   API/worker is part of Stage 37.
5. **Company scope in the URL** (`?company=<slug>`). Every view is linkable,
   server-rendered with the right filter, and the switcher works across pages.
6. **Validation everywhere with one schema set.** The wizard validates each
   step with the same Zod schemas the API and repositories enforce; DB check
   constraints are the last line of defence.
7. **Development data is labelled.** Rows carry `origin = live | dev_seed`.
   The seed deletes and recreates only `dev_seed` rows; the UI shows
   "Dev seed data" / "Mock data" badges wherever such data is displayed.
8. **No live side-effects in Stage 01.** Provider adapters throw
   `ProviderNotConfiguredError`, integration adapters report
   `not_configured`, the worker's task processor is a documented no-op, and
   live-session controls are disabled.
9. **BullMQ 6 + Redis** for queues; the worker writes a heartbeat key the API
   reads for the header's system-health indicator.
10. **Authentication (Stage 02).** Server-side sessions with argon2id
    passwords, company-scoped RBAC and a separate agent authority model —
    see the sections below. The Stage 01 `dev-user` assumption is gone.
11. **Company knowledge & Context Engine (Stage 03).** See below and
    `docs/KNOWLEDGE_SYSTEM.md`.

## Request flow (example: Add Company)

1. Wizard (client) validates each step with `companyIdentitySchema`, …
2. `POST /api/v1/companies` → Next rewrite → Fastify `POST /v1/companies`.
3. `createCompany()` re-validates, then in **one transaction** inserts the
   company, company budget policies, initial agents (Company Manager first so
   specialists report to it), assignments and a `company.created` audit event.
4. API returns `201`; the wizard shows success and refreshes server data.

## Provider abstraction

```ts
interface AIProvider {
  executeTask(req): Promise<ProviderTaskResult>;
  estimateCost(req): CostEstimate;
  supportsCapability(cap): boolean;
  cancel(requestId): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
}
```

`ProviderRouter.select()` resolves required → primary → fallback → company
default → any capable provider, honouring unavailability. Capabilities:
reasoning, coding, web_research, x_research, computer_use, vision,
document_analysis, email_drafting.

## Frontend design system

- Tokens in `apps/web/src/app/globals.css` (`--bg`, `--surface*`, `--line*`,
  `--fg*`, `--accent*`), with a _selected_ dark palette (`data-theme`),
  toggled without flash by an inline head script.
- Status colours (agent/task/approval/risk) are reserved for state and always
  paired with a text label (`packages/ui/src/status.ts`).
- Chart series use a validated categorical palette in fixed provider order
  (`--series-1..4`: Claude, OpenAI, Grok, Local), never status colours.
- Motion is subtle (status pulse, progress sheen, live-view scan) and
  disabled under `prefers-reduced-motion`.

## Authentication (Stage 02)

**Choice: first-party server-side sessions** following the Lucia / Copenhagen
Book design, built from maintained primitives — `@node-rs/argon2` (argon2id
password hashing), Node `crypto` (CSPRNG tokens, SHA-256) and
`@fastify/cookie`. No custom cryptography.

Why not a library such as better-auth or Auth.js? Both are capable, but they
own their own user/session/account tables and route handlers, and Auth.js
discourages credentials sign-in with database sessions. Our requirements —
company-scoped RBAC, a separate agent principal, service identities and
audit on every event — sit on our own schema and Fastify middleware, and
the session layer is ~100 lines of well-understood code. No hosted or paid
dependency, no vendor lock-in. OAuth/SSO, MFA and passkeys can be added as
additional _authentication methods_ that create the same sessions
(`sessions.auth_level` is reserved for MFA strength).

### Sessions

```
Browser ──(HttpOnly cookie aibos_session=<256-bit token>)──► Next.js /api rewrite ──► Fastify
                                                                                       │ SHA-256(token)
                                                                                       ▼
                                                                     sessions.id → users (status must be active)
```

- Token: 32 random bytes (base64url). The database stores only `SHA-256(token)`.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production.
  Never in localStorage.
- Expiry: 24 h sliding idle timeout (extended at most every 5 min) capped by a
  7-day absolute lifetime.
- Rotation: every sign-in issues a new session and revokes any session
  presented with the request. Logout, password reset and account
  disable/suspend revoke server-side (`revoked_at`, `revoked_reason`).
- Every request re-validates the session and the user's status, then loads
  the principal's access context — a disabled user is locked out on the next request.
- CSRF: `SameSite=Lax` cookies + an `Origin` allow-list on every unsafe
  method + JSON-only bodies (`text/plain` and form posts get 415).

### Web integration

- `apps/web/src/proxy.ts` (Next 16 "proxy", formerly middleware) redirects
  requests without a session cookie to `/login?next=…` (open-redirect safe).
- The `(app)` route group layout calls `/v1/auth/me`; 401 → `/login`,
  disabled → `/account-disabled`. Server components forward only the
  session cookie to the API.
- Client code never sees the token. UI permission checks (`useCan`, `IfCan`)
  only hide controls; the API is the authority.

## Authorization (Stage 02)

Two **separate principal types** with separate catalogues, evaluated by
pure functions in `@aibos/access-core`:

|          | Humans                                                        | AI agents                                                      |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Identity | `users` + `sessions`                                          | `agents` (Stage 01)                                            |
| Grants   | roles → permissions via `company_memberships` (+ departments) | `agent_permission_grants` (tool.* / action.*) + autonomy level |
| Question | `can(ctx, "approval.financial", companyId)`                   | `canAgent(agentId, companyId, "tool.email.send")`              |
| Default  | deny                                                          | deny                                                           |

A third principal, **internal service identities** (`service_identities`:
worker, scheduler, email-monitor, meta-webhook, website-monitor,
browser-worker, bootstrap-cli, dev-seed), exists for audit attribution:
actions show `actor_type = service` rather than pretending a human acted.

### Human authorization

1. **Permissions** are granular keys (`company.view`, `approval.financial`, …),
   grouped into categories for the UI (`HUMAN_PERMISSIONS`).
2. **Roles** map to permissions (`role_permissions`). System roles
   (Platform Owner, Group Admin, Company Owner, Company Manager, Department
   Manager, Staff, Viewer) are code-owned and read-only; custom roles are editable.
   Decisions are never based on role names.
3. **Memberships** bind a user to a company (or to _all_ companies when
   `company_id` is NULL) with one role, and optionally restrict it to
   departments (`membership_departments`).
4. **Access context** (`HumanAccessContext`) = global permissions + permissions
   per company + department restrictions, built once per request.
5. **Company isolation.** Every company-scoped repository query takes an
   `AccessScope` (`companyIds`, `includeGroup`, `departments`) derived by
   `scopeFor(req, permission)`; `?company=` is resolved by `companyScope()`,
   which returns an identical 403 for forbidden and unknown companies (for
   non-global users) and audits attempts on real ones. Global agents never
   leak another company's task titles; group-level rows (`company_id` NULL)
   are only visible with global access.
6. **Anti-escalation.** Granting a role requires holding every permission in
   it (security admins excepted); acting on a user requires dominating all of
   their roles; self-changes, last-Platform-Owner removal and system-role
   edits are rejected and audited (`security.privilege_change_denied`).
7. **Approval authority** is data-driven: `approval_requirements` maps
   approval type + minimum risk to required permissions (e.g.
   `ad_budget_increase` → `approval.financial`; high/critical →
   `approval.high_risk`; all → `approval.decide`). Each approval stores its
   `required_permissions`; the API checks them on decide and exposes
   `viewerCanDecide` for the UI. Multi-person approval can be added by
   extending rules with a quorum (Stage 33).

### Agent authorization

`evaluateAgentPermission` (wrapped by `canAgent` in `@aibos/db`) applies, in order:
agent exists → autonomy not disabled → agent not paused/failed/offline →
agent serves the company → grant exists (company-specific overrides global,
default deny) → explicit deny → autonomy ceiling → grant `require_approval`
→ agent approval gates. Autonomy ladder:

| Level                 | Behaviour                                                                               |
| --------------------- | --------------------------------------------------------------------------------------- |
| L0 Disabled           | Nothing executes                                                                        |
| L1 Observe            | Low-risk reads only                                                                     |
| L2 Limited operator   | Low/medium risk if granted; high risk denied                                            |
| L3 Approval-gated     | High-risk actions always return `require_approval`                                      |
| L4 Trusted automation | Granted actions run, except financial and destructive actions which always need a human |

Every decision is subject (in later stages) to cost policies (Stage 11),
company rules (Stage 03) and the execution controller (Stage 06).

## Company knowledge & Agent Context Engine (Stage 03)

Details: `docs/KNOWLEDGE_SYSTEM.md`.

- **Structured company profile.** Identity, business, brand and compliance
  sections are typed columns on `companies` (no free-form JSON blob), edited
  per section through strict schemas (`PUT /v1/companies/:ref/profile/:section`).
  The AI operations policy is a 1:1 table (`company_ai_policies`).
- **Knowledge library.** Versioned `knowledge_items` with provenance,
  verification, confidence, sensitivity, lifecycle and freshness; explicit
  task/agent links; Postgres full-text search (generated `tsvector` + GIN,
  `websearch_to_tsquery`) — no external search service.
- **Rules engine.** `brand_rules`, `commercial_rules`, `compliance_rules` —
  generic, queryable structures (IF company AND action THEN effect) evaluated by
  `evaluateCompanyAction`; nothing company-specific is hard-coded.
- **Context Engine.** `@aibos/context-core` is pure and deterministic:
  `assembleContextPack(request, sources)` → `AgentContextPack`. `@aibos/db`
  loads the sources (`loadContextSources`, `PostgresKnowledgeRetriever`) and
  enforces that the agent serves the company and the task belongs to it.
- **Context precedence.** P1 management-approved rules/policies → P2 approved
  profile → P3 official documents/data → P4 SOPs → P5 verified company research
  → P6 verified external information → P7 unverified research → P8 inference.
- **Source of truth.** The database is authoritative; AI output enters as
  DRAFT/UNVERIFIED and needs human verification before approval.
- **Future provider relationship.**

```
Task → Context Engine → AgentContextPack → renderContextPack() → AIProvider.executeTask()
```

Providers (Stages 07–09) receive only the pack. They never query company
tables, never see other companies' data and never get raw conversation
history. Semantic retrieval can later replace the `KnowledgeRetriever`
implementation without changing the engine or its isolation guarantees.
