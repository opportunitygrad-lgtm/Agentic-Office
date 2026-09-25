"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import {
  PROVIDER_LABELS,
  TASK_TYPES,
  type AgentDTO,
  type DepartmentDetailDTO,
  type ProviderType,
  type TaskType,
} from "@aibos/shared";
import { Button } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { Dialog } from "../common/Dialog";
import { useMe, hasPermission } from "../shell/SessionContext";
import { SelectField, Switch, TagInput, TextArea, TextField } from "../wizard/fields";

type CompanyOption = { id: string; name: string };

function MemberPicker({
  agents,
  value,
  onChange,
}: {
  agents: AgentDTO[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium">Members</legend>
      {agents.length === 0 ? (
        <p className="text-[12.5px] text-fg-faint">No eligible agents for this company.</p>
      ) : (
        <ul className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
          {agents.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={value.includes(a.id)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))
                  }
                />
                <span className="truncate">{a.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Only agents serving the team's company (or global agents) can be members — enforced again by the API. */
const eligibleFor = (agents: AgentDTO[], companyId: string) =>
  agents.filter(
    (a) => !a.isTemporary && (a.scope === "global" || a.companies.some((c) => c.id === companyId)),
  );

export function CreateTeamButton({
  companies,
  agents,
  departments,
}: {
  companies: CompanyOption[];
  agents: AgentDTO[];
  departments: DepartmentDetailDTO[];
}) {
  const me = useMe();
  const router = useRouter();
  const canGlobal = !!me?.globalPermissions.includes("team.manage");
  const manageable = companies.filter((c) => hasPermission(me, "team.manage", c.id));
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(manageable[0]?.id ?? "");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [leader, setLeader] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (!manageable.length && !canGlobal) return null;

  const pool = companyId
    ? eligibleFor(agents, companyId)
    : agents.filter((a) => a.scope === "global");
  async function submit() {
    setError(null);
    const r = await clientApi("/v1/teams", {
      method: "POST",
      body: {
        companyId: companyId || null,
        name,
        purpose: purpose || null,
        departmentId: departmentId || null,
        leaderAgentId: leader || null,
        memberIds: [...new Set([...(leader ? [leader] : []), ...members])],
        defaultTaskTypes: types,
      },
    });
    if (!r.ok)
      return setError(r.issues?.[0] ? `${r.issues[0].path}: ${r.issues[0].message}` : r.message);
    setOpen(false);
    setName("");
    setMembers([]);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus className="size-4" aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        New team
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New team"
        description="Teams group agents for a purpose. Members must serve the team's company."
      >
        <form
          className="space-y-3 overflow-y-auto p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <SelectField
            label="Company"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setMembers([]);
              setLeader("");
            }}
            options={[
              ...manageable.map((c) => ({ value: c.id, label: c.name })),
              ...(canGlobal ? [{ value: "", label: "Global team (all companies)" }] : []),
            ]}
          />
          <TextField
            label="Team name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextArea label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              options={[
                { value: "", label: "None" },
                ...departments
                  .filter((d) => !d.company || d.company.id === companyId)
                  .map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
            <SelectField
              label="Team leader"
              value={leader}
              onChange={(e) => setLeader(e.target.value)}
              options={[
                { value: "", label: "None" },
                ...pool.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
          <MemberPicker agents={pool} value={members} onChange={setMembers} />
          <TagInput
            label="Default task types"
            hint={`e.g. ${TASK_TYPES.slice(0, 3).join(", ")}`}
            values={types}
            onChange={(v) =>
              setTypes(
                v.filter((t): t is TaskType => (TASK_TYPES as readonly string[]).includes(t)),
              )
            }
          />
          {error && (
            <p role="alert" className="text-[12.5px] text-rose-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Create team
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function EditDepartmentButton({
  department,
  agents,
}: {
  department: DepartmentDetailDTO;
  agents: AgentDTO[];
}) {
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mission, setMission] = useState(department.mission ?? "");
  const [manager, setManager] = useState(department.managerAgent?.id ?? "");
  const [provider, setProvider] = useState<string>(department.defaultProvider ?? "");
  const [concurrency, setConcurrency] = useState(department.concurrencyLimit?.toString() ?? "");
  const [budget, setBudget] = useState(department.dailyBudgetUsd?.toString() ?? "");
  const [active, setActive] = useState(department.active);
  const [instructions, setInstructions] = useState(department.instructions);
  const [handoffs, setHandoffs] = useState(department.handoffDestinations);
  const [error, setError] = useState<string | null>(null);
  const allowed = department.company
    ? hasPermission(me, "team.manage", department.company.id)
    : !!me?.globalPermissions.includes("team.manage");
  if (!allowed) return null;

  async function submit() {
    const r = await clientApi(`/v1/departments/${department.id}`, {
      method: "PATCH",
      body: {
        mission: mission || null,
        managerAgentId: manager || null,
        defaultProvider: (provider || null) as ProviderType | null,
        concurrencyLimit: concurrency ? Number(concurrency) : null,
        dailyBudgetUsd: budget ? Number(budget) : null,
        active,
        instructions,
        handoffDestinations: handoffs,
      },
    });
    if (!r.ok) return setError(r.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Pencil className="size-3.5" aria-hidden="true" />}
        onClick={() => setOpen(true)}
        aria-label={`Edit ${department.name}`}
      >
        Edit
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${department.name}`}
        description={
          department.company
            ? `${department.company.name} department`
            : "Global department — shared by every company"
        }
      >
        <form
          className="space-y-3 overflow-y-auto p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextArea label="Mission" value={mission} onChange={(e) => setMission(e.target.value)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Manager agent"
              value={manager}
              onChange={(e) => setManager(e.target.value)}
              options={[
                { value: "", label: "None" },
                ...agents
                  .filter((a) => !a.isTemporary)
                  .map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <SelectField
              label="Default provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              options={[
                { value: "", label: "Company default" },
                ...(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((p) => ({
                  value: p,
                  label: PROVIDER_LABELS[p],
                })),
              ]}
            />
            <TextField
              label="Concurrency limit"
              type="number"
              min={1}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              placeholder="Unlimited"
            />
            <TextField
              label="Daily budget (USD)"
              type="number"
              min={0}
              step="0.5"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Company budget"
            />
          </div>
          <TagInput
            label="Department instructions"
            values={instructions}
            onChange={setInstructions}
          />
          <TagInput
            label="Handoff destinations"
            hint="Department slugs, e.g. email, sales"
            values={handoffs}
            onChange={setHandoffs}
          />
          <Switch
            label="Active"
            description="Inactive departments receive no new work."
            checked={active}
            onChange={setActive}
          />
          {error && (
            <p role="alert" className="text-[12.5px] text-rose-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save department
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ManageTeamButton({
  teamId,
  companyId,
  agents,
  members,
  leaderId,
  active,
}: {
  teamId: string;
  companyId: string | null;
  agents: AgentDTO[];
  members: string[];
  leaderId: string | null;
  active: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(members);
  const [leader, setLeader] = useState(leaderId ?? "");
  const [isActive, setActive] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const pool = companyId
    ? eligibleFor(agents, companyId)
    : agents.filter((a) => a.scope === "global");

  async function submit() {
    setError(null);
    const ids = [...new Set([...(leader ? [leader] : []), ...value])];
    const m = await clientApi(`/v1/teams/${teamId}/members`, {
      method: "PUT",
      body: { memberIds: ids },
    });
    if (!m.ok) return setError(m.message);
    const t = await clientApi(`/v1/teams/${teamId}`, {
      method: "PATCH",
      body: { leaderAgentId: leader || null, active: isActive },
    });
    if (!t.ok) return setError(t.message);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        icon={<Pencil className="size-3.5" aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Manage team
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Manage team"
        description="Membership changes are audited."
      >
        <form
          className="space-y-3 overflow-y-auto p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <SelectField
            label="Team leader"
            value={leader}
            onChange={(e) => setLeader(e.target.value)}
            options={[
              { value: "", label: "None" },
              ...pool.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <MemberPicker agents={pool} value={value} onChange={setValue} />
          <Switch
            label="Active"
            description="Inactive teams receive no delegated work."
            checked={isActive}
            onChange={setActive}
          />
          {error && (
            <p role="alert" className="text-[12.5px] text-rose-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
