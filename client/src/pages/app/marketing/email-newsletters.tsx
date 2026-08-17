import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import DOMPurify from "dompurify";
import { useDeepLinkFocus } from "@/lib/use-deep-link-focus";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTabMarketId } from "@/lib/tabContext";
import {
  Mail,
  Lock,
  Filter,
  Pencil,
  Sparkles,
  Loader2,
  Copy,
  CopyPlus,
  Lightbulb,
  ChevronDown,
  Trash2,
  Search,
  ImageIcon,
  Calendar,
  CalendarClock,
  Eye,
  Tag,
  Download,
  Send,
  Upload,
  Plus,
  Library,
  Check,
  CheckCircle,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { EmailListSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlag, useFeatureFlagWithLoading } from "@/hooks/useFeatureFlag";
import { useSearch, useLocation } from "wouter";

// ── HubSpot stats mini-panel ──────────────────────────────────────────────
interface HubspotStats {
  sent: number; delivered: number; opens: number; uniqueOpens: number;
  clicks: number; uniqueClicks: number; unsubscribes: number;
  openRate: number; clickRate: number;
}

function HubspotStatsPanel({ emailId }: { emailId: string }) {
  const { data, isLoading, isError, error } = useQuery<HubspotStats, { error: string; needsReauth?: boolean }>({
    queryKey: [`/api/generated-emails/${emailId}/hubspot-stats`],
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 min — stats don't update that often
  });

  if (isLoading) {
    return (
      <div className="flex gap-4 mt-1" aria-label="Loading HubSpot stats">
        {[1, 2, 3].map(i => <div key={i} className="h-7 w-16 rounded bg-muted animate-pulse" />)}
      </div>
    );
  }
  if (isError) {
    const msg = (error as any)?.error ?? String(error);
    const needsReauth = (error as any)?.needsReauth;
    return (
      <p className="text-[10px] text-muted-foreground mt-1" data-testid={`hubspot-stats-error-${emailId}`}>
        {needsReauth
          ? "Re-authorize HubSpot in Settings → Connections to enable open/click stats."
          : `Stats unavailable: ${msg}`}
      </p>
    );
  }
  if (!data) return null;

  const fmt = (n: number) => n.toLocaleString();
  const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

  const cols: { label: string; value: string; testId: string }[] = [
    { label: "Delivered", value: fmt(data.delivered || data.sent), testId: "delivered" },
    { label: "Unique opens", value: `${fmt(data.uniqueOpens)} (${pct(data.openRate)})`, testId: "opens" },
    { label: "Unique clicks", value: `${fmt(data.uniqueClicks)} (${pct(data.clickRate)})`, testId: "clicks" },
    { label: "Unsubscribes", value: fmt(data.unsubscribes), testId: "unsubs" },
  ];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1" data-testid={`hubspot-stats-${emailId}`}>
      {cols.map(c => (
        <span key={c.label} className="text-[10px] text-muted-foreground" data-testid={`hubspot-stat-${c.testId}-${emailId}`}>
          <span className="font-medium text-foreground">{c.value}</span>{" "}{c.label}
        </span>
      ))}
    </div>
  );
}

interface ContentAsset {
  id: string;
  title: string;
  description?: string;
  aiSummary?: string;
  leadImageUrl?: string;
  url?: string;
  categoryId?: string;
  productIds?: string[];
  createdAt: string;
  status: string;
}

interface Product {
  id: string;
  name: string;
  isBaseline: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface SavedEmail {
  id: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  platform?: string;
  tone?: string;
  label?: string;
  status: string;
  subjectLineSuggestions?: string[];
  coachingTips?: string[];
  sourceAssetIds?: string[] | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  hubspotEmailId?: string | null;
  hubspotEmailUrl?: string | null;
  sections?: {
    caseStudyAssetId?: string | null;
    eventIds?: string[];
    blogAssetIds?: string[];
    eventsCalendarUrl?: string | null;
    blogIndexUrl?: string | null;
    blogSectionTitle?: string | null;
    blogIntro?: string | null;
    generalInfo?: {
      senderSignoff?: string | null;
      senderName?: string | null;
      senderTitle?: string | null;
      aboutTitle?: string | null;
      aboutText?: string | null;
      aboutImageUrl?: string | null;
    } | null;
  } | null;
  sectionsHtml?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  // A/B test config
  abTestEnabled?: boolean;
  abTestSplit?: number;
  abWinnerMetric?: string;
  abEvaluationHours?: number;
  abWinnerVariantLabel?: string | null;
  abWinnerDeclaredAt?: string | null;
  fontFamily?: string | null;
}

interface AbTestResults {
  abTestEnabled: boolean;
  abWinnerMetric: string;
  abEvaluationHours: number;
  abTestSplit: number;
  winnerVariantLabel: string | null;
  winnerDeclaredAt: string | null;
  variantA: { subjectLine: string; recipientCount: number; openCount: number; clickCount: number; openRate: number; clickRate: number; status: string } | null;
  variantB: { subjectLine: string; recipientCount: number; openCount: number; clickCount: number; openRate: number; clickRate: number; status: string } | null;
}
interface PreviewEmail {
  subject: string;
  htmlBody: string;
  textBody?: string;
  platform: string;
  subjectLineSuggestions?: string[];
  coachingTips?: string[];
}

/**
 * Fetch the server-rendered export for a saved email — the body with the
 * configured sections (case study, events, blog posts, About) re-rendered and
 * appended. Copy/Wix export must use this instead of the raw htmlBody, which
 * never contains sections. Returns null when the fetch fails.
 */
async function fetchSavedEmailExport(id: string): Promise<{ html: string; fragment: string; hubspotFragment: string } | null> {
  try {
    const r = await fetch(`/api/email/saved/${id}/export-html`, { credentials: "include" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Faithful email preview: renders the full responsive export (main body +
 * freshly re-rendered sections) in a sandboxed iframe, exactly as recipients
 * see it — instead of squeezing the 600px email tables into a padded div.
 */
function EmailPreviewFrame({ emailId, fallbackHtml }: { emailId: string; fallbackHtml: string }) {
  const { data } = useQuery<{ html: string } | null>({
    queryKey: ["/api/email/saved", getTabMarketId(), emailId, "export-html"],
    queryFn: () => fetchSavedEmailExport(emailId),
  });
  const doc = data?.html || `<!doctype html><html><body style="margin:0;background:#ffffff;">${DOMPurify.sanitize(fallbackHtml)}</body></html>`;
  return (
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={doc}
      className="w-full border rounded bg-white"
      style={{ height: "65vh" }}
      data-testid="view-email-html"
    />
  );
}

function buildWixHtml(htmlBody: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
<style>
  .wix-email-container {
    max-width: 620px;
    margin: 0 auto;
    font-family: Arial, Helvetica, sans-serif;
    color: #1a1a2e;
    line-height: 1.6;
    padding: 24px;
  }
  .wix-email-container img {
    max-width: 100%;
    height: auto;
    display: block;
    border-radius: 8px;
  }
  .wix-email-container table {
    border-collapse: collapse;
    width: 100%;
    max-width: 100%;
  }
  .wix-email-container td {
    word-break: break-word;
  }
  .wix-email-container a {
    color: inherit;
  }
  .wix-email-container h1,
  .wix-email-container h2,
  .wix-email-container h3 {
    margin: 1em 0 0.5em;
    line-height: 1.3;
  }
  .wix-email-container p {
    margin: 0 0 1em;
  }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div class="wix-email-container">
${htmlBody}
</div>
</body>
</html>`;
}

function downloadHtmlFile(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Prospect-suppression warning shown inside the send dialog when some
 * recipients are currently active sales prospects (status not in
 * 'replied' / 'dormant'). The operator can choose to exclude them before
 * confirming the send.
 */
function ProspectCheckBanner({ listId }: { listId: string }) {
  const { data, isLoading } = useQuery<{ count: number; prospects: Array<{ email: string; name: string | null; companyName: string | null; status: string }> }>({
    queryKey: [`/api/email-prospect-check`, listId],
    queryFn: async () => {
      const r = await fetch("/api/email-prospect-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ listId }),
      });
      if (!r.ok) return { count: 0, prospects: [] };
      return r.json();
    },
    enabled: !!listId,
  });
  if (!listId || isLoading || !data || data.count === 0) return null;
  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1" data-testid="banner-prospect-warning">
      <div className="font-medium flex items-center gap-1.5">
        <span>⚠</span>
        <span>{data.count} recipient{data.count !== 1 ? "s are" : " is"} in an active sales cadence</span>
      </div>
      <p className="text-amber-700">These contacts are in mid-sequence. Use the checkbox below to exclude them from this send and avoid disrupting the sales conversation.</p>
      <ul className="ml-3 list-disc space-y-0.5 text-amber-700">
        {data.prospects.slice(0, 5).map(p => (
          <li key={p.email} data-testid={`text-prospect-email-${p.email}`}>
            {p.name || p.email}{p.companyName ? ` · ${p.companyName}` : ""} <span className="capitalize">({p.status})</span>
          </li>
        ))}
        {data.count > 5 && <li>…and {data.count - 5} more</li>}
      </ul>
    </div>
  );
}

/**
 * Live deliverability preview shown inside the send dialog. When the
 * operator picks a recipient list we fetch the deliverable / suppressed
 * breakdown so they know exactly how many addresses will be skipped — and
 * why — *before* confirming the send.
 */
/**
 * A/B test results bar shown inline on email cards when a test is active or
 * completed.  Fetches live results from /api/generated-emails/:id/ab-results.
 */
function AbTestResultsPanel({ emailId, winnerLabel }: { emailId: string; winnerLabel?: string | null }) {
  const { data, isLoading } = useQuery<AbTestResults>({
    queryKey: [`/api/generated-emails/${emailId}/ab-results`],
    queryFn: async () => {
      const r = await fetch(`/api/generated-emails/${emailId}/ab-results`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load A/B results");
      return r.json();
    },
    refetchInterval: winnerLabel ? false : 60_000, // poll until winner declared
  });
  if (isLoading || !data || (!data.variantA && !data.variantB)) return null;
  const metric = data.abWinnerMetric === "click_rate" ? "click" : "open";
  const maxRate = Math.max(
    data.variantA ? (metric === "click" ? data.variantA.clickRate : data.variantA.openRate) : 0,
    data.variantB ? (metric === "click" ? data.variantB.clickRate : data.variantB.openRate) : 0,
    0.001,
  );
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const variantRow = (label: "A" | "B", v: NonNullable<typeof data.variantA>) => {
    const rate = metric === "click" ? v.clickRate : v.openRate;
    const isWinner = data.winnerVariantLabel === label;
    return (
      <div key={label} className="space-y-0.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className={`font-medium ${isWinner ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
            Variant {label}{isWinner ? " 🏆" : ""}
          </span>
          <span className="text-muted-foreground">{fmtPct(rate)} {metric} · {v.recipientCount.toLocaleString()} rcpt</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isWinner ? "bg-green-500" : "bg-blue-400"}`}
            style={{ width: `${Math.min(100, (rate / maxRate) * 100)}%` }}
          />
        </div>
      </div>
    );
  };
  return (
    <div
      className="mt-2 p-2 rounded border border-border bg-muted/30 space-y-1.5"
      onClick={e => e.stopPropagation()}
      data-testid={`panel-ab-results-${emailId}`}
    >
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        A/B {metric} rate · {data.abTestSplit}% split
        {data.winnerDeclaredAt && <span className="ml-1 text-green-600 font-normal">· winner declared</span>}
        {!data.winnerDeclaredAt && <span className="ml-1 font-normal">· evaluating in {data.abEvaluationHours}h</span>}
      </p>
      {data.variantA && variantRow("A", data.variantA)}
      {data.variantB && variantRow("B", data.variantB)}
      {!data.winnerDeclaredAt && !data.variantA?.status.match(/sent|completed/) && (
        <p className="text-[10px] text-muted-foreground italic">Results will appear once the test send completes.</p>
      )}
    </div>
  );
}
function SendDeliverabilityPreview({ listId }: { listId: string }) {
  const { data, isLoading } = useQuery<{ deliverable: number; suppressed: Array<{ email: string; reason: string }> }>({
    queryKey: [`/api/email-recipient-lists/${listId}/deliverability`],
    queryFn: async () => {
      const r = await fetch(`/api/email-recipient-lists/${listId}/deliverability`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load preview");
      return r.json();
    },
    enabled: !!listId,
  });
  if (!listId) return null;
  if (isLoading) {
    return <div className="text-xs text-muted-foreground" data-testid="text-preview-loading">Checking suppressions…</div>;
  }
  if (!data) return null;
  const supByReason = data.suppressed.reduce<Record<string, number>>((acc, r) => {
    acc[r.reason] = (acc[r.reason] || 0) + 1;
    return acc;
  }, {});
  return (
    <div className="rounded border bg-muted/40 px-3 py-2 text-xs space-y-1" data-testid="preview-deliverability">
      <div className="flex items-center justify-between">
        <span><strong className="text-foreground" data-testid="text-deliverable-count">{data.deliverable}</strong> deliverable</span>
        <span><strong className="text-foreground" data-testid="text-suppressed-count">{data.suppressed.length}</strong> will be skipped</span>
      </div>
      {data.suppressed.length > 0 && (
        <>
          <div className="text-muted-foreground">Skipped reasons:</div>
          <ul className="list-disc ml-4 text-muted-foreground">
            {Object.entries(supByReason).map(([reason, count]) => (
              <li key={reason} data-testid={`text-suppression-reason-${reason}`}>
                <span className="capitalize">{reason.replace(/_/g, " ")}</span>: {count}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.deliverable === 0 && data.suppressed.length > 0 && (
        <div className="text-amber-700 pt-1">All recipients on this list are suppressed — the send will be refused.</div>
      )}
    </div>
  );
}

const EMAIL_STATUS_FILTER_KEY = "orbit:email-newsletters:statusFilter";

// hint: Logic changed on both sides. Requires understanding intent of each change.
export default function EmailNewslettersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const preselectedAssetId = params.get("assetId");
  const briefingAction = params.get("briefingAction");
  const recommendationContext = params.get("recommendation");
  // Capture the ?emailId= deep-link param once at mount (stable across renders).
  const focusEmailId = params.get("emailId");
  // Prevent re-opening the viewer if savedEmails refreshes after the user closes it.
  const deepLinkHonoredRef = useRef(false);

  const [emailPlatform, setEmailPlatform] = useState("outlook");
  const [emailTone, setEmailTone] = useState("professional");
  const [emailFontFamily, setEmailFontFamily] = useState<string>("Arial"); // default until brand font loaded
  const [emailCallToAction, setEmailCallToAction] = useState("");
  const [emailRecipientContext, setEmailRecipientContext] = useState("");
  const [wrapEmailLinks, setWrapEmailLinks] = useState(false);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [emailInstructions, setEmailInstructions] = useState(
    briefingAction ? `Address this intelligence action item in the email: ${briefingAction}`
    : recommendationContext ? `Address this strategic recommendation: ${recommendationContext}`
    : ""
  );
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<PreviewEmail | null>(null);
  const [coachingTipsOpen, setCoachingTipsOpen] = useState(false);

  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<string>("all");
  const [assetProductFilter, setAssetProductFilter] = useState<string>("all");
  const [assetDateSort, setAssetDateSort] = useState<string>("newest");

  const [statusFilter, setStatusFilter] = useState<string>(
    () => {
      try { return sessionStorage.getItem(EMAIL_STATUS_FILTER_KEY) ?? "all"; } catch { return "all"; }
    }
  );
  useEffect(() => {
    try { sessionStorage.setItem(EMAIL_STATUS_FILTER_KEY, statusFilter); } catch {}
  }, [statusFilter]);
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [editingEmail, setEditingEmail] = useState<SavedEmail | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editFontFamily, setEditFontFamily] = useState<string>("Arial");
  const [editSourceAssetIds, setEditSourceAssetIds] = useState<string[]>([]);
  const [editAssetSearch, setEditAssetSearch] = useState("");
  const [editMode, setEditMode] = useState<"visual" | "source">("visual");
  const editableRef = useRef<HTMLDivElement>(null);
  // A/B test editing state
  const [abEnabled, setAbEnabled] = useState(false);
  const [abSplit, setAbSplit] = useState(20);
  const [abMetric, setAbMetric] = useState<"open_rate" | "click_rate">("open_rate");
  const [abEvalHours, setAbEvalHours] = useState(24);
  const [bVariantSubject, setBVariantSubject] = useState("");
  const [bVariantBody, setBVariantBody] = useState("");
  const [abSaving, setAbSaving] = useState(false);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<{ url: string; name: string }[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewingEmail, setViewingEmail] = useState<SavedEmail | null>(null);
  const [labelDialogEmail, setLabelDialogEmail] = useState<SavedEmail | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [sendDialogEmail, setSendDialogEmail] = useState<SavedEmail | null>(null);
  const [sendListId, setSendListId] = useState<string>("");
  const [sendSegmentId, setSendSegmentId] = useState<string>("");
  const [sendTestRecipient, setSendTestRecipient] = useState<string>("");
  const [sendMode, setSendMode] = useState<"list" | "segment" | "hubspot" | "test">("test");
  const [sendHubspotListId, setSendHubspotListId] = useState<string>("");
  const [sendScheduleAt, setSendScheduleAt] = useState<string>("");
  const [sendTrackOpens, setSendTrackOpens] = useState<boolean>(true);
  const [sendTrackClicks, setSendTrackClicks] = useState<boolean>(true);
  const [sendExcludeActiveProspects, setSendExcludeActiveProspects] = useState<boolean>(false);
  const [sendSenderIdentityId, setSendSenderIdentityId] = useState<string>("");
  const [sendSubscriptionTypeIds, setSendSubscriptionTypeIds] = useState<string[]>([]);
  const [rescheduleEmail, setRescheduleEmail] = useState<SavedEmail | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState<string>("");
  const [markSentDialogEmail, setMarkSentDialogEmail] = useState<SavedEmail | null>(null);
  const [markSentDate, setMarkSentDate] = useState<string>("");
  const [markSentHubspotUrl, setMarkSentHubspotUrl] = useState<string>("");

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean>; mailingAddress?: string | null }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = useFeatureFlag("emailNewsletters");
  const { enabled: directDeliveryEnabled, isLoading: directDeliveryFlagLoading } = useFeatureFlagWithLoading("directEmailDelivery");
  const hasMailingAddress = !!(tenantInfo?.mailingAddress?.trim());

  // Font options from the curated list + the tenant's brand body font default.
  const { data: fontOptions } = useQuery<{
    fonts: Array<{ label: string; value: string; isCustom?: boolean; googleFont?: string }>;
    brandBodyFont: string | null;
    brandBodyFontLabel: string | null;
    brandBodyFontIsCustom: boolean;
  }>({
    queryKey: ["/api/email/font-options"],
    queryFn: async () => {
      const r = await fetch("/api/email/font-options", { credentials: "include" });
      return r.ok ? r.json() : { fonts: [], brandBodyFont: null, brandBodyFontLabel: null, brandBodyFontIsCustom: false };
    },
    enabled: isAllowed,
  });

  // Build the effective font list: curated list + tenant brand font prepended if
  // it isn't already in the curated list (brandBodyFontIsCustom === true).
  const effectiveFontList = useMemo(() => {
    const base = fontOptions?.fonts ?? [];
    if (fontOptions?.brandBodyFontIsCustom && fontOptions.brandBodyFont) {
      return [
        { value: fontOptions.brandBodyFont, label: `${fontOptions.brandBodyFontLabel ?? fontOptions.brandBodyFont} (Brand)`, isBrandCustom: true },
        ...base,
      ];
    }
    return base;
  }, [fontOptions]);

  // Auto-select the tenant brand body font the first time options load —
  // but only if the user hasn't manually changed the selector yet.
  useEffect(() => {
    if (fontOptions?.brandBodyFont && emailFontFamily === "Arial") {
      setEmailFontFamily(fontOptions.brandBodyFont);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontOptions?.brandBodyFont]);

  const { data: hubspotStatus } = useQuery<{ connection?: { activeProspectSuppressionDefault?: string } }>({
    queryKey: ["/api/integrations/hubspot/status"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/hubspot/status", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
    enabled: !directDeliveryFlagLoading && directDeliveryEnabled,
  });

  // Pre-populate the prospect-exclusion checkbox from the tenant-level default
  // whenever the operator opens the send dialog.
  useEffect(() => {
    if (sendDialogEmail) {
      const defaultVal = hubspotStatus?.connection?.activeProspectSuppressionDefault;
      setSendExcludeActiveProspects(defaultVal === "always_exclude");
    }
  }, [sendDialogEmail, hubspotStatus?.connection?.activeProspectSuppressionDefault]);

  const { data: recipientLists = [] } = useQuery<Array<{ id: string; name: string; recipientCount: number }>>({
    queryKey: ["/api/email-recipient-lists", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/email-recipient-lists", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed && !directDeliveryFlagLoading && directDeliveryEnabled,
  });

  const { data: senderIdentities = [] } = useQuery<Array<{ id: string; name: string; email: string; replyToEmail: string | null; isDefault: boolean }>>({
    queryKey: ["/api/email-sender-identities"],
    queryFn: async () => {
      const r = await fetch("/api/email-sender-identities", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed && !directDeliveryFlagLoading && directDeliveryEnabled,
  });

  const { data: subscriptionTypes = [] } = useQuery<Array<{ id: string; name: string; isTransactional: boolean }>>({
    queryKey: ["/api/email-subscription-types"],
    queryFn: async () => {
      const r = await fetch("/api/email-subscription-types", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed && !directDeliveryFlagLoading && directDeliveryEnabled,
  });

  const { data: marketingSegments = [] } = useQuery<Array<{ id: string; name: string; memberCount: number }>>({
    queryKey: ["/api/marketing-segments"],
    queryFn: async () => {
      const r = await fetch("/api/marketing-segments", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed && !directDeliveryFlagLoading && directDeliveryEnabled,
  });

  type HubspotAudienceList = {
    listId: string;
    name: string;
    memberCount: number;
    linkedSegment: {
      id: string;
      name: string;
      syncStatus: string | null;
      syncError: string | null;
      lastSyncedAt: string | null;
      memberCount: number;
    } | null;
  };
  const hubspotConnected = !!hubspotStatus?.connection;
  const { data: hubspotAudienceLists = [], isLoading: hubspotListsLoading } = useQuery<HubspotAudienceList[]>({
    queryKey: ["/api/marketing/hubspot-lists"],
    queryFn: async () => {
      const r = await fetch("/api/marketing/hubspot-lists", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed && !directDeliveryFlagLoading && directDeliveryEnabled && hubspotConnected && sendMode === "hubspot" && !!sendDialogEmail,
    // Poll while an import/sync is running so status + counts stay live.
    refetchInterval: (query) =>
      (query.state.data ?? []).some(l => ["pending", "syncing"].includes(l.linkedSegment?.syncStatus ?? ""))
        ? 3000
        : false,
  });

  const importHubspotListMutation = useMutation({
    mutationFn: async (listId: string) => {
      const r = await fetch(`/api/marketing/hubspot-lists/${encodeURIComponent(listId)}/import`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Import failed");
      return r.json() as Promise<{ segment: { id: string } }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/hubspot-lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-segments"] });
    },
    onError: (err: Error) => toast({ title: "HubSpot import failed", description: err.message, variant: "destructive" }),
  });

  const resyncHubspotSegmentMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const r = await fetch(`/api/marketing-segments/${segmentId}/hubspot-sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Sync failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/hubspot-lists"] });
      toast({ title: "Refresh started", description: "Membership is being re-synced from HubSpot." });
    },
    onError: (err: Error) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  const sendEmailMutation = useMutation({
    mutationFn: async ({ emailId, listId, segmentId, testRecipient, scheduledAt, trackOpens, trackClicks, excludeActiveProspects, senderIdentityId, subscriptionTypeIds }: { emailId: string; listId?: string; segmentId?: string; testRecipient?: string; scheduledAt?: string; trackOpens?: boolean; trackClicks?: boolean; excludeActiveProspects?: boolean; senderIdentityId?: string; subscriptionTypeIds?: string[] }) => {
      const r = await fetch(`/api/generated-emails/${emailId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          listId: listId || undefined,
          segmentId: segmentId || undefined,
          testRecipient: testRecipient || undefined,
          scheduledAt: scheduledAt || undefined,
          trackOpens,
          trackClicks,
          excludeActiveProspects,
          senderIdentityId: senderIdentityId || undefined,
          subscriptionTypeIds: subscriptionTypeIds?.length ? subscriptionTypeIds : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Send failed");
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email-sends"] });
      setSendDialogEmail(null);
      setSendListId("");
      setSendSegmentId("");
      setSendHubspotListId("");
      setSendTestRecipient("");
      setSendScheduleAt("");
      setSendSenderIdentityId("");
      setSendSubscriptionTypeIds([]);
      toast({
        title: "Send started",
        description: `${data.sentCount ?? data.totalRecipients ?? 0} of ${data.totalRecipients ?? 0} delivered. View progress in the Sends tab.`,
      });
    },
    onError: (err: Error) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const { data: strategicContext } = useQuery<{ available: boolean; sections: Record<string, boolean> }>({
    queryKey: ["/api/strategic-context/summary", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/strategic-context/summary", { credentials: "include" });
      return r.ok ? r.json() : { available: false, sections: {} };
    },
    enabled: isAllowed,
  });

  const { data: contentAssets = [] } = useQuery<ContentAsset[]>({
    queryKey: ["/api/content-assets", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/content-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/content-categories", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/content-categories", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/products", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: savedEmails = [], isLoading: emailsLoading } = useQuery<SavedEmail[]>({
    queryKey: ["/api/email/saved", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/email/saved", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: availablePersonas = [] } = useQuery<{ id: string; name: string; role: string | null; isIcp: boolean }[]>({
    queryKey: ["/api/personas", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/personas", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  useEffect(() => {
    if (preselectedAssetId && contentAssets.length > 0) {
      const exists = contentAssets.some(a => a.id === preselectedAssetId);
      if (exists && !selectedAssetIds.includes(preselectedAssetId)) {
        setSelectedAssetIds(prev => [...prev, preselectedAssetId]);
      }
    }
  }, [preselectedAssetId, contentAssets]);

  // Deep-link: eagerly reset any filters that would hide the target email and
  // open its viewer. This must run before the DOM lookup below because cards
  // are rendered from filteredEmails — a filter can prevent the card from
  // existing in the DOM. Uses a ref so a query refetch doesn't re-open the
  // viewer after the user has already closed it.
  useEffect(() => {
    if (!focusEmailId || savedEmails.length === 0 || deepLinkHonoredRef.current) return;
    const target = savedEmails.find(e => e.id === focusEmailId);
    if (!target) return;
    deepLinkHonoredRef.current = true;
    setStatusFilter("all");
    setLabelFilter("all");
    setViewingEmail(target);
  }, [focusEmailId, savedEmails]);

  // Scroll to and briefly highlight the target card once it's in the DOM
  // (filters cleared above). The hook reads ?emailId=, finds the card element,
  // scrolls it into view, and clears the ring after the timeout.
  const [focusId] = useDeepLinkFocus<SavedEmail>({
    paramName: "emailId",
    items: savedEmails,
    testIdPrefix: "card-email",
  });

  const categoryName = (catId?: string) => {
    if (!catId) return "";
    return categories.find(c => c.id === catId)?.name || "";
  };

  const productName = (pid: string) => products.find(p => p.id === pid)?.name || "";

  const activeAssets = contentAssets.filter(a => a.status === "active");

  const filteredAssets = useMemo(() => {
    let list = activeAssets;
    if (assetSearchQuery) {
      const q = assetSearchQuery.toLowerCase();
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q)
      );
    }
    if (assetCategoryFilter !== "all") {
      list = list.filter(a => a.categoryId === assetCategoryFilter);
    }
    if (assetProductFilter !== "all") {
      list = list.filter(a => a.productIds?.includes(assetProductFilter));
    }
    list = [...list].sort((a, b) => {
      if (assetDateSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return list;
  }, [activeAssets, assetSearchQuery, assetCategoryFilter, assetProductFilter, assetDateSort]);

  const usedCategories = useMemo(() => {
    const ids = new Set(activeAssets.map(a => a.categoryId).filter(Boolean));
    return categories.filter(c => ids.has(c.id));
  }, [activeAssets, categories]);

  const usedProducts = useMemo(() => {
    const ids = new Set(activeAssets.flatMap(a => a.productIds || []));
    return products.filter(p => ids.has(p.id));
  }, [activeAssets, products]);

  // Sync contenteditable div when switching to visual mode or opening a new email.
  // Use requestAnimationFrame so the Dialog open-animation has time to mount the
  // DOM node before we attempt to write to it (fixes blank-body on first open).
  useEffect(() => {
    if (editingEmail?.platform === "hubspot-marketing" && editMode === "visual") {
      const inject = () => {
        if (editableRef.current) {
          editableRef.current.innerHTML = DOMPurify.sanitize(editBody, {
            ADD_ATTR: ["width", "height", "cellpadding", "cellspacing", "border", "align", "valign", "bgcolor", "target"],
          });
        }
      };
      const raf = requestAnimationFrame(inject);
      return () => cancelAnimationFrame(raf);
    }
  }, [editingEmail?.id, editMode, editBody]);

  const updateEmailMutation = useMutation({
    mutationFn: async ({ emailId, subject, body, isHtml, sourceAssetIds, fontFamily }: { emailId: string; subject: string; body: string; isHtml: boolean; sourceAssetIds: string[]; fontFamily?: string | null }) => {
      const payload: Record<string, unknown> = { subject, sourceAssetIds, fontFamily: fontFamily || null };
      if (isHtml) {
        payload.htmlBody = body;
      } else {
        payload.textBody = body;
      }
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setEditingEmail(null);
      toast({ title: "Email updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteEmailMutation = useMutation({
    mutationFn: async (emailId: string) => {
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setDeleteConfirmId(null);
      toast({ title: "Email deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds(prev =>
      prev.includes(assetId)
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    );
  };

  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    try {
      const r = await fetch("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assetIds: selectedAssetIds,
          instructions: emailInstructions,
          platform: emailPlatform,
          tone: emailTone,
          callToAction: emailCallToAction || undefined,
          recipientContext: emailRecipientContext || undefined,
          personaIds: selectedPersonaIds.length > 0 ? selectedPersonaIds : undefined,
          wrapLinks: wrapEmailLinks,
          fontFamily: emailFontFamily !== "Arial" ? emailFontFamily : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const data = await r.json();
      setPreviewEmail({
        subject: data.subject,
        htmlBody: data.htmlBody,
        textBody: data.textBody,
        platform: data.platform,
        subjectLineSuggestions: data.subjectLineSuggestions,
        coachingTips: data.coachingTips,
      });
      setCoachingTipsOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingEmail(false);
    }
  };

  const saveEmailMutation = useMutation({
    mutationFn: async () => {
      if (!previewEmail) return;
      const r = await fetch("/api/email/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          platform: emailPlatform,
          tone: emailTone,
          callToAction: emailCallToAction || undefined,
          recipientContext: emailRecipientContext || undefined,
          subject: previewEmail.subject,
          htmlBody: previewEmail.htmlBody,
          textBody: previewEmail.textBody,
          subjectLineSuggestions: previewEmail.subjectLineSuggestions,
          coachingTips: previewEmail.coachingTips,
          sourceAssetIds: selectedAssetIds.length > 0 ? selectedAssetIds : undefined,
          fontFamily: emailFontFamily || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json() as Promise<SavedEmail>;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setPreviewEmail(null);
      // For HubSpot emails, open the edit dialog immediately so the user can
      // configure sections (case study, events, blog posts) right away.
      if (saved?.platform === "hubspot-marketing") {
        setEditMode("visual");
        setEditingEmail(saved);
        setEditSubject(saved.subject);
        setEditBody(saved.htmlBody || "");
        setEditFontFamily(saved.fontFamily || "Arial");
        setEditSourceAssetIds(Array.isArray(saved.sourceAssetIds) ? saved.sourceAssetIds : []);
        setEditAssetSearch("");
        toast({ title: "Email saved", description: "Add sections like case studies and upcoming events below." });
      } else {
        toast({ title: "Email saved" });
      }
    },
  });

  const setLabelMutation = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const r = await fetch(`/api/email/saved/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label: label || null }),
      });
      if (!r.ok) throw new Error("Failed to update label");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setLabelDialogEmail(null);
      toast({ title: "Label updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const duplicateEmailMutation = useMutation({
    mutationFn: async (email: SavedEmail) => {
      const r = await fetch("/api/email/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: `${email.subject} (copy)`,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
          platform: email.platform,
          tone: email.tone,
          subjectLineSuggestions: email.subjectLineSuggestions,
          coachingTips: email.coachingTips,
          sourceAssetIds: Array.isArray(email.sourceAssetIds) && email.sourceAssetIds.length > 0 ? email.sourceAssetIds : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      toast({ title: "Email duplicated", description: "A copy has been added to your saved emails." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rescheduleEmailMutation = useMutation({
    mutationFn: async ({ email, scheduledAt }: { email: SavedEmail; scheduledAt: string }) => {
      const r = await fetch("/api/email/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: email.subject,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
          platform: email.platform,
          tone: email.tone,
          label: email.label,
          subjectLineSuggestions: email.subjectLineSuggestions,
          coachingTips: email.coachingTips,
          sourceAssetIds: Array.isArray(email.sourceAssetIds) && email.sourceAssetIds.length > 0 ? email.sourceAssetIds : undefined,
          scheduledAt,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setRescheduleEmail(null);
      setRescheduleDateTime("");
      toast({ title: "Email rescheduled", description: "A new draft has been created with the selected send date." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clearScheduledDateMutation = useMutation({
    mutationFn: async (emailId: string) => {
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledAt: null }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setRescheduleEmail(null);
      setRescheduleDateTime("");
      toast({ title: "Schedule cleared", description: "The email has been returned to a saved state." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const markSentMutation = useMutation({
    mutationFn: async ({ emailId, sentAt, hubspotEmailUrl }: { emailId: string; sentAt?: string; hubspotEmailUrl?: string }) => {
      const r = await fetch(`/api/generated-emails/${emailId}/mark-sent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sentAt, hubspotEmailUrl }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setMarkSentDialogEmail(null);
      setMarkSentDate("");
      setMarkSentHubspotUrl("");
      toast({ title: "Marked as sent", description: "This email is now in your sent history." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const uniqueLabels = [...new Set(savedEmails.map(e => e.label).filter(Boolean))] as string[];

  const filteredEmails = savedEmails.filter(e => {
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "scheduled" ? !!e.scheduledAt : e.status === statusFilter);
    const matchesLabel = labelFilter === "all" || (labelFilter === "__unlabeled" ? !e.label : e.label === labelFilter);
    return matchesStatus && matchesLabel;
  });

  const PLATFORM_LABELS: Record<string, string> = {
    "outlook": "Outlook",
    "hubspot-marketing": "HubSpot Marketing",
    "hubspot-1to1": "HubSpot 1:1",
    "dynamics-365": "Dynamics 365",
  };

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center" data-testid="card-email-newsletters-coming-soon">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle data-testid="text-email-newsletters-title">Email Newsletter Generator</CardTitle>
              <CardDescription>
                Create AI-powered promotional emails from your content assets and market intelligence. Available on the Enterprise plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild data-testid="button-email-newsletters-contact-sales">
                <a href="mailto:contactus@synozur.com?subject=Enterprise%20Plan%20Inquiry%20-%20Email%20Newsletters">
                  Contact Sales
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6" /> Email Newsletters
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate AI-drafted emails from your content assets and marketing grounding documents.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate Email</CardTitle>
            <CardDescription>
              Select content assets and configure your email generation settings.{" "}
              <span className="text-foreground/70">Not sure which platform to pick? <strong>HubSpot Marketing Email</strong> is the best choice for most bulk newsletters.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeAssets.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-2 block">Content Assets</label>

                <div className="flex flex-wrap gap-2 mb-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      value={assetSearchQuery}
                      onChange={e => setAssetSearchQuery(e.target.value)}
                      placeholder="Search assets..."
                      className="h-8 pl-8 text-sm"
                      data-testid="input-asset-search"
                    />
                  </div>
                  <Select value={assetCategoryFilter} onValueChange={setAssetCategoryFilter}>
                    <SelectTrigger className="h-8 w-[160px] text-sm" data-testid="select-asset-category-filter">
                      <Filter className="w-3 h-3 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {usedCategories.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {usedProducts.length > 0 && (
                    <Select value={assetProductFilter} onValueChange={setAssetProductFilter}>
                      <SelectTrigger className="h-8 w-[160px] text-sm" data-testid="select-asset-product-filter">
                        <Tag className="w-3 h-3 mr-1 text-muted-foreground" />
                        <SelectValue placeholder="Product" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Products</SelectItem>
                        {usedProducts.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={assetDateSort} onValueChange={setAssetDateSort}>
                    <SelectTrigger className="h-8 w-[130px] text-sm" data-testid="select-asset-date-sort">
                      <Calendar className="w-3 h-3 mr-1 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest First</SelectItem>
                      <SelectItem value="oldest">Oldest First</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  {filteredAssets.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">No assets match your filters.</div>
                  ) : (
                    filteredAssets.map(asset => (
                      <label
                        key={asset.id}
                        className={`flex items-start gap-3 cursor-pointer hover:bg-muted/50 p-3 border-b last:border-b-0 transition-colors ${
                          selectedAssetIds.includes(asset.id) ? "bg-primary/5" : ""
                        }`}
                      >
                        <Checkbox
                          checked={selectedAssetIds.includes(asset.id)}
                          onCheckedChange={() => toggleAsset(asset.id)}
                          className="mt-0.5"
                          data-testid={`checkbox-asset-${asset.id}`}
                        />
                        {asset.leadImageUrl ? (
                          <div className="w-12 h-12 rounded border overflow-hidden shrink-0 bg-muted">
                            <img
                              src={asset.leadImageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded border flex items-center justify-center shrink-0 bg-muted/50">
                            <ImageIcon className="w-5 h-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">{asset.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {categoryName(asset.categoryId) && (
                              <Badge variant="outline" className="text-[10px] h-4">{categoryName(asset.categoryId)}</Badge>
                            )}
                            {asset.productIds?.map(pid => (
                              <Badge key={pid} variant="outline" className="text-[10px] h-4 text-primary">{productName(pid) || pid}</Badge>
                            ))}
                            <span className="text-[10px] text-muted-foreground">{format(new Date(asset.createdAt), "MMM d, yyyy")}</span>
                          </div>
                          {asset.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{asset.description}</p>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
                {selectedAssetIds.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedAssetIds.length} asset{selectedAssetIds.length !== 1 ? "s" : ""} selected</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Platform</label>
                <Select value={emailPlatform} onValueChange={setEmailPlatform}>
                  <SelectTrigger data-testid="select-email-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outlook">Outlook</SelectItem>
                    <SelectItem value="hubspot-marketing">HubSpot Marketing Email</SelectItem>
                    <SelectItem value="hubspot-1to1">HubSpot 1:1 Email</SelectItem>
                    <SelectItem value="dynamics-365">Dynamics 365 Customer Email</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-platform-description">
                  {emailPlatform === "outlook" && "Plain-text or simple HTML — copy-paste into Outlook compose."}
                  {emailPlatform === "hubspot-marketing" && "Branded HTML newsletter, rendered in HubSpot's email tool."}
                  {emailPlatform === "hubspot-1to1" && "Short personal-style email sent one-to-one via HubSpot CRM."}
                  {emailPlatform === "dynamics-365" && "Customer email formatted for Dynamics 365 customer journeys."}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Tone</label>
                <Select value={emailTone} onValueChange={setEmailTone}>
                  <SelectTrigger data-testid="select-email-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Font picker — only visible for HTML platforms */}
            {emailPlatform === "hubspot-marketing" && (
              <div>
                <label className="text-sm font-medium">Body Font</label>
                <Select value={emailFontFamily} onValueChange={setEmailFontFamily}>
                  <SelectTrigger data-testid="select-email-font">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {effectiveFontList.map(f => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                        {(f as any).isCustom && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">Brand</span>
                        )}
                        {(f as any).isBrandCustom && (
                          <span className="ml-1.5 text-[10px] text-primary font-normal">✓ Brand kit</span>
                        )}
                        {!(f as any).isBrandCustom && fontOptions?.brandBodyFont === f.value && (
                          <span className="ml-1.5 text-[10px] text-primary font-normal">✓ Brand kit default</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Applied throughout the rendered email. Custom brand fonts (Avenir, MetroNova) load in Apple Mail and iOS.
                </p>
                {(() => {
                  const sel = effectiveFontList.find(f => f.value === emailFontFamily);
                  if (!sel && emailFontFamily && emailFontFamily !== "Arial") {
                    return (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-1" data-testid="text-hubspot-font-warning-unrecognized">
                        Font &ldquo;{emailFontFamily}&rdquo; isn&rsquo;t in the email-safe list — HubSpot and Outlook will fall back to Arial.
                      </p>
                    );
                  }
                  const needsLoad = (sel as any)?.isCustom || (sel as any)?.googleFont || (sel as any)?.isBrandCustom;
                  if (!needsLoad) return null;
                  const fallback = emailFontFamily === "MetroNova" ? "Verdana" : "Arial";
                  return (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-1" data-testid="text-hubspot-font-warning">
                      Custom and Google Fonts don't load in HubSpot or Outlook — recipients will see {fallback}.
                    </p>
                  );
                })()}
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Call to Action (optional)</label>
              <Input
                value={emailCallToAction}
                onChange={e => setEmailCallToAction(e.target.value)}
                placeholder="e.g. Book a demo, Download the whitepaper..."
                data-testid="input-email-cta"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Recipient Context (optional)</label>
              <Input
                value={emailRecipientContext}
                onChange={e => setEmailRecipientContext(e.target.value)}
                placeholder="e.g. IT decision makers at mid-market companies..."
                data-testid="input-email-recipient-context"
              />
            </div>
            {availablePersonas.length > 0 && (
              <div>
                <label className="text-sm font-medium">Target Personas (optional)</label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {availablePersonas.map(p => (
                    <Badge
                      key={p.id}
                      variant={selectedPersonaIds.includes(p.id) ? "default" : "outline"}
                      className="cursor-pointer gap-1"
                      onClick={() => setSelectedPersonaIds(prev =>
                        prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                      )}
                      data-testid={`badge-persona-${p.id}`}
                    >
                      {p.isIcp && "⭐ "}{p.name}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Select personas to tailor the email to specific audiences.</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Additional Instructions (optional)</label>
              <Textarea
                value={emailInstructions}
                onChange={e => setEmailInstructions(e.target.value)}
                placeholder="e.g. Focus on the enterprise audience, highlight ROI..."
                rows={3}
                data-testid="input-email-instructions"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer text-sm rounded-md border bg-muted/30 p-3" data-testid="toggle-wrap-email-links-label">
              <input
                type="checkbox"
                checked={wrapEmailLinks}
                onChange={e => setWrapEmailLinks(e.target.checked)}
                className="mt-0.5"
                data-testid="checkbox-wrap-email-links"
              />
              <div>
                <span className="font-medium">Wrap outbound URLs in tracked redirects</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Replace any URLs in the generated email with /r/short-codes that record click counts and append UTM tags. Tracked links appear in Marketing → Performance.
                </p>
              </div>
            </label>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleGenerateEmail}
                disabled={generatingEmail || selectedAssetIds.length === 0}
                className="gap-2"
                data-testid="button-generate-email"
              >
                {generatingEmail ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Email</>}
              </Button>
              {strategicContext?.available && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="strategic-context-indicator">
                  <Badge variant="secondary" className="text-[10px] gap-1">
                    <Sparkles className="w-3 h-3" />
                    Intelligence-enriched
                  </Badge>
                  <span className="hidden sm:inline">
                    {[
                      strategicContext.sections.messagingFramework && "messaging",
                      strategicContext.sections.competitiveIntelligence && "competitive intel",
                      strategicContext.sections.gtmPlan && "GTM plan",
                      strategicContext.sections.recommendations && "recommendations",
                      strategicContext.sections.briefingActionItems && "briefing actions",
                    ].filter(Boolean).join(", ")}
                  </span>
                </div>
              )}
            </div>
            {selectedAssetIds.length === 0 && activeAssets.length > 0 && (
              <p className="text-xs text-muted-foreground">Select at least one content asset to generate an email.</p>
            )}
          </CardContent>
        </Card>

        {previewEmail && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Preview: {previewEmail.subject}</CardTitle>
                <Button size="sm" onClick={() => saveEmailMutation.mutate()} disabled={saveEmailMutation.isPending} data-testid="button-save-email">
                  Save Email
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewEmail.subjectLineSuggestions && previewEmail.subjectLineSuggestions.length > 0 && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Subject Line Suggestions</label>
                  <ol className="space-y-1">
                    {previewEmail.subjectLineSuggestions.map((line, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm border rounded px-3 py-2 bg-muted/30" data-testid={`text-subject-suggestion-${i}`}>
                        <span>{i + 1}. {line}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(line);
                            toast({ title: "Copied", description: "Subject line copied to clipboard" });
                          }}
                          data-testid={`button-copy-subject-${i}`}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="relative">
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 gap-1.5 text-xs shadow-sm"
                    onClick={() => {
                      const content = previewEmail.platform === "hubspot-marketing"
                        ? previewEmail.htmlBody
                        : (previewEmail.textBody || previewEmail.htmlBody);
                      navigator.clipboard.writeText(content);
                      toast({
                        title: "Copied",
                        description: previewEmail.platform === "hubspot-marketing"
                          ? "HTML copied to clipboard — paste into your email editor"
                          : "Email body copied to clipboard",
                      });
                    }}
                    data-testid="button-copy-email-body"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {previewEmail.platform === "hubspot-marketing" ? "Copy HTML" : "Copy Text"}
                  </Button>
                  {previewEmail.platform === "hubspot-marketing" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 gap-1.5 text-xs shadow-sm"
                      onClick={() => {
                        const wixHtml = buildWixHtml(previewEmail.htmlBody, previewEmail.subject);
                        const filename = `${previewEmail.subject.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "").toLowerCase()}-wix.html`;
                        downloadHtmlFile(wixHtml, filename);
                        toast({ title: "Wix Export downloaded", description: "Paste the HTML into a Wix HTML embed widget" });
                      }}
                      data-testid="button-wix-export-preview"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Wix Export
                    </Button>
                  )}
                </div>
                {previewEmail.platform === "hubspot-marketing" ? (
                  <div
                    className="border rounded bg-card text-card-foreground text-sm overflow-y-auto"
                    style={{ maxHeight: "600px" }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewEmail.htmlBody) }}
                    data-testid="preview-email-html"
                  />
                ) : (
                  <pre className="border rounded p-4 bg-card text-card-foreground text-sm max-h-96 overflow-y-auto whitespace-pre-wrap font-sans" data-testid="preview-email-text">
                    {previewEmail.textBody || previewEmail.htmlBody}
                  </pre>
                )}
              </div>

              {previewEmail.coachingTips && previewEmail.coachingTips.length > 0 && (
                <Collapsible open={coachingTipsOpen} onOpenChange={setCoachingTipsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2 w-full justify-start text-muted-foreground" data-testid="button-toggle-coaching-tips">
                      <Lightbulb className="w-4 h-4" />
                      Coaching Tips
                      <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${coachingTipsOpen ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground pl-6 list-disc">
                      {previewEmail.coachingTips.map((tip, i) => (
                        <li key={i} data-testid={`text-coaching-tip-${i}`}>{tip}</li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        )}

        {savedEmails.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Saved Emails</h2>
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36" data-testid="select-email-status-filter">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap" data-testid="label-pills-email">
              <button
                onClick={() => setLabelFilter("all")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${labelFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                data-testid="pill-label-all"
              >
                All <span className="bg-white/20 rounded-full px-1.5 text-[10px]">{savedEmails.length}</span>
              </button>
              {uniqueLabels.map(label => {
                const count = savedEmails.filter(e => e.label === label).length;
                return (
                  <button
                    key={label}
                    onClick={() => setLabelFilter(labelFilter === label ? "all" : label)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${labelFilter === label ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    data-testid={`pill-label-${label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {label} <span className={`rounded-full px-1.5 text-[10px] ${labelFilter === label ? "bg-white/20" : "bg-primary/20 text-primary"}`}>{count}</span>
                  </button>
                );
              })}
              {savedEmails.some(e => !e.label) && uniqueLabels.length > 0 && (
                <button
                  onClick={() => setLabelFilter(labelFilter === "__unlabeled" ? "all" : "__unlabeled")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${labelFilter === "__unlabeled" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  data-testid="pill-label-unlabeled"
                >
                  Unlabeled <span className={`rounded-full px-1.5 text-[10px] ${labelFilter === "__unlabeled" ? "bg-white/20" : "bg-primary/20 text-primary"}`}>{savedEmails.filter(e => !e.label).length}</span>
                </button>
              )}
            </div>

            {filteredEmails.map(email => (
              <Card key={email.id} className={`cursor-pointer hover:bg-muted/30 transition-colors${focusId === email.id ? " ring-2 ring-primary ring-offset-2" : ""}`} onClick={() => setViewingEmail(email)} data-testid={`card-email-${email.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{email.subject}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {email.platform && (
                          <Badge variant="secondary" className="text-[10px]">
                            {PLATFORM_LABELS[email.platform] || email.platform}
                          </Badge>
                        )}
                        {email.tone && (
                          <Badge variant="outline" className="text-[10px] capitalize">{email.tone}</Badge>
                        )}
                        {email.label && (
                          <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">{email.label}</Badge>
                        )}
                        {Array.isArray(email.sourceAssetIds) && email.sourceAssetIds.length > 0 && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1" data-testid={`badge-source-assets-${email.id}`}>
                            <span>Based on {email.sourceAssetIds.length} asset{email.sourceAssetIds.length !== 1 ? "s" : ""}</span>
                          </Badge>
                        )}
                        {email.status === "sent" && email.sentAt && (
                          <Badge variant="outline" className="text-[10px] text-green-700 border-green-400 bg-green-50 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700 gap-1" data-testid={`badge-sent-${email.id}`}>
                            <CheckCircle className="w-2.5 h-2.5" />
                            Sent {format(new Date(email.sentAt), "MMM d, yyyy")}
                          </Badge>
                        )}
                        {email.hubspotEmailUrl && (
                          <a
                            href={email.hubspotEmailUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] text-primary underline underline-offset-2 hover:text-primary/80"
                            data-testid={`link-hubspot-email-${email.id}`}
                          >
                            View in HubSpot ↗
                          </a>
                        )}
                        {email.hubspotEmailId && (
                          <HubspotStatsPanel emailId={email.id} />
                        )}
                        {email.scheduledAt && email.status !== "sent" && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700 gap-1" data-testid={`badge-scheduled-${email.id}`}>
                            <Calendar className="w-2.5 h-2.5" />
                            Scheduled for {format(new Date(email.scheduledAt), "MMM d, yyyy")}
                          </Badge>
                        )}
                        {email.abTestEnabled && (
                          <Badge variant="outline" className={`text-[10px] gap-1 ${email.abWinnerVariantLabel ? "text-green-700 border-green-400 bg-green-50" : "text-blue-700 border-blue-400 bg-blue-50"}`} data-testid={`badge-ab-test-${email.id}`}>
                            {email.abWinnerVariantLabel ? `A/B winner: ${email.abWinnerVariantLabel}` : "A/B test"}
                          </Badge>
                        )}
                        <p className="text-xs text-muted-foreground">{format(new Date(email.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                      </div>
                      {email.abTestEnabled && (
                        <AbTestResultsPanel emailId={email.id} winnerLabel={email.abWinnerVariantLabel} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="capitalize">{email.status}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Set label"
                        onClick={e => { e.stopPropagation(); setLabelDialogEmail(email); setLabelInput(email.label || ""); }}
                        data-testid={`button-label-email-${email.id}`}
                      >
                        <Tag className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={email.platform === "hubspot-marketing" ? "Copy HTML" : "Copy email body"}
                        onClick={async e => {
                          e.stopPropagation();
                          let content = email.platform === "hubspot-marketing"
                            ? email.htmlBody
                            : (email.textBody || email.htmlBody);
                          if (email.platform === "hubspot-marketing") {
                            const exported = await fetchSavedEmailExport(email.id);
                            if (!exported) {
                              toast({ title: "Export failed", description: "Could not build the HTML with sections — nothing was copied. Try again or reload the page.", variant: "destructive" });
                              return;
                            }
                            content = exported.hubspotFragment || exported.fragment;
                          }
                          navigator.clipboard.writeText(content);
                          toast({
                            title: "Copied",
                            description: email.platform === "hubspot-marketing"
                              ? "HTML (sections included) copied to clipboard"
                              : "Email body copied to clipboard",
                          });
                        }}
                        data-testid={`button-copy-email-${email.id}`}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      {email.platform === "hubspot-marketing" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Wix Export — download HTML for Wix embed"
                          onClick={async e => {
                            e.stopPropagation();
                            const exported = await fetchSavedEmailExport(email.id);
                            if (!exported) {
                              toast({ title: "Export failed", description: "Could not build the HTML with sections — no file was downloaded. Try again or reload the page.", variant: "destructive" });
                              return;
                            }
                            const body = exported.fragment;
                            const wixHtml = buildWixHtml(body, email.subject);
                            const filename = `${email.subject.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "").toLowerCase()}-wix.html`;
                            downloadHtmlFile(wixHtml, filename);
                            toast({ title: "Wix Export downloaded", description: "Paste the HTML into a Wix HTML embed widget" });
                          }}
                          data-testid={`button-wix-export-${email.id}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {directDeliveryFlagLoading ? (
                        <Skeleton className="h-8 w-8 rounded-md" />
                      ) : directDeliveryEnabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Send this email via SendGrid"
                          onClick={e => {
                            e.stopPropagation();
                            setSendDialogEmail(email);
                            setSendMode("test");
                            setSendListId("");
                            setSendTestRecipient("");
                          }}
                          data-testid={`button-send-email-${email.id}`}
                        >
                          <Send className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {email.status !== "sent" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Mark as sent via HubSpot or another tool"
                          onClick={e => {
                            e.stopPropagation();
                            setMarkSentDialogEmail(email);
                            setMarkSentDate(new Date().toISOString().slice(0, 16));
                          }}
                          data-testid={`button-mark-sent-email-${email.id}`}
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Reschedule email"
                        onClick={e => {
                          e.stopPropagation();
                          setRescheduleEmail(email);
                          setRescheduleDateTime("");
                        }}
                        data-testid={`button-reschedule-email-${email.id}`}
                      >
                        <CalendarClock className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Duplicate email"
                        onClick={e => { e.stopPropagation(); duplicateEmailMutation.mutate(email); }}
                        disabled={duplicateEmailMutation.isPending}
                        data-testid={`button-duplicate-email-${email.id}`}
                      >
                        <CopyPlus className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit email"
                        onClick={async e => {
                          e.stopPropagation();
                          setEditMode("visual");
                          setEditingEmail(email);
                          setEditSubject(email.subject);
                          setEditBody(email.platform === "hubspot-marketing" ? email.htmlBody : (email.textBody || email.htmlBody));
                          setEditFontFamily(email.fontFamily || "Arial");
                          setEditSourceAssetIds(Array.isArray(email.sourceAssetIds) ? email.sourceAssetIds : []);
                          setEditAssetSearch("");
                          // Load A/B test config
                          setAbEnabled(email.abTestEnabled ?? false);
                          setAbSplit(email.abTestSplit ?? 20);
                          setAbMetric((email.abWinnerMetric ?? "open_rate") as "open_rate" | "click_rate");
                          setAbEvalHours(email.abEvaluationHours ?? 24);
                          // Load B variant if exists
                          try {
                            const r = await fetch(`/api/generated-emails/${email.id}/variants`, { credentials: "include" });
                            if (r.ok) {
                              const variants: Array<{ variantLabel: string; subject: string; htmlBody: string }> = await r.json();
                              const b = variants.find(v => v.variantLabel === "B");
                              setBVariantSubject(b?.subject ?? "");
                              setBVariantBody(b?.htmlBody ?? "");
                            }
                          } catch { /* ignore */ }
                        }}
                        data-testid={`button-edit-email-${email.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        title="Delete email"
                        onClick={e => { e.stopPropagation(); setDeleteConfirmId(email.id); }}
                        data-testid={`button-delete-email-${email.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {emailsLoading && savedEmails.length === 0 && !previewEmail && (
          <EmailListSkeleton count={4} />
        )}

        {!emailsLoading && savedEmails.length === 0 && !previewEmail && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <Mail className="w-10 h-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium">No saved emails yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select content assets above, configure your settings, and generate an email to get started.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={!!editingEmail} onOpenChange={v => { if (!v) { setEditingEmail(null); setEditMode("visual"); } }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Email</DialogTitle>
              <DialogDescription>Modify the subject line and email body.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Subject</Label>
                <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} data-testid="input-edit-email-subject" />
              </div>
              {editingEmail?.platform === "hubspot-marketing" && (
                <div>
                  <Label>Body Font</Label>
                  <Select value={editFontFamily} onValueChange={setEditFontFamily}>
                    <SelectTrigger data-testid="select-edit-email-font">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {effectiveFontList.map(f => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                          {(f as any).isCustom && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">Brand</span>
                          )}
                          {(f as any).isBrandCustom && (
                            <span className="ml-1.5 text-[10px] text-primary font-normal">✓ Brand kit</span>
                          )}
                          {!(f as any).isBrandCustom && fontOptions?.brandBodyFont === f.value && (
                            <span className="ml-1.5 text-[10px] text-primary font-normal">✓ Brand kit default</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const sel = effectiveFontList.find(f => f.value === editFontFamily);
                    if (!sel && editFontFamily && editFontFamily !== "Arial") {
                      return (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-1" data-testid="text-hubspot-font-warning-edit-unrecognized">
                          Font &ldquo;{editFontFamily}&rdquo; isn&rsquo;t in the email-safe list — HubSpot and Outlook will fall back to Arial.
                        </p>
                      );
                    }
                    const needsLoad = (sel as any)?.isCustom || (sel as any)?.googleFont || (sel as any)?.isBrandCustom;
                    if (!needsLoad) return null;
                    const fallback = editFontFamily === "MetroNova" ? "Verdana" : "Arial";
                    return (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-1" data-testid="text-hubspot-font-warning-edit">
                        Custom and Google Fonts don't load in HubSpot or Outlook — recipients will see {fallback}.
                      </p>
                    );
                  })()}
                </div>
              )}
              <div>
                {editingEmail?.platform === "hubspot-marketing" ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Email Body</Label>
                      <div className="flex gap-1 text-xs">
                        <button
                          onClick={() => {
                            if (editMode === "visual" && editableRef.current) {
                              setEditBody(editableRef.current.innerHTML);
                            }
                            setEditMode("visual");
                          }}
                          className={`px-2.5 py-1 rounded border transition-colors ${editMode === "visual" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/80"}`}
                          data-testid="button-edit-mode-visual"
                        >Visual</button>
                        <button
                          onClick={() => {
                            if (editMode === "visual" && editableRef.current) {
                              setEditBody(editableRef.current.innerHTML);
                            }
                            setEditMode("source");
                          }}
                          className={`px-2.5 py-1 rounded border transition-colors ${editMode === "source" ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/80"}`}
                          data-testid="button-edit-mode-source"
                        >HTML</button>
                      </div>
                    </div>
                    {editMode === "visual" ? (
                      <div
                        ref={editableRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="border rounded bg-card text-sm overflow-y-auto focus:outline-none focus:ring-2 focus:ring-ring p-1"
                        style={{ minHeight: "300px", maxHeight: "55vh" }}
                        data-testid="visual-edit-email"
                      />
                    ) : (
                      <Textarea
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        rows={16}
                        className="font-mono text-xs"
                        data-testid="input-edit-email-body"
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {editMode === "visual"
                        ? "Click any text in the preview to edit it directly."
                        : "Edit the raw HTML. Switch to Visual to see the rendered result."}
                    </p>
                    {(() => {
                      const srcIds = editingEmail?.sourceAssetIds;
                      const assetsWithImages = contentAssets.filter(a =>
                        a.leadImageUrl && (!srcIds?.length || srcIds.includes(a.id))
                      );
                      const insertImageTag = (url: string, alt: string) => {
                        const tag = `<img src="${url}" alt="${alt.replace(/"/g, "&quot;")}" style="max-width:100%;display:block;margin:8px 0;" />`;
                        if (editMode === "visual") {
                          if (editableRef.current) {
                            editableRef.current.focus();
                            document.execCommand("insertHTML", false, tag);
                          }
                        } else {
                          setEditBody(prev => prev + "\n" + tag);
                        }
                      };
                      return (
                        <Collapsible data-testid="collapsible-insert-image">
                          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
                            <ImageIcon className="w-3.5 h-3.5" />
                            Insert Image from Assets
                            <ChevronDown className="w-3 h-3" />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <input
                              ref={imageUploadInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              data-testid="input-upload-image-file"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                e.target.value = "";
                                setIsUploadingImage(true);
                                try {
                                  const formData = new FormData();
                                  formData.append("file", file);
                                  const r = await fetch("/api/integrations/website/upload-media", {
                                    method: "POST",
                                    credentials: "include",
                                    body: formData,
                                  });
                                  const data = await r.json();
                                  if (!r.ok) throw new Error(data.error || "Upload failed");
                                  const uploaded = { url: data.url as string, name: file.name };
                                  setUploadedImages(prev => [uploaded, ...prev]);
                                  insertImageTag(uploaded.url, file.name.replace(/\.[^.]+$/, ""));
                                } catch (err) {
                                  toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload image.", variant: "destructive" });
                                } finally {
                                  setIsUploadingImage(false);
                                }
                              }}
                            />
                            <div className="flex items-center justify-between mt-2 mb-1">
                              <span className="text-xs text-muted-foreground">
                                {assetsWithImages.length + uploadedImages.length === 0 ? "No images yet" : `${assetsWithImages.length + uploadedImages.length} image${assetsWithImages.length + uploadedImages.length !== 1 ? "s" : ""}`}
                              </span>
                              <button
                                type="button"
                                disabled={isUploadingImage}
                                data-testid="button-upload-image"
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => imageUploadInputRef.current?.click()}
                              >
                                {isUploadingImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                {isUploadingImage ? "Uploading…" : "Upload image"}
                              </button>
                            </div>
                            {assetsWithImages.length === 0 && uploadedImages.length === 0 ? (
                              <p className="text-xs text-muted-foreground border rounded p-3 bg-muted/30" data-testid="text-no-asset-images">
                                None of the assets used to generate this email have images attached. Upload one above.
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 gap-2" data-testid="grid-asset-images">
                                {uploadedImages.map((img, idx) => (
                                  <button
                                    key={`uploaded-${idx}`}
                                    type="button"
                                    title={img.name}
                                    className="border rounded overflow-hidden bg-muted/30 hover:ring-2 hover:ring-primary transition-all text-left relative"
                                    data-testid={`button-insert-uploaded-image-${idx}`}
                                    onClick={() => insertImageTag(img.url, img.name.replace(/\.[^.]+$/, ""))}
                                  >
                                    <img
                                      src={img.url}
                                      alt={img.name}
                                      className="w-full h-20 object-cover"
                                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                    <p className="text-[10px] text-muted-foreground px-1.5 py-1 truncate">{img.name}</p>
                                    <span className="absolute top-1 right-1 text-[9px] bg-primary text-primary-foreground rounded px-1 leading-4">Uploaded</span>
                                  </button>
                                ))}
                                {assetsWithImages.map(asset => (
                                  <button
                                    key={asset.id}
                                    type="button"
                                    title={asset.title}
                                    className="border rounded overflow-hidden bg-muted/30 hover:ring-2 hover:ring-primary transition-all text-left"
                                    data-testid={`button-insert-image-${asset.id}`}
                                    onClick={() => insertImageTag(asset.leadImageUrl!, asset.title)}
                                  >
                                    <img
                                      src={asset.leadImageUrl}
                                      alt={asset.title}
                                      className="w-full h-20 object-cover"
                                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                    <p className="text-[10px] text-muted-foreground px-1.5 py-1 truncate">{asset.title}</p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })()}
                  </div>
                ) : (
                  <div>
                    <Label>Email Body</Label>
                    <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={12} className="font-mono text-xs" data-testid="input-edit-email-body" />
                  </div>
                )}
              </div>
              {/* Source Asset Picker */}
              <div className="space-y-2">
                <Label>Source Assets</Label>
                <p className="text-xs text-muted-foreground">Link the content assets that informed this email. Used for image insertion and context tracking.</p>
                {editSourceAssetIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" data-testid="linked-source-assets">
                    {editSourceAssetIds.map(id => {
                      const asset = contentAssets.find(a => a.id === id);
                      if (!asset) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2.5 py-0.5 border"
                          data-testid={`badge-linked-asset-${id}`}
                        >
                          {asset.title}
                          <button
                            type="button"
                            aria-label={`Remove ${asset.title}`}
                            data-testid={`button-remove-linked-asset-${id}`}
                            onClick={() => setEditSourceAssetIds(prev => prev.filter(x => x !== id))}
                            className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <Collapsible data-testid="collapsible-add-source-assets">
                  <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Add or change linked assets
                    <ChevronDown className="w-3 h-3" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-1.5">
                      <Input
                        placeholder="Search assets…"
                        value={editAssetSearch}
                        onChange={e => setEditAssetSearch(e.target.value)}
                        className="h-7 text-xs"
                        data-testid="input-edit-asset-search"
                      />
                      <div className="max-h-44 overflow-y-auto border rounded space-y-0.5 p-1 bg-background" data-testid="list-edit-source-assets">
                        {activeAssets
                          .filter(a => !editAssetSearch || a.title.toLowerCase().includes(editAssetSearch.toLowerCase()))
                          .map(asset => {
                            const linked = editSourceAssetIds.includes(asset.id);
                            return (
                              <button
                                key={asset.id}
                                type="button"
                                data-testid={`button-toggle-source-asset-${asset.id}`}
                                onClick={() => setEditSourceAssetIds(prev =>
                                  linked ? prev.filter(x => x !== asset.id) : [...prev, asset.id]
                                )}
                                className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-2 transition-colors ${linked ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}
                              >
                                <span className={`w-3.5 h-3.5 flex-shrink-0 border rounded-sm flex items-center justify-center ${linked ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                                  {linked && <span className="text-[9px] leading-none">✓</span>}
                                </span>
                                <span className="truncate">{asset.title}</span>
                              </button>
                            );
                          })}
                        {activeAssets.filter(a => !editAssetSearch || a.title.toLowerCase().includes(editAssetSearch.toLowerCase())).length === 0 && (
                          <p className="text-xs text-muted-foreground p-2 text-center" data-testid="text-no-assets-found">No assets found</p>
                        )}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <Button
                className="w-full"
                disabled={!editSubject.trim() || updateEmailMutation.isPending}
                onClick={() => {
                  if (editingEmail) {
                    let bodyToSave = editBody;
                    if (editingEmail.platform === "hubspot-marketing" && editMode === "visual" && editableRef.current) {
                      bodyToSave = editableRef.current.innerHTML;
                    }
                    updateEmailMutation.mutate({
                      emailId: editingEmail.id,
                      subject: editSubject,
                      body: bodyToSave,
                      isHtml: editingEmail.platform === "hubspot-marketing",
                      sourceAssetIds: editSourceAssetIds,
                      fontFamily: editFontFamily || null,
                    });
                  }
                }}
                data-testid="button-save-edit-email"
              >
                {updateEmailMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>

              {editingEmail?.platform === "hubspot-marketing" && (
                <EmailSectionsPanel
                  email={editingEmail}
                  onSaved={(updated) => {
                    setEditingEmail(updated);
                    queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
                  }}
                />
              )}

              {/* ── A/B Test configuration ─────────────────────────────── */}
              <div className="border-t pt-4 space-y-3" data-testid="ab-test-section">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">A/B Subject Test</p>
                    <p className="text-xs text-muted-foreground">Test two subject lines and auto-send the winner to the holdback cohort.</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={abEnabled}
                      onChange={e => setAbEnabled(e.target.checked)}
                      className="rounded"
                      data-testid="checkbox-ab-enabled"
                    />
                    <span className="text-xs">Enable</span>
                  </label>
                </div>

                {abEnabled && (
                  <div className="space-y-3 bg-muted/30 rounded p-3">
                    <div>
                      <Label className="text-xs">Variant B — subject line</Label>
                      <Input
                        value={bVariantSubject}
                        onChange={e => setBVariantSubject(e.target.value)}
                        placeholder="Alternative subject line…"
                        className="mt-1 text-sm"
                        data-testid="input-b-variant-subject"
                      />
                      <TokenPicker onInsert={token => setBVariantSubject(prev => prev + token)} />
                    </div>
                    <div>
                      <Label className="text-xs">Variant B — body (optional, leave blank to only test subject)</Label>
                      <Textarea
                        value={bVariantBody}
                        onChange={e => setBVariantBody(e.target.value)}
                        placeholder="Leave blank to keep the same body as variant A…"
                        rows={4}
                        className="mt-1 text-xs font-mono"
                        data-testid="input-b-variant-body"
                      />
                      <TokenPicker onInsert={token => setBVariantBody(prev => prev + token)} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Split % each</Label>
                        <Input
                          type="number"
                          min={5}
                          max={49}
                          value={abSplit}
                          onChange={e => setAbSplit(Number(e.target.value))}
                          className="mt-1 text-sm"
                          data-testid="input-ab-split"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">{100 - abSplit * 2}% holdback</p>
                      </div>
                      <div>
                        <Label className="text-xs">Winner metric</Label>
                        <select
                          value={abMetric}
                          onChange={e => setAbMetric(e.target.value as "open_rate" | "click_rate")}
                          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                          data-testid="select-ab-metric"
                        >
                          <option value="open_rate">Open rate</option>
                          <option value="click_rate">Click rate</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">Evaluate after (h)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={168}
                          value={abEvalHours}
                          onChange={e => setAbEvalHours(Number(e.target.value))}
                          className="mt-1 text-sm"
                          data-testid="input-ab-eval-hours"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={abSaving || !bVariantSubject.trim()}
                      data-testid="button-save-ab-config"
                      onClick={async () => {
                        if (!editingEmail) return;
                        setAbSaving(true);
                        try {
                          // Save B variant
                          await fetch(`/api/generated-emails/${editingEmail.id}/variants/B`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ subject: bVariantSubject, htmlBody: bVariantBody }),
                          });
                          // Save A/B config
                          await fetch(`/api/generated-emails/${editingEmail.id}/ab-config`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ abTestEnabled: true, abTestSplit: abSplit, abWinnerMetric: abMetric, abEvaluationHours: abEvalHours }),
                          });
                          queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
                          toast({ title: "A/B test saved", description: "Variant B and test config saved." });
                        } catch (err: any) {
                          toast({ title: "Error", description: err.message, variant: "destructive" });
                        } finally {
                          setAbSaving(false);
                        }
                      }}
                    >
                      {abSaving ? "Saving…" : "Save A/B test config"}
                    </Button>
                    {abEnabled && (
                      <p className="text-[10px] text-muted-foreground">
                        Variant A gets the original subject above. Variant B gets the subject set here. Each cohort receives {abSplit}% of your list. The remaining {100 - abSplit * 2}% is held back and sent the winner after {abEvalHours}h based on {abMetric === "open_rate" ? "open rate" : "click rate"}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Mark as Sent (via HubSpot or external tool) ── */}
        <Dialog open={!!markSentDialogEmail} onOpenChange={v => { if (!v) { setMarkSentDialogEmail(null); setMarkSentDate(""); } }}>
          <DialogContent className="sm:max-w-[400px]" data-testid="dialog-mark-sent-email">
            <DialogHeader>
              <DialogTitle>Mark as Sent</DialogTitle>
              <DialogDescription>
                Flag this email as sent via HubSpot or another tool so it moves out of drafts and into your campaign history.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="mark-sent-date">Date sent</Label>
                <Input
                  id="mark-sent-date"
                  type="datetime-local"
                  value={markSentDate}
                  onChange={e => setMarkSentDate(e.target.value)}
                  data-testid="input-mark-sent-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mark-sent-hubspot-url">HubSpot email link <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="mark-sent-hubspot-url"
                  type="url"
                  placeholder="Paste the HubSpot email URL for one-click access to its report"
                  value={markSentHubspotUrl}
                  onChange={e => setMarkSentHubspotUrl(e.target.value)}
                  data-testid="input-mark-sent-hubspot-url"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This records the email as sent in Orbit. It does not trigger a delivery — use this after sending through HubSpot or another platform.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => { setMarkSentDialogEmail(null); setMarkSentDate(""); setMarkSentHubspotUrl(""); }} data-testid="button-cancel-mark-sent">
                Cancel
              </Button>
              <Button
                disabled={markSentMutation.isPending}
                onClick={() => {
                  if (markSentDialogEmail) {
                    markSentMutation.mutate({
                      emailId: markSentDialogEmail.id,
                      sentAt: markSentDate ? new Date(markSentDate).toISOString() : undefined,
                      hubspotEmailUrl: markSentHubspotUrl.trim() || undefined,
                    });
                  }
                }}
                data-testid="button-confirm-mark-sent"
              >
                {markSentMutation.isPending ? "Saving..." : "Mark as Sent"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!rescheduleEmail} onOpenChange={v => { if (!v) { setRescheduleEmail(null); setRescheduleDateTime(""); } }}>
          <DialogContent className="sm:max-w-[420px]" data-testid="dialog-reschedule-email">
            <DialogHeader>
              <DialogTitle>Reschedule Email</DialogTitle>
              <DialogDescription>
                Pick a new send date and time. A new draft will be created with the same content and source assets — the original email is unchanged.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-datetime">Send date &amp; time</Label>
                <Input
                  id="reschedule-datetime"
                  type="datetime-local"
                  value={rescheduleDateTime}
                  onChange={e => setRescheduleDateTime(e.target.value)}
                  data-testid="input-reschedule-datetime"
                />
              </div>
              {rescheduleEmail?.scheduledAt && (
                <p className="text-xs text-muted-foreground">
                  Currently scheduled for{" "}
                  <span className="font-medium text-foreground">
                    {format(new Date(rescheduleEmail.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-center justify-between mt-2">
              {rescheduleEmail?.scheduledAt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={clearScheduledDateMutation.isPending}
                  onClick={() => {
                    if (rescheduleEmail) clearScheduledDateMutation.mutate(rescheduleEmail.id);
                  }}
                  data-testid="button-clear-scheduled-date"
                >
                  {clearScheduledDateMutation.isPending ? "Clearing..." : "Clear scheduled date"}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setRescheduleEmail(null); setRescheduleDateTime(""); }}
                  data-testid="button-cancel-reschedule-email"
                >
                  Cancel
                </Button>
                <Button
                  disabled={!rescheduleDateTime || rescheduleEmailMutation.isPending}
                  onClick={() => {
                    if (rescheduleEmail && rescheduleDateTime) {
                      rescheduleEmailMutation.mutate({ email: rescheduleEmail, scheduledAt: new Date(rescheduleDateTime).toISOString() });
                    }
                  }}
                  data-testid="button-confirm-reschedule-email"
                >
                  {rescheduleEmailMutation.isPending ? "Scheduling..." : "Create scheduled draft"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteConfirmId} onOpenChange={v => { if (!v) setDeleteConfirmId(null); }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Delete Email</DialogTitle>
              <DialogDescription>Are you sure you want to delete this saved email? This cannot be undone.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)} data-testid="button-cancel-delete-email">Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => { if (deleteConfirmId) deleteEmailMutation.mutate(deleteConfirmId); }}
                disabled={deleteEmailMutation.isPending}
                data-testid="button-confirm-delete-email"
              >
                {deleteEmailMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!sendDialogEmail} onOpenChange={v => { if (!v) setSendDialogEmail(null); }}>
          <DialogContent className="sm:max-w-[480px]" data-testid="dialog-send-email">
            <DialogHeader>
              <DialogTitle>Send email</DialogTitle>
              <DialogDescription>Deliver this email to a recipient list or send a test message. Suppressions and unsubscribes are honored automatically.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={sendMode === "test" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setSendMode("test")}
                  data-testid="button-send-mode-test"
                >Test send</Button>
                <Button
                  variant={sendMode === "list" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setSendMode("list")}
                  data-testid="button-send-mode-list"
                >Recipient list</Button>
                <Button
                  variant={sendMode === "segment" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setSendMode("segment")}
                  data-testid="button-send-mode-segment"
                >Segment</Button>
                {hubspotConnected && (
                  <Button
                    variant={sendMode === "hubspot" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setSendMode("hubspot")}
                    data-testid="button-send-mode-hubspot"
                  >HubSpot list</Button>
                )}
              </div>
              {sendMode === "test" ? (
                <div>
                  <Label>Test recipient email</Label>
                  <Input
                    value={sendTestRecipient}
                    onChange={e => setSendTestRecipient(e.target.value)}
                    placeholder="you@example.com"
                    data-testid="input-test-recipient"
                  />
                  <p className="text-xs text-muted-foreground mt-1">A single test message will be sent and recorded under Sends.</p>
                </div>
              ) : sendMode === "hubspot" ? (
                <div>
                  <Label>HubSpot contact list</Label>
                  {hubspotListsLoading ? (
                    <p className="text-xs text-muted-foreground mt-2">Loading HubSpot lists…</p>
                  ) : hubspotAudienceLists.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-2">No contact lists found in the connected HubSpot account.</p>
                  ) : (
                    <Select value={sendHubspotListId} onValueChange={setSendHubspotListId}>
                      <SelectTrigger data-testid="select-hubspot-list">
                        <SelectValue placeholder="Choose a HubSpot list..." />
                      </SelectTrigger>
                      <SelectContent>
                        {hubspotAudienceLists.map(l => (
                          <SelectItem key={l.listId} value={l.listId}>
                            {l.name} ({l.memberCount} in HubSpot)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {(() => {
                    const sel = hubspotAudienceLists.find(l => l.listId === sendHubspotListId);
                    if (!sel) return null;
                    const seg = sel.linkedSegment;
                    if (!seg) {
                      return (
                        <p className="text-xs text-muted-foreground mt-1" data-testid="text-hubspot-list-not-imported">
                          Not imported yet — contacts will be imported from HubSpot when you send. Suppressions, opt-outs, and subscription preferences still apply.
                        </p>
                      );
                    }
                    const syncing = seg.syncStatus === "pending" || seg.syncStatus === "syncing";
                    return (
                      <div className="text-xs text-muted-foreground mt-1 space-y-1" data-testid="text-hubspot-list-status">
                        <p>
                          {syncing
                            ? "Importing contacts from HubSpot…"
                            : seg.syncStatus === "error"
                              ? `Last sync failed: ${seg.syncError ?? "unknown error"}`
                              : `${seg.memberCount} contacts imported${seg.lastSyncedAt ? ` · last synced ${new Date(seg.lastSyncedAt).toLocaleString()}` : ""}`}
                        </p>
                        <p>Membership is refreshed from HubSpot automatically before each send.</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={syncing || resyncHubspotSegmentMutation.isPending}
                          onClick={() => resyncHubspotSegmentMutation.mutate(seg.id)}
                          data-testid="button-resync-hubspot-list"
                        >
                          {syncing ? "Syncing…" : "Re-sync now"}
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              ) : sendMode === "segment" ? (
                <div>
                  <Label>Segment</Label>
                  {marketingSegments.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-2">No segments yet. Create one in Marketing → Segments.</p>
                  ) : (
                    <Select value={sendSegmentId} onValueChange={setSendSegmentId}>
                      <SelectTrigger data-testid="select-segment">
                        <SelectValue placeholder="Choose a segment..." />
                      </SelectTrigger>
                      <SelectContent>
                        {marketingSegments.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.memberCount} contacts)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {sendSegmentId && marketingSegments.find(s => s.id === sendSegmentId)?.memberCount === 0 && (
                    <p className="text-xs text-amber-600 mt-1">This segment has no members — the send will have zero recipients.</p>
                  )}
                </div>
              ) : (
                <div>
                  <Label>Recipient list</Label>
                  {recipientLists.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-2">No recipient lists yet. Create one in Sends → Recipient Lists.</p>
                  ) : (
                    <Select value={sendListId} onValueChange={setSendListId}>
                      <SelectTrigger data-testid="select-recipient-list">
                        <SelectValue placeholder="Choose a list..." />
                      </SelectTrigger>
                      <SelectContent>
                        {recipientLists.map(l => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name} ({l.recipientCount})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {(sendMode === "list" || sendMode === "segment" || sendMode === "hubspot") && (
                <>
                  <div>
                    <Label htmlFor="send-schedule-at">Schedule for later (optional)</Label>
                    <Input
                      id="send-schedule-at"
                      type="datetime-local"
                      value={sendScheduleAt}
                      onChange={e => setSendScheduleAt(e.target.value)}
                      data-testid="input-schedule-at"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Leave blank to send immediately. Scheduled sends queue up and dispatch automatically.</p>
                  </div>
                  <ProspectCheckBanner listId={sendListId} />
                  <SendDeliverabilityPreview listId={sendListId} />
                  {senderIdentities.length > 0 && (
                    <div className="space-y-2 pt-1 border-t">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">From address</Label>
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        value={sendSenderIdentityId}
                        onChange={e => setSendSenderIdentityId(e.target.value)}
                        data-testid="select-sender-identity"
                      >
                        <option value="">— Use default SendGrid sender —</option>
                        {senderIdentities.map(si => (
                          <option key={si.id} value={si.id}>
                            {si.name} &lt;{si.email}&gt;{si.isDefault ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {subscriptionTypes.filter(t => !t.isTransactional).length > 0 && (
                    <div className="space-y-2 pt-1 border-t">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Subscription type</Label>
                      <p className="text-xs text-muted-foreground">Tag this send so recipients can opt out per category in the preference center.</p>
                      <div className="space-y-1.5">
                        {subscriptionTypes.filter(t => !t.isTransactional).map(t => (
                          <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sendSubscriptionTypeIds.includes(t.id)}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSendSubscriptionTypeIds(prev => [...prev, t.id]);
                                } else {
                                  setSendSubscriptionTypeIds(prev => prev.filter(id => id !== t.id));
                                }
                              }}
                              className="mt-0.5"
                            />
                            <span>{t.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-2 pt-1 border-t">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Suppression</Label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendExcludeActiveProspects}
                        onChange={e => setSendExcludeActiveProspects(e.target.checked)}
                        className="mt-0.5"
                        data-testid="checkbox-exclude-active-prospects"
                      />
                      <span>
                        <strong>Exclude active sales prospects</strong>
                        <span className="block text-xs text-muted-foreground">Recipients who are currently in a sales cadence (not yet replied or dormant) will be skipped to protect the sales conversation.</span>
                      </span>
                    </label>
                  </div>
                  <div className="space-y-2 pt-1 border-t">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Tracking</Label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendTrackOpens}
                        onChange={e => setSendTrackOpens(e.target.checked)}
                        className="mt-0.5"
                        data-testid="checkbox-track-opens"
                      />
                      <span>
                        <strong>Track opens</strong> via 1×1 pixel
                        <span className="block text-xs text-muted-foreground">Disable for privacy-sensitive sends. The pixel will not be embedded.</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendTrackClicks}
                        onChange={e => setSendTrackClicks(e.target.checked)}
                        className="mt-0.5"
                        data-testid="checkbox-track-clicks"
                      />
                      <span>
                        <strong>Track link clicks</strong>
                        <span className="block text-xs text-muted-foreground">Wraps outbound links so click attribution shows up in Sends analytics.</span>
                      </span>
                    </label>
                  </div>
                </>
              )}
              {(sendMode === "list" || sendMode === "segment" || sendMode === "hubspot") && !hasMailingAddress && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 space-y-1" data-testid="banner-missing-mailing-address">
                  <div className="font-semibold flex items-center gap-1.5">
                    <span>⛔</span>
                    <span>Mailing address required (CAN-SPAM)</span>
                  </div>
                  <p className="text-red-700">
                    Commercial email sends must include a physical mailing address.{" "}
                    <a
                      href="/app/settings/branding"
                      className="underline font-medium hover:text-red-900"
                      onClick={() => setSendDialogEmail(null)}
                    >
                      Add one in Settings → Branding
                    </a>
                    . Test sends are still allowed.
                  </p>
                </div>
              )}
              {sendDialogEmail && sendDialogEmail.status !== "approved" && sendDialogEmail.status !== "sent" && (sendMode === "list" || sendMode === "segment" || sendMode === "hubspot") && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="text-approval-warning">
                  This email is in <strong>{sendDialogEmail.status}</strong> status. Approve it before sending. Test sends are still allowed.
                </div>
              )}
              {(() => {
                const fv = sendDialogEmail?.fontFamily;
                if (!fv) return null;
                const sel = effectiveFontList.find(f => f.value === fv);
                // Unsafe = custom @font-face, Google @import, brand-custom, or unrecognized
                const isUnsafe = !sel || (sel as any).isCustom || (sel as any).googleFont || (sel as any).isBrandCustom;
                if (!isUnsafe) return null;
                const fallback = fv === "MetroNova" ? "Verdana" : "Arial";
                const label = sel ? (sel.label ?? fv) : fv;
                let reason: string;
                if (!sel) {
                  reason = `"${label}" isn't in the email-safe list — HubSpot and Outlook will fall back to ${fallback}`;
                } else if ((sel as any).isCustom) {
                  reason = `${label} uses @font-face rules that Outlook strips and HubSpot's paste editor removes — recipients will see ${fallback}`;
                } else if ((sel as any).googleFont) {
                  reason = `${label} is a Google Font loaded via @import, which Outlook and HubSpot's paste editor don't support — recipients will see ${fallback}`;
                } else {
                  // isBrandCustom: unrecognized brand font
                  reason = `"${label}" isn't in the email-safe list — HubSpot and Outlook will fall back to ${fallback}`;
                }
                return (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700" data-testid="text-send-font-warning">
                    ⚠ {reason}. Change the font in the email editor if needed.
                  </div>
                );
              })()}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSendDialogEmail(null)} data-testid="button-cancel-send">Cancel</Button>
                <Button
                  disabled={
                    sendEmailMutation.isPending ||
                    ((sendMode === "list" || sendMode === "segment" || sendMode === "hubspot") && !hasMailingAddress) ||
                    importHubspotListMutation.isPending ||
                    (sendMode === "test" ? !sendTestRecipient.includes("@") :
                     sendMode === "segment" ? !sendSegmentId :
                     sendMode === "hubspot" ? !sendHubspotListId :
                     !sendListId)
                  }
                  onClick={async () => {
                    if (!sendDialogEmail) return;
                    const isBulk = sendMode === "list" || sendMode === "segment" || sendMode === "hubspot";
                    const scheduledAt = isBulk && sendScheduleAt
                      ? new Date(sendScheduleAt).toISOString()
                      : undefined;
                    // HubSpot mode targets the linked segment; import the list
                    // first if it hasn't been linked yet. Membership is also
                    // refreshed from HubSpot automatically at delivery time.
                    let hubspotSegmentId: string | undefined;
                    if (sendMode === "hubspot") {
                      const sel = hubspotAudienceLists.find(l => l.listId === sendHubspotListId);
                      if (sel?.linkedSegment) {
                        hubspotSegmentId = sel.linkedSegment.id;
                      } else {
                        try {
                          const imported = await importHubspotListMutation.mutateAsync(sendHubspotListId);
                          hubspotSegmentId = imported.segment.id;
                        } catch {
                          return; // toast already shown by the mutation
                        }
                      }
                    }
                    sendEmailMutation.mutate({
                      emailId: sendDialogEmail.id,
                      listId: sendMode === "list" ? sendListId : undefined,
                      segmentId: sendMode === "segment" ? sendSegmentId : sendMode === "hubspot" ? hubspotSegmentId : undefined,
                      testRecipient: sendMode === "test" ? sendTestRecipient.trim() : undefined,
                      scheduledAt,
                      trackOpens: isBulk ? sendTrackOpens : undefined,
                      trackClicks: isBulk ? sendTrackClicks : undefined,
                      excludeActiveProspects: isBulk ? sendExcludeActiveProspects : undefined,
                      senderIdentityId: sendSenderIdentityId || undefined,
                      subscriptionTypeIds: isBulk ? sendSubscriptionTypeIds : undefined,
                    });
                  }}
                  data-testid="button-confirm-send"
                >
                  {sendEmailMutation.isPending ? "Sending..." : "Send"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!labelDialogEmail} onOpenChange={v => { if (!v) setLabelDialogEmail(null); }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Set Label</DialogTitle>
              <DialogDescription>Group this email by topic, product, or campaign. Leave blank to remove the label.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                placeholder="e.g. Product Launch, Q2 Campaign..."
                data-testid="input-email-label"
              />
              {uniqueLabels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {uniqueLabels.map(l => (
                    <button
                      key={l}
                      onClick={() => setLabelInput(l)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${labelInput === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      data-testid={`button-existing-label-${l.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setLabelDialogEmail(null)}>Cancel</Button>
                <Button
                  onClick={() => { if (labelDialogEmail) setLabelMutation.mutate({ id: labelDialogEmail.id, label: labelInput.trim() }); }}
                  disabled={setLabelMutation.isPending}
                  data-testid="button-save-label"
                >
                  {setLabelMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!viewingEmail} onOpenChange={v => { if (!v) setViewingEmail(null); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <DialogTitle data-testid="text-view-email-subject">{viewingEmail?.subject}</DialogTitle>
                  <DialogDescription className="flex items-center gap-2 mt-1">
                    {viewingEmail?.platform && (
                      <Badge variant="secondary" className="text-[10px]">
                        {PLATFORM_LABELS[viewingEmail.platform] || viewingEmail.platform}
                      </Badge>
                    )}
                    {viewingEmail?.tone && (
                      <Badge variant="outline" className="text-[10px] capitalize">{viewingEmail.tone}</Badge>
                    )}
                    {viewingEmail?.label && (
                      <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">{viewingEmail.label}</Badge>
                    )}
                    {viewingEmail?.createdAt && (
                      <span className="text-xs">{format(new Date(viewingEmail.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                    )}
                  </DialogDescription>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={async () => {
                      if (!viewingEmail) return;
                      let content = viewingEmail.platform === "hubspot-marketing"
                        ? viewingEmail.htmlBody
                        : (viewingEmail.textBody || viewingEmail.htmlBody);
                      if (viewingEmail.platform === "hubspot-marketing") {
                        const exported = await fetchSavedEmailExport(viewingEmail.id);
                        if (!exported) {
                          toast({ title: "Export failed", description: "Could not build the HTML with sections — nothing was copied. Try again or reload the page.", variant: "destructive" });
                          return;
                        }
                        content = exported.hubspotFragment || exported.fragment;
                      }
                      navigator.clipboard.writeText(content);
                      toast({
                        title: "Copied",
                        description: viewingEmail.platform === "hubspot-marketing"
                          ? "HTML copied to clipboard"
                          : "Email body copied to clipboard",
                      });
                    }}
                    data-testid="button-copy-viewed-email"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {viewingEmail?.platform === "hubspot-marketing" ? "Copy HTML" : "Copy Text"}
                  </Button>
                  {viewingEmail?.platform === "hubspot-marketing" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={async () => {
                        if (!viewingEmail) return;
                        try {
                          const r = await fetch(`/api/email/saved/${viewingEmail.id}/export-html`, { credentials: "include" });
                          if (!r.ok) throw new Error("Export failed");
                          const { html, hubspotFragment } = await r.json();
                          await navigator.clipboard.writeText(hubspotFragment || html);
                          toast({ title: "Copied", description: "HubSpot-safe HTML (sections included, inline styles only) copied — paste into HubSpot's HTML module" });
                        } catch {
                          toast({ title: "Copy failed", description: "Could not build the responsive export", variant: "destructive" });
                        }
                      }}
                      data-testid="button-copy-responsive-html"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy for HubSpot (responsive)
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      if (!viewingEmail) return;
                      setEditMode("visual");
                      setEditingEmail(viewingEmail);
                      setEditSubject(viewingEmail.subject);
                      setEditBody(viewingEmail.platform === "hubspot-marketing" ? viewingEmail.htmlBody : (viewingEmail.textBody || viewingEmail.htmlBody));
                      setEditFontFamily(viewingEmail.fontFamily || "Arial");
                      setEditSourceAssetIds(Array.isArray(viewingEmail.sourceAssetIds) ? viewingEmail.sourceAssetIds : []);
                      setEditAssetSearch("");
                      setViewingEmail(null);
                    }}
                    data-testid="button-edit-from-view"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </Button>
                </div>
              </div>
            </DialogHeader>
            {viewingEmail && (
              <div className="mt-2 space-y-4">
                {viewingEmail.subjectLineSuggestions && viewingEmail.subjectLineSuggestions.length > 0 && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">Subject Line Suggestions</label>
                    <ol className="space-y-1">
                      {viewingEmail.subjectLineSuggestions.map((line, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 text-sm border rounded px-3 py-2 bg-muted/30" data-testid={`text-view-subject-suggestion-${i}`}>
                          <span>{i + 1}. {line}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 shrink-0"
                            onClick={() => {
                              navigator.clipboard.writeText(line);
                              toast({ title: "Copied", description: "Subject line copied to clipboard" });
                            }}
                            data-testid={`button-copy-view-subject-${i}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {(() => {
                  const linkedAssets = Array.isArray(viewingEmail.sourceAssetIds) && viewingEmail.sourceAssetIds.length > 0
                    ? contentAssets.filter(a => viewingEmail.sourceAssetIds!.includes(a.id))
                    : [];
                  if (linkedAssets.length === 0) return null;
                  return (
                    <div data-testid="section-generated-from">
                      <label className="text-sm font-medium mb-2 block">Generated from</label>
                      <div className="flex flex-col gap-2">
                        {linkedAssets.map(asset => (
                          <button
                            key={asset.id}
                            className="flex items-center gap-3 text-left border rounded px-3 py-2 bg-muted/30 hover:bg-muted/60 transition-colors w-full group"
                            onClick={() => {
                              setViewingEmail(null);
                              navigate(`/app/marketing/content-library?asset=${encodeURIComponent(asset.id)}`);
                            }}
                            data-testid={`button-source-asset-${asset.id}`}
                          >
                            {asset.leadImageUrl ? (
                              <img
                                src={asset.leadImageUrl}
                                alt=""
                                className="w-10 h-10 rounded object-cover shrink-0 border"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 border">
                                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate group-hover:text-primary transition-colors" data-testid={`text-source-asset-title-${asset.id}`}>{asset.title}</div>
                              {asset.description && (
                                <div className="text-xs text-muted-foreground truncate">{asset.description}</div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {viewingEmail.platform === "hubspot-marketing" ? (
                  <EmailPreviewFrame emailId={viewingEmail.id} fallbackHtml={`${viewingEmail.htmlBody}${viewingEmail.sectionsHtml || ""}`} />
                ) : (
                  <pre className="border rounded p-4 bg-card text-card-foreground text-sm overflow-y-auto whitespace-pre-wrap font-sans" style={{ maxHeight: "65vh" }} data-testid="view-email-text">
                    {viewingEmail.textBody || viewingEmail.htmlBody}
                  </pre>
                )}
                {viewingEmail.platform === "hubspot-marketing" && (
                  <EmailSectionsPanel
                    email={viewingEmail}
                    onSaved={(updated) => {
                      setViewingEmail(updated);
                      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
                    }}
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

/**
 * Structured sections editor: case study card, upcoming events, recent blog
 * updates. Selections are rendered server-side into deterministic responsive
 * HTML appended after the main message on send/export.
 */
function EmailSectionsPanel({ email, onSaved }: { email: SavedEmail; onSaved: (updated: SavedEmail) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(!email.sections);
  const [caseStudyAssetId, setCaseStudyAssetId] = useState<string>(email.sections?.caseStudyAssetId || "none");
  const [eventIds, setEventIds] = useState<string[]>(email.sections?.eventIds || []);
  const [blogIds, setBlogIds] = useState<string[]>(email.sections?.blogAssetIds || []);
  const [eventsCalendarUrl, setEventsCalendarUrl] = useState<string>(email.sections?.eventsCalendarUrl || "");
  const [blogIndexUrl, setBlogIndexUrl] = useState<string>((email.sections as any)?.blogIndexUrl || "");
  const [blogSectionTitle, setBlogSectionTitle] = useState<string>((email.sections as any)?.blogSectionTitle || "");
  const [blogIntro, setBlogIntro] = useState<string>((email.sections as any)?.blogIntro || "");
  // General information (rendered below the three content sections)
  const savedGI = email.sections?.generalInfo;
  const [giSignoff, setGiSignoff] = useState<string>(savedGI?.senderSignoff ?? "Best,");
  const [giName, setGiName] = useState<string>(savedGI?.senderName ?? "");
  const [giTitle, setGiTitle] = useState<string>(savedGI?.senderTitle ?? "");
  const [giAboutTitle, setGiAboutTitle] = useState<string>(savedGI?.aboutTitle ?? "");
  const [giAboutText, setGiAboutText] = useState<string>(savedGI?.aboutText ?? "");
  const [giAboutImage, setGiAboutImage] = useState<string>(savedGI?.aboutImageUrl ?? "");
  const [showGiImagePicker, setShowGiImagePicker] = useState(false);
  const seededRef = useRef(false);
  const giSeededRef = useRef(!!savedGI);

  // Re-hydrate the form only when a *different* email is opened — without
  // this, saved URLs looked "lost" because the initial useState values were
  // captured from a stale email object. Deliberately NOT keyed on updatedAt:
  // re-syncing on every server-side version bump would clobber in-progress
  // unsaved edits (our own save already reflects local state).
  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = email.id;
    if (lastSyncedRef.current === key) return;
    lastSyncedRef.current = key;
    const s: any = email.sections || {};
    setCaseStudyAssetId(s.caseStudyAssetId || "none");
    setEventIds(s.eventIds || []);
    setBlogIds(s.blogAssetIds || []);
    setEventsCalendarUrl(s.eventsCalendarUrl || "");
    setBlogIndexUrl(s.blogIndexUrl || "");
    setBlogSectionTitle(s.blogSectionTitle || "");
    setBlogIntro(s.blogIntro || "");
    const gi = s.generalInfo;
    if (gi) {
      setGiSignoff(gi.senderSignoff ?? "Best,");
      setGiName(gi.senderName ?? "");
      setGiTitle(gi.senderTitle ?? "");
      setGiAboutTitle(gi.aboutTitle ?? "");
      setGiAboutText(gi.aboutText ?? "");
      setGiAboutImage(gi.aboutImageUrl ?? "");
      giSeededRef.current = true;
    }
  }, [email.id, email.sections]);

  const { data: options } = useQuery<{
    events: Array<{ id: string; name: string; location?: string | null; website?: string | null; startDate?: string | null; endDate?: string | null }>;
    caseStudies: Array<{ id: string; title: string; url?: string | null; assetType: string; assetDate?: string | null; leadImageUrl?: string | null; aiSummary?: string | null }>;
    blogPosts: Array<{ id: string; title: string; url?: string | null; assetType: string; assetDate?: string | null; leadImageUrl?: string | null }>;
  }>({ queryKey: ["/api/email/section-options"], enabled: open });

  const { data: senderIdentities = [] } = useQuery<Array<{ id: string; name: string; email: string; isDefault: boolean }>>({
    queryKey: ["/api/email-sender-identities"],
    enabled: open,
  });

  // Brand assets for the About image picker
  const { data: giBA = [] } = useQuery<Array<{ id: string; name: string; fileUrl: string | null; url: string | null; fileType: string | null }>>({
    queryKey: ["/api/brand-assets", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open && showGiImagePicker,
  });
  const GI_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  const giImages = giBA.filter(ba => {
    const url = ba.fileUrl || ba.url || "";
    const ft = (ba.fileType ?? "").toLowerCase();
    const urlExt = (() => {
      const path = url.split("?")[0];
      const seg = path.split("/").find(s => /\.[a-z]{2,5}($|\/)/i.test(s)) ?? "";
      return seg.split(".").pop()?.toLowerCase() ?? "";
    })();
    return ft.startsWith("image/") || ft === "image" || GI_IMAGE_EXTS.has(ft) || GI_IMAGE_EXTS.has(urlExt);
  });

  // First-open defaults: pre-check all upcoming events + url-backed posts
  useEffect(() => {
    if (!options || seededRef.current || email.sections) return;
    seededRef.current = true;
    setEventIds(options.events.map(e => e.id));
    setBlogIds(options.blogPosts.map(p => p.id));
  }, [options, email.sections]);

  // Pre-populate general info from default sender identity when first opened
  useEffect(() => {
    if (giSeededRef.current || !senderIdentities.length || giName) return;
    const def = senderIdentities.find(s => s.isDefault) ?? senderIdentities[0];
    if (def) { setGiName(def.name); giSeededRef.current = true; }
  }, [senderIdentities, giName]);

  const buildGeneralInfo = () => {
    const hasAny = giSignoff.trim() || giName.trim() || giTitle.trim() || giAboutTitle.trim() || giAboutText.trim() || giAboutImage.trim();
    if (!hasAny) return null;
    return {
      senderSignoff: giSignoff.trim() || null,
      senderName: giName.trim() || null,
      senderTitle: giTitle.trim() || null,
      aboutTitle: giAboutTitle.trim() || null,
      aboutText: giAboutText.trim() || null,
      aboutImageUrl: giAboutImage.trim() || null,
    };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/email/saved/${email.id}/sections`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          caseStudyAssetId: caseStudyAssetId === "none" ? null : caseStudyAssetId,
          eventIds,
          blogAssetIds: blogIds,
          eventsCalendarUrl: eventsCalendarUrl.trim() || null,
          blogIndexUrl: blogIndexUrl.trim() || null,
          blogSectionTitle: blogSectionTitle.trim() || null,
          blogIntro: blogIntro.trim() || null,
          generalInfo: buildGeneralInfo(),
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json() as Promise<SavedEmail>;
    },
    onSuccess: (updated) => {
      toast({ title: "Sections saved", description: "The sections will be appended after the main message on send and export." });
      onSaved(updated);
    },
    onError: () => toast({ title: "Error", description: "Could not save sections", variant: "destructive" }),
  });

  const fmtEventDate = (s?: string | null, e?: string | null) => {
    if (!s) return "";
    const sd = new Date(s);
    const ed = e ? new Date(e) : null;
    if (!ed || ed.toDateString() === sd.toDateString()) return format(sd, "MMM d, yyyy");
    return `${format(sd, "MMM d")}–${format(ed, sd.getMonth() === ed.getMonth() ? "d, yyyy" : "MMM d, yyyy")}`;
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-md">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium" data-testid="button-toggle-sections">
        <span className="flex items-center gap-2">
          Email sections
          {email.sectionsHtml && <Badge variant="outline" className="text-[10px]">configured</Badge>}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-4">
        <p className="text-xs text-muted-foreground">
          Case study, upcoming events, and recent updates are rendered with a responsive layout
          and appended after the main message. General information (sign-off + About block)
          appears last, below the three content sections.
        </p>

        {/* ── 1. Case study ─────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">1 · Case study</Label>
          {options && (options.caseStudies ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground border rounded p-2">
              No case studies found in your digital asset library. Add one in{" "}
              <span className="font-medium">Marketing → Content Library</span> with type "Case Study".
            </p>
          ) : (
            <Select value={caseStudyAssetId} onValueChange={setCaseStudyAssetId}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-section-case-study">
                <SelectValue placeholder="No case study" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No case study</SelectItem>
                {(options?.caseStudies ?? []).map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title}{!a.url ? " (no URL)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* ── 2 & 3. Events + Blog posts ───────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">2 · Upcoming events</Label>
            <div className="max-h-44 overflow-y-auto space-y-1 border rounded p-2">
              {(options?.events ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No upcoming events found. Add them in{" "}
                  <span className="font-medium">Marketing → Events</span>, or connect your
                  website in <span className="font-medium">Settings → Integrations</span> to
                  pull events from the site calendar automatically.
                </p>
              )}
              {(options?.events ?? []).map((ev: any) => (
                <label key={ev.id} className="flex items-start gap-2 text-xs cursor-pointer" data-testid={`checkbox-section-event-${ev.id}`}>
                  <Checkbox
                    className="mt-0.5"
                    checked={eventIds.includes(ev.id)}
                    onCheckedChange={(c) => setEventIds(prev => c ? [...prev, ev.id] : prev.filter(x => x !== ev.id))}
                  />
                  <span>
                    <span className="font-medium">{ev.name}</span>
                    {ev.source === "website" && (
                      <span className="ml-1 text-[10px] text-muted-foreground/70 border rounded px-1">site</span>
                    )}
                    {ev.source === "library" && (
                      <span className="ml-1 text-[10px] text-muted-foreground/70 border rounded px-1">library</span>
                    )}
                    {" "}
                    <span className="text-muted-foreground">
                      {fmtEventDate(ev.startDate, ev.endDate)}{ev.location ? ` · ${ev.location}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Events Calendar URL (optional)"
              value={eventsCalendarUrl}
              onChange={(e) => setEventsCalendarUrl(e.target.value)}
              data-testid="input-events-calendar-url"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">3 · From Our Blog</Label>
            <div className="max-h-56 overflow-y-auto space-y-1 border rounded p-2">
              {options && (options.blogPosts ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No blog posts found. Register posts in{" "}
                  <span className="font-medium">Marketing → Content Library</span> with type "Blog Post".
                </p>
              )}
              {(options?.blogPosts ?? []).map(a => (
                <label key={a.id} className="flex items-start gap-2 text-xs cursor-pointer" data-testid={`checkbox-section-blog-${a.id}`}>
                  <Checkbox
                    className="mt-0.5"
                    checked={blogIds.includes(a.id)}
                    onCheckedChange={(c) => setBlogIds(prev => c ? [...prev, a.id] : prev.filter(x => x !== a.id))}
                  />
                  <span className="min-w-0 truncate">
                    {a.title}
                    {a.assetDate && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        · {format(new Date(a.assetDate), "MMM d, yyyy")}
                      </span>
                    )}
                    {!a.url && <span className="ml-1 text-[10px] text-muted-foreground/60">(no URL)</span>}
                  </span>
                </label>
              ))}
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Blog section title (default: From Our Blog)"
              value={blogSectionTitle}
              onChange={(e) => setBlogSectionTitle(e.target.value)}
              data-testid="input-blog-section-title"
            />
            <Textarea
              className="text-xs min-h-[48px]"
              placeholder="Short message about your blog and where to read more (optional)"
              value={blogIntro}
              onChange={(e) => setBlogIntro(e.target.value)}
              data-testid="input-blog-intro"
            />
            <Input
              className="h-7 text-xs"
              placeholder="Blog URL (adds a “Read more on our blog” link)"
              value={blogIndexUrl}
              onChange={(e) => setBlogIndexUrl(e.target.value)}
              data-testid="input-blog-index-url"
            />
            <p className="text-[11px] text-muted-foreground">
              Posts are listed newest-first by publish date. Only blog posts registered in the Content Library with a live URL appear here.
            </p>
          </div>
        </div>

        {/* ── 4. General information (sign-off + About) ────────────── */}
        <div className="space-y-3 border-t pt-3">
          <div>
            <Label className="text-xs font-semibold">4 · General information</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Rendered below the three sections above. Pre-filled from your default sender identity — edit as needed per email.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Greeting</Label>
              <Input className="h-7 text-xs" placeholder="Best," value={giSignoff} onChange={e => setGiSignoff(e.target.value)} data-testid="input-gi-signoff" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Sender name</Label>
              <Input className="h-7 text-xs" placeholder="Chris McNulty" value={giName} onChange={e => setGiName(e.target.value)} data-testid="input-gi-name" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Title / role</Label>
              <Input className="h-7 text-xs" placeholder="CTO, Synozur" value={giTitle} onChange={e => setGiTitle(e.target.value)} data-testid="input-gi-title" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">About section heading</Label>
              <Input className="h-7 text-xs" placeholder="About Synozur" value={giAboutTitle} onChange={e => setGiAboutTitle(e.target.value)} data-testid="input-gi-about-title" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">About image</Label>
              <div className="flex gap-1.5 items-center">
                {giAboutImage.trim() && (
                  <img
                    src={giAboutImage}
                    alt="Selected About image"
                    className="w-7 h-7 rounded border object-cover shrink-0"
                    onError={e => (e.currentTarget.style.display = "none")}
                    data-testid="img-gi-about-selected"
                  />
                )}
                <Input className="h-7 text-xs flex-1 min-w-0" placeholder="Paste image URL or pick below…" value={giAboutImage} onChange={e => setGiAboutImage(e.target.value)} data-testid="input-gi-about-image" />
                {giAboutImage.trim() && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 shrink-0 text-muted-foreground" title="Clear image" onClick={() => setGiAboutImage("")} data-testid="button-gi-about-image-clear">
                    <X className="w-3 h-3" />
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 shrink-0" title="Pick from Brand Assets" onClick={() => setShowGiImagePicker(v => !v)} data-testid="button-gi-about-image-picker">
                  <Library className="w-3 h-3" />
                </Button>
              </div>
              {showGiImagePicker && (
                <div className="border rounded p-2 space-y-1.5 bg-muted/30 mt-1">
                  {giImages.length === 0
                    ? <p className="text-xs text-muted-foreground">No images in Visual/Brand Assets.</p>
                    : <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                        {giImages.map(ba => {
                          const imgUrl = ba.fileUrl || ba.url || "";
                          const selected = giAboutImage.trim() === imgUrl;
                          return (
                            <button
                              key={ba.id}
                              type="button"
                              title={ba.name}
                              className={`relative rounded border overflow-hidden text-left bg-card transition-all hover:ring-2 hover:ring-primary/50 ${selected ? "ring-2 ring-primary border-primary" : ""}`}
                              onClick={() => setGiAboutImage(imgUrl)}
                              data-testid={`button-gi-about-image-${ba.id}`}
                            >
                              <div className="aspect-video bg-muted">
                                <img src={imgUrl} alt={ba.name} className="w-full h-full object-cover" loading="lazy" onError={e => (e.currentTarget.style.display = "none")} />
                              </div>
                              {selected && (
                                <span className="absolute top-1 right-1 rounded-full bg-primary text-primary-foreground p-0.5">
                                  <Check className="w-3 h-3" />
                                </span>
                              )}
                              <span className={`block px-1.5 py-1 text-[10px] truncate ${selected ? "text-primary font-medium" : "text-muted-foreground"}`}>{ba.name}</span>
                            </button>
                          );
                        })}
                      </div>
                  }
                  <div className="flex justify-end">
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowGiImagePicker(false)} data-testid="button-gi-about-image-done">Done</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">About description</Label>
            <Textarea className="text-xs min-h-[72px] resize-none" placeholder="Short company description that appears below the About heading…" value={giAboutText} onChange={e => setGiAboutText(e.target.value)} data-testid="input-gi-about-text" />
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-sections">
            {saveMutation.isPending ? "Saving..." : "Save sections"}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Inline token picker button strip for body/subject edit areas. */
function TokenPicker({ onInsert }: { onInsert: (token: string) => void }) {
  const tokens = [
    { token: "first_name", label: "First name" },
    { token: "last_name", label: "Last name" },
    { token: "company", label: "Company" },
    { token: "job_title", label: "Job title" },
  ];
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      <span className="text-xs text-muted-foreground self-center mr-1">Insert token:</span>
      {tokens.map(t => (
        <button
          key={t.token}
          type="button"
          onClick={() => onInsert(`{{${t.token}}}`)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-primary/50 text-primary hover:bg-primary/10 transition-colors"
          title={`Insert {{${t.token}}}`}
        >
          {`{{${t.token}}}`}
        </button>
      ))}
    </div>
  );
}

