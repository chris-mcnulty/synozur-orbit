import { useState, useMemo, useEffect } from "react";
import { useParams, Link } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Image as ImageIcon, Sparkles, Upload, RefreshCw, Calendar } from "lucide-react";

interface Session {
  id: string;
  title: string;
  speaker?: string | null;
  track?: string | null;
  room?: string | null;
  sessionStart?: string | null;
  abstract?: string | null;
  url?: string | null;
  sortOrder: number;
}
interface ConfImage {
  id: string;
  sessionId?: string | null;
  role: string;
  source: string;
  name?: string | null;
  imagePrompt?: string | null;
  templateAssetId?: string | null;
  fileUrl?: string | null;
  status: string;
}
interface Conference {
  id: string;
  name: string;
  location?: string | null;
  eventHashtag?: string | null;
  postsPerDay: number;
  anchorPostCount: number;
  variantsPerPost: number;
  status: string;
  sessions: Session[];
  images: ConfImage[];
}
interface Post {
  id: string;
  platform: string;
  content: string;
  hashtags?: string[];
  postRole?: string | null;
  conferenceSessionId?: string | null;
  variantGroup?: string | null;
  scheduledDate?: string | null;
  overrideImageUrl?: string | null;
  status: string;
}
interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
}
interface BrandAsset {
  id: string;
  name: string;
  fileUrl?: string | null;
  fileType?: string | null;
}

async function uploadFile(file: File): Promise<string> {
  const reqRes = await fetch("/api/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!reqRes.ok) throw new Error((await reqRes.json().catch(() => ({}))).error || "Upload request failed");
  const { uploadURL, objectPath } = await reqRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("File upload failed");
  return objectPath;
}

export default function ConferenceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const confKey = ["/api/conferences", id];

  const { data: conf, isLoading } = useQuery<Conference>({
    queryKey: confKey,
    queryFn: async () => {
      const r = await fetch(`/api/conferences/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
  });

  const { data: accounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: brandAssets = [] } = useQuery<BrandAsset[]>({
    queryKey: ["/api/brand-assets"],
    queryFn: async () => {
      const r = await fetch("/api/brand-assets", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: confKey });
  const imageTemplates = brandAssets.filter((a) => (a.fileType || "").startsWith("image/"));

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 max-w-6xl mx-auto">Loading…</div>
      </AppLayout>
    );
  }
  if (!conf) {
    return (
      <AppLayout>
        <div className="p-6 max-w-6xl mx-auto">Conference not found.</div>
      </AppLayout>
    );
  }

  const imageBySession = new Map<string, ConfImage>();
  let anchorImage: ConfImage | undefined;
  for (const img of conf.images) {
    if (img.sessionId) imageBySession.set(img.sessionId, img);
    else if (img.role === "anchor" && !anchorImage) anchorImage = img;
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/app/marketing/conferences">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{conf.name}</h1>
            <p className="text-sm text-muted-foreground">
              {conf.location ? `${conf.location} · ` : ""}
              {conf.sessions.length} sessions · {conf.postsPerDay} posts/day · {conf.variantsPerPost} variations/post
            </p>
          </div>
          {conf.status === "archived" && <Badge variant="secondary">Archived</Badge>}
        </div>

        <Tabs defaultValue="sessions">
          <TabsList>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="graphics">Graphics</TabsTrigger>
            <TabsTrigger value="generate">Generate & Review</TabsTrigger>
          </TabsList>

          <TabsContent value="sessions" className="pt-4">
            <SessionsTab conferenceId={conf.id} sessions={conf.sessions} onChange={refresh} />
          </TabsContent>

          <TabsContent value="graphics" className="pt-4">
            <GraphicsTab
              conf={conf}
              anchorImage={anchorImage}
              imageBySession={imageBySession}
              templates={imageTemplates}
              onChange={refresh}
            />
          </TabsContent>

          <TabsContent value="generate" className="pt-4">
            <GenerateTab conferenceId={conf.id} accounts={accounts} sessions={conf.sessions} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// ─── Sessions ──────────────────────────────────────────────────────────────────

function SessionsTab({ conferenceId, sessions, onChange }: { conferenceId: string; sessions: Session[]; onChange: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [sessionStart, setSessionStart] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  const add = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/conferences/${conferenceId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          speaker,
          sessionStart: sessionStart ? new Date(sessionStart).toISOString() : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      return r.json();
    },
    onSuccess: () => {
      setTitle("");
      setSpeaker("");
      setSessionStart("");
      onChange();
      toast({ title: "Session added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkImport = useMutation({
    mutationFn: async () => {
      // Parse pasted rows: title, speaker, track, room, start(ISO/date), url — tab or comma separated.
      const rows = bulkText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const cols = line.includes("\t") ? line.split("\t") : line.split(",");
          const [title, speaker, track, room, start, url] = cols.map((c) => (c || "").trim());
          return {
            title,
            speaker: speaker || undefined,
            track: track || undefined,
            room: room || undefined,
            sessionStart: start ? new Date(start).toISOString() : undefined,
            url: url || undefined,
          };
        })
        .filter((s) => s.title);
      const r = await fetch(`/api/conferences/${conferenceId}/sessions/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessions: rows }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Import failed");
      return r.json();
    },
    onSuccess: (data: { created: number }) => {
      setBulkText("");
      setBulkOpen(false);
      onChange();
      toast({ title: `Imported ${data.created} sessions` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (sid: string) => {
      const r = await fetch(`/api/conference-sessions/${sid}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: onChange,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Add a session
            <Button variant="outline" size="sm" onClick={() => setBulkOpen((v) => !v)}>
              {bulkOpen ? "Single entry" : "Bulk paste / CSV"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bulkOpen ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                One session per line. Columns (tab or comma separated):{" "}
                <code>title, speaker, track, room, start, url</code>. Only title is required.
              </p>
              <Textarea
                rows={6}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"Building Agents with Claude, Jane Doe, AI Track, Room 101, 2026-09-15 14:00, https://…"}
                data-testid="textarea-bulk-sessions"
              />
              <Button onClick={() => bulkImport.mutate()} disabled={!bulkText.trim() || bulkImport.isPending}>
                {bulkImport.isPending ? "Importing…" : "Import sessions"}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[2fr,1fr,1fr,auto] items-end">
              <div className="grid gap-1">
                <Label>Title *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-session-title" />
              </div>
              <div className="grid gap-1">
                <Label>Speaker</Label>
                <Input value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Start</Label>
                <Input type="datetime-local" value={sessionStart} onChange={(e) => setSessionStart(e.target.value)} />
              </div>
              <Button onClick={() => add.mutate()} disabled={!title.trim() || add.isPending}>
                <Plus className="w-4 h-4 mr-1" /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sessions ({sessions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => (
                <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[s.speaker, s.track, s.sessionStart ? new Date(s.sessionStart).toLocaleString() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(s.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Graphics ──────────────────────────────────────────────────────────────────

function GraphicsTab({
  conf,
  anchorImage,
  imageBySession,
  templates,
  onChange,
}: {
  conf: Conference;
  anchorImage?: ConfImage;
  imageBySession: Map<string, ConfImage>;
  templates: BrandAsset[];
  onChange: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Anchor graphic (overall presence)</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageSlot
            conferenceId={conf.id}
            role="anchor"
            sessionId={null}
            image={anchorImage}
            templates={templates}
            onChange={onChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session graphics — one per session (1:1)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {conf.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add sessions first.</p>
          ) : (
            conf.sessions.map((s) => (
              <div key={s.id} className="rounded-md border p-3">
                <p className="font-medium mb-2 truncate">{s.title}</p>
                <ImageSlot
                  conferenceId={conf.id}
                  role="session"
                  sessionId={s.id}
                  image={imageBySession.get(s.id)}
                  templates={templates}
                  onChange={onChange}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImageSlot({
  conferenceId,
  role,
  sessionId,
  image,
  templates,
  onChange,
}: {
  conferenceId: string;
  role: string;
  sessionId: string | null;
  image?: ConfImage;
  templates: BrandAsset[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [source, setSource] = useState<string>(image?.source || "ai_generated");
  const [prompt, setPrompt] = useState(image?.imagePrompt || "");
  const [templateId, setTemplateId] = useState(image?.templateAssetId || "");
  const [busy, setBusy] = useState(false);

  const ensureImage = async (overrides: Partial<ConfImage> & { fileUrl?: string }) => {
    // Create the image row if it doesn't exist, else patch it.
    if (!image) {
      const r = await fetch(`/api/conferences/${conferenceId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role, sessionId, source, imagePrompt: prompt, templateAssetId: templateId || undefined, ...overrides }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to create image");
      return (await r.json()) as ConfImage;
    }
    const r = await fetch(`/api/conference-images/${image.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ source, imagePrompt: prompt, templateAssetId: templateId || null, ...overrides }),
    });
    if (!r.ok) throw new Error("Failed to update image");
    return (await r.json()) as ConfImage;
  };

  const render = async () => {
    setBusy(true);
    try {
      const img = await ensureImage({});
      const r = await fetch(`/api/conference-images/${img.id}/render`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Render failed");
      onChange();
      toast({ title: "Graphic generated" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setBusy(true);
    try {
      const objectPath = await uploadFile(file);
      await ensureImage({ source: "uploaded", fileUrl: objectPath } as any);
      onChange();
      toast({ title: "Image uploaded" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-[160px,1fr] items-start">
      <div className="aspect-video rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden">
        {image?.fileUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.fileUrl} alt={image.name || "graphic"} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-6 h-6 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-3">
        <div className="grid gap-1">
          <Label className="text-xs">Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ai_generated">AI-generated</SelectItem>
              <SelectItem value="template_composite">Composite on template</SelectItem>
              <SelectItem value="uploaded">Upload my own</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {source === "ai_generated" && (
          <Textarea
            rows={2}
            placeholder="Optional image prompt (we generate a sensible default from the session if blank)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        )}

        {source === "template_composite" && (
          <div className="grid gap-1">
            <Label className="text-xs">Background template (from Brand Library)</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="None (branded gradient)" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 && <SelectItem value="__none" disabled>No image assets found</SelectItem>}
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2">
          {source === "uploaded" ? (
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              />
              <Button asChild size="sm" disabled={busy}>
                <span>
                  <Upload className="w-4 h-4 mr-1" /> {busy ? "Uploading…" : "Upload"}
                </span>
              </Button>
            </label>
          ) : (
            <Button size="sm" onClick={render} disabled={busy}>
              <Sparkles className="w-4 h-4 mr-1" /> {busy ? "Working…" : image?.fileUrl ? "Regenerate" : "Generate"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Generate & Review ──────────────────────────────────────────────────────────

function GenerateTab({
  conferenceId,
  accounts,
  sessions,
}: {
  conferenceId: string;
  accounts: SocialAccount[];
  sessions: Session[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [generateImages, setGenerateImages] = useState(true);
  const [polling, setPolling] = useState(false);

  const { data: status } = useQuery<{ status: string; errorMessage?: string | null }>({
    queryKey: ["/api/conferences", conferenceId, "gen-status"],
    queryFn: async () => {
      const r = await fetch(`/api/conferences/${conferenceId}/generate-posts-status`, { credentials: "include" });
      return r.ok ? r.json() : { status: "unknown" };
    },
    refetchInterval: polling ? 2500 : false,
  });

  const { data: posts = [], refetch: refetchPosts } = useQuery<Post[]>({
    queryKey: ["/api/conferences", conferenceId, "posts"],
    queryFn: async () => {
      const r = await fetch(`/api/conferences/${conferenceId}/posts`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  // Stop polling + refresh posts once generation settles.
  useEffect(() => {
    if (polling && status && (status.status === "completed" || status.status === "failed")) {
      setPolling(false);
      refetchPosts();
      queryClient.invalidateQueries({ queryKey: ["/api/conferences", conferenceId] });
      if (status.status === "failed") {
        toast({ title: "Generation failed", description: status.errorMessage || undefined, variant: "destructive" });
      } else {
        toast({ title: "Posts generated" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, status?.status]);

  const generate = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/conferences/${conferenceId}/generate-posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialAccountIds: selected, generateImages }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to start");
      return r.json();
    },
    onSuccess: () => {
      setPolling(true);
      toast({ title: "Generating posts…", description: "This runs in the background." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const groups = useMemo(() => groupPosts(posts), [posts]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate posts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Publish to accounts</Label>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">
                No social accounts yet.{" "}
                <Link href="/app/marketing/social-accounts" className="underline">
                  Connect one
                </Link>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      selected.includes(a.id) ? "bg-primary text-primary-foreground border-primary" : "bg-muted"
                    }`}
                  >
                    {a.accountName} · {a.platform}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={generateImages} onCheckedChange={setGenerateImages} />
            Auto-render graphics that don't have an image yet
          </label>

          <p className="text-xs text-muted-foreground">
            Generates {sessions.length} session posts + anchor posts, each with multiple copy variations, scheduled across
            your promotion window. Re-running replaces unpublished drafts.
          </p>

          <Button
            onClick={() => generate.mutate()}
            disabled={selected.length === 0 || generate.isPending || polling}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${polling ? "animate-spin" : ""}`} />
            {polling ? "Generating…" : "Generate posts"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review ({groups.length} posts, {posts.length} variations)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts yet. Generate to see drafts here.</p>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={g.postRole === "anchor" ? "default" : "secondary"}>
                      {g.postRole === "anchor" ? "Anchor" : "Session"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{g.platform}</span>
                  </div>
                  {g.scheduledDate && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(g.scheduledDate).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-[120px,1fr]">
                  <div className="aspect-video rounded border bg-muted/40 flex items-center justify-center overflow-hidden">
                    {g.imageUrl ? (
                      <img src={g.imageUrl} alt="graphic" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-2">
                    {g.variants.map((v, i) => (
                      <div key={v.id} className="text-sm">
                        <span className="text-xs font-semibold text-muted-foreground">Variation {i + 1}</span>
                        <p className="whitespace-pre-wrap">{v.content}</p>
                        {v.hashtags && v.hashtags.length > 0 && (
                          <p className="text-xs text-primary mt-0.5">{v.hashtags.map((h) => `#${h}`).join(" ")}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface PostGroup {
  key: string;
  postRole?: string | null;
  platform: string;
  scheduledDate?: string | null;
  imageUrl?: string | null;
  variants: Post[];
}

function groupPosts(posts: Post[]): PostGroup[] {
  const map = new Map<string, PostGroup>();
  for (const p of posts) {
    const key = p.variantGroup || p.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        postRole: p.postRole,
        platform: p.platform,
        scheduledDate: p.scheduledDate,
        imageUrl: p.overrideImageUrl,
        variants: [],
      });
    }
    map.get(key)!.variants.push(p);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.postRole === "anchor" && b.postRole !== "anchor") return -1;
    if (b.postRole === "anchor" && a.postRole !== "anchor") return 1;
    return (a.scheduledDate || "").localeCompare(b.scheduledDate || "");
  });
}
