# Security

## Principles

1. **No secrets in code, database or logs.** Secrets come only from the
   process environment. `.env` is git-ignored; `.env.example` lists names with
   empty values (the only non-empty values are local Docker development
   defaults).
2. **Least privilege for agents.** Every agent has explicit allowed tools,
   read/write permissions, prohibited actions and approval requirements.
   Autonomy starts at `suggest`/`act_with_approval` for anything external.
3. **Human approval for consequential actions.** Sending email, spending
   money, launching/scaling ads, deployments, legal/commercial and destructive
   actions go through the approval engine (Stage 33).
4. **Everything auditable.** Mutations write append-only `audit_events` with
   actor, request id, IP and user agent. Audit FKs use `SET NULL` so history
   survives deletions.
5. **Validate at every boundary.** Shared Zod schemas on the client, API and
   repository; database check constraints (budgets ≥ 0, concurrency 1–50,
   progress 0–100) as the final guard. Request bodies are capped at 256 KB.

## Secret handling

| Rule               | Detail                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage            | Local: `.env` (never committed). Production: host secret manager / Docker secrets injected as env vars (Stage 37).                                                                                   |
| Integration tokens | OAuth refresh/access tokens will be stored **encrypted** in a credential vault (Stage 12) using `CREDENTIALS_ENCRYPTION_KEY`. The `integrations.credential_ref` column holds only an opaque pointer. |
| Display            | The UI shows secret _names_ only (Settings → Secret slots), never values.                                                                                                                            |
| Logging            | Do not log request bodies containing credentials; future adapters must redact tokens.                                                                                                                |
| Rotation           | Rotate provider keys and OAuth secrets on staff changes or suspected exposure; the vault design supports re-encryption.                                                                              |
| Generation         | `openssl rand -base64 48` for `SESSION_SECRET`; 32 random bytes for `CREDENTIALS_ENCRYPTION_KEY`.                                                                                                    |

If a secret is ever committed: revoke/rotate it at the provider immediately,
then purge it from history. Deleting the file is not enough.

## Current posture (Stage 01)

- No authentication yet — **do not expose the stack to the internet**. The API
  binds to `127.0.0.1` by default and CORS allows only `API_CORS_ORIGINS`.
- Every request acts as `dev-user` (Stage 02 introduces users, sessions and
  RBAC).
- No live AI or integration calls are possible: adapters are placeholders.
- HTTP hardening: `@fastify/helmet` on the API; `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: DENY` on the web app; no
  `X-Powered-By`.
- Development seed data refuses to load when `NODE_ENV=production` unless
  `ALLOW_DEV_SEED=true`; `db:reset` is disabled in production.
- Tests refuse to run against a database whose name does not contain `test`.

## Planned hardening

Stage 02 (auth/RBAC), 12 (credential vault), 33 (approval engine), 34 (audit
immutability/export), 38 (backups), 39 (rate limiting, CSP, dependency and
secret scanning, pen-test fixes).
