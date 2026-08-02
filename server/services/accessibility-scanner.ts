/**
 * Built-in accessibility scanner — injects axe-core into the application URL
 * via the existing headless browser and maps violations into ScannerFindings.
 *
 * No external service required. axe-core runs entirely inside the Puppeteer
 * page process, so this works against any publicly-reachable URL.
 */

import * as fs from "fs";
import * as path from "path";
import { getBrowserPage, releaseBrowserPage } from "./headless-crawler";
import type { ScannerProvider, ScanRequest, ScanResult, ScannerFinding } from "./observatory-scanners";

// ── axe-core source (loaded once at module init) ────────────────────────────

let _axeSource: string | null = null;

function getAxeSource(): string {
  if (_axeSource) return _axeSource;
  try {
    const axePath = require.resolve("axe-core");
    _axeSource = fs.readFileSync(axePath, "utf8");
    console.log("[AccessibilityScanner] axe-core loaded from:", axePath);
    return _axeSource;
  } catch (err) {
    throw new Error(`axe-core not found. Run: npm install axe-core\n${err}`);
  }
}

// ── axe severity → Observatory severity mapping ─────────────────────────────

function mapImpact(impact: string | null): string {
  switch (impact) {
    case "critical": return "Critical";
    case "serious":  return "High";
    case "moderate": return "Medium";
    case "minor":    return "Low";
    default:         return "Informational";
  }
}

// Parse WCAG criterion from axe tags like "wcag143" → "1.4.3", "wcag21" → "2.1"
function extractWcagCriterion(tags: string[]): string | undefined {
  for (const tag of tags) {
    const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
    const m2 = tag.match(/^wcag(\d)(\d+)$/);
    if (m2) return `${m2[1]}.${m2[2]}`;
  }
  return undefined;
}

// ── Scanner implementation ───────────────────────────────────────────────────

export const accessibilityScanner: ScannerProvider = {
  key: "axe_core",
  name: "axe-core (built-in)",
  assessmentTypes: ["accessibility"],

  async isAvailable(): Promise<boolean> {
    try {
      getAxeSource();
      return true;
    } catch {
      return false;
    }
  },

  async runScan(request: ScanRequest): Promise<ScanResult> {
    const startedAt = new Date();
    const targetUrl = request.target.url;
    if (!targetUrl) throw new Error("accessibility scan requires a target URL");

    const axeSource = getAxeSource();
    const findings: ScannerFinding[] = [];
    let rawAxeResults: unknown = null;

    let page: Awaited<ReturnType<typeof getBrowserPage>> | null = null;
    try {
      console.log(`[AccessibilityScanner] Scanning ${targetUrl}`);
      page = await getBrowserPage();

      await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 });

      // Wait for page to settle
      await new Promise(r => setTimeout(r, 1500));

      // Inject axe-core and run
      await page.evaluate(axeSource);

      const axeResults = await page.evaluate(async () => {
        return await (window as any).axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
          },
          resultTypes: ["violations", "incomplete"],
        });
      }) as any;

      rawAxeResults = axeResults;

      // Map violations → findings (one per rule, first node as primary location)
      for (const violation of (axeResults.violations ?? [])) {
        const firstNode = violation.nodes?.[0];
        const selector = firstNode?.target?.join(", ") ?? undefined;
        const htmlSnippet = firstNode?.html ?? "";
        const nodeCount = violation.nodes?.length ?? 0;

        const description = [
          violation.description,
          htmlSnippet ? `\n\nFirst affected element:\n\`${htmlSnippet}\`` : "",
          nodeCount > 1 ? `\n\n${nodeCount} elements affected on this page.` : "",
          firstNode?.failureSummary ? `\n\n${firstNode.failureSummary}` : "",
        ].filter(Boolean).join("");

        findings.push({
          ruleId: violation.id,
          title: violation.help,
          description,
          severity: mapImpact(violation.impact),
          wcagCriterion: extractWcagCriterion(violation.tags ?? []),
          location: { url: targetUrl, selector },
          raw: { violation, nodeCount },
        });
      }

      // Also surface incomplete (needs-review) items as Informational
      for (const incomplete of (axeResults.incomplete ?? [])) {
        const firstNode = incomplete.nodes?.[0];
        const selector = firstNode?.target?.join(", ") ?? undefined;

        findings.push({
          ruleId: `${incomplete.id}:needs-review`,
          title: `Needs review: ${incomplete.help}`,
          description: `${incomplete.description}\n\nManual verification required.`,
          severity: "Informational",
          wcagCriterion: extractWcagCriterion(incomplete.tags ?? []),
          location: { url: targetUrl, selector },
          raw: incomplete,
        });
      }

      console.log(
        `[AccessibilityScanner] ${targetUrl} — ${findings.filter(f => f.severity !== "Informational").length} violations, ${findings.filter(f => f.severity === "Informational").length} needs-review`,
      );
    } finally {
      if (page) releaseBrowserPage(page);
    }

    return {
      findings,
      rawReport: {
        contentType: "application/json",
        body: JSON.stringify(rawAxeResults, null, 2),
      },
      tool: `axe-core@${getAxeVersion()}`,
      startedAt,
      finishedAt: new Date(),
    };
  },
};

function getAxeVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("axe-core/package.json").version;
  } catch {
    return "unknown";
  }
}
