import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  buildDiscoveryPrompt,
  parseDiscoveryCandidates,
  dedupeCandidates,
  dedupeKeys,
  candidateToAttributes,
  normalizeLimit,
  type DiscoveryCandidate,
} from "../discovery-provider-core";


describe("discovery-provider-core", () => {
  it("normalizeLimit clamps and defaults", () => {
    assert.equal(normalizeLimit(undefined), 25);
    assert.equal(normalizeLimit(0), 25);
    assert.equal(normalizeLimit(-5), 25);
    assert.equal(normalizeLimit(10), 10);
    assert.equal(normalizeLimit(999), 50); // capped at MAX_LIMIT
    assert.equal(normalizeLimit("12"), 12);
  });

  it("buildDiscoveryPrompt includes targeting facets and exclusions", () => {
    const prompt = buildDiscoveryPrompt({
      criteria: {
        roles: ["CIO", "IT director"],
        industries: ["Private Equity"],
        geographies: ["Pacific Northwest"],
        segments: ["mid-market"],
        disqualifiers: ["intern", "student"],
      },
      namedAccounts: ["Acme Capital"],
      goal: "book 10 discovery calls",
      limit: 25,
    });
    assert.ok(prompt.includes("book 10 discovery calls"));
    assert.ok(prompt.includes("CIO"));
    assert.ok(prompt.includes("Pacific Northwest"));
    assert.ok(prompt.includes("Acme Capital"));
    assert.ok(prompt.includes("intern"));
    assert.ok(prompt.includes("at most 25"));
    assert.ok(prompt.toUpperCase().includes("JSON"));
  });

  it("parseDiscoveryCandidates parses a clean JSON array", () => {
    const text = JSON.stringify([
      { name: "Jane Doe", title: "CIO", companyName: "Acme", email: "jane@acme.com", linkedinUrl: null, sourceUrl: "https://acme.com/team" },
      { name: "John Roe", title: "IT Director", companyName: "Globex" },
    ]);
    const { candidates, droppedCount } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].name, "Jane Doe");
    assert.equal(candidates[0].email, "jane@acme.com");
    assert.equal(candidates[0].source, "web");
    assert.equal(candidates[1].email, null);
    assert.equal(droppedCount, 0);
  });

  it("parseDiscoveryCandidates tolerates prose/code-fence wrapping", () => {
    const text = 'Here are the people I found:\n```json\n[{"name":"Amy Lin","companyName":"Initech"}]\n```\nLet me know!';
    const { candidates } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].name, "Amy Lin");
  });

  it("parseDiscoveryCandidates drops rows without a name and respects limit", () => {
    const text = JSON.stringify([
      { title: "no name" },
      { name: "  " },
      { name: "Real Person", companyName: "Co" },
      { name: "Second Person", companyName: "Co2" },
    ]);
    assert.equal(parseDiscoveryCandidates(text, "web", 25).candidates.length, 2); // two valid-named rows
    assert.equal(parseDiscoveryCandidates(text, "web", 1).candidates.length, 1); // limit honored
  });

  it("parseDiscoveryCandidates returns [] for non-JSON / empty", () => {
    assert.deepEqual(parseDiscoveryCandidates("no json here", "web", 25).candidates, []);
    assert.deepEqual(parseDiscoveryCandidates("", "web", 25).candidates, []);
    assert.deepEqual(parseDiscoveryCandidates("{}", "web", 25).candidates, []);
  });

  it("parseDiscoveryCandidates counts dropped rows in droppedCount", () => {
    const text = JSON.stringify([
      { title: "no name here" },
      { name: "SingleToken" },
      { name: "VP Sales" },
      { name: "Acme Inc" },
      { name: "Valid Person", companyName: "Co" },
    ]);
    const { candidates, droppedCount } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].name, "Valid Person");
    assert.equal(droppedCount, 4);
  });

  it("parseDiscoveryCandidates nulls unsafe linkedinUrl schemes", () => {
    const text = JSON.stringify([
      { name: "Alice Smith", companyName: "Acme", linkedinUrl: "javascript:alert(1)" },
      { name: "Bob Jones", companyName: "Acme", linkedinUrl: "data:text/html,<h1>hi</h1>" },
      { name: "Carol White", companyName: "Acme", linkedinUrl: "vbscript:msgbox(1)" },
      { name: "Dave Brown", companyName: "Acme", linkedinUrl: "ftp://files.acme.com/profile" },
    ]);
    const { candidates } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates.length, 4);
    assert.equal(candidates[0].linkedinUrl, null, "javascript: must be nulled");
    assert.equal(candidates[1].linkedinUrl, null, "data: must be nulled");
    assert.equal(candidates[2].linkedinUrl, null, "vbscript: must be nulled");
    assert.equal(candidates[3].linkedinUrl, null, "ftp: must be nulled");
  });

  it("parseDiscoveryCandidates passes through valid http/https linkedinUrl", () => {
    const text = JSON.stringify([
      { name: "Alice Smith", companyName: "Acme", linkedinUrl: "https://www.linkedin.com/in/alice-smith" },
      { name: "Bob Jones", companyName: "Acme", linkedinUrl: "http://linkedin.com/in/bob-jones" },
    ]);
    const { candidates } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates[0].linkedinUrl, "https://www.linkedin.com/in/alice-smith");
    assert.equal(candidates[1].linkedinUrl, "http://linkedin.com/in/bob-jones");
  });

  it("parseDiscoveryCandidates nulls unsafe sourceUrl schemes", () => {
    const text = JSON.stringify([
      { name: "Alice Smith", companyName: "Acme", sourceUrl: "javascript:void(0)" },
      { name: "Bob Jones", companyName: "Acme", sourceUrl: "data:application/json,{}" },
      { name: "Carol White", companyName: "Acme", sourceUrl: "file:///etc/passwd" },
    ]);
    const { candidates } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates[0].sourceUrl, null, "javascript: must be nulled");
    assert.equal(candidates[1].sourceUrl, null, "data: must be nulled");
    assert.equal(candidates[2].sourceUrl, null, "file: must be nulled");
  });

  it("parseDiscoveryCandidates passes through valid http/https sourceUrl", () => {
    const text = JSON.stringify([
      { name: "Alice Smith", companyName: "Acme", sourceUrl: "https://acme.com/team/alice" },
      { name: "Bob Jones", companyName: "Acme", sourceUrl: "http://acme.com/about" },
    ]);
    const { candidates } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates[0].sourceUrl, "https://acme.com/team/alice");
    assert.equal(candidates[1].sourceUrl, "http://acme.com/about");
  });

  it("parseDiscoveryCandidates nulls malformed or relative URLs", () => {
    const text = JSON.stringify([
      { name: "Alice Smith", companyName: "Acme", linkedinUrl: "not-a-url" },
      { name: "Bob Jones", companyName: "Acme", sourceUrl: "/relative/path" },
      { name: "Carol White", companyName: "Acme", linkedinUrl: "" },
    ]);
    const { candidates } = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(candidates[0].linkedinUrl, null, "bare string must be nulled");
    assert.equal(candidates[1].sourceUrl, null, "relative path must be nulled");
    assert.equal(candidates[2].linkedinUrl, null, "empty string must be nulled");
  });

  it("dedupeKeys derives email/linkedin/name+company keys", () => {
    assert.deepEqual(
      dedupeKeys({ email: "A@B.com", linkedinUrl: "https://li/in/x/", name: "Jo", companyName: "Co" }),
      ["email:a@b.com", "li:https://li/in/x", "nc:jo|co"],
    );
    assert.deepEqual(dedupeKeys({ name: "Jo" }), []); // name alone is not an identity
  });

  it("dedupeCandidates removes matches against existing prospects", () => {
    const candidates: DiscoveryCandidate[] = [
      { name: "Jane", companyName: "Acme", email: "jane@acme.com", source: "web" },
      { name: "John", companyName: "Globex", linkedinUrl: "https://li/in/john", source: "web" },
      { name: "New Person", companyName: "Fresh", source: "web" },
    ];
    const existing = [
      { email: "JANE@acme.com", name: "Jane", companyName: "Acme" },
      { linkedinUrl: "https://li/in/john/", name: "John", companyName: "Globex" },
    ];
    const out = dedupeCandidates(candidates, existing);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "New Person");
  });

  it("dedupeCandidates removes intra-list duplicates", () => {
    const candidates: DiscoveryCandidate[] = [
      { name: "Dup", companyName: "Co", email: "dup@co.com", source: "web" },
      { name: "Dup", companyName: "Co", email: "dup@co.com", source: "web" },
    ];
    assert.equal(dedupeCandidates(candidates, []).length, 1);
  });

  it("candidateToAttributes maps to scorer shape", () => {
    const attrs = candidateToAttributes({
      name: "Jane", title: "CIO", companyName: "Acme", industry: "PE", geography: "Seattle", segment: "mid-market", email: "j@a.com", linkedinUrl: "x", source: "web",
    });
    assert.equal(attrs.title, "CIO");
    assert.equal(attrs.industry, "PE");
    assert.equal(attrs.segment, "mid-market");
    assert.equal(attrs.email, "j@a.com");
  });

});
