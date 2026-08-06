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
import { Loader2, AlertTriangle, FileText, CalendarDays, Mic, LayoutTemplate, BookOpen, Film, Wrench, Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type ContentKind = "blog_posts" | "case_studies" | "whitepapers" | "videos" | "workshops" | "events" | "episodes" | "landing_pages";

export interface PostCandidate {
  mcpId: string;
  title: string;
  slug: string;
  publishedAt?: string;
  excerpt?: string;
  heroImageUrl?: string;
  url: string;
  suggestedAssetType?: string;
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
  eventType?: string;
  url?: string;
  registrationUrl?: string;
  description?: string;
  imageUrl?: string;
  existing: boolean;
  existingConferenceId?: string;
}

export interface EpisodeCandidate {
  mcpId: string;
  title: string;
  slug: string;
  episodeNumber?: number;
  guestName?: string;
  summary?: string;
  publishedAt?: string;
  artworkUrl?: string;
  existing: boolean;
  existingId?: string;
  existingAssetType?: string;
}

export interface LandingPageCandidate {
  mcpId: string;
  title: string;
  slug: string;
  subtitle?: string;
  description?: string;
  pillar?: string;
  publishedAt?: string;
  url: string;
  existing: boolean;
  existingId?: string;
  existingAssetType?: string;
}

interface Candidates {
  posts: PostCandidate[];
  events: EventCandidate[];
  episodes: EpisodeCandidate[];
  landingPages: LandingPageCandidate[];
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

// Shared badge used in every list row
function StatusBadge({ existing }: { existing: boolean }) {
  return existing ? (
    <Badge variant="outline" className="text-[10px] px-1.5 border-amber-400/60 text-amber-600 dark:text-amber-400 shrink-0">
      Will update
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] px-1.5 border-green-500/50 text-green-600 dark:text-green-400 shrink-0">
      New
    </Badge>
  );
}

// ── Kind picker ───────────────────────────────────────────────────────────────

const KIND_OPTIONS: { value: ContentKind; label: string; description: string; icon: React.ElementType }[] = [
  { value: "blog_posts",    label: "Blog Posts",    description: "Published insights and articles",           icon: FileText },
  { value: "case_studies",  label: "Case Studies",  description: "Customer success and outcome stories",      icon: Briefcase },
  { value: "whitepapers",   label: "Whitepapers",   description: "Research papers and in-depth guides",       icon: BookOpen },
  { value: "videos",        label: "Videos",        description: "Video content and recordings",              icon: Film },
  { value: "workshops",     label: "Workshops",     description: "Interactive sessions and how-to content",   icon: Wrench },
  { value: "events",        label: "Events",        description: "Upcoming conferences and webinars",         icon: CalendarDays },
  { value: "episodes",      label: "Podcast",       description: "Polaris podcast episodes",                  icon: Mic },
  { value: "landing_pages", label: "Landing Pages", description: "Campaign and pillar landing pages",         icon: LayoutTemplate },
];

function KindPicker({ onPick }: { onPick: (k: ContentKind) => void }) {
  return (
    <div className="px-6 py-6 space-y-3">
      <p className="text-sm text-muted-foreground">What would you like to import?</p>
      <div className="grid grid-cols-2 gap-2">
        {KIND_OPTIONS.map(opt => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => onPick(opt.value)}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-muted/30 hover:bg-muted/70 hover:border-primary/40 transition-colors px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                <Icon className="w-4 h-4 text-muted-foreground" />
                {opt.label}
              </div>
              <span className="text-[11px] text-muted-foreground leading-snug">{opt.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Select-all row ────────────────────────────────────────────────────────────

function SelectAllRow({
  all, total, selected, id, onToggle,
}: { all: boolean; total: number; selected: number; id: string; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b mb-1">
      <Checkbox checked={all} onCheckedChange={onToggle} id={id} />
      <label htmlFor={id} className="text-xs text-muted-foreground cursor-pointer select-none">
        {all ? "Deselect all" : `Select all ${total}`}
      </label>
      {selected > 0 && (
        <span className="ml-auto text-xs text-muted-foreground">{selected} selected</span>
      )}
    </div>
  );
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
  const [kind, setKind] = useState<ContentKind | null>(null);

  const [selectedPostIds,    setSelectedPostIds]    = useState<Set<string>>(new Set());
  const [selectedEventIds,   setSelectedEventIds]   = useState<Set<string>>(new Set());
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(new Set());
  const [selectedLandingIds, setSelectedLandingIds] = useState<Set<string>>(new Set());
  const [confirmingUpdates,  setConfirmingUpdates]  = useState(false);

  useEffect(() => {
    if (open) {
      setKind(null);
      setSelectedPostIds(new Set());
      setSelectedEventIds(new Set());
      setSelectedEpisodeIds(new Set());
      setSelectedLandingIds(new Set());
      setConfirmingUpdates(false);
    }
  }, [open]);

  const { data: candidates, isLoading, error } = useQuery<Candidates>({
    queryKey: ["/api/mcp-website/candidates", kind],
    queryFn: async () => {
      const r = await fetch(`/api/mcp-website/candidates?kind=${kind}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to load website content");
      return r.json();
    },
    enabled: open && kind !== null,
    staleTime: 60_000,
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      // assetType: the server already filtered posts to the chosen kind and set
      // suggestedAssetType accordingly — no per-row override needed.
      const posts = (candidates?.posts ?? [])
        .filter(p => selectedPostIds.has(p.mcpId))
        .map(p => ({
          mcpId: p.mcpId,
          assetType: p.existingAssetType ?? p.suggestedAssetType ?? "blog_post",
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          publishedAt: p.publishedAt,
          heroImageUrl: p.heroImageUrl,
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
      const episodes = (candidates?.episodes ?? [])
        .filter(ep => selectedEpisodeIds.has(ep.mcpId))
        .map(ep => ({
          mcpId: ep.mcpId,
          title: ep.title,
          slug: ep.slug,
          summary: ep.summary,
          publishedAt: ep.publishedAt,
          artworkUrl: ep.artworkUrl,
          existingId: ep.existingId,
        }));
      const landingPages = (candidates?.landingPages ?? [])
        .filter(lp => selectedLandingIds.has(lp.mcpId))
        .map(lp => ({
          mcpId: lp.mcpId,
          title: lp.title,
          slug: lp.slug,
          description: lp.description,
          publishedAt: lp.publishedAt,
          url: lp.url,
          existingId: lp.existingId,
        }));
      const r = await fetch("/api/mcp-website/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ posts, events, episodes, landingPages }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Import failed");
      return r.json() as Promise<{
        postsAdded: number; postsUpdated: number;
        eventsAdded: number; eventsUpdated: number;
        episodesAdded: number; episodesUpdated: number;
        landingAdded: number; landingUpdated: number;
      }>;
    },
    onSuccess: result => {
      const parts: string[] = [];
      const add = (n: number, label: string) => n > 0 && parts.push(`${n} ${label}`);
      add(result.postsAdded,    "content added");
      add(result.postsUpdated,  "content updated");
      add(result.eventsAdded,   "event" + (result.eventsAdded !== 1 ? "s" : "") + " added to Events");
      add(result.eventsUpdated, "event" + (result.eventsUpdated !== 1 ? "s" : "") + " updated");
      add(result.episodesAdded,   "episode" + (result.episodesAdded !== 1 ? "s" : "") + " added");
      add(result.episodesUpdated, "episode" + (result.episodesUpdated !== 1 ? "s" : "") + " updated");
      add(result.landingAdded,   "landing page" + (result.landingAdded !== 1 ? "s" : "") + " added");
      add(result.landingUpdated, "landing page" + (result.landingUpdated !== 1 ? "s" : "") + " updated");
      toast({ title: "Import complete", description: parts.length ? parts.join(" · ") : "Nothing was imported" });
      onImported();
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  // ── Derived counts ──────────────────────────────────────────────────────────

  const posts       = candidates?.posts       ?? [];
  const events      = candidates?.events      ?? [];
  const episodes    = candidates?.episodes    ?? [];
  const landingPages = candidates?.landingPages ?? [];

  const selPosts    = posts.filter(p  => selectedPostIds.has(p.mcpId));
  const selEvents   = events.filter(e => selectedEventIds.has(e.mcpId));
  const selEps      = episodes.filter(ep => selectedEpisodeIds.has(ep.mcpId));
  const selLanding  = landingPages.filter(lp => selectedLandingIds.has(lp.mcpId));

  const dupPosts   = selPosts.filter(p  => p.existing).length;
  const dupEvents  = selEvents.filter(e => e.existing).length;
  const dupEps     = selEps.filter(ep  => ep.existing).length;
  const dupLanding = selLanding.filter(lp => lp.existing).length;
  const totalDuplicates = dupPosts + dupEvents + dupEps + dupLanding;
  const totalSelected   = selectedPostIds.size + selectedEventIds.size + selectedEpisodeIds.size + selectedLandingIds.size;

  // ── Select-all toggles ─────────────────────────────────────────────────────

  const allPosts   = posts.length   > 0 && posts.every(p  => selectedPostIds.has(p.mcpId));
  const allEvents  = events.length  > 0 && events.every(e => selectedEventIds.has(e.mcpId));
  const allEps     = episodes.length > 0 && episodes.every(ep => selectedEpisodeIds.has(ep.mcpId));
  const allLanding = landingPages.length > 0 && landingPages.every(lp => selectedLandingIds.has(lp.mcpId));

  const toggle = (set: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, all: boolean, items: string[]) => {
    setConfirmingUpdates(false);
    setFn(all ? new Set() : new Set(items));
  };

  function handleImport() {
    if (totalDuplicates > 0 && !confirmingUpdates) { setConfirmingUpdates(true); return; }
    importMutation.mutate();
  }

  function goBack() {
    setKind(null);
    setSelectedPostIds(new Set()); setSelectedEventIds(new Set());
    setSelectedEpisodeIds(new Set()); setSelectedLandingIds(new Set());
    setConfirmingUpdates(false);
  }

  const kindLabel = kind
    ? KIND_OPTIONS.find(o => o.value === kind)?.label ?? kind
    : "";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => { if (!importMutation.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Import from website</DialogTitle>
          <DialogDescription>
            {kind === null
              ? "Choose what to import, then pick the items you want."
              : "Select the items you want to bring into Orbit. Items already in the library are marked — selecting them will update the existing record."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: kind picker ─────────────────────────────────────────── */}
        {kind === null && (
          <>
            <KindPicker onPick={setKind} />
            <DialogFooter className="px-6 py-4 border-t">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 2: loading ─────────────────────────────────────────────── */}
        {kind !== null && isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading {kindLabel.toLowerCase()}…</span>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {kind !== null && error && (
          <>
            <div className="mx-6 my-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
            <DialogFooter className="px-6 py-4 border-t">
              <Button variant="outline" size="sm" onClick={goBack}>← Back</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step 2: candidate list ──────────────────────────────────────── */}
        {candidates && (
          <>
            {/* ── Posts (blog posts / case studies / whitepapers / videos / workshops) */}
            {(kind === "blog_posts" || kind === "case_studies" || kind === "whitepapers" || kind === "videos" || kind === "workshops") && (
              <div className="flex-1 overflow-y-auto px-6 pb-2">
                {posts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No {kindLabel.toLowerCase()} found on the connected website.</p>
                ) : (
                  <>
                    <SelectAllRow
                      all={allPosts} total={posts.length} selected={selectedPostIds.size}
                      id="sa-posts"
                      onToggle={() => toggle(selectedPostIds, setSelectedPostIds, allPosts, posts.map(p => p.mcpId))}
                    />
                    <div className="space-y-0.5">
                      {posts.map(post => {
                        const checked = selectedPostIds.has(post.mcpId);
                        return (
                          <div key={post.mcpId} className={`flex items-start gap-3 rounded px-2 py-2 hover:bg-muted/40 transition-colors ${checked ? "bg-muted/20" : ""}`}>
                            <Checkbox checked={checked} onCheckedChange={c => {
                              setConfirmingUpdates(false);
                              setSelectedPostIds(prev => { const n = new Set(prev); c ? n.add(post.mcpId) : n.delete(post.mcpId); return n; });
                            }} className="mt-0.5" />
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-start gap-2 flex-wrap">
                                <span className="text-sm font-medium leading-snug">{post.title}</span>
                                <StatusBadge existing={post.existing} />
                              </div>
                              {post.publishedAt && <p className="text-xs text-muted-foreground">{fmtDate(post.publishedAt)}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Events ────────────────────────────────────────────────── */}
            {kind === "events" && (
              <div className="flex-1 overflow-y-auto px-6 pb-2">
                {events.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No upcoming events found on the connected website.</p>
                ) : (
                  <>
                    <SelectAllRow
                      all={allEvents} total={events.length} selected={selectedEventIds.size}
                      id="sa-events"
                      onToggle={() => toggle(selectedEventIds, setSelectedEventIds, allEvents, events.map(e => e.mcpId))}
                    />
                    <div className="space-y-0.5">
                      {events.map(ev => {
                        const checked = selectedEventIds.has(ev.mcpId);
                        return (
                          <div key={ev.mcpId} className={`flex items-start gap-3 rounded px-2 py-2 hover:bg-muted/40 transition-colors ${checked ? "bg-muted/20" : ""}`}>
                            <Checkbox checked={checked} onCheckedChange={c => {
                              setConfirmingUpdates(false);
                              setSelectedEventIds(prev => { const n = new Set(prev); c ? n.add(ev.mcpId) : n.delete(ev.mcpId); return n; });
                            }} className="mt-0.5" />
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-start gap-2 flex-wrap">
                                <span className="text-sm font-medium leading-snug">{ev.name}</span>
                                <StatusBadge existing={ev.existing} />
                                {ev.eventType && <Badge variant="secondary" className="text-[10px] px-1.5">{ev.eventType}</Badge>}
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
                      Imported events are added to <span className="font-medium">Marketing → Events</span> so you can launch social campaigns from them.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* ── Episodes ──────────────────────────────────────────────── */}
            {kind === "episodes" && (
              <div className="flex-1 overflow-y-auto px-6 pb-2">
                {episodes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No podcast episodes found on the connected website.</p>
                ) : (
                  <>
                    <SelectAllRow
                      all={allEps} total={episodes.length} selected={selectedEpisodeIds.size}
                      id="sa-eps"
                      onToggle={() => toggle(selectedEpisodeIds, setSelectedEpisodeIds, allEps, episodes.map(e => e.mcpId))}
                    />
                    <div className="space-y-0.5">
                      {episodes.map(ep => {
                        const checked = selectedEpisodeIds.has(ep.mcpId);
                        return (
                          <div key={ep.mcpId} className={`flex items-start gap-3 rounded px-2 py-2 hover:bg-muted/40 transition-colors ${checked ? "bg-muted/20" : ""}`}>
                            <Checkbox checked={checked} onCheckedChange={c => {
                              setConfirmingUpdates(false);
                              setSelectedEpisodeIds(prev => { const n = new Set(prev); c ? n.add(ep.mcpId) : n.delete(ep.mcpId); return n; });
                            }} className="mt-0.5" />
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-start gap-2 flex-wrap">
                                {ep.episodeNumber != null && (
                                  <span className="text-xs text-muted-foreground shrink-0">Ep {ep.episodeNumber}</span>
                                )}
                                <span className="text-sm font-medium leading-snug">{ep.title}</span>
                                <StatusBadge existing={ep.existing} />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {ep.guestName ? `with ${ep.guestName}` : ""}
                                {ep.guestName && ep.publishedAt ? " · " : ""}
                                {ep.publishedAt ? fmtDate(ep.publishedAt) : ""}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground px-1">
                      Episodes are added to the <span className="font-medium">Content Library</span>.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* ── Landing Pages ─────────────────────────────────────────── */}
            {kind === "landing_pages" && (
              <div className="flex-1 overflow-y-auto px-6 pb-2">
                {landingPages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No landing pages found on the connected website.</p>
                ) : (
                  <>
                    <SelectAllRow
                      all={allLanding} total={landingPages.length} selected={selectedLandingIds.size}
                      id="sa-lp"
                      onToggle={() => toggle(selectedLandingIds, setSelectedLandingIds, allLanding, landingPages.map(lp => lp.mcpId))}
                    />
                    <div className="space-y-0.5">
                      {landingPages.map(lp => {
                        const checked = selectedLandingIds.has(lp.mcpId);
                        return (
                          <div key={lp.mcpId} className={`flex items-start gap-3 rounded px-2 py-2 hover:bg-muted/40 transition-colors ${checked ? "bg-muted/20" : ""}`}>
                            <Checkbox checked={checked} onCheckedChange={c => {
                              setConfirmingUpdates(false);
                              setSelectedLandingIds(prev => { const n = new Set(prev); c ? n.add(lp.mcpId) : n.delete(lp.mcpId); return n; });
                            }} className="mt-0.5" />
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-start gap-2 flex-wrap">
                                <span className="text-sm font-medium leading-snug">{lp.title}</span>
                                <StatusBadge existing={lp.existing} />
                                {lp.pillar && <Badge variant="secondary" className="text-[10px] px-1.5">{lp.pillar}</Badge>}
                              </div>
                              {lp.subtitle && <p className="text-xs text-muted-foreground">{lp.subtitle}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        {kind !== null && candidates && (
          <DialogFooter className="px-6 py-4 border-t flex-col items-stretch gap-2">
            {confirmingUpdates && totalDuplicates > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>{totalDuplicates} existing record{totalDuplicates !== 1 ? "s" : ""}</strong> will be updated. Click Import again to confirm.
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
                <Button variant="outline" size="sm" onClick={goBack} disabled={importMutation.isPending}>
                  ← Back
                </Button>
                <Button size="sm" onClick={handleImport} disabled={totalSelected === 0 || importMutation.isPending}>
                  {importMutation.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Importing…</>
                    : confirmingUpdates && totalDuplicates > 0
                      ? "Confirm import"
                      : `Import ${totalSelected > 0 ? totalSelected : ""} selected`}
                </Button>
              </div>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
