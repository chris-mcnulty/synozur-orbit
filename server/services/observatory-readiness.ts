/**
 * Observatory Readiness Engine.
 *
 * Computes a weighted readiness score per application version from findings,
 * workbench checklist results, pen-test validation state, and evidence
 * coverage. Weights (percent of overall):
 *   Accessibility 25 · Security 25 · Source Code 15 · Architecture 10 ·
 *   Privacy 10 · Documentation 10 · AI Governance 5
 *
 * Bands: 90–100 Ready · 75–89 Ready With Minor Remediation ·
 *        60–74 Remediation Required · 0–59 Not Ready
 *
 * Hard blockers (a version can never be "Ready" while any exist):
 *   - open Critical findings
 *   - Critical pen-test findings not yet validated
 *   - completed assessments with no linked evidence (mandatory evidence)
 */
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import {
  obsApplications,
  obsVersions,
  obsAssessments,
  obsFindings,
  obsReviewItems,
  obsPenTests,
  obsPenTestFindings,
  obsAssessmentEvidence,
  obsFindingEvidence,
  obsReviewItemEvidence,
  obsVersionEvidence,
  obsReadinessScores,
  OBS_READINESS_DOMAINS,
  OBS_READINESS_WEIGHTS,
  OBS_READINESS_DOMAIN_LABELS,
  type ObsReadinessDomain,
  type ObsReadinessBand,
  type ObsDomainScore,
  type ObsReadinessBlocker,
  type ObsApplication,
  type ObsVersion,
} from "@shared/schema";

/** Assessment types feeding each readiness domain (documentation is evidence-based). */
const DOMAIN_ASSESSMENT_TYPES: Record<Exclude<ObsReadinessDomain, "documentation">, string[]> = {
  accessibility: ["accessibility"],
  security: ["penetration_test"],
  source_code: ["security_source_review", "code_quality"],
  architecture: ["architecture_review"],
  privacy: ["privacy_review", "compliance"],
  ai_governance: ["ai_governance"],
};

/** Review workbench modules feeding each domain's checklist score. */
const DOMAIN_MODULES: Partial<Record<ObsReadinessDomain, string[]>> = {
  accessibility: ["accessibility"],
  source_code: ["source_code"],
  architecture: ["architecture", "architecture_azure"],
  privacy: ["privacy"],
  ai_governance: ["ai_governance"],
};

const OPEN_STATUSES = ["open", "in_progress"];

const SEVERITY_DEDUCTION: Record<string, number> = {
  Critical: 40,
  High: 25,
  Medium: 10,
  Low: 4,
  Informational: 0,
};

const REVIEW_STATUS_SCORE: Record<string, number> = {
  // standard workbench statuses
  "Pass": 100,
  "Pass With Notes": 90,
  "Supports With Exceptions": 70,
  "Fail": 0,
  // azure capability checklist statuses
  "Configured": 100,
  "Partially Configured": 60,
  "Planned": 30,
  "Not Configured": 0,
  // "Not Tested" / "Not Applicable" are excluded from scoring
};

export function bandForScore(score: number): ObsReadinessBand {
  if (score >= 90) return "Ready";
  if (score >= 75) return "Ready With Minor Remediation";
  if (score >= 60) return "Remediation Required";
  return "Not Ready";
}

export interface ReadinessResult {
  applicationId: string;
  versionId: string;
  overallScore: number;
  band: ObsReadinessBand;
  rawBand: ObsReadinessBand;
  blocked: boolean;
  domainScores: ObsDomainScore[];
  blockers: ObsReadinessBlocker[];
}

/** Compute the readiness score for one application version (no persistence). */
export async function computeReadiness(
  tenantDomain: string,
  version: ObsVersion,
  application: ObsApplication,
): Promise<ReadinessResult> {
  const versionId = version.id;

  const assessments = await db
    .select()
    .from(obsAssessments)
    .where(and(eq(obsAssessments.tenantDomain, tenantDomain), eq(obsAssessments.versionId, versionId)));
  const activeAssessments = assessments.filter((a) => a.status !== "cancelled");
  const assessmentIds = activeAssessments.map((a) => a.id);

  const findings = assessmentIds.length
    ? await db
        .select()
        .from(obsFindings)
        .where(and(eq(obsFindings.tenantDomain, tenantDomain), inArray(obsFindings.assessmentId, assessmentIds)))
    : [];

  const reviewItems = assessmentIds.length
    ? await db
        .select()
        .from(obsReviewItems)
        .where(and(eq(obsReviewItems.tenantDomain, tenantDomain), inArray(obsReviewItems.assessmentId, assessmentIds)))
    : [];

  // Pen-test finding extensions (validation state) for this version's findings.
  const findingIds = findings.map((f) => f.id);
  const penTestFindings = findingIds.length
    ? await db
        .select()
        .from(obsPenTestFindings)
        .where(and(eq(obsPenTestFindings.tenantDomain, tenantDomain), inArray(obsPenTestFindings.findingId, findingIds)))
    : [];

  // Evidence coverage
  const versionEvidence = await db
    .select()
    .from(obsVersionEvidence)
    .where(eq(obsVersionEvidence.versionId, versionId));
  const assessmentEvidence = assessmentIds.length
    ? await db.select().from(obsAssessmentEvidence).where(inArray(obsAssessmentEvidence.assessmentId, assessmentIds))
    : [];
  const findingEvidence = findingIds.length
    ? await db.select().from(obsFindingEvidence).where(inArray(obsFindingEvidence.findingId, findingIds))
    : [];
  const reviewItemIds = reviewItems.map((r) => r.id);
  const reviewItemEvidence = reviewItemIds.length
    ? await db.select().from(obsReviewItemEvidence).where(inArray(obsReviewItemEvidence.reviewItemId, reviewItemIds))
    : [];

  // Assessments that have at least one piece of evidence linked at any level.
  const assessmentsWithEvidence = new Set<string>();
  for (const ae of assessmentEvidence) assessmentsWithEvidence.add(ae.assessmentId);
  const findingById = new Map(findings.map((f) => [f.id, f]));
  for (const fe of findingEvidence) {
    const f = findingById.get(fe.findingId);
    if (f) assessmentsWithEvidence.add(f.assessmentId);
  }
  const reviewItemById = new Map(reviewItems.map((r) => [r.id, r]));
  for (const re of reviewItemEvidence) {
    const r = reviewItemById.get(re.reviewItemId);
    if (r) assessmentsWithEvidence.add(r.assessmentId);
  }

  // ── Domain scores ─────────────────────────────────────────────────────────
  const domainScores: ObsDomainScore[] = [];

  for (const domain of OBS_READINESS_DOMAINS) {
    if (domain === "documentation") {
      // Evidence coverage: 40 pts for version-level evidence, 60 pts scaled by
      // the share of non-cancelled assessments that carry linked evidence.
      const hasVersionEvidence = versionEvidence.length > 0;
      let score = hasVersionEvidence ? 40 : 0;
      if (activeAssessments.length > 0) {
        score += Math.round((assessmentsWithEvidence.size / activeAssessments.length) * 60);
      } else if (hasVersionEvidence) {
        score = 100; // nothing else to document yet
      }
      domainScores.push({
        domain,
        score,
        weight: OBS_READINESS_WEIGHTS[domain],
        applicable: true,
        assessed: hasVersionEvidence || activeAssessments.length > 0,
        openFindings: 0,
        note: activeAssessments.length === 0 && !hasVersionEvidence ? "No evidence collected yet" : undefined,
      });
      continue;
    }

    if (domain === "ai_governance" && !application.aiEnabled) {
      domainScores.push({
        domain,
        score: null,
        weight: 0,
        applicable: false,
        assessed: false,
        openFindings: 0,
        note: "Application is not AI-enabled",
      });
      continue;
    }

    const types = DOMAIN_ASSESSMENT_TYPES[domain];
    const domainAssessments = activeAssessments.filter((a) => types.includes(a.type));
    const domainAssessmentIds = new Set(domainAssessments.map((a) => a.id));
    const domainFindings = findings.filter((f) => domainAssessmentIds.has(f.assessmentId));
    const openFindings = domainFindings.filter((f) => OPEN_STATUSES.includes(f.status));

    if (domainAssessments.length === 0) {
      domainScores.push({
        domain,
        score: 0,
        weight: OBS_READINESS_WEIGHTS[domain],
        applicable: true,
        assessed: false,
        openFindings: 0,
        note: `No ${OBS_READINESS_DOMAIN_LABELS[domain].toLowerCase()} assessment yet`,
      });
      continue;
    }

    // Finding-based score: deduct per open finding by severity.
    const deduction = openFindings.reduce((sum, f) => sum + (SEVERITY_DEDUCTION[f.severity] ?? 10), 0);
    const findingScore = Math.max(0, 100 - deduction);

    // Checklist-based score (when the domain has a workbench with rated rows).
    const modules = DOMAIN_MODULES[domain] ?? [];
    const rated = reviewItems.filter(
      (r) =>
        domainAssessmentIds.has(r.assessmentId) &&
        modules.includes(r.module) &&
        REVIEW_STATUS_SCORE[r.status] !== undefined,
    );
    let score: number;
    if (rated.length > 0) {
      const checklistScore = rated.reduce((sum, r) => sum + REVIEW_STATUS_SCORE[r.status], 0) / rated.length;
      score = Math.round(0.5 * findingScore + 0.5 * checklistScore);
    } else {
      score = findingScore;
    }

    domainScores.push({
      domain,
      score,
      weight: OBS_READINESS_WEIGHTS[domain],
      applicable: true,
      assessed: true,
      openFindings: openFindings.length,
    });
  }

  // Renormalize weights over applicable domains (e.g. AI Governance excluded).
  const totalWeight = domainScores.filter((d) => d.applicable).reduce((s, d) => s + OBS_READINESS_WEIGHTS[d.domain], 0);
  let weighted = 0;
  for (const d of domainScores) {
    if (!d.applicable || d.score === null) continue;
    const effective = (OBS_READINESS_WEIGHTS[d.domain] / totalWeight) * 100;
    d.weight = Math.round(effective * 10) / 10;
    weighted += (d.score * effective) / 100;
  }
  const overallScore = Math.round(weighted);

  // ── Hard blockers ─────────────────────────────────────────────────────────
  const blockers: ObsReadinessBlocker[] = [];

  const openCritical = findings.filter((f) => f.severity === "Critical" && OPEN_STATUSES.includes(f.status));
  if (openCritical.length > 0) {
    blockers.push({
      type: "open_critical_findings",
      reason: `${openCritical.length} open Critical finding${openCritical.length === 1 ? "" : "s"} must be remediated and verified.`,
      count: openCritical.length,
      refs: openCritical.slice(0, 10).map((f) => ({ id: f.id, title: f.title })),
    });
  }

  const closedForValidation = new Set(["duplicate", "wont_fix"]);
  const unvalidatedCriticalPt = penTestFindings.filter((pt) => {
    const f = findingById.get(pt.findingId);
    return f && f.severity === "Critical" && pt.validationStatus !== "Validated" && !closedForValidation.has(f.status);
  });
  if (unvalidatedCriticalPt.length > 0) {
    blockers.push({
      type: "unvalidated_critical_pen_test",
      reason: `${unvalidatedCriticalPt.length} Critical pen-test finding${unvalidatedCriticalPt.length === 1 ? "" : "s"} not yet validated.`,
      count: unvalidatedCriticalPt.length,
      refs: unvalidatedCriticalPt
        .slice(0, 10)
        .map((pt) => {
          const f = findingById.get(pt.findingId)!;
          return { id: f.id, title: f.title };
        }),
    });
  }

  const completedWithoutEvidence = activeAssessments.filter(
    (a) => a.status === "completed" && !assessmentsWithEvidence.has(a.id),
  );
  if (completedWithoutEvidence.length > 0) {
    blockers.push({
      type: "missing_mandatory_evidence",
      reason: `${completedWithoutEvidence.length} completed assessment${completedWithoutEvidence.length === 1 ? "" : "s"} ha${completedWithoutEvidence.length === 1 ? "s" : "ve"} no linked evidence.`,
      count: completedWithoutEvidence.length,
      refs: completedWithoutEvidence.slice(0, 10).map((a) => ({ id: a.id, title: a.title })),
    });
  }

  const rawBand = bandForScore(overallScore);
  const blocked = blockers.length > 0;
  let band: ObsReadinessBand = rawBand;
  if (blocked && (rawBand === "Ready" || rawBand === "Ready With Minor Remediation")) {
    band = "Remediation Required";
  }

  return {
    applicationId: application.id,
    versionId,
    overallScore,
    band,
    rawBand,
    blocked,
    domainScores,
    blockers,
  };
}

/** Compute and persist a readiness score snapshot for a version. */
export async function snapshotReadiness(
  tenantDomain: string,
  version: ObsVersion,
  application: ObsApplication,
  computedBy?: string | null,
): Promise<ReadinessResult & { id: string; computedAt: Date }> {
  const result = await computeReadiness(tenantDomain, version, application);
  const [row] = await db
    .insert(obsReadinessScores)
    .values({
      tenantDomain,
      applicationId: result.applicationId,
      versionId: result.versionId,
      overallScore: result.overallScore,
      band: result.band,
      rawBand: result.rawBand,
      blocked: result.blocked,
      domainScores: result.domainScores,
      blockers: result.blockers,
      computedBy: computedBy ?? null,
    })
    .returning();
  return { ...result, id: row.id, computedAt: row.computedAt };
}

export interface PortfolioReadinessEntry extends ReadinessResult {
  applicationName: string;
  versionNumber: string;
}

/**
 * Compute readiness live for every active application's most recent version.
 * Used by the executive dashboard (portfolios are small; no persistence).
 */
export async function computePortfolioReadiness(tenantDomain: string): Promise<PortfolioReadinessEntry[]> {
  const apps = await db
    .select()
    .from(obsApplications)
    .where(and(eq(obsApplications.tenantDomain, tenantDomain), eq(obsApplications.status, "active")));
  if (apps.length === 0) return [];

  const versions = await db
    .select()
    .from(obsVersions)
    .where(and(eq(obsVersions.tenantDomain, tenantDomain), inArray(obsVersions.applicationId, apps.map((a) => a.id))));

  const results: PortfolioReadinessEntry[] = [];
  for (const app of apps) {
    const appVersions = versions
      .filter((v) => v.applicationId === app.id && v.assessmentStatus !== "Retired")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = appVersions[0];
    if (!latest) continue;
    const r = await computeReadiness(tenantDomain, latest, app);
    results.push({ ...r, applicationName: app.name, versionNumber: latest.versionNumber });
  }
  return results.sort((a, b) => b.overallScore - a.overallScore);
}

/** Fetch pen tests for a tenant (helper reused by dashboard KPIs). */
export async function countPenTests(tenantDomain: string): Promise<number> {
  const rows = await db.select({ id: obsPenTests.id }).from(obsPenTests).where(eq(obsPenTests.tenantDomain, tenantDomain));
  return rows.length;
}
