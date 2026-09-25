# Agent operating model (Stage 04)

Agents are **not** free-form autonomous bots. Every agent is a permanent (or
task-bound temporary) member of a governed workforce with a structured role,
reporting lines, capabilities, permissions, limits and stopping rules. All
routing decisions in this stage are deterministic — no AI provider is called.

## Workforce structure

```
Platform / Group (global agents: Group Manager, Revenue/CRO, Email, CTO, Analytics)
└── Company (EPT, PilotsAssist, Opportunitygrad, …)
    └── Company Manager agent
        └── Departments (global or company-specific)
            ├── Teams (company or global; leader + members; may be temporary)
            │   └── Specialist agents
            └── Specialist agents
                └── Temporary workers (task-bound, expiring)
```

- **Departments** carry mission, manager agent, human manager, default
  provider, concurrency limit, daily budget, active flag, instructions,
  allowed task types and handoff destinations.
- **Teams** carry company (or GLOBAL), department, leader, members, purpose,
  concurrency, default task types, active and temporary flags. Every member must
  serve the team's company (global agents excepted). GLOBAL teams need the
  platform-level `team.manage`.
- **Reporting hierarchy:** `reportsTo`, escalation agent and fallback manager.
  Managers must be in the same company (or global). Cycles are rejected.
- **Capabilities are not permissions.** Capabilities (26, e.g. `research.web`,
  `email.draft`, `meta.execute`) say what an agent can do; the Stage 02
  permission engine says what it may do. Delegation requires both.

## Role structure

A role (`AgentRole`, strict schema) has these sections:

| Section          | Content                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| identity         | role name, mission                                                      |
| responsibilities | primary, secondary                                                      |
| behaviours       | workflow, required checks, required context                             |
| prohibited       | actions, work that belongs elsewhere, data not accessed                 |
| delegation       | may delegate, allowed delegate templates / departments, max depth (0–5) |
| handoff          | destinations: department, when, required fields, stop / keep monitoring |
| research         | max searches, max retries, deep research (never/approval/allowed), stop |
| cost             | max task budget, provider preference, escalation threshold              |
| completion       | definition of done, stopping conditions, result format                  |
| free text        | additional instructions (checked; can never override higher layers)     |

Roles resolve as: agent-specific version → company role template → global
template role. **Saving never overwrites:** each save creates a new
`agent_role_versions` row (version, summary, changed by/at, approved by,
effective from); the previous one stays in history. Identical saves are
no-ops. Every change is audited (`agent.role_version_created`,
`agent.role_updated`). The UI is a structured form — never raw JSON.

## Instruction precedence

Highest priority first:

1. **Platform safety** (locked)
2. **Global operating policy** (structured rules)
3. **Company rules & AI policy** (Stage 03 critical rules, AI policy, prohibited claims)
4. **Department rules**
5. **Role template**
6. **Agent-specific role**
7. **Task instructions**
8. **Temporary task notes**

`compileAgentInstructions` (in `@aibos/agent-core`) builds a provider-neutral
`CompiledAgentInstructionPack`:

- one structured rule list per layer, with source, priority and a
  deterministic "why included" reason — plus a concise text rendering (never
  the only representation, never a provider message array);
- **deduplication:** a rule that repeats a higher-priority rule is folded into it;
- **override rejection:** lower-layer text that tries to ignore/override
  higher rules is rejected (negated prohibitions such as "Never bypass
  approvals" are recognised and kept);
- **stricter wins** for limits (searches, retries, deep research, budget,
  external actions, delegation depth);
- **authority wins:** a role that expects a tool the agent is not permitted
  to use yields a `permission` conflict and the tool stays denied;
- context metadata (Stage 03 Context Engine version, tokens, knowledge ids) is
  referenced — the Context Engine is reused, not rebuilt.

## Delegation

`@aibos/delegation-core` produces a `DelegationDecision`:
`HANDLE_SELF`, `DELEGATE_TO_AGENT`, `DELEGATE_TO_TEAM`,
`CREATE_TEMPORARY_WORKER`, `REQUIRE_HUMAN_REVIEW` or `BLOCKED`, with an
explanation, budget decision, duplicate result and a per-candidate check list:

| Check               | Hard (cannot be overridden) |
| ------------------- | --------------------------- |
| company             | yes                         |
| status              | yes                         |
| circular            | yes                         |
| permission          | yes                         |
| delegation_scope    | no                          |
| capability          | no                          |
| capacity            | no                          |
| department_capacity | no                          |
| budget              | no                          |

Rules applied, in order: budget (ALLOWED / REQUIRES_APPROVAL / BLOCKED;
high-cost tasks need approval), duplicate check, hard stops (requester must
serve the company; exact duplicates; blocked budget), global/company
concurrency (queue, never exceed), delegation depth (`min(policy, role)`),
**handle routine work itself when capable**, human review when the requester
may not delegate, team for preferred-team or large parallel work, best
eligible specialist (score: capability, preferred agent/department, idle
capacity), temporary worker when permitted, otherwise human review.

People can accept the recommendation, pick another candidate (overriding a
soft check needs a reason) or assign manually; hard checks always apply. All
of it is recorded in `task_delegations` and audited
(`task.delegated`, `task.reassigned`, `delegation.blocked`).

Concurrency seeds: global active agents **3**, Research department **5**.

## Duplicate prevention

Before creating a task the objective is normalised (lower-case, stop words
removed, crude singularisation, sorted unique tokens) and compared with active
tasks of the **same company** (Jaccard similarity; target entity match):

- **EXACT** → the existing task is reused, nothing is created;
- **LIKELY** (≥ 0.6, or same target entity) → the person must confirm "create anyway";
- **RELATED** (≥ 0.35) → shown for information;
- **NONE**.

Completed tasks are only ever "related". Avoided duplicates are audited
(`task.duplicate_detected`). No embeddings are used yet.

## Claims, workload and agent states

- Tasks are claimed atomically with a lease (`claimed_by_agent_id`,
  `lease_expires_at`, advisory lock + concurrency check); expired leases are
  recovered.
- Workload = active / queued / completed-recently / capacity per agent.
- Agent status is **derived from real work** (`refreshAgentStates`):
  working, waiting, needs_approval, blocked, queued or sleeping. Manual states
  (paused, offline, error, expired, terminated) are never overwritten. No
  status is ever displayed independently of data.

## Handoffs

A handoff packet contains: task, source agent, exactly one destination (agent,
team or department), type, objective, summary, verified facts, source
references, knowledge ids (evidence), a contact **reference** (never contact
data), action required, priority, deadline and "do not research again unless".
Statuses: PENDING → ACCEPTED/REJECTED/CANCELLED → COMPLETED.

- The destination builds **its own Context Pack**; it never receives the
  source agent's context. The handoff (summary, verified facts, evidence
  links) is added to the destination's pack under "HANDOFFS — PRIOR WORK
  (reuse; do not repeat)", and evidence knowledge is included with the reason
  `handoff_link`.
- Evidence must be same-company or global and within the destination's
  sensitivity clearance; the person creating it must be able to read it.
- Every handoff sends an `agent_messages` row (types TASK_INSTRUCTION,
  HANDOFF, STATUS, QUESTION, ESCALATION, APPROVAL_NOTICE, SYSTEM).

## Temporary agents

- Created for **one task of one company**; expire (policy maximum), have a
  fixed budget (≤ parent per-task budget) and a company limit of active workers.
- Inherit company isolation, department, provider, prohibitions and approval
  requirements; autonomy is capped at Limited operator.
- Permissions are never more than the parent can exercise in that company
  (allow stays allow, approval-gated stays approval-gated, denied is refused);
  grants are company-scoped plus a destructive-action deny.
- **No uncontrolled self-replication:** a temporary worker cannot create
  another unless a person explicitly permits it (platform-level
  `agent.permissions.manage`), and agents need `action.create_temp_worker`
  (approval-gated for managers and research) — agent-initiated creation
  becomes an approval request.
- Terminated automatically when their task completes or is cancelled; expired
  lazily when listed (no background scheduler yet). Audited:
  `temp_agent.created`, `temp_agent.approval_requested`, `temp_agent.expired`,
  `temp_agent.terminated`.

## Stopping rules

Every compiled pack carries the effective stop conditions and definition of
done: the role's completion rules, the task's stopping condition, research
limits (max searches / retries, stricter wins) and the global policy ("stop
when the task is complete", "stop when a required approval is pending",
"stop when required information cannot be found within limits"). Delegation
stops at the depth limit and never loops back to an agent already in the chain.

## Conversations

`conversations` / `conversation_messages` store messages from a person to an
agent. In Stage 04 there are **no AI replies**: each message gets a system
placeholder. Conversations are visible to their owner only.
