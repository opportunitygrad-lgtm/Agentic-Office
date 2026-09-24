import { describe, expect, it } from "vitest";
import { createCompanySchema, listTasksQuery, slugify } from "../src";

const valid = {
  name: "Test Aviation Ltd",
  industry: "Aviation training",
  primaryCountry: "IE",
  timezone: "Europe/Dublin",
  defaultCurrency: "EUR",
  dailyAiBudget: 20,
  monthlyAiBudget: 400,
  concurrencyLimit: 3,
};

describe("createCompanySchema", () => {
  it("accepts a minimal valid company and applies defaults", () => {
    const parsed = createCompanySchema.parse(valid);
    expect(parsed.defaultProvider).toBe("CLAUDE");
    expect(parsed.requireApprovalDeepResearch).toBe(true);
    expect(parsed.initialAgents).toEqual([]);
  });

  it("rejects a company without a name", () => {
    const r = createCompanySchema.safeParse({ ...valid, name: "  " });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid timezone, currency and website", () => {
    expect(createCompanySchema.safeParse({ ...valid, timezone: "Mars/Olympus" }).success).toBe(
      false,
    );
    expect(createCompanySchema.safeParse({ ...valid, defaultCurrency: "euro" }).success).toBe(
      false,
    );
    expect(createCompanySchema.safeParse({ ...valid, website: "not a url" }).success).toBe(false);
  });

  it("rejects negative, excessive and inconsistent budgets", () => {
    expect(createCompanySchema.safeParse({ ...valid, dailyAiBudget: -1 }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...valid, dailyAiBudget: 1e9 }).success).toBe(false);
    const r = createCompanySchema.safeParse({ ...valid, dailyAiBudget: 50, monthlyAiBudget: 10 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["monthlyAiBudget"]);
    }
  });

  it("rejects invalid concurrency", () => {
    expect(createCompanySchema.safeParse({ ...valid, concurrencyLimit: 0 }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...valid, concurrencyLimit: 2.5 }).success).toBe(false);
    expect(createCompanySchema.safeParse({ ...valid, concurrencyLimit: 9999 }).success).toBe(false);
  });

  it("rejects unknown agent templates", () => {
    expect(
      createCompanySchema.safeParse({ ...valid, initialAgents: ["time_traveller"] }).success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("slugifies names", () => {
    expect(slugify("Euro Pilot Training")).toBe("euro-pilot-training");
    expect(slugify("  Café & Co. ")).toBe("cafe-co");
  });

  it("parses comma-separated task status filters", () => {
    expect(listTasksQuery.parse({ status: "running,waiting" }).status).toEqual([
      "running",
      "waiting",
    ]);
    expect(listTasksQuery.safeParse({ status: "exploded" }).success).toBe(false);
  });
});
