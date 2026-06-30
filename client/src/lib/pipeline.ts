/**
 * Unified content pipeline — one canonical set of stages over the
 * sources that were built as separate pipelines (social/campaign posts,
 * saved emails, content briefs). Each source keeps its own status enum
 * in the database; adapters here map those statuses onto board stages
 * and back, so the board needs no schema changes.
 */

export type PipelineStage = "draft" | "in_review" | "approved" | "scheduled" | "live";

export type PipelineItemType = "post" | "email" | "brief";

export interface PipelineItem {
  /** Stable key across sources: `${type}:${id}` */
  key: string;
  id: string;
  type: PipelineItemType;
  stage: PipelineStage;
  /** Raw source status, shown as a chip when it carries more nuance than the stage. */
  sourceStatus: string;
  title: string;
  subtitle?: string;
  platform?: string | null;
  campaignId?: string | null;
  scheduledAt?: string | null;
  imageUrl?: string | null;
  /** publish/send failure — rendered as an alert strip inside its column */
  failed?: boolean;
  /** Where the full editor for this item lives. */
  href: string;
  createdAt?: string | null;
}

export const PIPELINE_STAGES: { id: PipelineStage; label: string; dotClass: string }[] = [
  { id: "draft", label: "Draft", dotClass: "bg-gray-400" },
  { id: "in_review", label: "In Review", dotClass: "bg-amber-500" },
  { id: "approved", label: "Approved", dotClass: "bg-blue-500" },
  { id: "scheduled", label: "Scheduled", dotClass: "bg-teal-500" },
  { id: "live", label: "Published / Sent", dotClass: "bg-green-500" },
];

export const TYPE_LABELS: Record<PipelineItemType, string> = {
  post: "Social post",
  email: "Email",
  brief: "Brief",
};

// ─── Source row shapes (subset of API payloads the board consumes) ───

export interface CalendarPostRow {
  id: string;
  platform: string;
  preview: string;
  scheduledDate: string | null;
  publishedAt: string | null;
  status: string; // draft | approved | rejected | published | publish_failed | exported
  campaignId: string | null;
  overrideImageUrl: string | null;
  accountName: string | null;
}

export interface SavedEmailRow {
  id: string;
  subject: string;
  platform: string;
  status: string; // draft | approved | sent
  scheduledAt?: string | null;
  label?: string | null;
  createdAt?: string | null;
}

export interface BriefRow {
  id: string;
  title: string;
  format: string;
  status: string; // suggested | accepted | in_progress | drafted | scheduled | approved | published | removed
  campaignId?: string | null;
  scheduledAt?: string | null;
  createdAt?: string | null;
}

// ─── Adapters: source row → PipelineItem ───

export function postToPipelineItem(row: CalendarPostRow): PipelineItem | null {
  if (row.status === "rejected" || row.status === "deleted") return null;
  let stage: PipelineStage;
  let failed = false;
  switch (row.status) {
    case "draft":
      stage = "draft";
      break;
    case "approved":
      stage = row.scheduledDate ? "scheduled" : "approved";
      break;
    case "publish_failed":
      stage = "scheduled";
      failed = true;
      break;
    case "published":
    case "exported":
      stage = "live";
      break;
    default:
      stage = "draft";
  }
  return {
    key: `post:${row.id}`,
    id: row.id,
    type: "post",
    stage,
    sourceStatus: row.status,
    title: row.preview || "(no content yet)",
    subtitle: row.accountName || row.platform,
    platform: row.platform,
    campaignId: row.campaignId,
    scheduledAt: row.scheduledDate,
    imageUrl: row.overrideImageUrl,
    failed,
    // Deep-link to this specific post in the queue (opens the edit dialog directly).
    href: `/app/marketing/queue?postId=${row.id}`,
  };
}

export function emailToPipelineItem(row: SavedEmailRow): PipelineItem | null {
  let stage: PipelineStage;
  switch (row.status) {
    case "draft":
      stage = "draft";
      break;
    case "approved":
      stage = row.scheduledAt ? "scheduled" : "approved";
      break;
    case "sent":
      stage = "live";
      break;
    default:
      stage = "draft";
  }
  return {
    key: `email:${row.id}`,
    id: row.id,
    type: "email",
    stage,
    sourceStatus: row.status,
    title: row.subject || "(no subject)",
    subtitle: row.label || row.platform,
    platform: row.platform,
    scheduledAt: row.scheduledAt ?? null,
    createdAt: row.createdAt ?? null,
    href: "/app/marketing/email-newsletters",
  };
}

export function briefToPipelineItem(row: BriefRow): PipelineItem | null {
  if (row.status === "removed") return null;
  let stage: PipelineStage;
  switch (row.status) {
    case "suggested":
      stage = "draft";
      break;
    case "accepted":
      stage = "in_review";
      break;
    case "in_progress":
    case "drafted":
    // "completed" predates the current status set; legacy rows map like
    // drafted — done but not yet published.
    case "completed":
    case "approved":
      stage = "approved";
      break;
    case "scheduled":
      stage = "scheduled";
      break;
    case "published":
      stage = "live";
      break;
    default:
      stage = "draft";
  }
  return {
    key: `brief:${row.id}`,
    id: row.id,
    type: "brief",
    stage,
    sourceStatus: row.status,
    title: row.title,
    subtitle: row.format?.replace(/_/g, " "),
    campaignId: row.campaignId ?? null,
    scheduledAt: row.scheduledAt ?? null,
    createdAt: row.createdAt ?? null,
    href: "/app/marketing/editorial-calendar",
  };
}

// ─── Drag rules: which stages an item may be dropped on, and what the
//     transition means for its source status. Live items never move. ───

export function allowedDropStages(item: PipelineItem): PipelineStage[] {
  if (item.stage === "live") return [];
  switch (item.type) {
    case "post":
      // publish_failed posts can be re-approved/rescheduled; "live" lets you
      // manually mark an old post as published without re-exporting it.
      return ["draft", "approved", "scheduled", "live"].filter((s) => s !== item.stage) as PipelineStage[];
    case "email":
      // Email scheduling/sending happens through recipient-list sends on the
      // email page, so the board only moves drafts through approval.
      return (["draft", "approved"] as PipelineStage[]).filter((s) => s !== item.stage);
    case "brief":
      return (["draft", "in_review", "approved"] as PipelineStage[]).filter((s) => s !== item.stage);
  }
}

export interface StageTransition {
  /** PATCH body for the item's source endpoint. */
  body: Record<string, unknown>;
  /** When true the UI must collect a date before committing (drop on Scheduled). */
  needsDate?: boolean;
}

export function transitionFor(item: PipelineItem, target: PipelineStage): StageTransition | null {
  if (!allowedDropStages(item).includes(target)) return null;
  switch (item.type) {
    case "post": {
      if (target === "draft") return { body: { status: "draft", scheduledDate: null } };
      if (target === "approved") return { body: { status: "approved", scheduledDate: null } };
      if (target === "scheduled") return { body: { status: "approved" }, needsDate: true };
      if (target === "live") return { body: { status: "published" } };
      return null;
    }
    case "email": {
      if (target === "draft") return { body: { status: "draft" } };
      if (target === "approved") return { body: { status: "approved" } };
      return null;
    }
    case "brief": {
      if (target === "draft") return { body: { status: "suggested" } };
      if (target === "in_review") return { body: { status: "accepted" } };
      if (target === "approved") return { body: { status: "approved" } };
      return null;
    }
  }
}

export function patchUrlFor(item: PipelineItem): string {
  switch (item.type) {
    case "post":
      return `/api/generated-posts/${item.id}`;
    case "email":
      return `/api/email/saved/${item.id}`;
    case "brief":
      return `/api/content-briefs/${item.id}`;
  }
}
