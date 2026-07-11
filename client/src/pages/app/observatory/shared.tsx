import { Badge } from "@/components/ui/badge";

export const ASSESSMENT_TYPES = [
  { value: "accessibility", label: "Accessibility" },
  { value: "security", label: "Security" },
  { value: "penetration_test", label: "Penetration Test" },
  { value: "privacy", label: "Privacy" },
  { value: "ai_assessment", label: "AI Assessment" },
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
  { value: "ai", label: "AI" },
  { value: "compliance", label: "Compliance" },
  { value: "performance", label: "Performance" },
  { value: "code_quality", label: "Code Quality" },
] as const;
export const FINDING_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "remediated", label: "Remediated" },
  { value: "verified", label: "Verified" },
  { value: "accepted_risk", label: "Accepted Risk" },
  { value: "false_positive", label: "False Positive" },
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
