import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyAiPolicyDTO } from "@aibos/shared";
import "@/test/next-navigation";
import { AiPolicyPanel } from "./AiPolicyPanel";

afterEach(() => vi.unstubAllGlobals());

function stubApi(response: unknown, status = 200) {
  const fn = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(response), { status })),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const policy = (over: Partial<CompanyAiPolicyDTO> = {}): CompanyAiPolicyDTO => ({
  defaultProvider: "CLAUDE",
  allowedProviders: ["CLAUDE", "OPENAI", "GROK", "LOCAL"],
  defaultResearchLimit: 20,
  deepResearchPolicy: "approval_required",
  externalActionPolicy: "approval_required",
  browserPolicy: "disabled",
  autoSendPolicy: "disabled",
  staleKnowledgePolicy: "mark_stale",
  customRules: [],
  defaultModelTier: "standard",
  premiumAllowed: false,
  maxResponseDetail: "detailed",
  fallbackAllowed: false,
  providerSelection: "fixed",
  reviewMode: "manual",
  reviewProvider: null,
  reviewTaskTypes: [],
  highValueThresholdUsd: null,
  maxReviewsPerTask: 1,
  updatedAt: null,
  ...over,
});

describe("AiPolicyPanel — second-opinion policy", () => {
  it("shows the current provider selection, review mode and reviewer preference", () => {
    render(
      <AiPolicyPanel
        companySlug="ept"
        policy={policy({ providerSelection: "auto", reviewMode: "high_value_only" })}
        canEdit={false}
      />,
    );
    const section = screen.getByTestId("second-opinion-policy");
    expect(section).toHaveTextContent("auto");
    expect(section).toHaveTextContent("High-value only");
    expect(section).toHaveTextContent("No preference");
    expect(section).toHaveTextContent("1");
  });

  it("marks Grok (not OpenAI) as not connected when editing provider choices", async () => {
    const u = userEvent.setup();
    render(<AiPolicyPanel companySlug="ept" policy={policy()} canEdit={true} />);
    await u.click(screen.getByRole("button", { name: "Edit" }));
    const openaiButton = screen.getByRole("button", { name: /^OpenAI/ });
    const grokButton = screen.getByRole("button", { name: /^Grok/ });
    expect(openaiButton).not.toHaveTextContent("not connected");
    expect(grokButton).toHaveTextContent("not connected");
  });

  it("edits and saves the second-opinion policy", async () => {
    const fn = stubApi({ data: policy({ reviewMode: "manual" }) });
    const u = userEvent.setup();
    render(<AiPolicyPanel companySlug="ept" policy={policy()} canEdit={true} />);
    await u.click(screen.getByRole("button", { name: "Edit" }));
    await u.selectOptions(screen.getByLabelText("Review mode"), "policy_required");
    await u.selectOptions(screen.getByLabelText("Preferred reviewer"), "OPENAI");
    await u.click(screen.getByRole("button", { name: "Save policy" }));
    const [, init] = fn.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ reviewMode: "policy_required", reviewProvider: "OPENAI" });
  });
});
