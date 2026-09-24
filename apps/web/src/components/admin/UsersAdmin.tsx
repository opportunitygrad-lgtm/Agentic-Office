"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Crown,
  Loader2,
  MailPlus,
  Plus,
  Search,
  ShieldOff,
  UserCheck,
  Users,
} from "lucide-react";
import type {
  CompanyRef,
  DepartmentDTO,
  MembershipDTO,
  RoleDTO,
  UserDTO,
  UserStatus,
} from "@aibos/shared";
import { Button, EmptyState, StatusPill, cn, type Tone } from "@aibos/ui";
import { relativeTime } from "@/lib/format";
import { Dialog } from "../common/Dialog";
import { hasPermission, useMe } from "../shell/SessionContext";
import { Avatar } from "../shell/UserMenu";

const USER_STATUS: Record<UserStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "live" },
  invited: { label: "Invited", tone: "info" },
  suspended: { label: "Suspended", tone: "attention" },
  disabled: { label: "Disabled", tone: "danger" },
};

const MEMBERSHIP_TONE: Record<MembershipDTO["status"], Tone> = {
  active: "live",
  invited: "info",
  suspended: "attention",
  revoked: "neutral",
};

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string; issues?: { message: string }[] };
  } & Record<string, unknown>;
  if (!res.ok)
    throw new Error(
      json?.error?.issues?.[0]?.message ?? json?.error?.message ?? `Request failed (${res.status})`,
    );
  return json;
}

function MembershipChip({ m }: { m: MembershipDTO }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] ring-1 ring-inset ring-line",
        m.status !== "active" && "opacity-60",
      )}
    >
      {m.company ? (
        <span
          className="size-2 shrink-0 rounded-[3px]"
          style={{ background: m.company.accentColor ?? "#64748b" }}
          aria-hidden="true"
        />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      )}
      <span className="truncate">
        {m.company?.name ?? "All companies"} · <span className="font-medium">{m.role.name}</span>
        {m.departments.length > 0 && (
          <span className="text-fg-faint"> · {m.departments.map((d) => d.name).join(", ")}</span>
        )}
      </span>
    </span>
  );
}

export interface UsersAdminProps {
  users: UserDTO[];
  roles: RoleDTO[];
  companies: CompanyRef[];
  departments: DepartmentDTO[];
}

export function UsersAdmin({ users, roles, companies, departments }: UsersAdminProps) {
  const me = useMe();
  const [q, setQ] = useState("");
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<UserDTO | null>(null);
  const canInvite = hasPermission(me, "user.invite");

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users.filter(
      (u) => !term || u.email.includes(term) || u.displayName.toLowerCase().includes(term),
    );
  }, [users, q]);
  const counts = { total: users.length, active: 0, invited: 0, inactive: 0 };
  for (const u of users) {
    if (u.status === "active") counts.active++;
    else if (u.status === "invited") counts.invited++;
    else counts.inactive++;
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["People", counts.total],
          ["Active", counts.active],
          ["Invited", counts.invited],
          ["Suspended / disabled", counts.inactive],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface px-4 py-3 shadow-panel">
            <dt className="text-[11.5px] text-fg-faint">{k}</dt>
            <dd className="num text-[22px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-2xl border border-line bg-surface shadow-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 p-4 sm:px-5">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search users"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              className="focus-ring h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13px]"
            />
          </div>
          {canInvite && (
            <Button
              variant="primary"
              icon={<MailPlus className="size-4" />}
              onClick={() => setInviting(true)}
            >
              Invite user
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <EmptyState className="m-4" icon={<Users className="size-5" />} title="No users found" />
        ) : (
          <ul className="divide-y divide-line/70" aria-label="Users">
            {visible.map((u) => {
              const status = USER_STATUS[u.status];
              return (
                <li
                  key={u.id}
                  className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_110px_minmax(0,2fr)_110px_auto] lg:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={u.displayName} owner={u.isPlatformOwner} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold">
                        {u.displayName}
                        {u.isPlatformOwner && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300">
                            <Crown className="size-3" aria-hidden="true" /> Platform Owner
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[12px] text-fg-muted">{u.email}</p>
                    </div>
                  </div>
                  <div>
                    <StatusPill tone={status.tone} label={status.label} />
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {u.memberships.length ? (
                      u.memberships.map((m) => <MembershipChip key={m.id} m={m} />)
                    ) : (
                      <span className="text-[12px] text-fg-faint">No visible memberships</span>
                    )}
                  </div>
                  <p className="text-[12px] text-fg-faint" suppressHydrationWarning>
                    {u.lastLoginAt ? `Seen ${relativeTime(u.lastLoginAt)}` : "Never signed in"}
                  </p>
                  <div className="lg:text-right">
                    <Button
                      size="sm"
                      onClick={() => setManaging(u)}
                      aria-label={`Manage ${u.displayName}`}
                    >
                      Manage
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite user"
        description="They'll receive a single-use link to set their password."
      >
        {inviting && (
          <InviteForm
            roles={roles}
            companies={companies}
            departments={departments}
            onDone={() => setInviting(false)}
          />
        )}
      </Dialog>
      <Dialog
        open={!!managing}
        onClose={() => setManaging(null)}
        title={managing?.displayName ?? "User"}
        description={managing?.email}
        side="right"
      >
        {managing && (
          <ManageUser
            key={managing.id}
            user={users.find((u) => u.id === managing.id) ?? managing}
            roles={roles}
            companies={companies}
          />
        )}
      </Dialog>
    </div>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  label,
  id,
}: {
  roles: RoleDTO[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  id: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring h-10 w-full rounded-lg border border-line bg-surface px-2.5 text-[13.5px]"
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isSystem ? "" : " (custom)"}
          </option>
        ))}
      </select>
    </div>
  );
}

function InviteForm({
  roles,
  companies,
  departments,
  onDone,
}: {
  roles: RoleDTO[];
  companies: CompanyRef[];
  departments: DepartmentDTO[];
  onDone: () => void;
}) {
  const router = useRouter();
  const me = useMe();
  const canGlobal = !!me?.globalPermissions.includes("security.manage");
  const inviteCompanies = companies.filter((c) => hasPermission(me, "user.invite", c.id));
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyId, setCompanyId] = useState<string>(
    inviteCompanies[0]?.id ?? (canGlobal ? "global" : ""),
  );
  // The API re-checks every grant (including no-escalation); this only trims obvious options.
  const assignable = roles.filter(
    (r) => r.key !== "platform_owner" || (canGlobal && companyId === "global"),
  );
  const [roleId, setRoleId] = useState<string>(
    roles.find((r) => r.key === "staff")?.id ?? roles[0]?.id ?? "",
  );
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const globalDepartments = departments.filter((d) => d.companyId === null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const json = await send("/api/v1/users/invitations", "POST", {
        email,
        firstName,
        ...(lastName ? { lastName } : {}),
        memberships: [
          { companyId: companyId === "global" ? null : companyId, roleId, departmentIds: deptIds },
        ],
      });
      setLink(String(json.invitationUrl));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation failed");
    } finally {
      setPending(false);
    }
  }

  if (link) {
    return (
      <div className="space-y-4 p-5" role="status">
        <p className="text-[13.5px] font-semibold">Invitation created for {email}</p>
        <p className="text-[12.5px] text-fg-muted">
          Email delivery arrives with the Outlook integration (Stage 14). Share this single-use link
          securely — it expires in 7 days and is shown only once.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{link}</code>
          <Button
            size="sm"
            icon={<Copy className="size-3.5" />}
            onClick={async () => {
              await navigator.clipboard?.writeText(link).catch(() => {});
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-5" aria-label="Invite user">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-[12.5px] font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px]"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-[12.5px] font-medium">First name</span>
          <input
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px]"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-[12.5px] font-medium">Last name</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px]"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-[12.5px] font-medium">Company</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="focus-ring h-10 w-full rounded-lg border border-line bg-surface px-2.5 text-[13.5px]"
          >
            {canGlobal && <option value="global">All companies (global access)</option>}
            {inviteCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <RoleSelect
          id="invite-role"
          label="Role"
          roles={assignable}
          value={roleId}
          onChange={setRoleId}
        />
      </div>
      {companyId !== "global" && (
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium">
            Restrict to departments <span className="font-normal text-fg-faint">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {globalDepartments.map((d) => {
              const on = deptIds.includes(d.id);
              return (
                <label
                  key={d.id}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-[12px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    on ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setDeptIds(on ? deptIds.filter((x) => x !== d.id) : [...deptIds, d.id])
                    }
                  />
                  {d.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || !companyId}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Send
          invitation
        </Button>
      </div>
    </form>
  );
}

function ManageUser({
  user,
  roles,
  companies,
}: {
  user: UserDTO;
  roles: RoleDTO[];
  companies: CompanyRef[];
}) {
  const router = useRouter();
  const me = useMe();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [addCompany, setAddCompany] = useState("");
  const [addRole, setAddRole] = useState(roles.find((r) => r.key === "staff")?.id ?? "");
  const isSelf = me?.user.id === user.id;

  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Change rejected");
    } finally {
      setPending(false);
    }
  }

  const canDisable = !isSelf && hasPermission(me, "user.disable");
  const addable = companies.filter(
    (c) =>
      hasPermission(me, "user.role.assign", c.id) &&
      !user.memberships.some((m) => m.company?.id === c.id),
  );

  return (
    <div className="space-y-5 p-5">
      {isSelf && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-muted">
          You can't change your own access or account status.
        </p>
      )}
      <section aria-label="Account status">
        <h3 className="eyebrow mb-2">Account</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={USER_STATUS[user.status].tone} label={USER_STATUS[user.status].label} />
          {canDisable && user.status === "active" && (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => send(`/api/v1/users/${user.id}`, "PATCH", { status: "suspended" }))
                }
              >
                Suspend
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<ShieldOff className="size-3.5" />}
                disabled={pending}
                onClick={() =>
                  run(() => send(`/api/v1/users/${user.id}`, "PATCH", { status: "disabled" }))
                }
              >
                Disable
              </Button>
            </>
          )}
          {canDisable && (user.status === "disabled" || user.status === "suspended") && (
            <Button
              size="sm"
              icon={<UserCheck className="size-3.5" />}
              disabled={pending}
              onClick={() =>
                run(() => send(`/api/v1/users/${user.id}`, "PATCH", { status: "active" }))
              }
            >
              Re-enable
            </Button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-fg-faint">
          Disabling or suspending signs the user out everywhere immediately.
        </p>
      </section>

      <section aria-label="Memberships">
        <h3 className="eyebrow mb-2">Company memberships</h3>
        <ul className="space-y-2">
          {user.memberships.map((m) => {
            const editable =
              !isSelf &&
              (m.company
                ? hasPermission(me, "user.role.assign", m.company.id)
                : !!me?.globalPermissions.includes("security.manage"));
            return (
              <li key={m.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    {m.company ? (
                      <span
                        className="size-2.5 rounded-[3px]"
                        style={{ background: m.company.accentColor ?? "#64748b" }}
                        aria-hidden="true"
                      />
                    ) : (
                      <Crown className="size-3.5 text-amber-500" aria-hidden="true" />
                    )}
                    {m.company?.name ?? "All companies (global)"}
                  </span>
                  <StatusPill tone={MEMBERSHIP_TONE[m.status]} label={m.status} />
                </div>
                {m.departments.length > 0 && (
                  <p className="mt-1 text-[12px] text-fg-muted">
                    Departments: {m.departments.map((d) => d.name).join(", ")}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`role-${m.id}`}>
                    Role for {m.company?.name ?? "global membership"}
                  </label>
                  <select
                    id={`role-${m.id}`}
                    disabled={!editable || pending}
                    value={m.role.id}
                    onChange={(e) =>
                      run(() =>
                        send(`/api/v1/memberships/${m.id}`, "PATCH", { roleId: e.target.value }),
                      )
                    }
                    className="focus-ring h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] disabled:opacity-60"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {editable && m.status !== "revoked" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          send(`/api/v1/memberships/${m.id}`, "PATCH", { status: "revoked" }),
                        )
                      }
                    >
                      Revoke
                    </Button>
                  )}
                  {editable && m.status === "revoked" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          send(`/api/v1/memberships/${m.id}`, "PATCH", { status: "active" }),
                        )
                      }
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!isSelf && addable.length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line p-3">
            <label className="min-w-[140px] flex-1">
              <span className="mb-1 block text-[11.5px] text-fg-faint">Add to company</span>
              <select
                value={addCompany}
                onChange={(e) => setAddCompany(e.target.value)}
                className="focus-ring h-8 w-full rounded-lg border border-line bg-surface px-2 text-[12.5px]"
              >
                <option value="">Choose…</option>
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[140px] flex-1">
              <span className="mb-1 block text-[11.5px] text-fg-faint">Role</span>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="focus-ring h-8 w-full rounded-lg border border-line bg-surface px-2 text-[12.5px]"
              >
                {roles
                  .filter((r) => r.key !== "platform_owner")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={!addCompany || pending}
              onClick={() =>
                run(() =>
                  send(`/api/v1/users/${user.id}/memberships`, "POST", {
                    companyId: addCompany,
                    roleId: addRole,
                  }),
                )
              }
            >
              Add
            </Button>
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
