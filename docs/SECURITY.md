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

## Password security

- **Hashing:** argon2id via `@node-rs/argon2` (19 MiB memory, t=2, p=1 —
  OWASP recommendation). Stored as a PHC string; never reversible, never
  returned by any API response (`UserDTO` has no hash field; tests assert it).
- **Policy:** 12–128 characters, not mostly whitespace, not a known-common
  password (NIST SP 800-63B: length over composition rules).
- **Reset tokens:** 256-bit random, stored as SHA-256, **single-use**, expire
  after 60 minutes, newest token invalidates older ones. Completing a reset
  revokes all of the user's sessions. Invalid, expired and used tokens are
  indistinguishable (`invalid_token`).
- **Invitations:** same token model, 7-day expiry; the link is shown once to
  the inviter (email delivery arrives in Stage 14). Token lookups use POST
  bodies so tokens never appear in API URLs or request logs.

## Session security

- Server-side sessions; the cookie holds a random token, the database holds
  only its SHA-256 (a database leak cannot hijack sessions).
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production
  (`COOKIE_SECURE` override). No tokens in localStorage or JS-readable storage.
- 24 h sliding idle timeout, 7-day absolute lifetime; new session on every
  sign-in (rotation); logout, password reset, suspension and disabling revoke
  server-side immediately. Each request re-checks session **and** account status.
- CSRF: SameSite cookies, `Origin` allow-list (`WEB_ORIGIN`, `API_CORS_ORIGINS`)
  on every unsafe method, JSON-only bodies (`text/plain`/form posts → 415).
- Audit logs store a 16-character session _reference_, never the token.

## Login protection

- Generic "Invalid email or password" for unknown users and wrong passwords;
  unknown emails still run an argon2 verification (uniform timing).
- Account status (disabled/suspended) is only revealed **after** the correct
  password is supplied, so it cannot be used for enumeration.
- Throttling (Redis fixed windows, in-memory fallback): 30 sign-in attempts /
  15 min per IP; 5 failures / 15 min per account (→ 429); password-reset
  requests 10/h per IP and 3/h per email; token endpoints 20 / 15 min per IP.
- Failed, blocked and successful sign-ins are audited (`auth.*`).
- Architecture is ready for MFA / WebAuthn / SSO: they become additional
  authentication methods issuing the same sessions (`sessions.auth_level`).

## Authorization & company isolation

- Every `/v1` route requires a session except `auth/status`, `auth/login`,
  `auth/logout`, password-reset and invitation endpoints; `GET /health`
  is public but returns only `{status, checkedAt}` in production (details at
  authenticated `/v1/system/health`).
- 401 = not authenticated (`unauthenticated`, `session_expired`,
  `account_disabled`); 403 = authenticated but not authorised.
- Permissions, not role names, decide access. Company-scoped queries always
  receive an `AccessScope` from the authenticated principal; `?company=` is
  never trusted. For non-global users, unknown and forbidden companies return
  the same 403 (no existence leak) and forbidden attempts on real companies
  are audited as `security.unauthorized_access`.
- IDOR guards: single agents, tasks, approvals, users and memberships are
  loaded through the caller's scope; invisible records return 403/404.
- Privilege escalation guards: no granting roles you don't fully hold, no
  acting on users whose roles exceed yours, no self role/status changes, no
  removing the last Platform Owner, system roles locked, company roles cannot
  hold platform permissions. Denials are audited.
- Approval decisions require every permission in `required_permissions`;
  decisions are atomic (pending → approved/rejected exactly once) and audited.
- Agents are a separate principal with default-deny `canAgent` evaluation;
  no autonomy level bypasses permissions, and financial/destructive actions
  always require a human.

## Knowledge sensitivity & context isolation (Stage 03)

- **Classification:** PUBLIC · INTERNAL · CONFIDENTIAL · RESTRICTED.
- **Humans:** reading CONFIDENTIAL/RESTRICTED knowledge needs
  `knowledge.confidential.read` / `knowledge.restricted.read` for that company.
  Such items are omitted from lists (never counted for text searches, so search
  is not a content oracle), return 403 with a `security.knowledge_access_denied`
  audit event on direct access, and are redacted in context previews.
  Nobody can create, re-classify or grant access above their own clearance.
- **Agents:** PUBLIC + INTERNAL by default; CONFIDENTIAL/RESTRICTED only via an
  explicit `knowledge_access_policies` grant (agent, department or all company
  agents), managed with `agent.permissions.manage`.
- **Context isolation:** a context pack contains only the requested company's
  knowledge and rules plus explicitly GLOBAL ones. The loader verifies the agent
  serves the company and the task belongs to it; the engine re-checks every
  candidate and blocks (and counts) anything from another company, even when
  linked to the task. Links can only be created within one company. Shared
  ownership never implies shared knowledge; cross-company context is not
  supported in Stage 03.
- **Authority:** approving company knowledge needs `knowledge.approve`; GLOBAL
  knowledge and GLOBAL rules need `knowledge.global.manage` (a global
  membership — a group admin scoped to some companies cannot change what every
  company's agents see). Rules bind agents only after `policy.approve`.
- **AI output:** never authoritative on its own — DRAFT/UNVERIFIED until a
  human verifies it; never `management_confirmed` (database constraint).
- **Logging:** knowledge audit events record ids, types, sensitivity and
  changed field names — never content; confidential/restricted titles are
  replaced by a label. Context previews are audited with counts only.
- **Profile updates:** per-section strict schemas; unknown keys (status,
  budgets, slug) are rejected with 400; compliance needs `policy.manage`, the
  AI policy `company.settings.manage`.

## Delegation & workforce security (Stage 04)

- **Company isolation in delegation.** Candidates are only agents serving the
  task's company (or global agents); `company`, `status`, `circular` and
  `permission` are hard checks that no override can bypass (cross-company
  attempts return 403 and are audited as `delegation.blocked`). Every agent,
  team and task id in a request must be visible to the caller (404 otherwise).
- **Delegation preview** needs `agent.view` in the company and only lists
  candidates the viewer can already see (department-restricted managers never
  learn about other departments' agents).
- **Assignment authority.** Delegating needs `agent.delegation.manage`;
  assigning/reassigning `task.assign`; pausing `task.pause`. Department-restricted
  people can only act on their departments' tasks and cannot move work to
  agents outside them. Overriding a soft check requires a written reason; all
  assignments are audited.
- **Role edits cannot grant authority.** Editing roles needs
  `agent.role.manage` in every company the agent serves (global agents and
  global templates need the platform-level permission). The compiler resolves
  conflicts in favour of permissions and company/global policy; override
  attempts in lower layers are rejected, never applied. Capabilities never
  imply permissions.
- **Hierarchy.** Reporting lines are same-company (or global) and cycles are
  rejected; delegation never loops back into its chain and stops at the depth
  limit (`min(platform, role)`).
- **Temporary agents** are task- and company-bound, expire, have fixed budgets
  within the parent's, inherit prohibitions, are capped at Limited operator and
  never get a permission the parent cannot exercise. Only a person with
  platform-level `agent.permissions.manage` can allow a worker to create
  further workers; agent-initiated creation is approval-gated.
- **Handoffs** carry summaries, verified facts and references — never the
  source agent's context. Evidence must be same-company/global, within the
  destination agent's sensitivity clearance and readable by the person creating
  the handoff; restricted titles are redacted in listings; contact data is only
  referenced. The destination assembles its own Context Pack.
- **Teams & org chart** are scoped to companies where the viewer holds both
  `team.view` and `agent.view`; members must serve the team's company; GLOBAL
  teams and the workforce policy need platform-level permissions.
- **Conversations** are private to their owner; no AI is called in Stage 04.

## AI execution security (Stage 05 / 05A)

| Risk                             | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential exposure              | Default Claude Code transport: the app holds **no** Claude credential — no login form, never asks for passwords/cookies/tokens, never reads `.credentials.json` or the Keychain; it only runs `claude` (`--version`, `--help`, `auth status`, `-p`). Optional API transport: `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` only in process env (gitignored `.env`), never stored, returned, rendered, logged or audited. Errors are normalised messages. |
| Shell / argument injection       | `spawn` with an argument array and `shell: false`; task, company and user text only on stdin; model/effort args validated; tested with hostile `;`, `$()`, backtick and pipe payloads.                                                                                                                                                                                                                                                                  |
| Environment inheritance          | Claude Code child gets an allowlisted env: never `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (would override the subscription), never `ANTHROPIC_BASE_URL` unless `CLAUDE_CODE_ALLOW_BASE_URL=true`, never app secrets. The user's shell env is untouched.                                                                                                                                                                                               |
| Accidental / hidden API billing  | Transport fixed by configuration, no runtime fallback. `auth status` refuses API-key logins (`MISCONFIGURED`); a run whose `init` reports an API key source is killed before any request (`API_BILLING_REFUSED`). Usage limits → `SUBSCRIPTION_LIMIT_REACHED`, never credits or API.                                                                                                                                                                    |
| Subscription exhaustion          | `CLAUDE_CODE_MAX_CONCURRENCY` (1) worker concurrency + semaphore; runs per task/agent per day and request-size limits; no retries on usage limits.                                                                                                                                                                                                                                                                                                      |
| Subprocess orphaning             | Every child tracked; Stop/timeout send SIGTERM then SIGKILL; worker shutdown and process exit kill remaining children.                                                                                                                                                                                                                                                                                                                                  |
| Cross-company execution          | Run start, view, stream, stop and feedback resolve the run's company and check the permission in that company (404 otherwise). `?company=` is never trusted; chat conversations belong to their owner.                                                                                                                                                                                                                                                  |
| Restricted leakage               | Context Pack built only for the run's company and capped at `min(agent clearance, starter clearance)`; stored on the run so worker-side builds cannot widen it. Isolation is enforced in software, not by the model.                                                                                                                                                                                                                                    |
| Prompt injection                 | System blocks carry authority; company context, history and the user message are fenced as data (`trust="data"`), look-alike tags neutralised. No tools are sent, so injected text cannot act.                                                                                                                                                                                                                                                          |
| Routing bypass / tier escalation | Router is deterministic and server-side; premium requires the company's `premiumAllowed`; agents can lower but never raise effort; no automatic Opus; no silent fallback.                                                                                                                                                                                                                                                                               |
| Budget bypass                    | Preflight (task, agent, company daily/monthly, provider, global) + reservations under advisory locks before enqueue; the provider is never called first; mock usage never counts.                                                                                                                                                                                                                                                                       |
| Duplicate calls                  | One active run per task/conversation (DB partial unique indexes), idempotency keys, atomic `begin()`; recovery never re-pays a started call (`NEEDS_REVIEW`).                                                                                                                                                                                                                                                                                           |
| Cancellation                     | Stop aborts the real HTTP request (API) or terminates the Claude Code child process (verified gone in tests).                                                                                                                                                                                                                                                                                                                                           |
| Unbounded retries                | SDK retries off; at most one retry for transient typed errors; every call has a timeout.                                                                                                                                                                                                                                                                                                                                                                |
| Result overwriting               | Each run stores its own result; reruns create new runs.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Logs                             | Worker/API logs carry ids, status, model, timings — never context, prompts, output or credentials.                                                                                                                                                                                                                                                                                                                                                      |
| Live tests in CI                 | `pnpm test` / `test:e2e` use mocks and a fake `claude` binary (zero usage); `pnpm test:claude-subscription-live` / `test:claude-live` refuse without `ALLOW_LIVE_AI_TESTS=true`; mock mode refused in production.                                                                                                                                                                                                                                       |
| Connection test abuse            | Platform-only `provider.test`, audited, 5 per 10 minutes per user; Claude Code test = local CLI checks only (no model call), API test = `models.retrieve` (token-free).                                                                                                                                                                                                                                                                                 |
| Terms boundary                   | Private, owner-operated: no "Login with Claude" for other users, no sharing or redistribution of the owner's subscription, not presented as an Anthropic-approved integration; a commercial multi-user product may need Anthropic approval or API authentication.                                                                                                                                                                                       |

## OpenAI Codex execution security & second-opinion review (Stage 06)

| Risk                             | Control                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Credential exposure              | Default Codex CLI transport: the app holds **no** Codex/ChatGPT credential — no login form, never asks for passwords/session cookies, never reads `~/.codex/auth.json` directly; it only runs `codex` (`--version`, `exec --help`, `doctor --json`, `exec`). Optional API transport is declared but **not implemented** — selecting `OPENAI_TRANSPORT=openai_api` registers OPENAI as not-connected, it does not fall back to an API key. |
| Shell / argument injection       | `spawn` with an argument array and `shell: false`; task, company and user text only on stdin; model/effort/config args are constructed by the provider, never from user-controlled strings; tested with hostile `;`, `$()`, backtick and pipe payloads.                                                          |
| Environment inheritance          | Codex child gets an allowlisted env: never `OPENAI_API_KEY`/`OPENAI_ADMIN_KEY` or any var selecting a custom API backend/org/project/auth mode, never app secrets (DATABASE_URL, REDIS_URL, other providers' credentials). The user's shell env is untouched.                                                    |
| Accidental / hidden API billing  | `stream()` runs a `codex doctor --json` pre-flight *before every call* (Codex has no per-turn auth signal in its event stream, unlike Claude Code): `stored auth mode === "api_key"` or an API auth env var present → `MISCONFIGURED`, execution blocked before any request. No runtime fallback from subscription to API. |
| Filesystem access                | Every run gets an isolated temporary working directory (`-C <dir>`), never the Business OS repository, user Desktop/Documents/Downloads, or SSH files; `--sandbox read-only` and no approval escalation (no `-a`, no `--dangerously-bypass-approvals-and-sandbox`, no `--full-auto`) — anything outside the sandbox fails rather than runs. |
| Subscription exhaustion          | `CODEX_MAX_CONCURRENCY` (default 1) enforced by a per-provider semaphore inside `CodexCliProvider`; the worker's overall concurrency is sized to the *sum* of Claude's and Codex's limits, never a single shared number that starves one behind the other. |
| Subprocess orphaning             | Every Codex child tracked the same way as Claude Code children; Stop/timeout send SIGINT (Codex's graceful-interrupt signal) then SIGKILL; worker shutdown kills remaining Codex children. |
| Hidden reasoning                 | Codex's `reasoning` stream items are never read, stored, streamed to the client, or passed to a reviewer — only the final `agent_message`/structured result and observable provider events are kept, for both providers alike. |
| Second-opinion self-review       | `requestSecondOpinion()` rejects a request where `reviewerProvider === reviewedRun.provider`; a review of a run that is itself `run_purpose = 'second_opinion'` is rejected (no recursive review chains). |
| Second-opinion isolation         | The reviewer's Context Pack is rebuilt fresh and capped to `min(the original run's own viewer clearance, the requester's clearance)` — a reviewer can never see more than the original run itself was cleared to see, even if the person requesting the review personally holds higher clearance. Verified with a live Postgres integration test using seeded restricted knowledge. |
| Second-opinion prompt injection  | The original task/result is fenced as `trust="data"` exactly like any other untrusted input (`original_task`/`original_result` are in the same tag-neutralisation allowlist as `task`/`company_context`); the neutral `REVIEW_FRAME` system prompt carries authority and explicitly bans "find faults" or ranking instructions. |
| Second-opinion authority         | A `ProviderReview` is stored as analysis on its own run — it never automatically edits the original run's result, approved knowledge, company policy, or financial rules, and never sends anything externally. |
| Review dedup / cost control      | At most one active review per (run, reviewer provider) is ever in flight; a completed one is reused unless a manual rerun (`force: true`) is explicitly requested; `company_ai_policies.max_reviews_per_task` caps total stored reviews per run even with `force`. |
| Task-claim safety                | A second-opinion run shares `taskId`/`agentId` with the primary run for budget/history grouping only — `RunStore`'s claim-release and task-status-transition logic explicitly skip `run_purpose = 'second_opinion'` runs, so completing, failing or cancelling a review can never release the primary task's execution claim or flip its status. |
| Live tests in CI                 | `pnpm test` / `test:e2e` use mocks and a fake `codex` binary (zero usage); `pnpm test:openai-subscription-live` refuses without `ALLOW_LIVE_AI_TESTS=true` and never invokes live Claude in the same run (the review's "original" is a stored fixture). |
| Connection test abuse            | Same platform-only `provider.test`, audited, rate-limited path as Claude; Codex test = local CLI checks only (`doctor --json`), never a model call. |
| Terms boundary                   | Private, owner-operated: no "Login with ChatGPT" for other users, no sharing or redistribution of the owner's subscription, not presented as an OpenAI-approved integration. |

## Security logging

- Append-only `audit_events` with `actor_type`, `actor_user_id` /
  `actor_service_id` / `agent_id`, company, task, resource, request id,
  session reference, IP and user agent.
- API request logs redact cookies, authorization headers, `Set-Cookie` and
  `token=` query parameters. Development-only password-reset links are
  logged to the API console when no email transport exists; never in production.

## Bootstrap administrator procedure

1. Deploy, run migrations. Set `BOOTSTRAP_ADMIN_EMAIL` in the server environment.
2. Run `pnpm auth:bootstrap` in a terminal on the server. It refuses to run if
   **any** user exists (checked under a PostgreSQL advisory lock).
3. Enter the password at the hidden prompt (or pipe it with
   `--password-stdin` from a secret manager). It is validated against the
   password policy and never written to disk, env files or logs.
4. The Platform Owner is created with a global membership; the event is
   audited as `SERVICE: bootstrap-cli` (`auth.bootstrap_admin_created`).
5. Remove `BOOTSTRAP_ADMIN_EMAIL`. Further administrators are invited from
   Settings → Users & Access.

Development seed accounts (`*@aibos.example`) are never created in
production: `pnpm db:seed` refuses when `NODE_ENV=production`.

## Remaining exposure notes

- Do not expose the stack publicly until deployment hardening (Stage 37/39):
  TLS termination, `NODE_ENV=production`, correct `WEB_ORIGIN`, and a
  reviewed CSP.
- Email delivery for resets/invitations is not configured (Stage 14).

## Planned hardening

Stage 12 (credential vault — AI provider keys move there too), 33 (approval engine: expiry, delegation,
multi-person), 34 (audit immutability/export), 38 (backups), 39 (rate
limiting at the edge, CSP, dependency and secret scanning, pen-test fixes).
