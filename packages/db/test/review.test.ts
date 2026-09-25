import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { executeRun } from "@aibos/execution-core";
import { createProviderRegistry, type ProviderRegistry } from "@aibos/provider-core";
import type { RunStreamMessage } from "@aibos/shared";
import {
  assignTask,
  createRunStore,
  createWorkforceTask,
  getRunDetail,
  listRunReviews,
  planReviewRun,
  requestRunCancel,
  requestSecondOpinion,
  resolveCompany,
  schema,
  startTaskRun,
  type Actor,
  type ExecutionEnv,
} from "../src";
import { seedDev } from "../src/seed/dev/seed-dev";
import { createTestDb, resetOperationalData } from "./helpers";

const handle = createTestDb();
const db = handle.db;
let actor: Actor;
let EPT = "";
let registry: ProviderRegistry;
let env: ExecutionEnv;
const published: RunStreamMessage[] = [];
const store = () => createRunStore(db, env, { publish: (_id, m) => published.push(m) });

const agentId = async (name: string) =>
  (await db.select().from(schema.agents).where(eq(schema.agents.name, name)))[0]!.id;
const runRow = async (id: string) =>
  (await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id)))[0]!;
const viewer = { canStop: () => true, canRequestReview: () => true, userId: null as string | null };

async function newTask(title: string, agent = "EPT Company Manager") {
  const res = await createWorkforceTask(
    db,
    { companyId: EPT, title, type: "research", onDuplicate: "create" },
    actor,
  );
  await assignTask(db, res.task!.id, { agentId: await agentId(agent) }, actor);
  return res.task!.id;
}

/** Runs a task to completion with CLAUDE (mock, subscription) and returns the primary run id. */
async function completedPrimaryRun(
  title: string,
  opts: { viewerMaxSensitivity?: "internal" | "restricted" } = {},
): Promise<string> {
  const id = await newTask(title);
  const started = await startTaskRun(db, env, id, {}, actor, {
    viewerMaxSensitivity: opts.viewerMaxSensitivity ?? "internal",
  });
  const runId = (started as { runId: string }).runId;
  expect(await executeRun(runId, { store: store(), provider: registry.get("CLAUDE") })).toBe(
    "completed",
  );
  return runId;
}

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(db);
  const [owner] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "owner@aibos.example"));
  actor = { kind: "human", ref: "owner@aibos.example", userId: owner!.id };
  viewer.userId = owner!.id;
  EPT = (await resolveCompany(db, "euro-pilot-training"))!.id;
  // Default transports: CLAUDE via Claude Code, OPENAI via Codex CLI — both
  // mock and subscription-billed, so review requests never hit dollar budgets.
  registry = createProviderRegistry({ mode: "mock", env: {} });
  env = { registry, timeoutMs: 30_000, historyLimit: 4 };
});
afterAll(() => handle.close());

describe("second-opinion review", () => {
  it("requests an independent OpenAI review of a completed Claude run and stores it separately", async () => {
    const primaryId = await completedPrimaryRun("Second-opinion happy path");
    const requested = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
      viewerMaxSensitivity: "internal",
    });
    expect(requested.status).toBe("started");
    const reviewRunId = requested.runId;
    expect(await runRow(reviewRunId)).toMatchObject({
      provider: "OPENAI",
      runPurpose: "second_opinion",
      reviewedRunId: primaryId,
      executionType: "review",
      billingMode: "subscription",
    });

    expect(
      await executeRun(reviewRunId, { store: store(), provider: registry.get("OPENAI") }),
    ).toBe("completed");
    const reviewAfter = await runRow(reviewRunId);
    expect(reviewAfter.status).toBe("completed");
    expect(reviewAfter.result).toMatchObject({ overallReviewSummary: expect.any(String) });
    expect(reviewAfter.result).not.toHaveProperty("proposedHandoffs"); // never an AgentExecutionResult shape

    // The original run's own row and result are untouched.
    const original = await runRow(primaryId);
    expect(original.status).toBe("completed");
    expect(original.result).not.toHaveProperty("overallReviewSummary");

    // The original run's detail view now surfaces the review and the event.
    const detail = await getRunDetail(db, primaryId, {
      scope: { companyIds: "all", includeGroup: true },
      viewer,
    });
    expect(detail.review).toMatchObject({ overallReviewSummary: expect.any(String) });
    expect(detail.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["REVIEW_COMPLETED"]),
    );

    const reviews = await listRunReviews(db, primaryId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ reviewerProvider: "OPENAI", reviewerRunId: reviewRunId });

    // The reviewer run never claimed or released the task's execution claim.
    const task = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, (await runRow(primaryId)).taskId!));
    expect(task[0]!.status).toBe("completed");
  });

  it("blocks a provider from reviewing its own result", async () => {
    const primaryId = await completedPrimaryRun("Self-review blocked");
    await expect(
      requestSecondOpinion(db, env, primaryId, "CLAUDE", actor, {
        viewerMaxSensitivity: "internal",
      }),
    ).rejects.toThrow(/cannot review its own result/);
  });

  it("rejects a review of a run that has not completed", async () => {
    const id = await newTask("Not yet completed");
    const started = await startTaskRun(db, env, id, {}, actor, {
      viewerMaxSensitivity: "internal",
    });
    const runId = (started as { runId: string }).runId;
    try {
      await expect(
        requestSecondOpinion(db, env, runId, "OPENAI", actor, {
          viewerMaxSensitivity: "internal",
        }),
      ).rejects.toThrow(/Only a completed run can be reviewed/);
    } finally {
      // Never left this queued run's task claim dangling for later tests.
      await requestRunCancel(db, runId, actor);
    }
  });

  it("never reviews a run that is itself a second opinion (no recursive review chains)", async () => {
    const primaryId = await completedPrimaryRun("No recursive review");
    const review = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
      viewerMaxSensitivity: "internal",
    });
    await executeRun(review.runId, { store: store(), provider: registry.get("OPENAI") });
    await expect(
      requestSecondOpinion(db, env, review.runId, "CLAUDE", actor, {
        viewerMaxSensitivity: "internal",
      }),
    ).rejects.toThrow(/Only a primary run can be reviewed/);
  });

  it("dedupes an in-flight review, then a completed one, unless force is set", async () => {
    // A forced rerun still counts toward the per-task review cap, so raise it
    // here to isolate dedup behaviour from that separate policy (tested below).
    await db
      .update(schema.companyAiPolicies)
      .set({ maxReviewsPerTask: 5 })
      .where(eq(schema.companyAiPolicies.companyId, EPT));
    try {
      const primaryId = await completedPrimaryRun("Dedup check");
      const first = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
        viewerMaxSensitivity: "internal",
      });
      // Still active (not executed yet) — a repeat request returns the same run,
      // even with force: a rerun is never started while one is already running.
      const second = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
        viewerMaxSensitivity: "internal",
        force: true,
      });
      expect(second).toEqual({ status: "existing", runId: first.runId });

      expect(
        await executeRun(first.runId, { store: store(), provider: registry.get("OPENAI") }),
      ).toBe("completed");

      // Completed — reused again without force.
      const third = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
        viewerMaxSensitivity: "internal",
      });
      expect(third).toEqual({ status: "existing", runId: first.runId });

      // With force, a fresh review run is created and stored alongside the first.
      const forced = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
        viewerMaxSensitivity: "internal",
        force: true,
      });
      expect(forced.status).toBe("started");
      expect(forced.runId).not.toBe(first.runId);
      expect(await listRunReviews(db, primaryId)).toHaveLength(2);
    } finally {
      await db
        .update(schema.companyAiPolicies)
        .set({ maxReviewsPerTask: 1 })
        .where(eq(schema.companyAiPolicies.companyId, EPT));
    }
  });

  it("enforces the company's maxReviewsPerTask policy even with force", async () => {
    const primaryId = await completedPrimaryRun("Review cap check");
    await db
      .update(schema.companyAiPolicies)
      .set({ maxReviewsPerTask: 1 })
      .where(eq(schema.companyAiPolicies.companyId, EPT));
    try {
      const first = await requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
        viewerMaxSensitivity: "internal",
      });
      expect(first.status).toBe("started");
      await executeRun(first.runId, { store: store(), provider: registry.get("OPENAI") });
      await expect(
        requestSecondOpinion(db, env, primaryId, "OPENAI", actor, {
          viewerMaxSensitivity: "internal",
          force: true,
        }),
      ).rejects.toThrow(/company policy allows 1/);
    } finally {
      await db
        .update(schema.companyAiPolicies)
        .set({ maxReviewsPerTask: 1 })
        .where(eq(schema.companyAiPolicies.companyId, EPT));
    }
  });

  it("never lets a review see more than the original run's own clearance (min of the two)", async () => {
    const [banking] = await db
      .select()
      .from(schema.knowledgeItems)
      .where(
        and(
          eq(schema.knowledgeItems.companyId, EPT),
          eq(schema.knowledgeItems.title, "Banking and payment details"),
        ),
      );
    const manager = await agentId("EPT Company Manager");
    await db
      .insert(schema.knowledgeAccessPolicies)
      .values({ companyId: EPT, agentId: manager, maxSensitivity: "restricted" })
      .onConflictDoNothing();
    const id = await newTask("Payments overview for review isolation");
    await db
      .insert(schema.knowledgeLinks)
      .values({ knowledgeId: banking!.id, target: "task", taskId: id });
    // The primary run itself was started at "internal" — never saw the restricted item.
    const started = await startTaskRun(db, env, id, {}, actor, {
      viewerMaxSensitivity: "internal",
    });
    const primaryId = (started as { runId: string }).runId;
    expect(
      await executeRun(primaryId, { store: store(), provider: registry.get("CLAUDE") }),
    ).toBe("completed");

    // A reviewer requested with a HIGHER personal clearance still gets capped
    // to what the original run itself was allowed to see.
    const plan = await planReviewRun(db, env, primaryId, "OPENAI", {
      viewerMaxSensitivity: "restricted",
    });
    expect(plan.context.knowledge.some((k) => k.id === banking!.id)).toBe(false);
  });
});
