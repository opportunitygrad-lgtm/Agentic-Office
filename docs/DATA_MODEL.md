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

## Identity & access (Stage 02)

| Table                     | Purpose                        | Notes                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                   | Human accounts (HumanUser).    | `email`, unique `email_normalized`, names, display name, avatar, argon2id `password_hash` (NULL until an invitation is accepted; never returned by the API), `status` (invited/active/suspended/disabled), timezone, locale, `last_login_at`, `password_changed_at`, `disabled_at`. |
| `sessions`                | Server-side sessions.          | PK = SHA-256 of the cookie token; `expires_at` (sliding), `absolute_expires_at`, `last_seen_at`, IP, user agent, `auth_level` (future MFA), `revoked_at`/`revoked_reason`.                                                                                                          |
| `auth_tokens`             | Single-use tokens.             | `type` (password_reset, invitation), unique `token_hash`, `expires_at`, `used_at`, `created_by_user_id`. Newer tokens invalidate older ones of the same type.                                                                                                                       |
| `permissions`             | Human permission catalogue.    | `key` PK (e.g. `approval.financial`), category, label, description, scope (company/global), sensitive flag. Synced from code.                                                                                                                                                       |
| `roles`                   | Role definitions.              | Unique `key`, name, description, scope (global/company), optional `company_id` for company-specific custom roles, `is_system`, `rank`.                                                                                                                                              |
| `role_permissions`        | Role ↔ permission (M:N).       | System role rows are rewritten from code on every sync.                                                                                                                                                                                                                             |
| `company_memberships`     | User ↔ company with a role.    | `company_id` NULL = global membership (all companies). Status (invited/active/suspended/revoked), `joined_at`, `invited_by_user_id`. Unique `(user_id, company_id)` NULLS NOT DISTINCT.                                                                                             |
| `membership_departments`  | Department-scoped access.      | A membership with rows here only covers those departments (User → Company → Department → Role).                                                                                                                                                                                     |
| `approval_requirements`   | Approval authority rules.      | `approval_type` (or `*`), `min_risk_level`, `required_permission`, optional `company_id` for company-specific extra rules.                                                                                                                                                          |
| `agent_permission_grants` | Agent tool/action permissions. | `permission` (`tool.*`, `action.*`), `effect` (allow / require_approval / deny), `company_id` NULL = all assigned companies, `constraints` JSONB (future caps). Unique `(agent_id, company_id, permission)`.                                                                        |
| `service_identities`      | Internal service principals.   | `key` PK (worker, email-monitor, …), name, description, active flag.                                                                                                                                                                                                                |

Changes to existing tables:

- `agents.autonomy` / `agent_templates.autonomy` — new `agent_autonomy` enum
  (disabled, observe, limited_operator, approval_gated, trusted_automation),
  replacing the Stage 01 vocabulary (migrations 0001–0002 map old values).
- `approvals.required_permissions`, `approvals.decided_by_user_id`.
- `audit_events.actor_type` (human/agent/service/system/anonymous),
  `actor_user_id`, `actor_service_id`, `resource_type`, `resource_id`
  (`session_id` holds a short, non-reversible session reference).

Audit action names are namespaced (Stage 01 convention): `auth.login_succeeded`,
`auth.login_failed`, `auth.login_blocked`, `auth.logout`, `auth.password_reset`,
`auth.bootstrap_admin_created`, `user.invited`, `user.invitation_accepted`,
`user.role_assigned`, `user.disabled`, `user.suspended`, `role.created`,
`role.permissions_changed`, `agent.autonomy_changed`, `agent.permissions_changed`,
`approval.approved`, `approval.rejected`, `security.unauthorized_access`,
`security.approval_denied`, `security.privilege_change_denied`.

## Status vocabularies

Defined once in `packages/shared/src/enums.ts` and turned into pgEnums.

- **Agent:** sleeping, queued, working, waiting, blocked, needs_approval, paused, failed, completed, offline
- **Task:** queued, assigned, running, waiting, needs_approval, paused, completed, failed, cancelled
- **Approval:** pending, approved, rejected, expired, cancelled
- **Approval type:** email_send, ad_launch, ad_budget_increase, financial_action, deep_research, browser_action, website_deployment, code_deployment, legal_commercial_action, destructive_action, custom
- **Provider:** CLAUDE, OPENAI, GROK, LOCAL
- **Autonomy:** disabled (L0), observe (L1), limited_operator (L2), approval_gated (L3), trusted_automation (L4)
- **User:** invited, active, suspended, disabled · **Membership:** invited, active, suspended, revoked
- **Actor type:** human, agent, service, system, anonymous · **Grant effect:** allow, require_approval, deny
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
  templates, platform-wide integration placeholders, the permission
  catalogue, system roles, default approval requirements and service identities — required in every
  environment, upserted idempotently.
- **Development seed** (`src/seed/dev/`): the three companies (upserted by
  slug), 6 development user accounts, 18 agents (with template grants), 13 tasks (incl. a 4-level hierarchy), 5 approvals,
  audit events, 35 days of mock usage, budget policies and per-company
  integration placeholders. All stored with `origin = 'dev_seed'`, replaced on
  every `pnpm db:seed`, refused in production unless `ALLOW_DEV_SEED=true`.
