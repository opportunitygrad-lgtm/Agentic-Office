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

Open http://localhost:3000.

## Commands

| Command                                       | What it does                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Start/stop/tail Docker services                                           |
| `pnpm db:migrate`                             | Apply Drizzle migrations to `DATABASE_URL`                                |
| `pnpm db:generate`                            | Generate a migration after editing `packages/db/src/schema.ts`            |
| `pnpm db:seed`                                | Sync reference data and (re)load development seed rows                    |
| `pnpm db:reset`                               | Drop schema, migrate and seed (development only)                          |
| `pnpm dev`                                    | Run web, API and worker together (or `dev:web`, `dev:api`, `dev:worker`)  |
| `pnpm test`                                   | All Vitest suites (unit, DB, API, frontend). DB/API tests need `infra:up` |
| `pnpm test:e2e`                               | Playwright responsive/navigation smoke (needs `pnpm dev` running)         |
| `pnpm typecheck`                              | `tsc --noEmit` in every workspace                                         |
| `pnpm lint`                                   | ESLint (zero warnings allowed)                                            |
| `pnpm format` / `format:check`                | Prettier                                                                  |
| `pnpm check`                                  | lint + typecheck + test                                                   |

Targeted runs: `pnpm --filter @aibos/api test`, `pnpm --filter @aibos/web test`.

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

- Status vocabularies are defined once in `packages/shared/src/enums.ts`.
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
