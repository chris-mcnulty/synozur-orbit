import { Badge } from "@/components/ui/badge";

export const ASSESSMENT_TYPES = [
  { value: "accessibility", label: "Accessibility" },
  { value: "security_source_review", label: "Source Code Review" },
  { value: "penetration_test", label: "Penetration Test" },
  { value: "architecture_review", label: "Architecture Review" },
  { value: "privacy_review", label: "Privacy & Compliance" },
  { value: "ai_governance", label: "AI Governance" },
  { value: "compliance", label: "Compliance" },
  { value: "performance", label: "Performance" },
  { value: "code_quality", label: "Code Quality" },
] as const;

export const VERSION_STATUSES = ["Draft", "In Review", "Ready", "Ready With Exceptions", "Blocked", "Retired"] as const;
export const ASSESSMENT_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;
export const FINDING_SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"] as const;
export const FINDING_DOMAINS = [
  { value: "accessibility", label: "Accessibility" },
  { value: "security", label: "Security" },
  { value: "privacy", label: "Privacy" },
  { value: "architecture", label: "Architecture" },
  { value: "ai_governance", label: "AI Governance" },
  { value: "compliance", label: "Compliance" },
  { value: "performance", label: "Performance" },
  { value: "code_quality", label: "Code Quality" },
  { value: "usability", label: "Usability" },
] as const;
export const FINDING_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "remediated", label: "Remediated" },
  { value: "verified", label: "Verified" },
  { value: "accepted_risk", label: "Accepted Risk" },
  { value: "deferred", label: "Deferred" },
  { value: "duplicate", label: "Duplicate" },
  { value: "wont_fix", label: "Won't Fix" },
] as const;
export const EVIDENCE_TYPES = [
  { value: "screenshot", label: "Screenshot" },
  { value: "scan_report", label: "Scan Report" },
  { value: "document", label: "Document" },
  { value: "log_extract", label: "Log Extract" },
  { value: "attestation", label: "Attestation" },
  { value: "test_result", label: "Test Result" },
  { value: "link", label: "Link" },
  { value: "other", label: "Other" },
] as const;
export const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;

export function labelFor(list: readonly { value: string; label: string }[], value?: string | null): string {
  if (!value) return "—";
  return list.find((o) => o.value === value)?.label ?? value;
}

// ── Workbench modules (specialized assessment surfaces) ─────────────────────

export const REVIEW_STATUSES = [
  "Pass",
  "Pass With Notes",
  "Supports With Exceptions",
  "Fail",
  "Not Tested",
  "Not Applicable",
] as const;

export const AZURE_STATUSES = [
  "Configured",
  "Partially Configured",
  "Not Configured",
  "Planned",
  "Not Applicable",
] as const;

export const PEN_TEST_RESULTS = ["Ready", "Ready After Remediation", "Remediation Required", "Not Ready"] as const;
export const VALIDATION_STATUSES = ["Not Started", "In Progress", "Validated", "Failed Validation"] as const;
export const EXPLOITABILITY_LEVELS = ["Trivial", "Easy", "Moderate", "Difficult", "Theoretical"] as const;

export interface WorkbenchModule {
  /** URL slug used in /app/observatory/review/:module */
  slug: string;
  /** obs_review_items.module key */
  moduleKey: string;
  /** obs_assessments.type this workbench operates on */
  assessmentType: string;
  label: string;
  description: string;
  /** default finding domain when creating findings from rows */
  findingDomain: string;
  aiOnly?: boolean;
}

export const WORKBENCH_MODULES: WorkbenchModule[] = [
  {
    slug: "accessibility",
    moduleKey: "accessibility",
    assessmentType: "accessibility",
    label: "Accessibility Review",
    description: "Structured WCAG-aligned checklist across 12 review categories, from Images to Error Handling.",
    findingDomain: "accessibility",
  },
  {
    slug: "source-code",
    moduleKey: "source_code",
    assessmentType: "security_source_review",
    label: "Source Code Review",
    description: "Secure code review across 10 categories with repository, branch, and commit metadata.",
    findingDomain: "security",
  },
  {
    slug: "architecture",
    moduleKey: "architecture",
    assessmentType: "architecture_review",
    label: "Architecture Review",
    description: "Security architecture across 8 areas plus an Azure capability checklist.",
    findingDomain: "architecture",
  },
  {
    slug: "privacy",
    moduleKey: "privacy",
    assessmentType: "privacy_review",
    label: "Privacy & Compliance",
    description: "Privacy review areas mapped to GDPR, SOC 2, and ISO 27001 in the standards library.",
    findingDomain: "privacy",
  },
  {
    slug: "ai-governance",
    moduleKey: "ai_governance",
    assessmentType: "ai_governance",
    label: "AI Governance",
    description: "Responsible-AI review for AI-enabled applications: model inventory through prompt injection protection.",
    findingDomain: "ai_governance",
    aiOnly: true,
  },
];

export function workbenchBySlug(slug?: string): WorkbenchModule | undefined {
  return WORKBENCH_MODULES.find((m) => m.slug === slug);
}

/** Compliance framework hints shown next to privacy review areas. */
export const PRIVACY_FRAMEWORK_HINTS: Record<string, string> = {
  "Data Collection": "GDPR Art. 5–6 · SOC 2 P3",
  "Retention": "GDPR Art. 5(1)(e) · ISO 27001 A.8",
  "Deletion": "GDPR Art. 17 · SOC 2 P4",
  "Consent": "GDPR Art. 7 · SOC 2 P2",
  "Classification": "ISO 27001 A.5.12 · SOC 2 C1",
  "Auditability": "SOC 2 CC7 · ISO 27001 A.8.15",
  "Privacy Controls": "GDPR Art. 25 · SOC 2 P1",
};

export function ReviewStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const cls =
    status === "Pass" || status === "Configured"
      ? "bg-green-600/15 text-green-400 border-green-600/30"
      : status === "Pass With Notes" || status === "Partially Configured"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : status === "Supports With Exceptions" || status === "Planned"
          ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
          : status === "Fail" || status === "Not Configured"
            ? "bg-red-600/15 text-red-400 border-red-600/30"
            : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-review-status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      {status}
    </Badge>
  );
}

export function PenTestResultBadge({ result }: { result?: string | null }) {
  if (!result) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border">In Progress</Badge>;
  const cls =
    result === "Ready"
      ? "bg-green-600/15 text-green-400 border-green-600/30"
      : result === "Ready After Remediation"
        ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
        : result === "Remediation Required"
          ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
          : "bg-red-600/15 text-red-400 border-red-600/30";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-pentest-result-${result.toLowerCase().replace(/\s+/g, "-")}`}>
      {result}
    </Badge>
  );
}

export function ValidationStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const cls =
    status === "Validated"
      ? "bg-green-600/15 text-green-400 border-green-600/30"
      : status === "In Progress"
        ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
        : status === "Failed Validation"
          ? "bg-red-600/15 text-red-400 border-red-600/30"
          : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-validation-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      {status}
    </Badge>
  );
}

export function severityFromCvss(score: number): string {
  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Medium";
  if (score > 0) return "Low";
  return "Informational";
}

export function SeverityBadge({ severity }: { severity?: string | null }) {
  if (!severity) return null;
  const cls =
    severity === "Critical"
      ? "bg-red-600/20 text-red-400 border-red-600/40"
      : severity === "High"
        ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
        : severity === "Medium"
          ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
          : severity === "Low"
            ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
            : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-severity-${severity.toLowerCase()}`}>
      {severity}
    </Badge>
  );
}

export function FindingStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const cls =
    status === "open"
      ? "bg-red-600/15 text-red-400 border-red-600/30"
      : status === "in_progress"
        ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
        : status === "remediated" || status === "verified"
          ? "bg-green-600/15 text-green-400 border-green-600/30"
          : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-finding-status-${status}`}>
      {labelFor(FINDING_STATUSES, status)}
    </Badge>
  );
}

export function AssessmentStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const cls =
    status === "in_progress"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : status === "completed"
        ? "bg-green-600/15 text-green-400 border-green-600/30"
        : status === "cancelled"
          ? "bg-muted text-muted-foreground border-border"
          : "bg-purple-500/15 text-purple-400 border-purple-500/30";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-assessment-status-${status}`}>
      {labelFor(ASSESSMENT_STATUSES, status)}
    </Badge>
  );
}

export function VersionStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const cls =
    status === "Ready"
      ? "bg-green-600/15 text-green-400 border-green-600/30"
      : status === "Ready With Exceptions"
        ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
        : status === "Blocked"
          ? "bg-red-600/15 text-red-400 border-red-600/30"
          : status === "In Review"
            ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
            : "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={cls} data-testid={`badge-version-status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      {status}
    </Badge>
  );
}
