import { strict as assert } from "node:assert";
import {
  buildDiscoveryPrompt,
  parseDiscoveryCandidates,
  dedupeCandidates,
  dedupeKeys,
  candidateToAttributes,
  normalizeLimit,
  type DiscoveryCandidate,
} from "../discovery-provider-core";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`[ok]   ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

(async () => {
  await test("normalizeLimit clamps and defaults", () => {
    assert.equal(normalizeLimit(undefined), 25);
    assert.equal(normalizeLimit(0), 25);
    assert.equal(normalizeLimit(-5), 25);
    assert.equal(normalizeLimit(10), 10);
    assert.equal(normalizeLimit(999), 50); // capped at MAX_LIMIT
    assert.equal(normalizeLimit("12"), 12);
  });

  await test("buildDiscoveryPrompt includes targeting facets and exclusions", () => {
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

  await test("parseDiscoveryCandidates parses a clean JSON array", () => {
    const text = JSON.stringify([
      { name: "Jane Doe", title: "CIO", companyName: "Acme", email: "jane@acme.com", linkedinUrl: null, sourceUrl: "https://acme.com/team" },
      { name: "John Roe", title: "IT Director", companyName: "Globex" },
    ]);
    const out = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, "Jane Doe");
    assert.equal(out[0].email, "jane@acme.com");
    assert.equal(out[0].source, "web");
    assert.equal(out[1].email, null);
  });

  await test("parseDiscoveryCandidates tolerates prose/code-fence wrapping", () => {
    const text = 'Here are the people I found:\n```json\n[{"name":"Amy Lin","companyName":"Initech"}]\n```\nLet me know!';
    const out = parseDiscoveryCandidates(text, "web", 25);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Amy Lin");
  });

  await test("parseDiscoveryCandidates drops rows without a name and respects limit", () => {
    const text = JSON.stringify([
      { title: "no name" },
      { name: "  " },
      { name: "Real Person", companyName: "Co" },
      { name: "Second Person", companyName: "Co2" },
    ]);
    assert.equal(parseDiscoveryCandidates(text, "web", 25).length, 2); // two valid-named rows
    assert.equal(parseDiscoveryCandidates(text, "web", 1).length, 1); // limit honored
  });

  await test("parseDiscoveryCandidates returns [] for non-JSON / empty", () => {
    assert.deepEqual(parseDiscoveryCandidates("no json here", "web", 25), []);
    assert.deepEqual(parseDiscoveryCandidates("", "web", 25), []);
    assert.deepEqual(parseDiscoveryCandidates("{}", "web", 25), []);
  });

  await test("dedupeKeys derives email/linkedin/name+company keys", () => {
    assert.deepEqual(
      dedupeKeys({ email: "A@B.com", linkedinUrl: "https://li/in/x/", name: "Jo", companyName: "Co" }),
      ["email:a@b.com", "li:https://li/in/x", "nc:jo|co"],
    );
    assert.deepEqual(dedupeKeys({ name: "Jo" }), []); // name alone is not an identity
  });

  await test("dedupeCandidates removes matches against existing prospects", () => {
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

  await test("dedupeCandidates removes intra-list duplicates", () => {
    const candidates: DiscoveryCandidate[] = [
      { name: "Dup", companyName: "Co", email: "dup@co.com", source: "web" },
      { name: "Dup", companyName: "Co", email: "dup@co.com", source: "web" },
    ];
    assert.equal(dedupeCandidates(candidates, []).length, 1);
  });

  await test("candidateToAttributes maps to scorer shape", () => {
    const attrs = candidateToAttributes({
      name: "Jane", title: "CIO", companyName: "Acme", industry: "PE", geography: "Seattle", segment: "mid-market", email: "j@a.com", linkedinUrl: "x", source: "web",
    });
    assert.equal(attrs.title, "CIO");
    assert.equal(attrs.industry, "PE");
    assert.equal(attrs.segment, "mid-market");
    assert.equal(attrs.email, "j@a.com");
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll discovery-provider-core tests passed");
})();
