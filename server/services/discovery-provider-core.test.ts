import { describe, it, expect } from "vitest";
import {
  parseDiscoveryCandidates,
  buildDiscoveryPrompt,
  dedupeCandidates,
} from "./discovery-provider-core";
import type { DiscoverySearchInput } from "./discovery-provider-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<DiscoverySearchInput> = {}): DiscoverySearchInput {
  return {
    criteria: { roles: ["VP of Sales"], industries: ["SaaS"] },
    limit: 10,
    ...overrides,
  };
}

function jsonRow(name: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    title: "VP of Sales",
    companyName: "Acme Corp",
    email: null,
    linkedinUrl: null,
    geography: "US",
    industry: "SaaS",
    segment: null,
    sourceUrl: null,
    ...extras,
  };
}

function jsonText(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows);
}

// ---------------------------------------------------------------------------
// parseDiscoveryCandidates — name filtering
// ---------------------------------------------------------------------------

describe("parseDiscoveryCandidates — name filtering", () => {
  it("passes a valid multi-token name", () => {
    const text = jsonText([jsonRow("Jane Smith")]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(1);
    expect(results.candidates[0].name).toBe("Jane Smith");
  });

  it("passes a three-token name", () => {
    const text = jsonText([jsonRow("Mary Anne Johnson")]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(1);
    expect(results.candidates[0].name).toBe("Mary Anne Johnson");
  });

  it("drops a single-token name (first name only)", () => {
    const text = jsonText([jsonRow("Alice")]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(0);
  });

  it("drops an empty name string", () => {
    const text = jsonText([jsonRow("")]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(0);
  });

  it("drops a whitespace-only name", () => {
    const text = jsonText([jsonRow("   ")]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(0);
  });

  it("drops a null name", () => {
    const row = { ...jsonRow("placeholder"), name: null };
    const text = jsonText([row]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(0);
  });

  it("drops rows missing the name key entirely", () => {
    const row: Record<string, unknown> = { title: "CEO", companyName: "Acme" };
    const text = jsonText([row]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(0);
  });

  it("filters invalid rows while keeping valid ones in the same response", () => {
    const text = jsonText([
      jsonRow("Only"),
      jsonRow("Jane Smith"),
      jsonRow(""),
      jsonRow("Bob Brown"),
    ]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(2);
    expect(results.candidates.map((r) => r.name)).toEqual(["Jane Smith", "Bob Brown"]);
  });

  it("respects the limit even when more valid rows are present", () => {
    const names = ["Jane Smith", "Bob Brown", "Carol White", "David Green", "Eva Black"];
    const rows = names.map((n) => jsonRow(n));
    const text = jsonText(rows);
    const results = parseDiscoveryCandidates(text, "web", 3);
    expect(results.candidates).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// parseDiscoveryCandidates — tolerance
// ---------------------------------------------------------------------------

describe("parseDiscoveryCandidates — tolerance", () => {
  it("returns [] for empty input", () => {
    expect(parseDiscoveryCandidates("", "web", 10).candidates).toEqual([]);
  });

  it("returns [] for non-JSON prose", () => {
    expect(parseDiscoveryCandidates("No candidates found.", "web", 10).candidates).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseDiscoveryCandidates("[{broken", "web", 10).candidates).toEqual([]);
  });

  it("extracts the array even when wrapped in markdown fences", () => {
    const text = "```json\n" + jsonText([jsonRow("Jane Smith")]) + "\n```";
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(1);
  });

  it("extracts the array even when preceded by prose", () => {
    const text = "Here are the results:\n" + jsonText([jsonRow("Jane Smith")]);
    const results = parseDiscoveryCandidates(text, "web", 10);
    expect(results.candidates).toHaveLength(1);
  });

  it("stamps the correct source on every candidate", () => {
    const text = jsonText([jsonRow("Jane Smith"), jsonRow("Bob Brown")]);
    const results = parseDiscoveryCandidates(text, "salesnav", 10);
    expect(results.candidates.every((r) => r.source === "salesnav")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDiscoveryPrompt — full-name requirement
// ---------------------------------------------------------------------------

describe("buildDiscoveryPrompt — full-name requirement", () => {
  it("contains the full-name instruction", () => {
    const prompt = buildDiscoveryPrompt(makeInput());
    expect(prompt).toContain("full name");
    expect(prompt).toContain("first name AND last name");
  });

  it("instructs skipping when only a first name is found", () => {
    const prompt = buildDiscoveryPrompt(makeInput());
    expect(prompt).toMatch(/skip/i);
    expect(prompt).toContain("first name");
  });

  it("includes the campaign goal when provided", () => {
    const prompt = buildDiscoveryPrompt(makeInput({ goal: "Expand into mid-market" }));
    expect(prompt).toContain("Expand into mid-market");
  });

  it("includes role and industry targeting", () => {
    const prompt = buildDiscoveryPrompt(makeInput());
    expect(prompt).toContain("VP of Sales");
    expect(prompt).toContain("SaaS");
  });

  it("includes the limit in the prompt", () => {
    const prompt = buildDiscoveryPrompt(makeInput({ limit: 20 }));
    expect(prompt).toContain("20");
  });

  it("mentions named accounts when provided", () => {
    const prompt = buildDiscoveryPrompt(makeInput({ namedAccounts: ["Salesforce", "HubSpot"] }));
    expect(prompt).toContain("Salesforce");
    expect(prompt).toContain("HubSpot");
  });

  it("includes hard exclusions (disqualifiers)", () => {
    const prompt = buildDiscoveryPrompt(
      makeInput({ criteria: { roles: ["VP of Sales"], disqualifiers: ["competitors"] } }),
    );
    expect(prompt).toContain("competitors");
  });
});

// ---------------------------------------------------------------------------
// dedupeCandidates
// ---------------------------------------------------------------------------

function makeCandidate(
  name: string,
  companyName: string,
  overrides: Partial<{ email: string; linkedinUrl: string }> = {},
) {
  return {
    name,
    title: "VP",
    companyName,
    email: overrides.email ?? null,
    linkedinUrl: overrides.linkedinUrl ?? null,
    geography: null,
    industry: null,
    segment: null,
    sourceUrl: null,
    source: "web" as const,
  };
}

describe("dedupeCandidates", () => {
  it("returns all candidates when there are no existing prospects", () => {
    const candidates = [makeCandidate("Jane Smith", "Acme"), makeCandidate("Bob Brown", "Globex")];
    expect(dedupeCandidates(candidates, [])).toHaveLength(2);
  });

  it("drops a candidate matching an existing prospect by email", () => {
    const candidates = [makeCandidate("Jane Smith", "Acme", { email: "jane@acme.com" })];
    const existing = [{ email: "jane@acme.com" }];
    expect(dedupeCandidates(candidates, existing)).toHaveLength(0);
  });

  it("drops a candidate matching an existing prospect by LinkedIn URL", () => {
    const url = "https://linkedin.com/in/janesmith";
    const candidates = [makeCandidate("Jane Smith", "Acme", { linkedinUrl: url })];
    const existing = [{ linkedinUrl: url }];
    expect(dedupeCandidates(candidates, existing)).toHaveLength(0);
  });

  it("drops a candidate matching an existing prospect by name + company", () => {
    const candidates = [makeCandidate("Jane Smith", "Acme Corp")];
    const existing = [{ name: "Jane Smith", companyName: "Acme Corp" }];
    expect(dedupeCandidates(candidates, existing)).toHaveLength(0);
  });

  it("keeps a candidate whose name matches but company differs", () => {
    const candidates = [makeCandidate("Jane Smith", "Globex")];
    const existing = [{ name: "Jane Smith", companyName: "Acme Corp" }];
    expect(dedupeCandidates(candidates, existing)).toHaveLength(1);
  });

  it("deduplicates within the candidate list itself", () => {
    const candidates = [
      makeCandidate("Jane Smith", "Acme Corp"),
      makeCandidate("Jane Smith", "Acme Corp"),
    ];
    expect(dedupeCandidates(candidates, [])).toHaveLength(1);
  });

  it("deduplicates within candidates by shared email", () => {
    const candidates = [
      makeCandidate("Jane Smith", "Acme", { email: "jane@acme.com" }),
      makeCandidate("J. Smith", "Acme Inc", { email: "jane@acme.com" }),
    ];
    expect(dedupeCandidates(candidates, [])).toHaveLength(1);
  });
});
