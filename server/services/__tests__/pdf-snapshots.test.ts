import * as fs from "node:fs";
import * as path from "node:path";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import {
  markdownToHtml,
  renderFrameworkContent,
  renderProductBlock,
} from "../pdf-generator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, "pdf-fixtures");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

interface Case {
  name: string;
  fixture: string;
  render: () => string;
}

const cases: Case[] = [
  {
    name: "active-products-block",
    fixture: "active-products-block.html",
    render: () => {
      const baseline = renderProductBlock({
        id: "p1",
        name: "Orbit Compete",
        description:
          "Always-on competitive intelligence platform that turns scattered web, social, and product signals into ranked actions for go-to-market teams.",
        competitivePositionSummary:
          "Differentiated by deep tenant+market scoping, integrated GTM & messaging artifacts, and consultant-grade PDF reporting that competitors treat as add-ons.",
        status: "baseline",
        featureCount: 12,
        roadmapCount: 4,
        isBaseline: true,
        topFeatures: [
          {
            name: "Full Analysis PDF Report",
            description:
              "Single-click export of executive summary, competitor profiles, gap analysis, GTM, and messaging.",
            category: "Reporting",
          },
          {
            name: "Tenant + Market Context Scoping",
            description:
              "All data, recommendations, and reports cleanly partitioned per market.",
            category: "Platform",
          },
          {
            name: "Long-Form Strategic Recommendations",
            description:
              "GTM Plan and Messaging Framework generated with cited evidence.",
            category: "AI",
          },
        ],
        competingProducts: [
          { competitorName: "Crayon", productName: "Crayon Intelligence" },
          { competitorName: "Klue", productName: "Klue Competitive Enablement" },
          { competitorName: "Kompyte", productName: "Kompyte Battlecards" },
        ],
      });
      const competitor = renderProductBlock({
        id: "p2",
        name: "Crayon Intelligence",
        description:
          "Market and competitive intelligence platform focused on tracking competitor digital footprints across the web.",
        competitivePositionSummary: null,
        status: "competitor",
        featureCount: 7,
        roadmapCount: 0,
        topFeatures: [
          {
            name: "Competitor Tracking",
            description: "Monitors public web, pricing, and content updates.",
            category: null,
          },
          {
            name: "Battlecards",
            description: "Built-in editor with sales enablement workflows.",
            category: null,
          },
          {
            name: "Insight Digests",
            description: "Email summaries delivered to revenue teams.",
            category: null,
          },
        ],
      });
      return baseline + competitor;
    },
  },
  {
    name: "messaging-framework-block",
    fixture: "messaging-framework-block.html",
    render: () =>
      renderFrameworkContent(`## Positioning Statement
For **go-to-market teams at mid-market B2B SaaS companies** who need ranked competitive actions instead of dashboards, **Orbit Compete** is the always-on intelligence platform that turns scattered web, social, and product signals into a single prioritized worklist — backed by consultant-grade PDF reporting.

### Pillars

- **Always-on intelligence** — continuous crawl + social monitoring per market.
- **Ranked actions** — every signal becomes a scored, owned next step.
- **Strategy-ready output** — GTM and messaging artifacts on demand.

> "We replaced three tools and a quarterly consultant retainer with one Orbit workspace." — VP Marketing, design partner

### Proof Points

| Claim | Evidence |
| --- | --- |
| Faster time-to-insight | Average competitor signal reviewed within 24h of crawl. |
| Lower tooling spend | Replaces battlecard tool + monitoring tool + manual research. |

See full sources at [orbit.example.com/research](https://orbit.example.com/research) or email [research@orbit.example.com](mailto:research@orbit.example.com).`),
  },
  {
    name: "gtm-plan-block",
    fixture: "gtm-plan-block.html",
    render: () =>
      markdownToHtml(`## 1. Target Segments

1. **Mid-market B2B SaaS (200–2,000 employees)** — Marketing + Product leaders running quarterly competitive reviews.
2. **Boutique strategy consultancies** — Need white-labeled competitive deliverables per client engagement.

## 2. Channels & Plays

- **Outbound** — Sequenced touches anchored on a freshly generated competitor battlecard.
- **Content** — Quarterly "State of the Category" PDF report co-marketed with design partners.
- **Partnerships** — Co-sell with revenue intelligence and CRM vendors.

## 3. 90-Day Milestones

| Window | Milestone | Owner |
| --- | --- | --- |
| Days 0–30 | Ship Capstone Report v1 to 5 design partners. | Product |
| Days 31–60 | Launch outbound sequence + 2 case studies. | Marketing |
| Days 61–90 | Open self-serve trial with usage-based gating. | Growth |

> Success metric: 12 paid logos and >40% trial-to-paid conversion by end of quarter.

Plan reviewed quarterly. Source data at [orbit.example.com/gtm](https://orbit.example.com/gtm).`),
  },
];

let failures = 0;
for (const c of cases) {
  const fixturePath = path.join(FIXTURE_DIR, c.fixture);
  const actual = c.render();
  if (UPDATE || !fs.existsSync(fixturePath)) {
    fs.writeFileSync(fixturePath, actual, "utf-8");
    console.log(`[snapshot] wrote ${c.fixture} (${actual.length} bytes)`);
    continue;
  }
  const expected = fs.readFileSync(fixturePath, "utf-8");
  try {
    assert.equal(actual, expected, `Snapshot drift for ${c.name}`);
    console.log(`[snapshot] OK  ${c.fixture}`);
  } catch (err) {
    failures += 1;
    console.error(`[snapshot] FAIL ${c.fixture}`);
    const aLines = actual.split("\n");
    const eLines = expected.split("\n");
    const max = Math.min(aLines.length, eLines.length);
    for (let i = 0; i < max; i++) {
      if (aLines[i] !== eLines[i]) {
        console.error(`  line ${i + 1}:`);
        console.error(`    expected: ${eLines[i]}`);
        console.error(`    actual:   ${aLines[i]}`);
        break;
      }
    }
    if (aLines.length !== eLines.length) {
      console.error(`  expected ${eLines.length} lines, got ${aLines.length}`);
    }
  }
}

// Security checks: ensure user/AI-authored markdown cannot inject live HTML
// into the rendered PDF. We look for *unescaped* dangerous tokens — escaped
// forms like `&lt;script&gt;` are safe because the browser/renderer will not
// execute them.
const securityCases: Array<{ name: string; input: string }> = [
  {
    name: "table cells escape HTML",
    input: `| Header | <script>alert(1)</script> |
| --- | --- |
| Cell | <img src=x onerror=alert(1)> |`,
  },
  {
    name: "blockquote escapes HTML",
    input: `> <script>alert("xss")</script>`,
  },
  {
    name: "headings escape HTML",
    input: `## <script>alert(1)</script>`,
  },
  {
    name: "paragraph escapes HTML",
    input: `Hello <img src=x onerror=alert(1)> world`,
  },
];
const dangerousUnescaped = [
  /<script\b/i,
  /<img\b[^>]*onerror=/i,
  /<iframe\b/i,
  /<svg\b[^>]*onload=/i,
];
for (const sc of securityCases) {
  const out = markdownToHtml(sc.input);
  let bad: RegExp | null = null;
  for (const re of dangerousUnescaped) {
    if (re.test(out)) {
      bad = re;
      break;
    }
  }
  if (bad) {
    failures += 1;
    console.error(`[security] FAIL ${sc.name}: output matched ${bad}`);
    console.error(out);
  } else {
    console.log(`[security] OK  ${sc.name}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} snapshot/security check(s) failed.`);
  console.error(`Run with UPDATE_SNAPSHOTS=1 to refresh fixtures after intentional changes.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + securityCases.length} checks passed.`);
