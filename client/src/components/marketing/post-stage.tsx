/**
 * Shared post lifecycle stage badge.
 *
 * Turns a generated post's raw status into one clear, human-readable stage so
 * the state of every post is obvious at a glance — used by the campaign
 * Social Posts tab, the shared Social Post editor, and any other post list.
 * Precedence: posted > rejected > failed > exported > approved > draft.
 */
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle, XCircle, AlertCircle, FileDown, Calendar, Zap, Pencil, ImageOff,
} from "lucide-react";

export interface StageablePost {
  status: string;
  publishedAt?: string | null;
  publishError?: string | null;
  scheduledDate?: string | null;
  deliveryMode?: string | null;
  /** Typed image error code set by pre-flight or a failed publish (Task #777). */
  imageIssue?: string | null;
}

export function getPostStage(post: StageablePost) {
  if (post.publishedAt || post.status === "published")
    return { label: "Posted via Orbit", cls: "bg-green-600 text-white border-green-600", Icon: CheckCircle };
  if (post.status === "rejected")
    return { label: "Rejected", cls: "text-orange-600 border-orange-300", Icon: XCircle };
  // Image problems get their own recognizable badge so triage is a glance,
  // not error-string reading. Failed = image killed the publish; approved =
  // pre-flight caught it before the send window.
  if (post.imageIssue && (post.status === "publish_failed" || post.publishError))
    return { label: "Image problem — post failed", cls: "text-red-600 border-red-300", Icon: ImageOff };
  if (post.imageIssue && post.status === "approved")
    return { label: "Image problem — fix before send", cls: "text-amber-600 border-amber-300", Icon: ImageOff };
  if (post.status === "publish_failed" || post.publishError)
    return { label: "Orbit: post failed", cls: "text-red-600 border-red-300", Icon: AlertCircle };
  if (post.status === "exported" || post.status === "scheduled_external")
    return { label: "Exported to CSV", cls: "text-blue-600 border-blue-300", Icon: FileDown };
  if (post.status === "missed")
    return { label: "Missed — needs review", cls: "text-amber-600 border-amber-300", Icon: AlertCircle };
  if (post.status === "approved") {
    if (!post.scheduledDate)
      return { label: "Approved – needs date", cls: "text-amber-600 border-amber-300", Icon: Calendar };
    if (post.deliveryMode === "csv")
      return { label: "Approved – export pending", cls: "text-sky-600 border-sky-300", Icon: FileDown };
    return { label: "Approved – Orbit scheduled", cls: "text-emerald-600 border-emerald-300", Icon: Zap };
  }
  return { label: "Draft", cls: "text-muted-foreground border-muted-foreground/40", Icon: Pencil };
}

export function PostStageBadge({
  post, className = "",
}: { post: StageablePost & { id: string }; className?: string }) {
  const s = getPostStage(post);
  const { Icon } = s;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${s.cls} ${className}`} data-testid={`badge-stage-${post.id}`}>
      <Icon className="w-2.5 h-2.5" /> {s.label}
    </Badge>
  );
}
