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

| Path                        | Responsibility                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                  | Next.js 16 command centre. Server components fetch the API; `/api/*` is rewritten to the API so the browser is same-origin. |
| `apps/api`                  | Fastify 5 HTTP API (`/v1/*`, `/health`). Thin: validates with Zod, calls repositories, maps errors.                         |
| `apps/worker`               | BullMQ workers. Stage 01: heartbeat (drives worker health) and a no-op `agent-tasks` processor.                             |
| `packages/shared`           | Enums (single source of truth for every status vocabulary), Zod schemas, API DTO types, formatting helpers. Browser-safe.   |
| `packages/db`               | Drizzle schema, migrations, repositories (data-access layer returning DTOs), reference data sync, development seed.         |
| `packages/agent-core`       | Agent template definitions, departments, task-routing contract + reference router.                                          |
| `packages/provider-core`    | `AIProvider` contract, mock providers, unconfigured live adapters, provider router, placeholder pricing.                    |
| `packages/integration-core` | Integration catalogue (16 systems), adapter contract, placeholder adapter.                                                  |
| `packages/browser-core`     | Browser-worker contracts and the mock live-session generator behind `LiveAgentScreen`.                                      |
| `packages/ui`               | Accessible UI primitives (buttons, status pills, progress, panels, sparkline, skeletons) and status-tone mapping.           |
| `infrastructure`            | Docker Compose for PostgreSQL 16 and Redis 7 (development).                                                                 |

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
10. **Authentication deferred to Stage 02.** Requests act as `dev-user`; the
    `Actor` abstraction already threads user, IP, user agent and request id
    into audit events so Stage 02 only has to supply a real identity.

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
