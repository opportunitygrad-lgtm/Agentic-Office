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

Stage 12 (credential vault), 33 (approval engine: expiry, delegation,
multi-person), 34 (audit immutability/export), 38 (backups), 39 (rate
limiting at the edge, CSP, dependency and secret scanning, pen-test fixes).
