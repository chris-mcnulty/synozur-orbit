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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Image as ImageIcon, Sparkles, Upload, RefreshCw, Calendar, Download, Pencil } from "lucide-react";

interface Speaker {
  name: string;
  isStaff: boolean;
}
interface Session {
  id: string;
  title: string;
  speaker?: string | null;
  speakers?: Speaker[] | null;
  sessionType?: string | null;
  track?: string | null;
  room?: string | null;
  sessionStart?: string | null;
  abstract?: string | null;
  url?: string | null;
  sortOrder: number;
}

const SESSION_TYPE_OPTIONS = ["BREAKOUT", "WORKSHOP", "KEYNOTE", "MEETUP"];

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Session times are floating wall-clock values stored as UTC. Always render in
// UTC so the time shows exactly as it was entered, regardless of viewer timezone.
function formatSessionDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// "YYYY-MM-DDTHH:mm" in UTC — used for CSV export and datetime-local editing so
// the wall-clock round-trips without timezone shifting.
function toWallClock(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// "YYYY-MM-DD" in UTC for <input type="date"> round-tripping without tz shift.
function toDateInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function speakersDisplay(s: Session): string {
  if (s.speakers && s.speakers.length) {
    return s.speakers.map((sp) => (sp.isStaff ? `${sp.name} (staff)` : sp.name)).join(", ");
  }
  return s.speaker ?? "";
}

// ─── CSV helpers (export round-trips with the bulk importer) ──────────────────
function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function speakersToCell(speakers?: Speaker[] | null, legacy?: string | null): string {
  if (speakers && speakers.length) {
    return speakers.map((s) => (s.isStaff ? `${s.name} *` : s.name)).join("; ");
  }
  return legacy ?? "";
}
function parseSpeakersCell(cell: string): Speaker[] {
  return cell
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const isStaff = /\*\s*$/.test(s);
      return { name: s.replace(/\*\s*$/, "").trim(), isStaff };
    })
    .filter((s) => s.name);
}
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}
function exportSessionsCsv(eventName: string, sessions: Session[]): void {
  const header = ["Title", "Type", "Speakers", "Track", "Room", "Start", "URL"];
  const lines = [header.join(",")];
  for (const s of sessions) {
    lines.push(
      [
        s.title ?? "",
        s.sessionType ?? "",
        speakersToCell(s.speakers, s.speaker),
        s.track ?? "",
        s.room ?? "",
        toWallClock(s.sessionStart),
        s.url ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(eventName || "event").replace(/[^\w.-]+/g, "_")}-sessions.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
interface ConfImage {
  id: string;
  sessionId?: string | null;
  role: string;
  source: string;
  name?: string | null;
  imagePrompt?: string | null;
  templateAssetId?: string | null;
  backgroundId?: string | null;
  fileUrl?: string | null;
  status: string;
  createdAt: string;
}
interface ConferenceBackground {
  id: string;
  name?: string | null;
  fileUrl: string;
  fileType?: string | null;
}
interface Conference {
  id: string;
  name: string;
  description?: string | null;
  location?: string | null;
  website?: string | null;
  eventHashtag?: string | null;
  discountStatement?: string | null;
  thematicBrief?: string | null;
  alwaysHashtags?: string[] | null;
  startDate?: string | null;
  endDate?: string | null;
  promoStartDate?: string | null;
  promoEndDate?: string | null;
  includeSaturday?: boolean;
  includeSunday?: boolean;
  postsPerDay: number;
  anchorPostCount: number;
  variantsPerPost: number;
  status: string;
  sessions: Session[];
  images: ConfImage[];
  eventLogoFileUrl?: string | null;
  eventLogoFileType?: string | null;
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

  // Accounts are scoped to the event's own market (the active context always
  // matches the conference's market, since the page 404s otherwise). This keeps
  // each client/market's social accounts isolated — never shared across markets.
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

  const { data: backgrounds = [], refetch: refetchBackgrounds } = useQuery<ConferenceBackground[]>({
    queryKey: ["/api/conferences", id, "backgrounds"],
    queryFn: async () => {
      const r = await fetch(`/api/conferences/${id}/backgrounds`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!id,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: confKey });
    refetchBackgrounds();
  };
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
        <div className="p-6 max-w-6xl mx-auto">Event not found.</div>
      </AppLayout>
    );
  }

  const imageBySession = new Map<string, ConfImage>();
  const anchorImages: ConfImage[] = [];
  for (const img of conf.images) {
    if (img.sessionId) imageBySession.set(img.sessionId, img);
    else if (img.role === "anchor") anchorImages.push(img);
  }
  anchorImages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

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
          <div className="ml-auto">
            <EditEventDialog conf={conf} onSaved={refresh} />
          </div>
        </div>

        <Tabs defaultValue="sessions">
          <TabsList>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="graphics">Graphics</TabsTrigger>
            <TabsTrigger value="generate">Generate & Review</TabsTrigger>
          </TabsList>

          <TabsContent value="sessions" className="pt-4">
            <SessionsTab conferenceId={conf.id} eventName={conf.name} sessions={conf.sessions} onChange={refresh} />
          </TabsContent>

          <TabsContent value="graphics" className="pt-4">
            <GraphicsTab
              conf={conf}
              anchorImages={anchorImages}
              imageBySession={imageBySession}
              templates={imageTemplates}
              backgrounds={backgrounds}
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

// ─── Edit event details ──────────────────────────────────────────────────────────

function EditEventDialog({ conf, onSaved }: { conf: Conference; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => buildEventForm(conf));

  // Re-seed the form whenever the dialog is opened so it reflects the latest data.
  useEffect(() => {
    if (open) setForm(buildEventForm(conf));
  }, [open, conf]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        description: form.description || null,
        location: form.location || null,
        website: form.website || null,
        eventHashtag: form.eventHashtag || null,
        discountStatement: form.discountStatement || null,
        thematicBrief: form.thematicBrief || null,
        alwaysHashtags: form.alwaysHashtags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean),
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        promoStartDate: form.promoStartDate ? new Date(form.promoStartDate).toISOString() : null,
        promoEndDate: form.promoEndDate ? new Date(form.promoEndDate).toISOString() : null,
        postsPerDay: form.postsPerDay,
        anchorPostCount: form.anchorPostCount,
        variantsPerPost: form.variantsPerPost,
        includeSaturday: form.includeSaturday,
        includeSunday: form.includeSunday,
      };
      const r = await fetch(`/api/conferences/${conf.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to save");
      return r.json();
    },
    onSuccess: () => {
      setOpen(false);
      onSaved();
      toast({ title: "Event updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-edit-event">
          <Pencil className="w-4 h-4 mr-1" /> Edit event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label>Event name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-testid="input-edit-event-name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Chicago, IL" />
            </div>
            <div className="grid gap-2">
              <Label>Event hashtag</Label>
              <Input value={form.eventHashtag} onChange={(e) => setForm((f) => ({ ...f, eventHashtag: e.target.value }))} placeholder="#MSIgnite" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Website</Label>
            <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://…" />
          </div>
          <div className="grid gap-2">
            <Label>Registration offer / discount code</Label>
            <Input
              value={form.discountStatement}
              onChange={(e) => setForm((f) => ({ ...f, discountStatement: e.target.value }))}
              placeholder="e.g. Save $200 with registration code SYNOZUR200"
              data-testid="input-edit-discount-statement"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Event start</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Event end</Label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-4">
            <div className="text-sm font-medium">Promotion window & cadence</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Promotion start</Label>
                <Input type="date" value={form.promoStartDate} onChange={(e) => setForm((f) => ({ ...f, promoStartDate: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Promotion end</Label>
                <Input type="date" value={form.promoEndDate} onChange={(e) => setForm((f) => ({ ...f, promoEndDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Posts per day</Label>
                <Input type="number" min={1} max={12} value={form.postsPerDay} onChange={(e) => setForm((f) => ({ ...f, postsPerDay: Number(e.target.value) }))} />
              </div>
              <div className="grid gap-2">
                <Label>Anchor posts</Label>
                <Input type="number" min={1} max={2} value={form.anchorPostCount} onChange={(e) => setForm((f) => ({ ...f, anchorPostCount: Number(e.target.value) }))} />
              </div>
              <div className="grid gap-2">
                <Label>Copy variations</Label>
                <Input type="number" min={2} max={3} value={form.variantsPerPost} onChange={(e) => setForm((f) => ({ ...f, variantsPerPost: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.includeSaturday} onCheckedChange={(v) => setForm((f) => ({ ...f, includeSaturday: v }))} />
                Post Saturdays
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.includeSunday} onCheckedChange={(v) => setForm((f) => ({ ...f, includeSunday: v }))} />
                Post Sundays
              </label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Always-on hashtags</Label>
            <Input value={form.alwaysHashtags} onChange={(e) => setForm((f) => ({ ...f, alwaysHashtags: e.target.value }))} placeholder="comma or space separated" />
          </div>
          <div className="grid gap-2">
            <Label>Theme / brief (guides AI copy & graphics)</Label>
            <Textarea rows={3} value={form.thematicBrief} onChange={(e) => setForm((f) => ({ ...f, thematicBrief: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending} data-testid="button-save-event">
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildEventForm(conf: Conference) {
  return {
    name: conf.name ?? "",
    description: conf.description ?? "",
    location: conf.location ?? "",
    website: conf.website ?? "",
    eventHashtag: conf.eventHashtag ?? "",
    discountStatement: conf.discountStatement ?? "",
    thematicBrief: conf.thematicBrief ?? "",
    alwaysHashtags: (conf.alwaysHashtags ?? []).join(" "),
    startDate: toDateInput(conf.startDate),
    endDate: toDateInput(conf.endDate),
    promoStartDate: toDateInput(conf.promoStartDate),
    promoEndDate: toDateInput(conf.promoEndDate),
    postsPerDay: conf.postsPerDay ?? 2,
    anchorPostCount: conf.anchorPostCount ?? 2,
    variantsPerPost: conf.variantsPerPost ?? 3,
    includeSaturday: !!conf.includeSaturday,
    includeSunday: !!conf.includeSunday,
  };
}

// ─── Sessions ──────────────────────────────────────────────────────────────────

function SessionsTab({
  conferenceId,
  eventName,
  sessions,
  onChange,
}: {
  conferenceId: string;
  eventName: string;
  sessions: Session[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [sessionType, setSessionType] = useState("");
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
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
          sessionType: sessionType || undefined,
          speakers: speakers.filter((s) => s.name.trim()),
          sessionStart: sessionStart || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      return r.json();
    },
    onSuccess: () => {
      setTitle("");
      setSessionType("");
      setSpeakers([]);
      setSessionStart("");
      onChange();
      toast({ title: "Session added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkImport = useMutation({
    mutationFn: async () => {
      // Parse pasted rows: title, type, speakers, track, room, start(ISO/date), url.
      // Tab or comma separated, with quote support so it round-trips with export.
      const lines = bulkText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const delim = lines[0]?.includes("\t") ? "\t" : ",";
      const rows = lines
        .map((line) => splitCsvLine(line, delim))
        .filter((cols, idx) => !(idx === 0 && (cols[0] || "").toLowerCase() === "title")) // skip header row
        .map((cols) => {
          const [t, type, speakersCell, track, room, start, url] = cols.map((c) => (c || "").trim());
          return {
            title: t,
            sessionType: type || undefined,
            speakers: parseSpeakersCell(speakersCell || ""),
            track: track || undefined,
            room: room || undefined,
            // Send the raw string; the server validates/parses it (invalid
            // timestamps become null rather than crashing the import here).
            sessionStart: start || undefined,
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
            <Button variant="outline" size="sm" onClick={() => setBulkOpen((v) => !v)} data-testid="button-toggle-bulk">
              {bulkOpen ? "Single entry" : "Bulk paste / CSV"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bulkOpen ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                One session per line. Columns (tab or comma separated):{" "}
                <code>title, type, speakers, track, room, start, url</code>. Only title is required. List multiple
                speakers separated by <code>;</code> and add <code>*</code> after a name to mark them as your staff
                (e.g. <code>Jane Doe *; John External</code>). A header row is optional. Use Export CSV to get a
                ready-to-edit template.
              </p>
              <Textarea
                rows={6}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"Building Agents with Claude, KEYNOTE, Jane Doe *; John External, AI Track, Room 101, 2026-09-15 14:00, https://…"}
                data-testid="textarea-bulk-sessions"
              />
              <Button onClick={() => bulkImport.mutate()} disabled={!bulkText.trim() || bulkImport.isPending}>
                {bulkImport.isPending ? "Importing…" : "Import sessions"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[2fr,1fr,1fr] items-end">
                <div className="grid gap-1">
                  <Label>Title *</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-session-title" />
                </div>
                <div className="grid gap-1">
                  <Label>Type</Label>
                  <Select value={sessionType || "none"} onValueChange={(v) => setSessionType(v === "none" ? "" : v)}>
                    <SelectTrigger data-testid="select-session-type">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {SESSION_TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {titleCase(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label>Start</Label>
                  <Input type="datetime-local" value={sessionStart} onChange={(e) => setSessionStart(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Enter the time as it appears in the event's local schedule. It displays exactly as typed.</p>
                </div>
              </div>

              <div className="grid gap-1">
                <Label>Speakers</Label>
                <div className="space-y-2">
                  {speakers.map((sp, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={sp.name}
                        placeholder="Speaker name"
                        onChange={(e) =>
                          setSpeakers((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                        }
                        data-testid={`input-speaker-name-${i}`}
                      />
                      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                        <Switch
                          checked={sp.isStaff}
                          onCheckedChange={(v) =>
                            setSpeakers((arr) => arr.map((x, j) => (j === i ? { ...x, isStaff: v } : x)))
                          }
                          data-testid={`switch-speaker-staff-${i}`}
                        />
                        Our staff
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSpeakers((arr) => arr.filter((_, j) => j !== i))}
                        data-testid={`button-remove-speaker-${i}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSpeakers((arr) => [...arr, { name: "", isStaff: false }])}
                    data-testid="button-add-speaker"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add speaker
                  </Button>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => add.mutate()} disabled={!title.trim() || add.isPending} data-testid="button-add-session">
                  <Plus className="w-4 h-4 mr-1" /> Add session
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            Sessions ({sessions.length})
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportSessionsCsv(eventName, sessions)}
              disabled={sessions.length === 0}
              data-testid="button-export-sessions"
            >
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => {
                const meta = [speakersDisplay(s) || null, s.track, formatSessionDateTime(s.sessionStart) || null]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={s.id} className="py-2 flex items-center justify-between gap-3" data-testid={`row-session-${s.id}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{s.title}</p>
                        {s.sessionType && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {titleCase(s.sessionType)}
                          </Badge>
                        )}
                      </div>
                      {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <EditSessionDialog session={s} onSaved={onChange} />
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(s.id)} data-testid={`button-delete-session-${s.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EditSessionDialog({ session, onSaved }: { session: Session; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [sessionType, setSessionType] = useState(session.sessionType ?? "");
  const [track, setTrack] = useState(session.track ?? "");
  const [room, setRoom] = useState(session.room ?? "");
  const [url, setUrl] = useState(session.url ?? "");
  const [sessionStart, setSessionStart] = useState(toWallClock(session.sessionStart));
  const [speakers, setSpeakers] = useState<Speaker[]>(
    session.speakers && session.speakers.length
      ? session.speakers
      : session.speaker
        ? [{ name: session.speaker, isStaff: false }]
        : [],
  );

  // Re-seed all fields from the latest session data when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTitle(session.title);
    setSessionType(session.sessionType ?? "");
    setTrack(session.track ?? "");
    setRoom(session.room ?? "");
    setUrl(session.url ?? "");
    setSessionStart(toWallClock(session.sessionStart));
    setSpeakers(
      session.speakers && session.speakers.length
        ? session.speakers
        : session.speaker
          ? [{ name: session.speaker, isStaff: false }]
          : [],
    );
  }, [open, session]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/conference-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          sessionType: sessionType || null,
          track: track || null,
          room: room || null,
          url: url || null,
          sessionStart: sessionStart || null,
          speakers: speakers.filter((s) => s.name.trim()),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to save");
      return r.json();
    },
    onSuccess: () => {
      setOpen(false);
      onSaved();
      toast({ title: "Session updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" data-testid={`button-edit-session-${session.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid gap-1">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-edit-session-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Type</Label>
              <Select value={sessionType || "none"} onValueChange={(v) => setSessionType(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="select-edit-session-type">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {SESSION_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Start</Label>
              <Input type="datetime-local" value={sessionStart} onChange={(e) => setSessionStart(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Track</Label>
              <Input value={track} onChange={(e) => setTrack(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Room</Label>
              <Input value={room} onChange={(e) => setRoom(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Session URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="grid gap-1">
            <Label>Speakers</Label>
            <div className="space-y-2">
              {speakers.map((sp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={sp.name}
                    placeholder="Speaker name"
                    onChange={(e) => setSpeakers((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    data-testid={`input-edit-speaker-name-${i}`}
                  />
                  <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <Switch
                      checked={sp.isStaff}
                      onCheckedChange={(v) => setSpeakers((arr) => arr.map((x, j) => (j === i ? { ...x, isStaff: v } : x)))}
                    />
                    Our staff
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => setSpeakers((arr) => arr.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSpeakers((arr) => [...arr, { name: "", isStaff: false }])}
                data-testid="button-edit-add-speaker"
              >
                <Plus className="w-4 h-4 mr-1" /> Add speaker
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending} data-testid="button-save-session">
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Graphics ──────────────────────────────────────────────────────────────────

function GraphicsTab({
  conf,
  anchorImages,
  imageBySession,
  templates,
  backgrounds,
  onChange,
}: {
  conf: Conference;
  anchorImages: ConfImage[];
  imageBySession: Map<string, ConfImage>;
  templates: BrandAsset[];
  backgrounds: ConferenceBackground[];
  onChange: () => void;
}) {
  const { toast } = useToast();

  const addAnchorImage = async () => {
    try {
      const r = await fetch(`/api/conferences/${conf.id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: "anchor", source: "logo_composite" }),
      });
      if (!r.ok) throw new Error("Failed to create anchor image slot");
      onChange();
      toast({ title: "Anchor image slot added" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const deleteAnchorImage = async (imgId: string) => {
    try {
      await fetch(`/api/conference-images/${imgId}/archive`, { method: "POST", credentials: "include" });
      onChange();
    } catch { /* ignore */ }
  };

  const uploadEventLogo = async (file: File) => {
    try {
      const objectPath = await uploadFile(file);
      const r = await fetch(`/api/conferences/${conf.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventLogoFileUrl: objectPath, eventLogoFileType: file.type }),
      });
      if (!r.ok) throw new Error("Failed to save event logo");
      onChange();
      toast({ title: "Event logo uploaded" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const uploadBackground = async (file: File) => {
    try {
      const objectPath = await uploadFile(file);
      const r = await fetch(`/api/conferences/${conf.id}/backgrounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fileUrl: objectPath, fileType: file.type, name: file.name, fileSize: file.size }),
      });
      if (!r.ok) throw new Error("Failed to save background");
      onChange();
      toast({ title: "Location photo added" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const deleteBackground = async (bgId: string) => {
    try {
      await fetch(`/api/conference-backgrounds/${bgId}`, { method: "DELETE", credentials: "include" });
      onChange();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      {/* ── Conference Media ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conference media</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Event logo */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Event / conference logo</p>
            <p className="text-xs text-muted-foreground">Used as the centred event mark in hero composites.</p>
            <div className="flex items-center gap-3">
              {conf.eventLogoFileUrl && (
                <div className="h-14 w-28 rounded border bg-muted/40 flex items-center justify-center overflow-hidden">
                  <img src={conf.eventLogoFileUrl} alt="Event logo" className="max-h-full max-w-full object-contain" />
                </div>
              )}
              <label className="inline-flex">
                <input
                  type="file"
                  accept="image/*,.svg"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadEventLogo(e.target.files[0])}
                  data-testid="input-upload-event-logo"
                />
                <Button asChild variant="outline" size="sm">
                  <span><Upload className="w-3.5 h-3.5 mr-1" /> {conf.eventLogoFileUrl ? "Replace" : "Upload logo"}</span>
                </Button>
              </label>
            </div>
          </div>

          {/* Location background photos */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Location / venue photos</p>
            <p className="text-xs text-muted-foreground">Background images for the hero composite. Upload one or more; pick one per image slot.</p>
            <div className="flex flex-wrap gap-2">
              {backgrounds.map((bg) => (
                <div key={bg.id} className="relative group rounded border overflow-hidden bg-muted/40 w-28 h-16 flex items-center justify-center">
                  <img src={bg.fileUrl} alt={bg.name || "background"} className="w-full h-full object-cover" />
                  <button
                    className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 rounded-full p-0.5 text-destructive"
                    onClick={() => deleteBackground(bg.id)}
                    data-testid={`button-delete-bg-${bg.id}`}
                    title="Remove"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <label className="inline-flex">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadBackground(e.target.files[0])}
                  data-testid="input-upload-background"
                />
                <Button asChild variant="outline" size="sm" className="h-16 w-28 flex-col gap-1">
                  <span>
                    <Plus className="w-4 h-4" />
                    <span className="text-xs">Add photo</span>
                  </span>
                </Button>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Anchor graphics (up to 3) ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            Anchor graphics
            <span className="text-xs text-muted-foreground font-normal">
              {anchorImages.length > 0
                ? `Scheduled ${anchorImages.length}× more often than session posts`
                : "Add up to 3 — scheduled more frequently than session posts"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {anchorImages.length === 0 && (
            <p className="text-sm text-muted-foreground">No anchor images yet. Add one below.</p>
          )}
          {anchorImages.map((img, idx) => (
            <div key={img.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Anchor {idx + 1}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => deleteAnchorImage(img.id)}
                  data-testid={`button-delete-anchor-${img.id}`}
                  title="Remove anchor image"
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
              <ImageSlot
                conferenceId={conf.id}
                role="anchor"
                sessionId={null}
                image={img}
                templates={templates}
                backgrounds={backgrounds}
                isAnchor={true}
                onChange={onChange}
              />
            </div>
          ))}
          {anchorImages.length < 3 && (
            <Button
              variant="outline"
              size="sm"
              onClick={addAnchorImage}
              data-testid="button-add-anchor-image"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add anchor image
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Session graphics ─────────────────────────────────────────────── */}
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
                  backgrounds={backgrounds}
                  isAnchor={false}
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
  backgrounds,
  isAnchor,
  onChange,
}: {
  conferenceId: string;
  role: string;
  sessionId: string | null;
  image?: ConfImage;
  templates: BrandAsset[];
  backgrounds: ConferenceBackground[];
  isAnchor: boolean;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [source, setSource] = useState<string>(image?.source || "ai_generated");
  const [prompt, setPrompt] = useState(image?.imagePrompt || "");
  const [templateId, setTemplateId] = useState(image?.templateAssetId || "");
  const [backgroundId, setBackgroundId] = useState(image?.backgroundId || "");
  const [busy, setBusy] = useState(false);

  const ensureImage = async (overrides: Partial<ConfImage> & { fileUrl?: string }) => {
    if (!image) {
      const r = await fetch(`/api/conferences/${conferenceId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          role,
          sessionId,
          source,
          imagePrompt: prompt,
          templateAssetId: templateId || undefined,
          backgroundId: backgroundId || undefined,
          ...overrides,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to create image");
      return (await r.json()) as ConfImage;
    }
    const r = await fetch(`/api/conference-images/${image.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        source,
        imagePrompt: prompt,
        templateAssetId: templateId || null,
        backgroundId: backgroundId || null,
        ...overrides,
      }),
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
      await ensureImage({ source: "uploaded", fileUrl: objectPath, fileType: file.type } as any);
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
              {isAnchor && (
                <SelectItem value="logo_composite">Hero composite (brand + event logo)</SelectItem>
              )}
              <SelectItem value="ai_generated">AI-generated</SelectItem>
              <SelectItem value="template_composite">Brand image + text overlay</SelectItem>
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

        {source === "logo_composite" && (
          <div className="grid gap-1">
            <Label className="text-xs">Background photo (from Conference Media)</Label>
            <Select value={backgroundId || "__none"} onValueChange={v => setBackgroundId(v === "__none" ? "" : v)}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="None (branded gradient)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None (branded gradient)</SelectItem>
                {backgrounds.map((bg) => (
                  <SelectItem key={bg.id} value={bg.id}>
                    {bg.name || bg.fileUrl.split("/").pop() || bg.id}
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
  const [includePublished, setIncludePublished] = useState(false);
  const [csvFormat, setCsvFormat] = useState<string>("generic");
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
        body: JSON.stringify({ socialAccountIds: selected, generateImages, includePublished, tzOffset: new Date().getTimezoneOffset() }),
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

  const exportCsv = useMutation({
    mutationFn: async () => {
      const tzOffset = new Date().getTimezoneOffset();
      const r = await fetch(
        `/api/conferences/${conferenceId}/export-csv?format=${csvFormat}&tzOffset=${tzOffset}&excludeUndated=false`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `event-posts-${csvFormat}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
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

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includePublished} onCheckedChange={setIncludePublished} data-testid="switch-include-published" />
            Also replace posts I've already published
          </label>

          <p className="text-xs text-muted-foreground">
            Generates {sessions.length} session posts + anchor posts, each with multiple copy variations, scheduled across
            your promotion window. Re-running replaces all unpublished drafts
            {includePublished ? " and your already-published posts" : " (published posts are kept)"}.
          </p>

          <Button
            onClick={() => {
              if (
                includePublished &&
                !window.confirm("This will delete and replace your already-published posts too. This can't be undone. Continue?")
              ) {
                return;
              }
              generate.mutate();
            }}
            disabled={selected.length === 0 || generate.isPending || polling}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${polling ? "animate-spin" : ""}`} />
            {polling ? "Generating…" : "Generate posts"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Review ({groups.length} posts, {posts.length} variations)</CardTitle>
            {posts.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={csvFormat} onValueChange={setCsvFormat}>
                  <SelectTrigger className="w-40" data-testid="select-csv-format-event">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">Generic (Copy/Paste)</SelectItem>
                    <SelectItem value="socialpilot">SocialPilot</SelectItem>
                    <SelectItem value="hootsuite">Hootsuite</SelectItem>
                    <SelectItem value="sproutsocial">Sprout Social</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => exportCsv.mutate()}
                  disabled={exportCsv.isPending}
                  data-testid="button-export-csv-event"
                >
                  <Download className="w-4 h-4" />Export CSV
                </Button>
              </div>
            )}
          </div>
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
