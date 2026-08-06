import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostCandidate {
  mcpId: string;
  title: string;
  slug: string;
  publishedAt?: string;
  excerpt?: string;
  leadImageUrl?: string;
  url: string;
  existing: boolean;
  existingId?: string;
  existingAssetType?: string;
}

export interface EventCandidate {
  mcpId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  url?: string;
  description?: string;
  existing: boolean;
  existingConferenceId?: string;
}

interface Candidates {
  posts: PostCandidate[];
  events: EventCandidate[];
  siteUrl: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return "";
  try { return format(new Date(iso), "MMM d, yyyy"); } catch { return ""; }
}

function fmtDateRange(start?: string, end?: string) {
  if (!start) return "";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (!e || e.toDateString() === s.toDateString()) return format(s, "MMM d, yyyy");
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth())
    return `${format(s, "MMM d")}–${format(e, "d, yyyy")}`;
  return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WebsiteMcpImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"posts" | "events">("posts");

  // Selection state: sets of mcpIds
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  // Per-post type override (blog_post | case_study)
  const [postTypes, setPostTypes] = useState<Map<string, string>>(new Map());
  // Duplicate confirmation step
  const [confirmingUpdates, setConfirmingUpdates] = useState(false);

  // Reset selection when dialog re-opens
  useEffect(() => {
    if (open) {
      setSelectedPostIds(new Set());
      setSelectedEventIds(new Set());
      setPostTypes(new Map());
      setConfirmingUpdates(false);
    }
  }, [open]);

  const { data: candidates, isLoading, error } = useQuery<Candidates>({
    queryKey: ["/api/mcp-website/candidates"],
    queryFn: async () => {
      const r = await fetch("/api/mcp-website/candidates", { credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to load website content");
      return r.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const posts = (candidates?.posts ?? [])
        .filter(p => selectedPostIds.has(p.mcpId))
        .map(p => ({
          mcpId: p.mcpId,
          assetType: postTypes.get(p.mcpId) ??
            (p.existingAssetType === "case_study" ? "case_study" : "blog_post"),
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          publishedAt: p.publishedAt,
          leadImageUrl: p.leadImageUrl,
          existingId: p.existingId,
        }));
      const events = (candidates?.events ?? [])
        .filter(e => selectedEventIds.has(e.mcpId))
        .map(e => ({
          mcpId: e.mcpId,
          name: e.name,
          startDate: e.startDate,
          endDate: e.endDate,
          location: e.location,
          url: e.url,
          description: e.description,
          existingConferenceId: e.existingConferenceId,
        }));
      const r = await fetch("/api/mcp-website/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ posts, events }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Import failed");
      return r.json() as Promise<{
        postsAdded: number; postsUpdated: number;
        eventsAdded: number; eventsUpdated: number;
      }>;
    },
    onSuccess: result => {
      const parts: string[] = [];
      const totalPosts = result.postsAdded + result.postsUpdated;
      const totalEvents = result.eventsAdded + result.eventsUpdated;
      if (totalPosts > 0) {
        parts.push(`${result.postsAdded} post${result.postsAdded !== 1 ? "s" : ""} added`);
        if (result.postsUpdated) parts.push(`${result.postsUpdated} updated`);
      }
      if (totalEvents > 0) {
        parts.push(`${result.eventsAdded} event${result.eventsAdded !== 1 ? "s" : ""} added to Events`);
        if (result.eventsUpdated) parts.push(`${result.eventsUpdated} updated`);
      }
      toast({
        title: "Import complete",
        description: parts.length ? parts.join(" · ") : "Nothing was imported",
      });
      onImported();
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  // ── Derived counts ──────────────────────────────────────────────────────────

  const posts = candidates?.posts ?? [];
  const events = candidates?.events ?? [];

  const selectedPosts = posts.filter(p => selectedPostIds.has(p.mcpId));
  const selectedEvents = events.filter(e => selectedEventIds.has(e.mcpId));
  const duplicatePosts = selectedPosts.filter(p => p.existing).length;
  const duplicateEvents = selectedEvents.filter(e => e.existing).length;
  const totalDuplicates = duplicatePosts + duplicateEvents;
  const totalSelected = selectedPostIds.size + selectedEventIds.size;

  // ── Select-all helpers ─────────────────────────────────────────────────────

  const allPostsSelected = posts.length > 0 && posts.every(p => selectedPostIds.has(p.mcpId));
  const allEventsSelected = events.length > 0 && events.every(e => selectedEventIds.has(e.mcpId));

  function toggleAllPosts() {
    if (allPostsSelected) setSelectedPostIds(new Set());
    else setSelectedPostIds(new Set(posts.map(p => p.mcpId)));
  }
  function toggleAllEvents() {
    if (allEventsSelected) setSelectedEventIds(new Set());
    else setSelectedEventIds(new Set(events.map(e => e.mcpId)));
  }

  // ── Import button handler ──────────────────────────────────────────────────

  function handleImport() {
    if (totalDuplicates > 0 && !confirmingUpdates) {
      setConfirmingUpdates(true);
      return;
    }
    importMutation.mutate();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => { if (!importMutation.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Import from website</DialogTitle>
          <DialogDescription>
            Select the posts, case studies, and events you want to bring into Orbit.
            Items already in the library are marked — selecting them will update the existing record.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading website content…</span>
          </div>
        )}

        {error && (
          <div className="mx-6 my-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {(error as Error).message}
          </div>
        )}

        {candidates && (
          <Tabs
            value={tab}
            onValueChange={v => { setTab(v as "posts" | "events"); setConfirmingUpdates(false); }}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="mx-6 mt-2 w-auto justify-start">
              <TabsTrigger value="posts">
                Content
                {posts.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{posts.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="events">
                Events
                {events.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{events.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── Posts tab ─────────────────────────────────────────────── */}
            <TabsContent value="posts" className="flex-1 overflow-y-auto mt-0 px-6 pb-2">
              {posts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No content found on the connected website.
                </p>
              ) : (
                <>
                  {/* Select-all row */}
                  <div className="flex items-center gap-2 py-2 border-b mb-1">
                    <Checkbox
                      checked={allPostsSelected}
                      onCheckedChange={toggleAllPosts}
                      id="select-all-posts"
                    />
                    <label htmlFor="select-all-posts" className="text-xs text-muted-foreground cursor-pointer select-none">
                      {allPostsSelected ? "Deselect all" : `Select all ${posts.length}`}
                    </label>
                    {selectedPostIds.size > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {selectedPostIds.size} selected
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    {posts.map(post => {
                      const checked = selectedPostIds.has(post.mcpId);
                      const currentType: string =
                        postTypes.get(post.mcpId) ??
                        post.existingAssetType ??
                        "blog_post";
                      return (
                        <div
                          key={post.mcpId}
                          className={`flex items-start gap-3 rounded px-2 py-2 hover:bg-muted/40 transition-colors ${checked ? "bg-muted/20" : ""}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={c => {
                              setConfirmingUpdates(false);
                              setSelectedPostIds(prev => {
                                const next = new Set(prev);
                                c ? next.add(post.mcpId) : next.delete(post.mcpId);
                                return next;
                              });
                            }}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className="text-sm font-medium leading-snug">{post.title}</span>
                              {post.existing ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 border-amber-400/60 text-amber-600 dark:text-amber-400 shrink-0">
                                  Will update
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 border-green-500/50 text-green-600 dark:text-green-400 shrink-0">
                                  New
                                </Badge>
                              )}
                            </div>
                            {post.publishedAt && (
                              <p className="text-xs text-muted-foreground">{fmtDate(post.publishedAt)}</p>
                            )}
                          </div>
                          {/* Type selector */}
                          <Select
                            value={currentType}
                            onValueChange={v => {
                              setPostTypes(prev => {
                                const next = new Map(prev);
                                next.set(post.mcpId, v);
                                return next;
                              });
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-36 shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="blog_post">Blog Post</SelectItem>
                              <SelectItem value="case_study">Case Study</SelectItem>
                              <SelectItem value="whitepaper">Whitepaper</SelectItem>
                              <SelectItem value="video">Video</SelectItem>
                              <SelectItem value="workshop">Workshop</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </TabsContent>

            {/* ── Events tab ────────────────────────────────────────────── */}
            <TabsContent value="events" className="flex-1 overflow-y-auto mt-0 px-6 pb-2">
              {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No upcoming events found on the connected website.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 py-2 border-b mb-1">
                    <Checkbox
                      checked={allEventsSelected}
                      onCheckedChange={toggleAllEvents}
                      id="select-all-events"
                    />
                    <label htmlFor="select-all-events" className="text-xs text-muted-foreground cursor-pointer select-none">
                      {allEventsSelected ? "Deselect all" : `Select all ${events.length}`}
                    </label>
                    {selectedEventIds.size > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {selectedEventIds.size} selected
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    {events.map(ev => {
                      const checked = selectedEventIds.has(ev.mcpId);
                      return (
                        <div
                          key={ev.mcpId}
                          className={`flex items-start gap-3 rounded px-2 py-2 hover:bg-muted/40 transition-colors ${checked ? "bg-muted/20" : ""}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={c => {
                              setConfirmingUpdates(false);
                              setSelectedEventIds(prev => {
                                const next = new Set(prev);
                                c ? next.add(ev.mcpId) : next.delete(ev.mcpId);
                                return next;
                              });
                            }}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className="text-sm font-medium leading-snug">{ev.name}</span>
                              {ev.existing ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 border-amber-400/60 text-amber-600 dark:text-amber-400 shrink-0">
                                  Will update
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 border-green-500/50 text-green-600 dark:text-green-400 shrink-0">
                                  New
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {fmtDateRange(ev.startDate, ev.endDate)}
                              {ev.location ? ` · ${ev.location}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground px-1">
                    Imported events are added to <span className="font-medium">Marketing → Events</span> so you can
                    launch social campaigns from them.
                  </p>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <DialogFooter className="px-6 py-4 border-t flex-col items-stretch gap-2">
          {/* Duplicate confirmation warning */}
          {confirmingUpdates && totalDuplicates > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>{totalDuplicates} existing record{totalDuplicates !== 1 ? "s" : ""}</strong> will
                be updated with the latest content from the website. Click Import again to confirm.
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {totalSelected === 0
                ? "Nothing selected"
                : `${totalSelected} selected${totalDuplicates > 0 ? ` · ${totalDuplicates} will update existing` : ""}`}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={importMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={totalSelected === 0 || importMutation.isPending}
              >
                {importMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Importing…</>
                  : confirmingUpdates && totalDuplicates > 0
                    ? "Confirm import"
                    : `Import ${totalSelected > 0 ? totalSelected : ""} selected`}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
