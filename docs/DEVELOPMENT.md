# Development

## Prerequisites

- Node.js **24 LTS** (`.nvmrc`; ≥ 22.12 works) and pnpm 10 (`corepack enable`)
- Docker Desktop (macOS) or Docker Engine (Ubuntu)

## First run

```bash
cp .env.example .env          # local defaults work as-is
pnpm install
pnpm infra:up                 # PostgreSQL 16 + Redis 7 (waits until healthy)
pnpm db:migrate               # apply migrations
pnpm db:seed                  # reference data + development seed
pnpm dev                      # web :3000, api :4000, worker
```

Open http://localhost:3000 and sign in with a development account.

## Signing in (development)

`pnpm db:seed` creates **DEVELOPMENT SEED accounts** — never use them in
production (the seed refuses to run when `NODE_ENV=production`). All share the
password `aibos-dev-only-password`:

| Email                        | Access                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `owner@aibos.example`        | Platform Owner — all companies                                  |
| `group.admin@aibos.example`  | Group Admin — Euro Pilot Training + Opportunitygrad             |
| `ept.manager@aibos.example`  | Company Manager — Euro Pilot Training only                      |
| `pa.manager@aibos.example`   | Company Manager — PilotsAssist only                             |
| `og.marketing@aibos.example` | Department Manager — Opportunitygrad, Marketing department only |
| `disabled@aibos.example`     | Disabled account (sign-in is refused)                           |

Password reset emails are not sent yet (Stage 14): in development the API logs
the reset link (`DEVELOPMENT ONLY — password reset link`). Invitation links are
shown once to the inviter in Settings → Users & Access.

## Company knowledge (development)

`pnpm db:seed` also loads DEVELOPMENT SEED profiles, knowledge and rules for the
three companies (known high-level facts only; everything is editable and is
reset by the next seed). Useful places to look:

- `/companies/<slug>` — profile tabs (Overview, Business, Brand, Commercial,
  Compliance, AI Policy, Knowledge, History).
- `/workforce/agents/<id>` and `/tasks/item/<id>` — Context Preview.
- `/settings/knowledge` — GLOBAL knowledge.

Try `ept.manager@aibos.example` to see restricted items hidden and redacted.

## First administrator (empty database)

```bash
BOOTSTRAP_ADMIN_EMAIL=you@company.com pnpm auth:bootstrap
```

Prompts for the password; refuses if any user exists. See docs/SECURITY.md.

## Commands

| Command                                       | What it does                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Start/stop/tail Docker services                                             |
| `pnpm db:migrate`                             | Apply Drizzle migrations to `DATABASE_URL`                                  |
| `pnpm db:generate`                            | Generate a migration after editing `packages/db/src/schema.ts`              |
| `pnpm db:seed`                                | Sync reference data and (re)load development seed rows                      |
| `pnpm db:reset`                               | Drop schema, migrate and seed (development only)                            |
| `pnpm auth:bootstrap`                         | Create the first Platform Owner on an empty database (prompts for password) |
| `pnpm dev`                                    | Run web, API and worker together (or `dev:web`, `dev:api`, `dev:worker`)    |
| `pnpm test`                                   | All Vitest suites (unit, DB, API, frontend). DB/API tests need `infra:up`   |
| `pnpm test:e2e`                               | Playwright flows (needs `pnpm dev`; execution flows need mock mode, below)  |
| `pnpm test:claude-live`                       | Guarded live Claude smoke (see "Claude configuration")                      |
| `pnpm typecheck`                              | `tsc --noEmit` in every workspace                                           |
| `pnpm lint`                                   | ESLint (zero warnings allowed)                                              |
| `pnpm format` / `format:check`                | Prettier                                                                    |
| `pnpm check`                                  | lint + typecheck + test                                                     |

Targeted runs: `pnpm --filter @aibos/api test`, `pnpm --filter @aibos/web test`.

## Claude configuration (Stage 05)

Add a credential to the local `.env` (never commit it, never paste it into a
chat) and restart `pnpm dev`:

```
ANTHROPIC_API_KEY=...            # or ANTHROPIC_AUTH_TOKEN=... (approved bearer)
# ANTHROPIC_WORKSPACE_ID=...     # optional
CLAUDE_DEFAULT_MODEL=claude-sonnet-5
CLAUDE_PREMIUM_MODEL=claude-opus-5-5
CLAUDE_DEFAULT_EFFORT=medium
CLAUDE_PREMIUM_EFFORT=high
AI_PROVIDER_TIMEOUT_MS=180000
CHAT_HISTORY_MAX_MESSAGES=12
```

Without a credential Settings → AI Providers shows Claude as _Not configured_
and runs are blocked with a clear message.

- **Mock mode (no credit):** `AIBOS_AI_PROVIDER_MODE=mock pnpm dev` uses the
  deterministic mock Claude in API and worker (optionally
  `AIBOS_MOCK_CHUNK_DELAY_MS=60` to watch streaming). Required for the
  execution E2E spec, which skips itself otherwise. Refused in production.
- **Live smoke:** `ALLOW_LIVE_AI_TESTS=true pnpm test:claude-live` — one
  connection test, one short Sonnet task on a `[DEV SMOKE TEST]` EPT task and
  one chat; prints tokens, cost and latency. Never part of `pnpm test` or
  `pnpm test:e2e`, never uses Opus.

## Tests

- **DB and API tests** use `TEST_DATABASE_URL` (default `aibos_test`). The
  database is created and migrated automatically by the Vitest global setup;
  each suite truncates operational tables. The helper refuses database names
  without `test`.
- **Frontend tests** run in jsdom with Testing Library; `next/navigation` is
  mocked in `src/test/next-navigation.ts`, fixtures live in `src/test/fixtures.ts`.
- **E2E**: `pnpm test:e2e`. If Playwright's bundled browser is unavailable,
  set `PLAYWRIGHT_CHROMIUM_PATH` to a local Chromium executable.

## Conventions

- Status vocabularies are defined once in `packages/shared/src/enums.ts`
  (knowledge vocabularies in `packages/shared/src/knowledge.ts`).
- Agents get company context only through `buildContextPack()`; never pass raw
  company tables or conversation history to a provider.
- Add API inputs as Zod schemas in `packages/shared/src/schemas.ts`; reuse
  them in the UI.
- Data access goes through `packages/db/src/repositories`; the API stays thin.
- Every meaningful mutation records an audit event in the same transaction.
- Development/demo rows must use `origin: "dev_seed"`.
- Never add live external calls outside their build-ledger stage.

## Troubleshooting

- _API unreachable page in the UI_: start the API (`pnpm dev:api`) and check
  `curl localhost:4000/health`.
- _Worker shows "no heartbeat"_: start the worker; it refreshes every 15 s.
- _Port 5432/6379 in use_: set `POSTGRES_PORT` / `REDIS_PORT` before
  `pnpm infra:up` and update the URLs in `.env`.
