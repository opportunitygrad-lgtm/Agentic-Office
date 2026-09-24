import { describe, expect, it, vi } from "vitest";
import { WORKER_HEARTBEAT_KEY } from "@aibos/shared";
import { processAgentTask, writeHeartbeat } from "../src/processors";

describe("worker processors", () => {
  it("writes a heartbeat with a TTL", async () => {
    const set = vi.fn().mockResolvedValue("OK");
    const hb = await writeHeartbeat({ set } as never, ["system"]);
    expect(set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      JSON.stringify(hb),
      "EX",
      expect.any(Number),
    );
  });

  it("does not execute agent tasks in Stage 01", async () => {
    const r = await processAgentTask({
      id: "1",
      data: { taskId: "t", companyId: null, agentId: null },
    });
    expect(r.status).toBe("skipped");
  });
});
