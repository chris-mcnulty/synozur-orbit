/**
 * Vega Launchpad export — packages a marketing plan into a downloadable .zip
 * built around **Big Rocks + OKRs** so the Vega Launchpad can render an
 * executable strategic plan, not just a flat task list.
 *
 * Bundle contents:
 *   - `plan.json` — machine-readable, schema-versioned (`vega-export/2.0`)
 *   - `plan.md`   — human-readable runbook
 *
 * See `docs/vega-export-schema.md` for the full schema.
 */

import { storage } from "../storage";
import { db } from "../db";
import {
  marketingPlanBucketMappings,
  type MarketingPlan,
  type MarketingTask,
  type CompanyProfile,
  type LongFormRecommendation,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ContextFilter } from "../storage";

export const VEGA_EXPORT_SCHEMA_VERSION = "vega-export/2.0";

export interface VegaExportBundle {
  filename: string;
  contentType: string;
  body: Buffer;
}

export type VegaExportFormat = "zip" | "json";

interface BigRock {
  id: string;
  title: string;
  description: string | null;
  theme: string; // activityGroup
  quarter: string; // timeframe
  priority: string;
  status: string;
  ownerUserId: string | null;
  dueDate: Date | null;
  sourceTaskId: string;
  plannerTaskId: string | null;
  plannerDeepLink: string | null;
}

interface KeyResult {
  id: string;
  statement: string;
  status: string;
  sourceTaskId: string;
  plannerTaskId: string | null;
}

interface Objective {
  id: string;
  quarter: string;
  statement: string;
  keyResults: KeyResult[];
}

interface VegaExportPayload {
  schemaVersion: typeof VEGA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  tenantDomain: string;
  marketId: string | null;
  plan: {
    id: string;
    name: string;
    fiscalYear: string;
    description: string | null;
    status: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  context: {
    company: {
      name: string;
      website: string | null;
      industry: string | null;
      description: string | null;
    } | null;
    gtmPlan: { lastGeneratedAt: Date | null; summary: string | null } | null;
    messagingFramework: { lastGeneratedAt: Date | null; summary: string | null } | null;
    configMatrix: unknown;
  };
  objectives: Objective[];
  bigRocks: BigRock[];
  planner: {
    groupId: string | null;
    groupName: string | null;
    planId: string | null;
    planName: string | null;
    defaultBucketId: string | null;
    defaultBucketName: string | null;
    deepLinkBase: string | null;
    categoryBucketMappings: Array<{ activityCategory: string; bucketId: string; bucketName: string }>;
  } | null;
}

const TIMEFRAME_LABEL: Record<string, string> = {
  steady_state: "Steady State",
  Q1: "Q1",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4",
  future: "Future",
};

const TIMEFRAME_ORDER = ["Q1", "Q2", "Q3", "Q4", "steady_state", "future"];

const BIG_ROCK_PRIORITIES = new Set(["High", "high"]);

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "plan";
}

function plannerPlanDeepLink(planId: string | null, tenantDomain: string): string | null {
  if (!planId) return null;
  return `https://tasks.office.com/${encodeURIComponent(tenantDomain)}/Home/Planner/#/plantaskboard?planId=${encodeURIComponent(planId)}`;
}

function plannerTaskDeepLink(planId: string | null, taskId: string | null, tenantDomain: string): string | null {
  if (!planId || !taskId) return null;
  return `https://tasks.office.com/${encodeURIComponent(tenantDomain)}/Home/Task/${encodeURIComponent(taskId)}?planId=${encodeURIComponent(planId)}`;
}

/**
 * Extract the first ~280 chars of a markdown body as a summary, skipping
 * leading headings. Treats the doc as plain text.
 */
function summarizeMarkdown(content: string | null | undefined, maxLen = 320): string | null {
  if (!content) return null;
  const stripped = content
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join(" ")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return null;
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen - 1)}…` : stripped;
}

/**
 * Build OKR-style objectives by grouping tasks by quarter. Each quarter
 * with at least one Big-Rock-priority task gets an objective whose key
 * results are derived from the quarter's tasks.
 */
function buildObjectives(tasks: MarketingTask[], plan: MarketingPlan): Objective[] {
  const byQuarter = new Map<string, MarketingTask[]>();
  for (const t of tasks) {
    const key = t.timeframe || "future";
    const list = byQuarter.get(key) ?? [];
    list.push(t);
    byQuarter.set(key, list);
  }

  const objectives: Objective[] = [];
  for (const tf of TIMEFRAME_ORDER) {
    const list = byQuarter.get(tf);
    if (!list || list.length === 0) continue;

    const themes = Array.from(new Set(list.map((t) => t.activityGroup).filter(Boolean)));
    const themeText = themes.slice(0, 3).join(", ") || "marketing";

    const keyResults: KeyResult[] = list
      .filter((t) => BIG_ROCK_PRIORITIES.has(t.priority) || list.length <= 5)
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        statement: t.title,
        status: t.status,
        sourceTaskId: t.id,
        plannerTaskId: t.plannerTaskId ?? null,
      }));

    if (keyResults.length === 0) continue;

    objectives.push({
      id: `${plan.id}:${tf}`,
      quarter: tf,
      statement: `${TIMEFRAME_LABEL[tf] ?? tf} — advance ${themeText} for FY${plan.fiscalYear}`,
      keyResults,
    });
  }
  return objectives;
}

/**
 * Big Rocks are the strategic anchors Vega should treat as immovable: one
 * rock per (quarter × activity-category) cluster. Within each cluster we
 * pick the highest-priority task (High → Medium → Low → first task) so
 * each quarter exports at most one rock per category, and never more than
 * the underlying plan supports.
 */
const PRIORITY_RANK: Record<string, number> = { High: 0, high: 0, Medium: 1, medium: 1, Low: 2, low: 2 };

function buildBigRocks(tasks: MarketingTask[], plan: MarketingPlan): BigRock[] {
  const clusters = new Map<string, MarketingTask[]>();
  for (const t of tasks) {
    const quarter = t.timeframe || "future";
    const category = t.activityGroup || "general";
    const key = `${quarter}::${category}`;
    const list = clusters.get(key) ?? [];
    list.push(t);
    clusters.set(key, list);
  }

  const rocks: BigRock[] = [];
  const orderedKeys = Array.from(clusters.keys()).sort((a, b) => {
    const [qa] = a.split("::");
    const [qb] = b.split("::");
    return TIMEFRAME_ORDER.indexOf(qa) - TIMEFRAME_ORDER.indexOf(qb);
  });

  for (const key of orderedKeys) {
    const list = clusters.get(key);
    if (!list || list.length === 0) continue;
    const sorted = [...list].sort((a, b) => {
      const ra = PRIORITY_RANK[a.priority ?? ""] ?? 3;
      const rb = PRIORITY_RANK[b.priority ?? ""] ?? 3;
      return ra - rb;
    });
    const t = sorted[0];
    const [quarter] = key.split("::");
    rocks.push({
      id: t.id,
      title: t.title,
      description: t.description,
      theme: t.activityGroup,
      quarter,
      priority: t.priority,
      status: t.status,
      ownerUserId: t.assignedTo,
      dueDate: t.dueDate,
      sourceTaskId: t.id,
      plannerTaskId: t.plannerTaskId ?? null,
      plannerDeepLink: plannerTaskDeepLink(plan.plannerPlanId, t.plannerTaskId, plan.tenantDomain),
    });
  }
  return rocks;
}

function buildJson(
  plan: MarketingPlan,
  tasks: MarketingTask[],
  mappings: Array<{ activityCategory: string; bucketId: string; bucketName: string }>,
  company: CompanyProfile | null,
  gtmPlan: LongFormRecommendation | null,
  messaging: LongFormRecommendation | null,
): string {
  const payload: VegaExportPayload = {
    schemaVersion: VEGA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tenantDomain: plan.tenantDomain,
    marketId: plan.marketId,
    plan: {
      id: plan.id,
      name: plan.name,
      fiscalYear: plan.fiscalYear,
      description: plan.description,
      status: plan.status,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    },
    context: {
      company: company
        ? {
            name: company.companyName,
            website: company.websiteUrl ?? null,
            industry: company.industry ?? null,
            description: company.description ?? null,
          }
        : null,
      gtmPlan: gtmPlan
        ? { lastGeneratedAt: gtmPlan.lastGeneratedAt, summary: summarizeMarkdown(gtmPlan.content) }
        : null,
      messagingFramework: messaging
        ? { lastGeneratedAt: messaging.lastGeneratedAt, summary: summarizeMarkdown(messaging.content) }
        : null,
      configMatrix: plan.configMatrix ?? null,
    },
    objectives: buildObjectives(tasks, plan),
    bigRocks: buildBigRocks(tasks, plan),
    planner: plan.plannerPlanId
      ? {
          groupId: plan.plannerGroupId,
          groupName: plan.plannerGroupName,
          planId: plan.plannerPlanId,
          planName: plan.plannerPlanName,
          defaultBucketId: plan.plannerBucketId,
          defaultBucketName: plan.plannerBucketName,
          deepLinkBase: plannerPlanDeepLink(plan.plannerPlanId, plan.tenantDomain),
          categoryBucketMappings: mappings,
        }
      : null,
  };
  return JSON.stringify(payload, null, 2);
}

function buildMarkdown(payload: VegaExportPayload): string {
  const lines: string[] = [];
  lines.push(`# ${payload.plan.name} — FY${payload.plan.fiscalYear}`);
  lines.push("");
  if (payload.plan.description) {
    lines.push(payload.plan.description);
    lines.push("");
  }
  lines.push(`- **Status:** ${payload.plan.status}`);
  lines.push(`- **Tenant:** ${payload.tenantDomain}`);
  if (payload.context.company) {
    lines.push(`- **Company:** ${payload.context.company.name}${payload.context.company.industry ? ` (${payload.context.company.industry})` : ""}`);
  }
  lines.push("");

  if (payload.context.gtmPlan?.summary) {
    lines.push("## GTM Plan");
    lines.push("");
    lines.push(payload.context.gtmPlan.summary);
    lines.push("");
  }
  if (payload.context.messagingFramework?.summary) {
    lines.push("## Messaging Framework");
    lines.push("");
    lines.push(payload.context.messagingFramework.summary);
    lines.push("");
  }

  lines.push("## Objectives & Key Results");
  lines.push("");
  if (payload.objectives.length === 0) {
    lines.push("_No quarterly objectives derived._");
    lines.push("");
  } else {
    for (const obj of payload.objectives) {
      lines.push(`### ${TIMEFRAME_LABEL[obj.quarter] ?? obj.quarter}`);
      lines.push("");
      lines.push(`**Objective:** ${obj.statement}`);
      lines.push("");
      for (const kr of obj.keyResults) {
        const checkbox = kr.status === "completed" ? "[x]" : "[ ]";
        lines.push(`- ${checkbox} ${kr.statement}`);
      }
      lines.push("");
    }
  }

  lines.push("## Big Rocks");
  lines.push("");
  if (payload.bigRocks.length === 0) {
    lines.push("_No Big Rocks identified._");
    lines.push("");
  } else {
    lines.push("| Quarter | Theme | Title | Priority | Status |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const r of payload.bigRocks) {
      lines.push(`| ${TIMEFRAME_LABEL[r.quarter] ?? r.quarter} | ${r.theme} | ${r.title} | ${r.priority} | ${r.status} |`);
    }
    lines.push("");
  }

  if (payload.planner?.deepLinkBase) {
    lines.push("## Planner");
    lines.push("");
    lines.push(`- [Open plan in Microsoft Planner](${payload.planner.deepLinkBase})`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a Vega Launchpad export bundle for the given marketing plan.
 */
export async function buildVegaExportBundle(
  planId: string,
  ctx: ContextFilter,
  format: VegaExportFormat = "zip",
): Promise<VegaExportBundle | null> {
  const plan = await storage.getMarketingPlan(planId, ctx);
  if (!plan) return null;

  const tasks = await storage.getMarketingTasks(planId, ctx);
  const mappingRows = await db.select().from(marketingPlanBucketMappings)
    .where(eq(marketingPlanBucketMappings.planId, planId));
  const mappings = mappingRows.map((m) => ({
    activityCategory: m.activityCategory,
    bucketId: m.bucketId,
    bucketName: m.bucketName,
  }));

  const company = (await storage.getCompanyProfileByContext(ctx).catch(() => undefined)) ?? null;

  let gtmPlan: LongFormRecommendation | null = null;
  let messaging: LongFormRecommendation | null = null;
  if (company) {
    gtmPlan = (await storage.getLongFormRecommendationByType("gtm_plan", undefined, company.id)) ?? null;
    messaging = (await storage.getLongFormRecommendationByType("messaging_framework", undefined, company.id)) ?? null;
  }

  const json = buildJson(plan, tasks, mappings, company, gtmPlan, messaging);
  const slug = slugify(plan.name);

  if (format === "json") {
    return {
      filename: `vega-export-${slug}-${plan.fiscalYear}.json`,
      contentType: "application/json",
      body: Buffer.from(json, "utf-8"),
    };
  }

  const payload = JSON.parse(json) as VegaExportPayload;
  const md = buildMarkdown(payload);

  const archiver = (await import("archiver")).default;
  const { PassThrough } = await import("stream");

  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  archive.pipe(stream);
  archive.append(json, { name: "plan.json" });
  archive.append(md, { name: "plan.md" });
  await archive.finalize();
  await new Promise<void>((resolve) => stream.on("end", resolve));

  return {
    filename: `vega-export-${slug}-${plan.fiscalYear}.zip`,
    contentType: "application/zip",
    body: Buffer.concat(chunks),
  };
}
