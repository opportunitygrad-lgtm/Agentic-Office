# Data model

PostgreSQL 16, managed by Drizzle (`packages/db/src/schema.ts`, migrations in
`packages/db/drizzle`). All ids are UUIDv4, timestamps are `timestamptz`, money
is `numeric(14,6)` in **USD** (provider billing currency) mapped to `number`.

## Entities

| Table                       | Purpose                                                   | Notes                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companies`                 | A business run by the OS. Unlimited.                      | Identity, locale, audiences/markets/products (text[]), objectives, brand, rules, prohibited claims, compliance, default provider, daily/monthly AI budget, concurrency (1–50), status, versioned `settings` JSONB. Unique `slug`.                                                                                                           |
| `departments`               | Teams. `company_id NULL` = global.                        | Unique `(company_id, slug)` with `NULLS NOT DISTINCT`.                                                                                                                                                                                                                                                                                      |
| `agent_templates`           | Code-owned template definitions synced to DB.             | Department, default/fallback provider, autonomy, responsibilities, tools, prohibited actions, approval gates, capabilities, `prompt_version` (Stage 05).                                                                                                                                                                                    |
| `agents`                    | Independent workers.                                      | Template, scope (`global`/`company`), status, department, `reports_to_agent_id`, primary/fallback provider, preferred model, autonomy, instructions, responsibilities, prohibited actions, allowed tools, read/write permissions, approval requirements, per-task/daily budget, max searches, max retries, concurrency, temporary + expiry. |
| `agent_company_assignments` | Many-to-many agent ↔ company.                             | `is_primary`, `role`. An agent can serve one, several, or (scope=global) all companies.                                                                                                                                                                                                                                                     |
| `tasks`                     | First-class work items.                                   | Company, type, priority, status, assigned agent, creator (`created_by_kind/ref`), `parent_task_id`, `root_task_id`, `depth`, required provider, estimated/actual cost, progress 0–100, current action/tool, approval flag, due/started/completed, error, result summary.                                                                    |
| `approvals`                 | Human-in-the-loop gates.                                  | Type (11), risk level, requested action, explanation, proposed change, before/after state (JSONB), status, requested/expires/decided, decided by, notes.                                                                                                                                                                                    |
| `audit_events`              | Append-only audit trail.                                  | Company, agent, task, human actor, namespaced `action` (e.g. `email.sent`), tool, provider, description, metadata, before/after, outcome, error, IP (`inet`), session, user agent, request id. FKs `SET NULL` so history survives deletions.                                                                                                |
| `integrations`              | Integration instances. `company_id NULL` = platform-wide. | Kind (16), status, auth state, capabilities, non-secret `config`, `credential_ref` (pointer, **never a secret**), last health check / successful sync / error.                                                                                                                                                                              |
| `ai_usage_records`          | Cost ledger (one row per call).                           | Provider, model, company, agent, task, request id, input/output/cached tokens, tool cost, provider cost, estimated/actual cost, timestamp.                                                                                                                                                                                                  |
| `budget_policies`           | Budget rules (not enforced until Stage 11).               | Scope: `task`, `agent_day`, `company_day`, `company_month`, `provider_day`, `global_day`; limit, warn %, action (`warn`/`require_approval`/`block`).                                                                                                                                                                                        |

## Status vocabularies

Defined once in `packages/shared/src/enums.ts` and turned into pgEnums.

- **Agent:** sleeping, queued, working, waiting, blocked, needs_approval, paused, failed, completed, offline
- **Task:** queued, assigned, running, waiting, needs_approval, paused, completed, failed, cancelled
- **Approval:** pending, approved, rejected, expired, cancelled
- **Approval type:** email_send, ad_launch, ad_budget_increase, financial_action, deep_research, browser_action, website_deployment, code_deployment, legal_commercial_action, destructive_action, custom
- **Provider:** CLAUDE, OPENAI, GROK, LOCAL
- **Autonomy:** observe, suggest, act_with_approval, autonomous_limited, autonomous
- **Data origin:** live, dev_seed

## Task hierarchy

`parent_task_id` gives the direct parent; `root_task_id` points at the top of
the tree (equal to `id` for roots) and `depth` its level. `createTask()`
inherits company and root from the parent, so a
Manager → Research → Verification → Email chain is queryable as one tree
(`GET /v1/tasks/:id/tree`) without recursive SQL.

## Extending company settings safely

`companies.settings` is JSONB validated by `companySettingsSchema` (versioned,
with defaults, `.loose()`), so new structured settings can be added without a
migration and old rows stay valid. Promote a setting to a column when it needs
indexing or constraints.

## Reference vs development data

- **Reference data** (`src/seed/reference.ts`): global departments, agent
  templates and platform-wide integration placeholders — required in every
  environment, upserted idempotently.
- **Development seed** (`src/seed/dev/`): the three companies (upserted by
  slug), 18 agents, 13 tasks (incl. a 4-level hierarchy), 5 approvals,
  audit events, 35 days of mock usage, budget policies and per-company
  integration placeholders. All stored with `origin = 'dev_seed'`, replaced on
  every `pnpm db:seed`, refused in production unless `ALLOW_DEV_SEED=true`.
