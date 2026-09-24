import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routerMock } from "@/test/next-navigation";
import { AddCompanyWizard, type WizardTemplate } from "./AddCompanyWizard";

const TEMPLATES: WizardTemplate[] = [
  {
    key: "company_manager",
    name: "Company Manager",
    description: "Plans the day",
    department: "management",
  },
  { key: "research", name: "Research Agent", description: "Investigates", department: "research" },
  {
    key: "email_communications",
    name: "Email & Communications",
    description: "Drafts replies",
    department: "communications",
  },
  {
    key: "marketing_manager",
    name: "Marketing Manager",
    description: "Owns marketing",
    department: "marketing",
  },
];

const cont = () => screen.getByRole("button", { name: /Continue/ });

describe("AddCompanyWizard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates each step, shows a review and creates the company", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "x", name: "SkyBridge Academy", slug: "skybridge-academy" },
          agentsCreated: 4,
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AddCompanyWizard templates={TEMPLATES} />);

    // Step 1 — required fields
    await user.click(cont());
    expect(await screen.findByText("Company name is required")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Company name/), "SkyBridge Academy");
    await user.type(screen.getByLabelText(/Industry/), "Aviation training");
    await user.type(screen.getByLabelText("Website"), "https://skybridge.example");
    await user.click(cont());

    // Step 2 — tags
    expect(screen.getByRole("heading", { name: "Business" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Products / services"), "Type ratings{Enter}");
    expect(screen.getByRole("button", { name: "Remove Type ratings" })).toBeInTheDocument();
    await user.click(cont());

    // Step 3 — brand
    await user.click(screen.getByRole("button", { name: "+ Professional" }));
    await user.click(cont());

    // Step 4 — invalid budget and concurrency are rejected
    const daily = screen.getByLabelText("Daily AI budget");
    await user.clear(daily);
    await user.type(daily, "-5");
    const conc = screen.getByLabelText("Normal concurrency");
    await user.clear(conc);
    await user.type(conc, "0");
    await user.click(cont());
    expect(screen.getByText("Budget cannot be negative")).toBeInTheDocument();
    expect(screen.getByText("Concurrency must be at least 1")).toBeInTheDocument();
    await user.clear(daily);
    await user.type(daily, "30");
    await user.clear(conc);
    await user.type(conc, "3");
    await user.click(screen.getByRole("radio", { name: /OpenAI/ }));
    await user.click(cont());

    // Step 5 — agents
    await user.click(screen.getByRole("checkbox", { name: /Marketing Manager/ }));
    await user.click(cont());

    // Step 6 — review + submit
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Company identity" })).toHaveTextContent(
      "SkyBridge Academy",
    );
    expect(screen.getByRole("region", { name: "Initial agents (4)" })).toHaveTextContent(
      "Marketing Manager",
    );
    await user.click(screen.getByRole("button", { name: /Create company/ }));

    await waitFor(() => expect(screen.getByText("SkyBridge Academy is ready")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/companies");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      name: "SkyBridge Academy",
      industry: "Aviation training",
      productsServices: ["Type ratings"],
      brandTone: "Professional",
      dailyAiBudget: 30,
      concurrencyLimit: 3,
      defaultProvider: "OPENAI",
      initialAgents: ["company_manager", "research", "email_communications", "marketing_manager"],
    });
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("returns to step 1 when the API reports a duplicate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "conflict", message: 'A company with slug "dup" already exists' },
          }),
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<AddCompanyWizard templates={TEMPLATES} />);
    await user.type(screen.getByLabelText(/Company name/), "Dup");
    await user.type(screen.getByLabelText(/Industry/), "Aviation");
    for (let i = 0; i < 5; i++) await user.click(cont());
    await user.click(screen.getByRole("button", { name: /Create company/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Company identity" })).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/already exists/).length).toBeGreaterThan(0);
  });
});
