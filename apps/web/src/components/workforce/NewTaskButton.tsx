"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";
import {
  AGENT_CAPABILITIES,
  CAPABILITY_LABELS,
  TASK_PRIORITIES,
  TASK_TYPES,
  titleCase,
  type AgentCapability,
  type DuplicateResult,
  type TaskPriority,
  type TaskType,
} from "@aibos/shared";
import { Button, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { Dialog } from "../common/Dialog";
import { hasPermission, useMe } from "../shell/SessionContext";
import { SelectField, Switch, TextArea, TextField } from "../wizard/fields";

interface CreateResult {
  task: { id: string } | null;
  reused: { id: string; title: string } | null;
  duplicate: DuplicateResult;
}

/**
 * Creates a task with structured requirements. Duplicates are checked first:
 * an exact duplicate is reused and a likely one needs explicit confirmation —
 * no second active task is created blindly.
 */
export function NewTaskButton() {
  const me = useMe();
  const router = useRouter();
  const companies = (me?.accessibleCompanies ?? []).filter((c) =>
    hasPermission(me, "task.create", c.id),
  );
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("research");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [caps, setCaps] = useState<AgentCapability[]>([]);
  const [budget, setBudget] = useState("");
  const [parallel, setParallel] = useState(false);
  const [items, setItems] = useState("");
  const [stop, setStop] = useState("");
  const [entity, setEntity] = useState("");
  const [dup, setDup] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!companies.length) return null;

  async function submit(onDuplicate: "reuse" | "create") {
    setError(null);
    const r = await clientApi<{ data: CreateResult }>("/v1/tasks", {
      method: "POST",
      body: {
        companyId,
        title,
        description: description || null,
        type,
        priority,
        onDuplicate,
        requirements: {
          requiredCapabilities: caps,
          maxBudget: budget ? Number(budget) : null,
          parallelAllowed: parallel,
          workItems: items ? Number(items) : null,
          stoppingCondition: stop || null,
          targetEntity: entity || null,
        },
      },
    });
    if (!r.ok)
      return setError(r.issues?.[0] ? `${r.issues[0].path}: ${r.issues[0].message}` : r.message);
    const res = r.data.data;
    if (res.task) {
      setOpen(false);
      router.push(`/tasks/item/${res.task.id}`);
      return;
    }
    setDup(res);
  }

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus className="size-4" aria-hidden="true" />}
        onClick={() => {
          setDup(null);
          setOpen(true);
        }}
      >
        New task
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New task"
        description="Requirements drive the delegation engine: capabilities, budget and stopping rules."
      >
        <form
          className="space-y-3 overflow-y-auto p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("reuse");
          }}
        >
          <SelectField
            label="Company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
          <TextField
            label="Title"
            required
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDup(null);
            }}
          />
          <TextArea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
              options={TASK_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
            />
            <SelectField
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))}
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Required capabilities</legend>
            <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {AGENT_CAPABILITIES.map((c) => {
                const on = caps.includes(c);
                return (
                  <li key={c}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCaps(on ? caps.filter((x) => x !== c) : [...caps, c])}
                      className={cn(
                        "focus-ring rounded-md px-2 py-0.5 text-[12px] ring-1 ring-inset",
                        on
                          ? "bg-accent-soft text-accent ring-accent/40"
                          : "text-fg-muted ring-line",
                      )}
                    >
                      {CAPABILITY_LABELS[c]}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField
              label="Max budget (USD)"
              type="number"
              min={0}
              step="0.1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <TextField
              label="Work items"
              type="number"
              min={0}
              value={items}
              onChange={(e) => setItems(e.target.value)}
              hint="e.g. 200 schools"
            />
            <TextField
              label="Target entity"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              hint="e.g. school:lisbon"
            />
          </div>
          <TextField
            label="Stopping condition"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            placeholder="e.g. Stop at 20 verified schools"
          />
          <Switch
            label="Parallel work allowed"
            description="Lets the engine suggest a team or temporary workers for large jobs."
            checked={parallel}
            onChange={setParallel}
          />

          {dup && (
            <div
              role="alert"
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] dark:border-amber-500/40 dark:bg-amber-500/10"
              data-testid="duplicate-warning"
            >
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {dup.duplicate.level === "exact_duplicate"
                  ? "This task already exists — reusing it"
                  : "A similar task is already active"}
              </p>
              <ul className="mt-1.5 space-y-1">
                {dup.duplicate.matches.slice(0, 4).map((m) => (
                  <li key={m.taskId}>
                    <Link href={`/tasks/item/${m.taskId}`} className="font-medium underline">
                      {m.title}
                    </Link>{" "}
                    <span className="text-fg-muted">
                      · {titleCase(m.level)} · {Math.round(m.similarity * 100)}% similar ·{" "}
                      {titleCase(m.status)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {dup.reused && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => router.push(`/tasks/item/${dup.reused!.id}`)}
                  >
                    Open existing task
                  </Button>
                )}
                {dup.duplicate.level !== "exact_duplicate" && (
                  <Button size="sm" onClick={() => void submit("create")}>
                    Create anyway
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[12.5px] text-rose-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || !!dup}>
              Check & create
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
