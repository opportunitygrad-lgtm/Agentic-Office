import { describe, expect, it } from "vitest";
import { INTEGRATION_KINDS } from "@aibos/shared";
import { INTEGRATION_CATALOG, PlaceholderIntegrationAdapter } from "../src";

describe("integration catalog", () => {
  it("defines every integration kind exactly once", () => {
    expect(INTEGRATION_CATALOG.map((d) => d.kind).sort()).toEqual([...INTEGRATION_KINDS].sort());
  });

  it("declares secret names only, never values", () => {
    for (const d of INTEGRATION_CATALOG)
      for (const s of d.requiredSecrets) expect(s).toMatch(/^[A-Z0-9_<>]+$/);
  });

  it("placeholder adapters report not_configured without I/O", async () => {
    const h = await new PlaceholderIntegrationAdapter("meta").healthCheck();
    expect(h.status).toBe("not_configured");
  });
});
