"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { PermissionDTO, RoleDTO } from "@aibos/shared";
import { Button, cn } from "@aibos/ui";
import { Dialog } from "../common/Dialog";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : ((await res.json()) as { data: RoleDTO });
}

export function RolesAdmin({
  roles,
  permissions,
  canManage,
}: {
  roles: RoleDTO[];
  permissions: PermissionDTO[];
  canManage: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ from?: RoleDTO } | null>(null);
  const open = roles.find((r) => r.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-fg-muted">
          Roles are bundles of permissions. Access is always decided by permissions, never by role
          names. System roles are maintained in code and locked; duplicate one to customise it.
        </p>
        {canManage && (
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => setCreating({})}
          >
            New custom role
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-panel">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <caption className="sr-only">Roles</caption>
          <thead className="border-b border-line text-[11px] text-fg-faint">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">
                Role
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Scope
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Users
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Permissions
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                Type
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {roles.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-surface-2/60"
                onClick={() => setOpenId(r.id)}
              >
                <th scope="row" className="px-5 py-3 font-normal">
                  <button
                    type="button"
                    className="focus-ring rounded text-left"
                    onClick={() => setOpenId(r.id)}
                  >
                    <span className="block font-semibold">{r.name}</span>
                    <span className="block max-w-md truncate text-[12px] text-fg-muted">
                      {r.description}
                    </span>
                  </button>
                </th>
                <td className="px-3 py-3 text-fg-muted">
                  {r.companyId
                    ? "Company-specific"
                    : r.scope === "global"
                      ? "Global / multi-company"
                      : "Per company"}
                </td>
                <td className="num px-3 py-3">{r.userCount}</td>
                <td className="px-3 py-3">
                  <span className="num font-medium">{r.permissions.length}</span>
                  <span className="text-fg-faint"> / {permissions.length}</span>
                  <div
                    className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-3"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${(r.permissions.length / Math.max(1, permissions.length)) * 100}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  {r.isSystem ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-line">
                      <Lock className="size-3" aria-hidden="true" /> System
                    </span>
                  ) : (
                    <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                      Custom
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open?.name ?? "Role"}
        description={open?.description ?? undefined}
        side="right"
      >
        {open && (
          <RoleEditor
            key={open.id + open.permissions.join()}
            role={open}
            permissions={permissions}
            canManage={canManage}
            onDuplicate={() => {
              setOpenId(null);
              setCreating({ from: open });
            }}
            onDeleted={() => setOpenId(null)}
          />
        )}
      </Dialog>
      <Dialog
        open={!!creating}
        onClose={() => setCreating(null)}
        title={creating?.from ? `Duplicate ${creating.from.name}` : "New custom role"}
      >
        {creating && (
          <CreateRoleForm
            from={creating.from}
            onDone={(id) => {
              setCreating(null);
              if (id) setOpenId(id);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function RoleEditor({
  role,
  permissions,
  canManage,
  onDuplicate,
  onDeleted,
}: {
  role: RoleDTO;
  permissions: PermissionDTO[];
  canManage: boolean;
  onDuplicate: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(new Set(role.permissions));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = canManage && !role.isSystem;
  const categories = useMemo(() => {
    const m = new Map<string, PermissionDTO[]>();
    for (const p of permissions) m.set(p.category, [...(m.get(p.category) ?? []), p]);
    return [...m.entries()];
  }, [permissions]);
  const dirty =
    selected.size !== role.permissions.length || role.permissions.some((p) => !selected.has(p));

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setPending(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Change rejected");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {role.isSystem ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg-muted">
            <Lock className="size-3.5" aria-hidden="true" /> System role — permissions are locked.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[12px] text-accent">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Custom role
            {editable ? " — editable" : ""}
          </p>
        )}
        {canManage && (
          <Button size="sm" icon={<Copy className="size-3.5" />} onClick={onDuplicate}>
            Duplicate as custom
          </Button>
        )}
        {editable && role.userCount === 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            disabled={pending}
            onClick={() => run(() => send(`/api/v1/roles/${role.id}`, "DELETE"), onDeleted)}
          >
            Delete
          </Button>
        )}
      </div>
      <div className="space-y-4">
        {categories.map(([category, perms]) => {
          const on = perms.filter((p) => selected.has(p.key)).length;
          return (
            <fieldset key={category} className="rounded-xl border border-line">
              <legend className="ml-3 px-1 text-[12px] font-semibold">
                {category}{" "}
                <span className="font-normal text-fg-faint">
                  {on}/{perms.length}
                </span>
              </legend>
              <ul className="divide-y divide-line/60">
                {perms.map((p) => {
                  const checked = selected.has(p.key);
                  return (
                    <li key={p.key}>
                      <label
                        className={cn(
                          "flex items-start gap-3 px-3 py-2",
                          editable ? "cursor-pointer hover:bg-surface-2/60" : "cursor-default",
                        )}
                      >
                        <input
                          type="checkbox"
                          role="switch"
                          aria-checked={checked}
                          checked={checked}
                          disabled={!editable}
                          onChange={() => {
                            const next = new Set(selected);
                            if (checked) next.delete(p.key);
                            else next.add(p.key);
                            setSelected(next);
                          }}
                          className="mt-0.5 size-4 accent-[var(--accent)]"
                          aria-label={p.label}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium">
                            {p.label}
                            {p.sensitive && (
                              <span className="rounded bg-amber-500/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Sensitive
                              </span>
                            )}
                          </span>
                          <span className="block text-[11.5px] text-fg-muted">{p.description}</span>
                        </span>
                        <code className="hidden shrink-0 font-mono text-[10.5px] text-fg-faint sm:block">
                          {p.key}
                        </code>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      {editable && (
        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-line bg-surface pt-3">
          <Button
            variant="ghost"
            disabled={!dirty || pending}
            onClick={() => setSelected(new Set(role.permissions))}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || pending}
            onClick={() =>
              run(() => send(`/api/v1/roles/${role.id}`, "PATCH", { permissions: [...selected] }))
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Save
            permissions
          </Button>
        </div>
      )}
    </div>
  );
}

function CreateRoleForm({ from, onDone }: { from?: RoleDTO; onDone: (id?: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState(from ? `${from.name} (custom)` : "");
  const [description, setDescription] = useState(from?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const blocked = new Set(["system.manage", "security.manage", "company.create"]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await send("/api/v1/roles", "POST", {
        name,
        ...(description ? { description } : {}),
        scope: "company",
        permissions: (from?.permissions ?? ["company.view"]).filter((p) => !blocked.has(p)),
      });
      router.refresh();
      onDone(res?.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create role");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-5" aria-label="Create role">
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium">Role name</span>
        <input
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px]"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium">Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      </label>
      <p className="text-[12px] text-fg-faint">
        {from
          ? `Starts with ${from.permissions.length} permissions from ${from.name}`
          : "Starts with company view only"}
        ; platform-level permissions are never copied into company roles.
      </p>
      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Create role
        </Button>
      </div>
    </form>
  );
}
