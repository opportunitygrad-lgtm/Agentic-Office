import { describe, expect, it } from "vitest";
import { createMockLiveSession } from "../src";

const now = new Date("2026-09-24T10:00:00Z");

describe("createMockLiveSession", () => {
  it("creates a browser session for a working research agent", () => {
    const s = createMockLiveSession({
      agent: { id: "a1", name: "Research", status: "working", templateKey: "research" },
      company: null,
      task: {
        id: "t1",
        title: "Research",
        progress: 40,
        currentAction: "Reading",
        currentTool: "browser",
      },
      now,
    });
    expect(s.isMock).toBe(true);
    expect(s.surface).toBe("browser");
    expect(s.currentUrl).toMatch(/^https:\/\//);
    expect(s.timeline.length).toBeGreaterThan(0);
    expect(s.control).toBe("agent");
  });

  it("is idle for sleeping agents", () => {
    const s = createMockLiveSession({
      agent: { id: "a2", name: "Sleepy", status: "sleeping", templateKey: "seo" },
      company: null,
      task: null,
      now,
    });
    expect(s.surface).toBe("idle");
    expect(s.timeline).toEqual([]);
    expect(s.lastFrameAt).toBeNull();
  });
});
