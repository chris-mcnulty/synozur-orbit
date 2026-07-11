/**
 * Observatory demo seed — sample applications, versions, an assessment,
 * findings, and evidence so a new tenant sees a functional workspace.
 * Idempotent per tenant: skips if any Observatory application exists.
 */
import { db } from "../db";
import {
  obsApplications,
  obsVersions,
  obsAssessments,
  obsFindings,
  obsEvidence,
  obsFindingEvidence,
  obsAssessmentEvidence,
  obsFindingControls,
  obsFrameworks,
  obsControls,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export async function seedObservatoryDemo(tenantDomain: string, userId: string | null): Promise<{ seeded: boolean }> {
  const existing = await db
    .select({ id: obsApplications.id })
    .from(obsApplications)
    .where(eq(obsApplications.tenantDomain, tenantDomain))
    .limit(1);
  if (existing.length > 0) return { seeded: false };

  const apps = [
    {
      name: "Observatory",
      productFamily: "Assurance Platform",
      description: "Application assurance and certification intelligence platform — the system of record for assessments, findings, and evidence.",
      businessOwner: "Elena Vasquez",
      technicalOwner: "Marcus Chen",
      hostingPlatform: "Azure App Service",
      authMethod: "Microsoft Entra ID",
      dataClassification: "confidential",
      aiEnabled: true,
      certificationTarget: "SOC 2 Type II",
      appUrl: "https://observatory.example.com",
    },
    {
      name: "Vega",
      productFamily: "Customer Portal",
      description: "Customer self-service portal for account management, billing, and support tickets.",
      businessOwner: "Priya Sharma",
      technicalOwner: "James Okafor",
      hostingPlatform: "Azure Kubernetes Service",
      authMethod: "OAuth 2.0 / OIDC",
      dataClassification: "restricted",
      aiEnabled: false,
      certificationTarget: "WCAG 2.2 AA",
      appUrl: "https://vega.example.com",
    },
    {
      name: "Orion",
      productFamily: "Data Platform",
      description: "Analytics and reporting engine that aggregates operational data into executive dashboards.",
      businessOwner: "David Lindqvist",
      technicalOwner: "Sarah Kim",
      hostingPlatform: "Azure Functions + Synapse",
      authMethod: "Managed Identity",
      dataClassification: "confidential",
      aiEnabled: true,
      certificationTarget: "ISO 27001",
    },
    {
      name: "Constellation",
      productFamily: "Assurance Platform",
      description: "Workflow orchestration service coordinating certification pipelines across product teams.",
      businessOwner: "Elena Vasquez",
      technicalOwner: "Tom Nakamura",
      hostingPlatform: "Azure Container Apps",
      authMethod: "Microsoft Entra ID",
      dataClassification: "internal",
      aiEnabled: false,
    },
    {
      name: "Galaxy",
      productFamily: "Mobile",
      description: "Field-team mobile companion app (iOS/Android) for on-site evidence capture and offline checklists.",
      businessOwner: "Priya Sharma",
      technicalOwner: "Ana Duarte",
      hostingPlatform: "Azure API Management",
      authMethod: "OAuth 2.0 PKCE",
      dataClassification: "confidential",
      aiEnabled: true,
      certificationTarget: "GDPR",
    },
  ];

  const insertedApps = await db
    .insert(obsApplications)
    .values(apps.map((a) => ({ ...a, tenantDomain, createdBy: userId })))
    .returning();
  const byName = new Map(insertedApps.map((a) => [a.name, a]));

  const versionRows = [
    { app: "Observatory", versionNumber: "2.4.0", environment: "production", assessmentStatus: "Ready", releaseDate: new Date("2026-05-14"), notes: "Q2 certification release." },
    { app: "Observatory", versionNumber: "2.5.0-rc1", environment: "staging", assessmentStatus: "In Review", branch: "release/2.5", notes: "Release candidate under active assessment." },
    { app: "Vega", versionNumber: "5.1.2", environment: "production", assessmentStatus: "Ready With Exceptions", releaseDate: new Date("2026-04-02"), notes: "Two accepted-risk accessibility exceptions." },
    { app: "Vega", versionNumber: "5.2.0", environment: "staging", assessmentStatus: "In Review", branch: "develop" },
    { app: "Orion", versionNumber: "3.0.1", environment: "production", assessmentStatus: "Ready", releaseDate: new Date("2026-03-20") },
    { app: "Constellation", versionNumber: "1.8.0", environment: "production", assessmentStatus: "Draft" },
    { app: "Galaxy", versionNumber: "4.6.0", environment: "production", assessmentStatus: "Blocked", notes: "Blocked on critical privacy finding." },
  ];
  const insertedVersions = await db
    .insert(obsVersions)
    .values(
      versionRows.map((v) => ({
        tenantDomain,
        applicationId: byName.get(v.app)!.id,
        versionNumber: v.versionNumber,
        environment: v.environment,
        assessmentStatus: v.assessmentStatus,
        releaseDate: v.releaseDate ?? null,
        branch: v.branch ?? null,
        notes: v.notes ?? null,
        createdBy: userId,
      })),
    )
    .returning();
  const versionOf = (app: string, num: string) =>
    insertedVersions.find((v) => v.applicationId === byName.get(app)!.id && v.versionNumber === num)!;

  // One in-flight accessibility assessment on Vega 5.2.0 with findings + evidence.
  const [assessment] = await db
    .insert(obsAssessments)
    .values({
      tenantDomain,
      applicationId: byName.get("Vega")!.id,
      versionId: versionOf("Vega", "5.2.0").id,
      type: "accessibility",
      title: "Vega 5.2.0 WCAG 2.2 AA Assessment",
      assessorName: "Accessibility Guild",
      team: "Quality Engineering",
      status: "in_progress",
      startDate: new Date("2026-06-22"),
      scope: "Customer portal web UI: sign-in, dashboard, billing, and support ticket flows.",
      outOfScope: "Legacy invoice PDF generator (scheduled for retirement in 5.3).",
      createdBy: userId,
    })
    .returning();

  const [pentest] = await db
    .insert(obsAssessments)
    .values({
      tenantDomain,
      applicationId: byName.get("Galaxy")!.id,
      versionId: versionOf("Galaxy", "4.6.0").id,
      type: "penetration_test",
      title: "Galaxy 4.6 Mobile API Penetration Test",
      assessorName: "Redshift Security (external)",
      status: "completed",
      startDate: new Date("2026-05-04"),
      endDate: new Date("2026-05-15"),
      overallScore: 68,
      executiveSummary: "External pen test of the Galaxy mobile API surface. One critical finding (broken object-level authorization on evidence download) and two medium findings. Retest scheduled after remediation.",
      scope: "Galaxy mobile REST API, push notification service, offline sync endpoints.",
      createdBy: userId,
    })
    .returning();

  const findingRows = [
    {
      assessmentId: assessment.id,
      applicationId: byName.get("Vega")!.id,
      versionId: versionOf("Vega", "5.2.0").id,
      title: "Insufficient color contrast on billing summary cards",
      description: "Amount-due text (#8A8F98 on #F5F6F8) measures 2.9:1, below the 4.5:1 minimum for normal text.",
      severity: "Medium",
      domain: "accessibility",
      status: "open",
      recommendation: "Darken the text token to meet 4.5:1 or increase font size/weight to qualify as large text at 3:1.",
      affectedComponent: "BillingSummaryCard",
      wcagCriterion: "1.4.3",
    },
    {
      assessmentId: assessment.id,
      applicationId: byName.get("Vega")!.id,
      versionId: versionOf("Vega", "5.2.0").id,
      title: "Support ticket dialog traps keyboard focus",
      description: "Escape does not close the attachment picker, and Tab cycles inside it indefinitely with no visible way out.",
      severity: "High",
      domain: "accessibility",
      status: "in_progress",
      recommendation: "Implement a standard focus trap with Escape-to-close and restore focus to the trigger on dismissal.",
      affectedComponent: "TicketAttachmentPicker",
      wcagCriterion: "2.1.2",
    },
    {
      assessmentId: pentest.id,
      applicationId: byName.get("Galaxy")!.id,
      versionId: versionOf("Galaxy", "4.6.0").id,
      title: "Broken object-level authorization on evidence download endpoint",
      description: "GET /api/v4/evidence/{id}/download returns files belonging to other organizations when the id is guessed; the endpoint checks authentication but not ownership.",
      severity: "Critical",
      domain: "security",
      status: "in_progress",
      recommendation: "Enforce tenant/ownership checks server-side on every object fetch; add IDOR regression tests.",
      affectedComponent: "evidence-service",
      cweId: "CWE-639",
      likelihood: "high",
      impact: "high",
    },
    {
      assessmentId: pentest.id,
      applicationId: byName.get("Galaxy")!.id,
      versionId: versionOf("Galaxy", "4.6.0").id,
      title: "Verbose stack traces returned by sync API on malformed payloads",
      description: "Malformed JSON to /api/v4/sync returns a full stack trace including framework versions and internal file paths.",
      severity: "Medium",
      domain: "security",
      status: "open",
      recommendation: "Return generic 400 responses; log details server-side only.",
      affectedComponent: "sync-service",
      cweId: "CWE-209",
    },
  ];
  const insertedFindings = await db
    .insert(obsFindings)
    .values(findingRows.map((f) => ({ ...f, tenantDomain, createdBy: userId })))
    .returning();

  const evidenceRows = [
    {
      title: "Contrast analyzer screenshot — billing summary",
      description: "Colour Contrast Analyser reading 2.9:1 on amount-due text.",
      evidenceType: "screenshot",
      source: "Colour Contrast Analyser",
      collectedBy: "Accessibility Guild",
      collectedAt: new Date("2026-06-24"),
    },
    {
      title: "axe-core scan report — Vega 5.2.0 dashboard",
      description: "Automated scan: 14 violations (3 serious) across dashboard routes.",
      evidenceType: "scan_report",
      source: "axe-core 4.9",
      collectedBy: "CI pipeline",
      collectedAt: new Date("2026-06-23"),
    },
    {
      title: "Burp Suite session — IDOR proof of concept",
      description: "Request/response capture demonstrating cross-organization evidence download.",
      evidenceType: "log_extract",
      source: "Burp Suite Professional",
      collectedBy: "Redshift Security",
      collectedAt: new Date("2026-05-09"),
    },
    {
      title: "Redshift Security final report",
      description: "Full penetration test report PDF for Galaxy 4.6 engagement.",
      evidenceType: "document",
      source: "Redshift Security",
      collectedBy: "Redshift Security",
      collectedAt: new Date("2026-05-15"),
    },
  ];
  const insertedEvidence = await db
    .insert(obsEvidence)
    .values(evidenceRows.map((e) => ({ ...e, tenantDomain, createdBy: userId })))
    .returning();

  await db.insert(obsFindingEvidence).values([
    { findingId: insertedFindings[0].id, evidenceId: insertedEvidence[0].id },
    { findingId: insertedFindings[0].id, evidenceId: insertedEvidence[1].id },
    { findingId: insertedFindings[2].id, evidenceId: insertedEvidence[2].id },
  ]);
  await db.insert(obsAssessmentEvidence).values([
    { assessmentId: assessment.id, evidenceId: insertedEvidence[1].id },
    { assessmentId: pentest.id, evidenceId: insertedEvidence[3].id },
  ]);

  // Map findings to standards controls where the catalog is present.
  const [wcag] = await db.select().from(obsFrameworks).where(eq(obsFrameworks.code, "WCAG22"));
  const [owasp] = await db.select().from(obsFrameworks).where(eq(obsFrameworks.code, "OWASP_TOP10"));
  const links: { findingId: string; controlId: string }[] = [];
  if (wcag) {
    const wcagControls = await db
      .select()
      .from(obsControls)
      .where(and(eq(obsControls.frameworkId, wcag.id), inArray(obsControls.controlId, ["1.4.3", "2.1.2"])));
    for (const c of wcagControls) {
      const finding = c.controlId === "1.4.3" ? insertedFindings[0] : insertedFindings[1];
      links.push({ findingId: finding.id, controlId: c.id });
    }
  }
  if (owasp) {
    const [bac] = await db
      .select()
      .from(obsControls)
      .where(and(eq(obsControls.frameworkId, owasp.id), eq(obsControls.controlId, "A01:2021")));
    if (bac) links.push({ findingId: insertedFindings[2].id, controlId: bac.id });
  }
  if (links.length > 0) await db.insert(obsFindingControls).values(links).onConflictDoNothing();

  return { seeded: true };
}
