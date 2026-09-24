import type { AgentStatus, LiveSessionDTO } from "@aibos/shared";

/**
 * Browser worker contracts. Stage 29 implements Playwright-backed sessions,
 * Stage 30 persistent profiles, Stage 31 live streaming and Stage 32 human
 * takeover. Stage 01 only provides types and a deterministic mock session
 * generator that powers the LiveAgentScreen placeholder.
 */
export interface BrowserSessionHandle {
  id: string;
  agentId: string;
  companyId: string | null;
  profileId: string | null;
}

export interface BrowserFrame {
  sessionId: string;
  capturedAt: Date;
  /** Future: object-storage key or data URL for the screenshot. */
  imageRef: string | null;
  url: string | null;
}

export interface BrowserWorker {
  open(agentId: string, companyId: string | null): Promise<BrowserSessionHandle>;
  navigate(session: BrowserSessionHandle, url: string): Promise<void>;
  captureFrame(session: BrowserSessionHandle): Promise<BrowserFrame>;
  requestHumanControl(session: BrowserSessionHandle, reason: string): Promise<void>;
  returnControl(session: BrowserSessionHandle): Promise<void>;
  close(session: BrowserSessionHandle): Promise<void>;
}

export interface MockSessionInput {
  agent: { id: string; name: string; status: AgentStatus; templateKey: string };
  company: LiveSessionDTO["company"];
  task: {
    id: string;
    title: string;
    progress: number;
    currentAction: string | null;
    currentTool: string | null;
  } | null;
  now?: Date;
}

const SURFACES: Record<string, { surface: LiveSessionDTO["surface"]; url?: string; app?: string }> =
  {
    research: {
      surface: "browser",
      url: "https://www.easa.europa.eu/en/domains/aircrew-and-medical",
    },
    meta_ads: {
      surface: "browser",
      url: "https://business.facebook.com/adsmanager/manage/campaigns",
    },
    marketing_manager: {
      surface: "browser",
      url: "https://business.facebook.com/adsmanager/reporting",
    },
    email_communications: { surface: "application", app: "Outlook — Drafts" },
    website_performance: { surface: "browser", url: "https://pagespeed.web.dev/" },
    seo: { surface: "browser", url: "https://search.google.com/search-console" },
    company_manager: { surface: "application", app: "AI Business OS — Operations board" },
    social_media: { surface: "browser", url: "https://x.com/search?q=pilot%20training" },
  };

const TIMELINES: Record<string, [string, LiveSessionDTO["timeline"][number]["kind"]][]> = {
  browser: [
    ["Opened controlled browser profile", "navigate"],
    ["Loaded source page", "navigate"],
    ["Extracted structured data", "read"],
    ["Cross-checked against company knowledge", "think"],
    ["Wrote findings to task notes", "write"],
  ],
  application: [
    ["Loaded working context", "read"],
    ["Reviewed open items", "read"],
    ["Drafted next step", "write"],
    ["Waiting for next instruction", "wait"],
  ],
};

/** Builds a deterministic mock live session. MOCK DATA — no browser is running. */
export function createMockLiveSession(input: MockSessionInput): LiveSessionDTO {
  const now = input.now ?? new Date();
  const active =
    input.agent.status === "working" ||
    input.agent.status === "waiting" ||
    input.agent.status === "needs_approval";
  const cfg = active
    ? (SURFACES[input.agent.templateKey] ?? {
        surface: "browser" as const,
        url: "https://example.com",
      })
    : { surface: "idle" as const };
  const steps =
    cfg.surface === "idle"
      ? []
      : TIMELINES[cfg.surface === "application" ? "application" : "browser"]!;
  const timeline = steps.map(([label, kind], i) => ({
    at: new Date(now.getTime() - (steps.length - i) * 47_000).toISOString(),
    label,
    kind,
  }));
  return {
    id: `mock-session-${input.agent.id}`,
    isMock: true,
    agent: { id: input.agent.id, name: input.agent.name, status: input.agent.status },
    company: input.company,
    task: input.task
      ? { id: input.task.id, title: input.task.title, progress: input.task.progress }
      : null,
    surface: cfg.surface,
    currentUrl: "url" in cfg ? (cfg.url ?? null) : null,
    applicationName: "app" in cfg ? (cfg.app ?? null) : null,
    currentAction: active ? (input.task?.currentAction ?? "Reviewing context") : null,
    currentTool: active ? (input.task?.currentTool ?? null) : null,
    lastFrameAt: active ? new Date(now.getTime() - 4_000).toISOString() : null,
    control: "agent",
    timeline,
  };
}
