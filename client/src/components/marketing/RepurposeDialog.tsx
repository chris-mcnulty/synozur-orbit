import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Linkedin, Video, FileText, Mail, Newspaper, Loader2, Sparkles,
  ImageIcon, Minus, Plus, ArrowLeft, ExternalLink, AlertTriangle, Mic,
} from "lucide-react";

// ── Output formats (mirrors REPURPOSE_FORMAT_DEFS on the server) ──────────────
type BatchFormat =
  | "linkedin_post"
  | "linkedin_carousel"
  | "video_script"
  | "video_shot_list"
  | "blog_snippet"
  | "whitepaper_snippet"
  | "email_snippet";

interface FormatDef {
  key: BatchFormat;
  label: string;
  description: string;
  destination: "posts" | "library";
  defaultCount: number;
  maxCount: number;
  icon: typeof FileText;
}

const FORMAT_DEFS: FormatDef[] = [
  { key: "linkedin_post", label: "LinkedIn single post", description: "Standalone posts, each with a branded graphic", destination: "posts", defaultCount: 3, maxCount: 6, icon: Linkedin },
  { key: "linkedin_carousel", label: "LinkedIn carousel", description: "5-slide branded sets with a caption", destination: "posts", defaultCount: 1, maxCount: 3, icon: Linkedin },
  { key: "video_script", label: "Video script (60-70s)", description: "Spoken script with visual cues", destination: "library", defaultCount: 1, maxCount: 3, icon: Video },
  { key: "video_shot_list", label: "Video shot list", description: "AI-video prompts, shot by shot", destination: "library", defaultCount: 1, maxCount: 3, icon: Video },
  { key: "blog_snippet", label: "Blog post snippet", description: "Hook intro plus a section outline", destination: "library", defaultCount: 1, maxCount: 3, icon: Newspaper },
  { key: "whitepaper_snippet", label: "Whitepaper snippet", description: "Summary plus a section scaffold", destination: "library", defaultCount: 1, maxCount: 2, icon: FileText },
  { key: "email_snippet", label: "Email / newsletter snippet", description: "Subject, intro, value, and a CTA", destination: "library", defaultCount: 1, maxCount: 3, icon: Mail },
];

interface RepurposeMeta {
  platform?: string | null;
  format?: string | null;
  coreIdea?: string | null;
  cta?: string | null;
  bestPostingWindow?: string | null;
}
interface CarouselSlide {
  index: number;
  role: "cover" | "body" | "close";
  kicker?: string | null;
  headline: string;
  supportingLines: string[];
  imageUrl?: string | null;
}
interface PostResult {
  id: string;
  platform: string;
  content: string;
  postFormat?: string | null;
  overrideImageUrl?: string | null;
  carouselSlides?: CarouselSlide[] | null;
  repurposeMeta?: RepurposeMeta | null;
}
interface AssetResult {
  id: string;
  title: string;
  assetType?: string | null;
  repurposeMeta?: RepurposeMeta | null;
}
interface ResultGroup {
  format: BatchFormat;
  label: string;
  destination: "posts" | "library";
  posts: PostResult[];
  assets: AssetResult[];
  count: number;
}
interface BatchResponse {
  groups: ResultGroup[];
  totalCount: number;
  errors: { format: string; message: string }[];
  imageWarnings: { format: string; message: string }[];
}

interface RepurposeDialogProps {
  assetId: string | null;
  assetTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to send the user to open a generated library snippet. */
  onOpenLibraryAsset?: (assetId: string) => void;
  /** Where to send the user to see the generated social drafts. */
  onViewPosts?: () => void;
  /** Fired once a batch has been generated, e.g. to refresh lists. */
  onGenerated?: (result: BatchResponse) => void;
}

export function RepurposeDialog({
  assetId,
  assetTitle,
  open,
  onOpenChange,
  onOpenLibraryAsset,
  onViewPosts,
  onGenerated,
}: RepurposeDialogProps) {
  // selection state: format → count (absent = not selected)
  const [counts, setCounts] = useState<Partial<Record<BatchFormat, number>>>({});
  const [results, setResults] = useState<BatchResponse | null>(null);
  // Polaris podcast outline: optional guest override + the created asset.
  const [podcastGuest, setPodcastGuest] = useState("");
  const [podcastAsset, setPodcastAsset] = useState<{ id: string; title: string } | null>(null);

  const reset = () => {
    setCounts({});
    setResults(null);
    setPodcastGuest("");
    setPodcastAsset(null);
  };

  const toggle = (def: FormatDef) => {
    setCounts((c) => {
      const next = { ...c };
      if (next[def.key] != null) delete next[def.key];
      else next[def.key] = def.defaultCount;
      return next;
    });
  };

  const setCount = (def: FormatDef, delta: number) => {
    setCounts((c) => {
      const current = c[def.key] ?? def.defaultCount;
      const value = Math.min(Math.max(current + delta, 1), def.maxCount);
      return { ...c, [def.key]: value };
    });
  };

  const selectedCount = Object.keys(counts).length;
  const totalItems = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  const generate = useMutation({
    mutationFn: async () => {
      if (!assetId) throw new Error("No source asset");
      const selections = Object.entries(counts).map(([format, count]) => ({ format, count }));
      const res = await fetch(`/api/content-assets/${assetId}/repurpose-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selections }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to repurpose");
      return res.json() as Promise<BatchResponse>;
    },
    onSuccess: (data) => {
      setResults(data);
      onGenerated?.(data);
      toast.success(`Generated ${data.totalCount} item${data.totalCount === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Polaris podcast outline goes through the long-form repurpose path (it
  // becomes a Content Library asset), not the batch path of social snippets.
  const generatePodcast = useMutation({
    mutationFn: async () => {
      if (!assetId) throw new Error("No source asset");
      const guest = podcastGuest.trim();
      const res = await fetch(`/api/content-assets/${assetId}/repurpose-longform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(guest ? { format: "podcast_outline", guest } : { format: "podcast_outline" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to generate outline");
      return res.json() as Promise<{ asset: { id: string; title: string } }>;
    },
    onSuccess: (data) => {
      setPodcastAsset(data.asset);
      toast.success(`Created "${data.asset.title}" in the Content Library`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-repurpose">
        {!results ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Repurpose into more formats
              </DialogTitle>
              <DialogDescription>
                {assetTitle ? <>From <span className="font-medium">{assetTitle}</span>. </> : null}
                Pick the content types to generate. Everything is written in Synozur's voice and created as drafts.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 sm:grid-cols-2">
              {FORMAT_DEFS.map((def) => {
                const selected = counts[def.key] != null;
                const count = counts[def.key] ?? def.defaultCount;
                const Icon = def.icon;
                return (
                  <div
                    key={def.key}
                    className={`rounded-lg border p-3 transition-colors cursor-pointer ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                    onClick={() => toggle(def)}
                    data-testid={`format-option-${def.key}`}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggle(def)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5"
                        data-testid={`checkbox-format-${def.key}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">{def.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                        <Badge variant="outline" className="mt-1.5 text-[10px]">
                          {def.destination === "posts" ? "Posts pipeline" : "Content Library"}
                        </Badge>
                      </div>
                    </div>
                    {selected && (
                      <div
                        className="mt-2 flex items-center justify-end gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs text-muted-foreground">How many</span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button" variant="outline" size="icon" className="h-6 w-6"
                            onClick={() => setCount(def, -1)} disabled={count <= 1}
                            data-testid={`button-decrement-${def.key}`}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-5 text-center text-sm font-medium" data-testid={`count-${def.key}`}>{count}</span>
                          <Button
                            type="button" variant="outline" size="icon" className="h-6 w-6"
                            onClick={() => setCount(def, 1)} disabled={count >= def.maxCount}
                            data-testid={`button-increment-${def.key}`}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Polaris podcast outline — long-form path (Content Library asset),
                with an optional "do you have a guest in mind?" override. */}
            <div className="rounded-lg border border-dashed p-3 space-y-2" data-testid="section-podcast-outline">
              <div className="flex items-center gap-1.5">
                <Mic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Polaris podcast outline</span>
                <Badge variant="outline" className="text-[10px]">Content Library</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                A Polaris house-format outline (recorded live, exported as a Word doc).
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Do you have a guest in mind?</label>
                <Input
                  value={podcastGuest}
                  onChange={(e) => setPodcastGuest(e.target.value)}
                  placeholder="Name, title, company (leave blank to let AI suggest)"
                  data-testid="input-podcast-guest"
                />
              </div>
              {podcastAsset ? (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2">
                  <span className="text-xs truncate">Created “{podcastAsset.title}”</span>
                  {onOpenLibraryAsset && (
                    <Button
                      variant="outline" size="sm" className="shrink-0"
                      onClick={() => { onOpenLibraryAsset(podcastAsset.id); handleOpenChange(false); }}
                      data-testid="button-open-podcast-outline"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" /> Open
                    </Button>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline" size="sm"
                  onClick={() => generatePodcast.mutate()}
                  disabled={!assetId || generatePodcast.isPending}
                  data-testid="button-generate-podcast-outline"
                >
                  {generatePodcast.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                  ) : (
                    <><Mic className="mr-2 h-4 w-4" /> Generate podcast outline</>
                  )}
                </Button>
              )}
            </div>

            <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedCount === 0
                  ? "No formats selected"
                  : `${totalItems} item${totalItems === 1 ? "" : "s"} across ${selectedCount} format${selectedCount === 1 ? "" : "s"}`}
              </span>
              <Button
                onClick={() => generate.mutate()}
                disabled={selectedCount === 0 || generate.isPending}
                data-testid="button-generate-repurpose"
              >
                {generate.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" /> Generate</>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {results.totalCount} draft{results.totalCount === 1 ? "" : "s"} created
              </DialogTitle>
              <DialogDescription>
                Posts and carousels are in the posts pipeline. Snippets are in the Content Library, ready to open and export.
              </DialogDescription>
            </DialogHeader>

            {(results.errors?.length > 0 || results.imageWarnings?.length > 0) && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-700 dark:text-yellow-400 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div>
                  {results.errors?.map((e, i) => <div key={`e${i}`}>Couldn't generate {e.format}: {e.message}</div>)}
                  {results.imageWarnings?.map((w, i) => <div key={`w${i}`}>Image for {w.format} skipped: {w.message}</div>)}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {results.groups.map((group) => (
                <div key={group.format} data-testid={`result-group-${group.format}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <Badge variant="secondary" className="text-[10px]">{group.count}</Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {group.destination === "posts" ? "Posts pipeline" : "Content Library"}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {group.posts.map((p) => (
                      <div key={p.id} className="rounded-lg border p-3" data-testid={`result-post-${p.id}`}>
                        <div className="flex gap-3">
                          {p.overrideImageUrl ? (
                            <img
                              src={p.overrideImageUrl}
                              alt=""
                              className="h-16 w-16 rounded object-cover shrink-0 border"
                              data-testid={`img-post-${p.id}`}
                            />
                          ) : (
                            <div className="h-16 w-16 rounded bg-muted flex items-center justify-center shrink-0">
                              <ImageIcon className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm line-clamp-3 whitespace-pre-wrap">{p.content}</p>
                            <MetaRow meta={p.repurposeMeta} />
                          </div>
                        </div>
                        {p.postFormat === "carousel" && p.carouselSlides && p.carouselSlides.length > 0 && (
                          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                            {p.carouselSlides.map((s) => (
                              s.imageUrl ? (
                                <img
                                  key={s.index}
                                  src={s.imageUrl}
                                  alt={`Slide ${s.index}`}
                                  className="h-20 w-20 rounded object-cover border shrink-0"
                                  data-testid={`img-slide-${p.id}-${s.index}`}
                                />
                              ) : (
                                <div key={s.index} className="h-20 w-20 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0">
                                  {s.index}/{p.carouselSlides!.length}
                                </div>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {group.assets.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-lg border p-3 flex items-center justify-between gap-2"
                        data-testid={`result-asset-${a.id}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{a.title}</p>
                          <MetaRow meta={a.repurposeMeta} />
                        </div>
                        {onOpenLibraryAsset && (
                          <Button
                            variant="outline" size="sm" className="shrink-0"
                            onClick={() => onOpenLibraryAsset(a.id)}
                            data-testid={`button-open-asset-${a.id}`}
                          >
                            <ExternalLink className="mr-1 h-3 w-3" /> Open
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={reset} data-testid="button-repurpose-again">
                <ArrowLeft className="mr-2 h-4 w-4" /> Generate more
              </Button>
              {onViewPosts && results.groups.some((g) => g.destination === "posts") && (
                <Button variant="outline" onClick={() => { onViewPosts(); handleOpenChange(false); }} data-testid="button-view-posts">
                  View posts
                </Button>
              )}
              <Button onClick={() => handleOpenChange(false)} data-testid="button-close-repurpose">Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ meta }: { meta?: RepurposeMeta | null }) {
  if (!meta) return null;
  const bits: string[] = [];
  if (meta.cta) bits.push(`CTA: ${meta.cta}`);
  if (meta.bestPostingWindow) bits.push(`Best: ${meta.bestPostingWindow}`);
  return (
    <div className="mt-1 space-y-0.5">
      {meta.coreIdea && <p className="text-xs text-muted-foreground italic line-clamp-1">{meta.coreIdea}</p>}
      {bits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bits.map((b, i) => (
            <Badge key={i} variant="outline" className="text-[10px] font-normal">{b}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
