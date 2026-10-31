import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId } from "@/lib/tabContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface EventOption {
  id: string;
  name: string;
  status: string;
}

interface SocialAccount {
  id: string;
  accountName: string;
  platform: string;
  status?: string;
}

interface ExportPreview {
  totalPosts: number;
  exportablePosts: number;
  automaticPosts: number;
  csvPosts: number;
  undatedOrPastPosts: number;
  draftPosts: number;
  claimedPosts: number;
  deliveredPosts: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: EventOption[];
}

type ExportFormat = "socialpilot" | "generic" | "hootsuite" | "sproutsocial";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Something went wrong. Please try again.";
}

export default function EventBulkExportDialog({ open, onOpenChange, events }: Props) {
  return open ? <EventBulkExportForm key={getTabMarketId()} open={open} onOpenChange={onOpenChange} events={events} /> : null;
}

function EventBulkExportForm({ open, onOpenChange, events }: Props) {
  const queryClient = useQueryClient();
  const marketId = getTabMarketId();
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>("socialpilot");
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);
  const [importConfirmed, setImportConfirmed] = useState(false);

  const activeEvents = useMemo(() => events.filter((event) => event.status === "active"), [events]);
  const selectionKey = `${selectedEventIds.slice().sort().join(",")}|${selectedAccountIds.slice().sort().join(",")}`;

  // A changed target set must never inherit a stale preview or delivery confirmation.
  useEffect(() => {
    setPreview(null);
    setDownloadedIds([]);
    setImportConfirmed(false);
  }, [selectionKey]);

  const accountsQuery = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts", marketId],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/social-accounts");
      const payload = await response.json();
      const accounts = Array.isArray(payload) ? payload : payload.accounts;
      if (!Array.isArray(accounts)) throw new Error("Social accounts response was not in the expected format.");
      return accounts.filter((account: SocialAccount) => account?.id && account?.accountName && account?.platform && (!account.status || account.status === "active"));
    },
    enabled: open,
    retry: false,
  });

  const postSelection = { conferenceIds: selectedEventIds, socialAccountIds: selectedAccountIds };
  const canRequest = selectedEventIds.length > 0 && selectedAccountIds.length > 0;

  const previewMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/conferences/export-preview", postSelection);
      return response.json() as Promise<ExportPreview>;
    },
    onSuccess: setPreview,
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/conferences/export-csv", {
        ...postSelection,
        format,
        tzOffset: new Date().getTimezoneOffset(),
      });
      const body = await response.blob();
      const headerIds = response.headers.get("X-Exported-Post-Ids") ?? "";
      const ids = headerIds.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) throw new Error("The export completed without any reserved post IDs. No file was downloaded; retry or contact support.");
      return { body, ids };
    },
    onSuccess: ({ body, ids }) => {
      setDownloadedIds(ids);
      setImportConfirmed(false);
      const url = URL.createObjectURL(body);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `events-${format}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      void queryClient.invalidateQueries({ queryKey: ["/api/generated-posts"] });
       void queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/conferences"] });
    },
  });

  const deliveryMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/conferences/mark-export-delivered", {
        ...postSelection,
        postIds: downloadedIds,
      });
      return response.json() as Promise<{ updated: number }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/generated-posts"] });
       void queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/conferences"] });
    },
  });

  const toggle = (values: string[], setValues: (next: string[]) => void, id: string, checked: boolean) => {
    setValues(checked ? [...values, id] : values.filter((value) => value !== id));
    previewMutation.reset();
    exportMutation.reset();
    deliveryMutation.reset();
  };

  const busy = previewMutation.isPending || exportMutation.isPending || deliveryMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Export event posts</DialogTitle>
          <DialogDescription>Build one CSV for the events and social accounts you choose. Exported posts are reserved for CSV delivery so the automatic publisher will not send duplicates.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">1. Choose active events</h3>
            {activeEvents.length === 0 ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">There are no active events to export.</div>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                {activeEvents.map((event) => (
                  <label key={event.id} className="flex items-center gap-3 p-3 text-sm cursor-pointer hover:bg-muted/30">
                    <Checkbox checked={selectedEventIds.includes(event.id)} disabled={busy} onCheckedChange={(checked) => toggle(selectedEventIds, setSelectedEventIds, event.id, checked === true)} />
                    <span className="min-w-0 truncate">{event.name}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">2. Choose destination accounts</h3>
            {accountsQuery.isPending ? (
              <div className="space-y-2" role="status" aria-label="Loading social accounts"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : accountsQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
                <p className="text-destructive">Could not load social accounts: {errorMessage(accountsQuery.error)}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void accountsQuery.refetch()}>Retry</Button>
              </div>
            ) : accountsQuery.data.length === 0 ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">No social accounts are connected. Connect an account before creating an export.</div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {accountsQuery.data.map((account) => (
                  <label key={account.id} className="flex items-center gap-3 p-3 text-sm cursor-pointer hover:bg-muted/30">
                    <Checkbox checked={selectedAccountIds.includes(account.id)} disabled={busy} onCheckedChange={(checked) => toggle(selectedAccountIds, setSelectedAccountIds, account.id, checked === true)} />
                    <span className="min-w-0 flex-1 truncate">{account.accountName}</span>
                    <span className="text-xs text-muted-foreground capitalize">{account.platform}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label htmlFor="event-export-format">CSV format</Label>
            <Select value={format} disabled={busy} onValueChange={(value) => {
              setFormat(value as ExportFormat);
              setPreview(null);
              setDownloadedIds([]);
              setImportConfirmed(false);
              previewMutation.reset();
              exportMutation.reset();
              deliveryMutation.reset();
            }}>
              <SelectTrigger id="event-export-format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="socialpilot">SocialPilot</SelectItem>
                <SelectItem value="generic">Generic CSV</SelectItem>
                <SelectItem value="hootsuite">Hootsuite</SelectItem>
                <SelectItem value="sproutsocial">Sprout Social</SelectItem>
              </SelectContent>
            </Select>
          </section>

          {!canRequest && <p className="text-xs text-muted-foreground">Select at least one event and one account. Nothing is preselected to avoid unintended delivery changes.</p>}
          {previewMutation.isError && <p role="alert" className="text-sm text-destructive">Could not preview the export: {errorMessage(previewMutation.error)}. Review your selection and try again.</p>}
          {previewMutation.isPending && <div className="space-y-2" role="status" aria-label="Loading export preview"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-20 w-full" /></div>}

          {preview && (
            <div className="space-y-3 rounded-md border p-4" aria-live="polite">
              <h3 className="font-medium">Export preview</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {([
                  ["Exportable", preview.exportablePosts],
                  ["Total posts", preview.totalPosts],
                   ["Not yet CSV-only", preview.automaticPosts],
                  ["CSV-only", preview.csvPosts],
                  ["Drafts", preview.draftPosts],
                  ["Undated or past", preview.undatedOrPastPosts],
                  ["Claimed", preview.claimedPosts],
                  ["Delivered", preview.deliveredPosts],
                ] as [string, number][]).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}
              </dl>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p>Selected approved future posts will be removed from automatic publishing and reserved for this CSV before it downloads. Drafts, past or undated, published/delivered, and rejected posts are excluded.</p>
              </div>
               {preview.claimedPosts > 0 && <p role="alert" className="text-sm text-destructive">A selected post is already being sent. Wait for it to finish, then refresh the preview before exporting.</p>}
            </div>
          )}

          {exportMutation.isError && <p role="alert" className="text-sm text-destructive">CSV export failed: {errorMessage(exportMutation.error)}. A failed request may still leave posts safely reserved; preview again before retrying.</p>}
          {downloadedIds.length > 0 && !deliveryMutation.data && (
            <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4" role="status">
              <p className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4" /> CSV downloaded; import pending</p>
              <p className="text-sm text-muted-foreground">Import the file into your selected scheduler first. Orbit has not contacted the scheduler. Confirm below only after the scheduler reports a successful import.</p>
              <div className="flex items-start gap-2">
                <Checkbox id="event-export-import-confirm" checked={importConfirmed} disabled={busy} onCheckedChange={(checked) => setImportConfirmed(checked === true)} />
                <Label htmlFor="event-export-import-confirm" className="text-sm leading-relaxed">I successfully imported this CSV into the selected scheduler.</Label>
              </div>
              {deliveryMutation.isError && <p role="alert" className="text-sm text-destructive">Could not record the import: {errorMessage(deliveryMutation.error)}. Your downloaded IDs are retained; retry after checking the scheduler.</p>}
            </div>
          )}
          {deliveryMutation.data && (
            <div className="rounded-md border p-4 text-sm" role="status">
               <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Import recorded</p>
              <p className="mt-1 text-muted-foreground">{deliveryMutation.data.updated} post{deliveryMutation.data.updated === 1 ? "" : "s"} marked delivered. This only updates Orbit; it does not contact or publish to the scheduler.</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
           {preview && downloadedIds.length === 0 && <Button variant="outline" disabled={busy} onClick={() => previewMutation.mutate()}>Refresh preview</Button>}
          {!preview ? (
            <Button disabled={!canRequest || accountsQuery.isPending || accountsQuery.isError || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preview export
            </Button>
          ) : downloadedIds.length > 0 && !deliveryMutation.data ? (
            <Button disabled={!importConfirmed || busy} onClick={() => deliveryMutation.mutate()}>
              {deliveryMutation.isPending ? "Recording import…" : "Confirm successful import"}
            </Button>
          ) : deliveryMutation.data ? null : (
             <Button disabled={preview.exportablePosts === 0 || preview.claimedPosts > 0 || busy} onClick={() => exportMutation.mutate()}>
              {exportMutation.isPending ? "Preparing CSV…" : <><Download className="mr-2 h-4 w-4" />Download CSV</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
