import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("client/src/pages/app/competitors.tsx", "utf8");
const routes = readFileSync("server/routes/integrations.ts", "utf8");
const service = readFileSync("server/services/hubspot-integration.ts", "utf8");

describe("CRM deal activity must not become competitor recommendations", () => {
  it("removes both suggestion surfaces and the tenant-wide query from the page", () => {
    expect(page).not.toContain("suggested-competitors");
    expect(page).not.toContain("suggestionsFromHubspot");
    expect(page).not.toContain("addHubspotSuggestion");
    expect(page).not.toContain("Suggested from HubSpot");
  });

  it("keeps authenticated compatibility for old clients without reading CRM companies", () => {
    const start = routes.indexOf('app.get("/api/integrations/hubspot/suggested-competitors"');
    expect(start).toBeGreaterThan(-1);
    const handler = routes.slice(start, routes.indexOf("// List HubSpot owners", start));
    expect(handler).toContain("await loadHubspotContext(req, res)");
    expect(handler).toContain("if (!ctx) return;");
    expect(handler).toContain("res.json({ items: [] })");
    expect(handler).not.toContain("hubspot.list");
    expect(service).not.toContain("listSuggestedCompetitors");
  });

  it("preserves market-specific AI discovery and existing competitor CRM details", () => {
    expect(page).toContain("/api/company-profile/suggest-competitors");
    expect(page).toContain("AI-Suggested Competitors");
    expect(page).toContain("hubspotPortalId");
    expect(page).toContain("formatLifecycleStage(c.hubspotLifecycleStage)");
  });
});
