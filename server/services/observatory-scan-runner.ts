/**
 * Observatory Scan Runner — orchestrates automated scans for an assessment.
 *
 * Responsibilities:
 *  1. Look up the assessment + application to get the target URL
 *  2. Find the right ScannerProvider for the assessment type
 *  3. Run the scan (via the job queue — never called inline)
 *  4. Write ScannerFindings → obs_findings (dedup by ruleId + URL)
 *  5. Persist the raw report as obs_evidence (type: scan_report)
 *  6. Link evidence to assessment + each finding
 *  7. Update assessment status to "completed"
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  obsAssessments,
  obsApplications,
  obsFindings,
  obsEvidence,
  obsAssessmentEvidence,
  obsFindingEvidence,
} from "@shared/schema";
import { findScannerForType } from "./observatory-scanners";
import type { ScanRequest } from "./observatory-scanners";
import { assertScanUrlSafe } from "./ssrf-guard";

export interface ScanRunOptions {
  assessmentId: string;
  tenantDomain: string;
  /** User ID who triggered the scan (for audit / createdBy). */
  triggeredByUserId?: string;
}

export interface ScanRunResult {
  findingsCreated: number;
  findingsSkipped: number;
  evidenceId: string | null;
  tool: string;
  durationMs: number;
}

export async function runObservatoryScan(opts: ScanRunOptions): Promise<ScanRunResult> {
  const { assessmentId, tenantDomain, triggeredByUserId } = opts;
  const started = Date.now();

  // ── 1. Load assessment + application ────────────────────────────────────
  const [assessment] = await db
    .select()
    .from(obsAssessments)
    .where(and(eq(obsAssessments.id, assessmentId), eq(obsAssessments.tenantDomain, tenantDomain)));

  if (!assessment) throw new Error(`Assessment ${assessmentId} not found for tenant ${tenantDomain}`);

  const [application] = await db
    .select()
    .from(obsApplications)
    .where(and(eq(obsApplications.id, assessment.applicationId), eq(obsApplications.tenantDomain, tenantDomain)));

  if (!application) throw new Error(`Application ${assessment.applicationId} not found`);

  const targetUrl = application.appUrl;
  if (!targetUrl) {
    throw new Error(
      `Application "${application.name}" has no URL configured. Add an App URL in the application settings before running a scan.`,
    );
  }

  // SSRF guard — validate before any scanner path issues a network request.
  await assertScanUrlSafe(targetUrl);

  // ── 2. Find scanner ───────────────────────────────────────────────────────
  const scanner = await findScannerForType(assessment.type, tenantDomain);
  if (!scanner) {
    throw new Error(
      `No scanner is available for assessment type "${assessment.type}". ` +
      `Supported types: accessibility, penetration_test, performance.`,
    );
  }

  // ── 3. Mark assessment in_progress ───────────────────────────────────────
  await db
    .update(obsAssessments)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(obsAssessments.id, assessmentId));

  // ── 4. Run scan ───────────────────────────────────────────────────────────
  const request: ScanRequest = {
    tenantDomain,
    applicationId: assessment.applicationId,
    assessmentId,
    target: { url: targetUrl },
  };

  console.log(`[ScanRunner] Starting ${scanner.key} scan for assessment ${assessmentId} (${assessment.type}) → ${targetUrl}`);
  const result = await scanner.runScan(request);

  // ── 5. Persist raw report as evidence ────────────────────────────────────
  let evidenceId: string | null = null;
  if (result.rawReport) {
    const [evidenceRow] = await db
      .insert(obsEvidence)
      .values({
        tenantDomain,
        title: `${scanner.name} scan report — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
        description: `Automated scan by ${result.tool}. Duration: ${Math.round((result.finishedAt.getTime() - result.startedAt.getTime()) / 1000)}s.`,
        evidenceType: "scan_report",
        contentType: result.rawReport.contentType,
        source: result.tool,
        collectedAt: result.startedAt,
        createdBy: triggeredByUserId ?? null,
        // Store the raw JSON inline in the description (no file upload needed for JSON reports)
        externalUrl: null,
        fileName: `scan-report-${assessmentId}-${Date.now()}.json`,
        fileSize: result.rawReport.body.length,
      })
      .returning({ id: obsEvidence.id });

    evidenceId = evidenceRow.id;

    // Link evidence to assessment
    await db.insert(obsAssessmentEvidence).values({
      assessmentId,
      evidenceId,
    }).onConflictDoNothing();
  }

  // ── 6. Write findings (dedup by ruleId + URL within this assessment) ──────
  // Fetch existing finding ruleIds for this assessment to avoid duplicates
  const existingFindings = await db
    .select({ id: obsFindings.id, affectedComponent: obsFindings.affectedComponent })
    .from(obsFindings)
    .where(and(eq(obsFindings.assessmentId, assessmentId), eq(obsFindings.tenantDomain, tenantDomain)));

  // Build dedup key: ruleId:url
  const existingKeys = new Set(
    existingFindings.map(f => `${f.affectedComponent ?? ""}`),
  );

  let findingsCreated = 0;
  let findingsSkipped = 0;

  for (const finding of result.findings) {
    const dedupKey = `${finding.ruleId}:${finding.location?.url ?? ""}`;
    if (existingKeys.has(dedupKey)) {
      findingsSkipped++;
      continue;
    }
    existingKeys.add(dedupKey);

    const [inserted] = await db
      .insert(obsFindings)
      .values({
        tenantDomain,
        assessmentId,
        applicationId: assessment.applicationId,
        versionId: assessment.versionId ?? null,
        title: finding.title,
        description: finding.description ?? null,
        severity: finding.severity,
        domain: mapDomain(assessment.type),
        status: "open",
        affectedComponent: finding.location?.selector ?? finding.location?.file ?? null,
        wcagCriterion: finding.wcagCriterion ?? null,
        cweId: finding.cweId ?? null,
        sourceLine: finding.location?.line ?? null,
        stepsToReproduce: finding.location?.url
          ? `URL: ${finding.location.url}${finding.location.selector ? `\nSelector: ${finding.location.selector}` : ""}`
          : null,
        createdBy: triggeredByUserId ?? null,
      })
      .returning({ id: obsFindings.id });

    // Link raw scan evidence to each finding
    if (evidenceId) {
      await db.insert(obsFindingEvidence).values({
        findingId: inserted.id,
        evidenceId,
      }).onConflictDoNothing();
    }

    findingsCreated++;
  }

  // ── 7. Mark assessment completed ─────────────────────────────────────────
  await db
    .update(obsAssessments)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(obsAssessments.id, assessmentId));

  const durationMs = Date.now() - started;
  console.log(
    `[ScanRunner] Completed ${scanner.key} for ${assessmentId}: ` +
    `${findingsCreated} findings created, ${findingsSkipped} skipped, ${Math.round(durationMs / 1000)}s`,
  );

  return { findingsCreated, findingsSkipped, evidenceId, tool: result.tool, durationMs };
}

function mapDomain(assessmentType: string): string {
  switch (assessmentType) {
    case "accessibility":        return "accessibility";
    case "penetration_test":
    case "security_source_review": return "security";
    case "performance":          return "performance";
    case "code_quality":         return "code_quality";
    case "compliance":           return "compliance";
    default:                     return "other";
  }
}
