import * as fs from "node:fs";
import * as path from "node:path";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
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

const dangerousUnescaped = [
  /<script\b/i,
  /<img\b[^>]*onerror=/i,
  /<iframe\b/i,
  /<svg\b[^>]*onload=/i,
];

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

describe("pdf-snapshots", () => {
  for (const c of cases) {
    it(`snapshot: ${c.name}`, () => {
      const fixturePath = path.join(FIXTURE_DIR, c.fixture);
      const actual = c.render();
      if (UPDATE || !fs.existsSync(fixturePath)) {
        fs.writeFileSync(fixturePath, actual, "utf-8");
        return;
      }
      const expected = fs.readFileSync(fixturePath, "utf-8");
      assert.equal(actual, expected, `Snapshot drift for ${c.name}. Run with UPDATE_SNAPSHOTS=1 to refresh.`);
    });
  }

  for (const sc of securityCases) {
    it(`security: ${sc.name}`, () => {
      const out = markdownToHtml(sc.input);
      for (const re of dangerousUnescaped) {
        assert.ok(!re.test(out), `Output matched dangerous pattern ${re} for case: ${sc.name}\n${out}`);
      }
    });
  }
});
