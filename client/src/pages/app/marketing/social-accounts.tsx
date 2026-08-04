import { useEffect, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Plus, Trash2, Lock, Pencil, Link as LinkIcon, Unlink, AlertTriangle, CheckCircle2, Mic, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const PLATFORMS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "X / Twitter" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "bluesky", label: "Bluesky" },
];

interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  accountId?: string;
  profileUrl?: string;
  notes?: string;
  status: string;
  encryptedAccessToken?: string | null;
  authorMode?: string | null;
  authorUrn?: string | null;
  availableAuthors?: Array<{ mode: "person" | "organization"; urn: string; name: string; vanityName?: string | null }> | null;
  connectedAt?: string | null;
  tokenExpiresAt?: string | null;
  lastPublishError?: string | null;
  status?: string | null;
}

function LinkedInAuthorPicker({ account }: { account: SocialAccount }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const authors = account.availableAuthors ?? [];
  const selectMutation = useMutation({
    mutationFn: async (authorUrn: string) => {
      const r = await fetch(`/api/social-accounts/${account.id}/linkedin/select-author`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ authorUrn }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to switch author");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Publishing identity updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/social-accounts/${account.id}/linkedin/authors?refresh=1`, { credentials: "include" });
      if (!r.ok) throw new Error("Refresh failed");
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Refreshed company pages" });
    } catch (err: any) {
      toast({ title: "Could not refresh", description: err.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };
  if (authors.length <= 1) {
    return (
      <div className="text-xs text-muted-foreground" data-testid={`text-author-${account.id}`}>
        Publishing as: <strong>{account.accountName}</strong> (personal)
        <Button variant="ghost" size="sm" className="text-xs h-6 ml-2" onClick={refresh} disabled={refreshing} data-testid={`button-refresh-orgs-${account.id}`}>
          {refreshing ? "Refreshing..." : "Refresh company pages"}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs">Publish as</Label>
      <div className="flex gap-2">
        <Select value={account.authorUrn ?? ""} onValueChange={v => selectMutation.mutate(v)}>
          <SelectTrigger className="h-8 text-xs" data-testid={`select-author-${account.id}`}>
            <SelectValue placeholder="Choose identity..." />
          </SelectTrigger>
          <SelectContent>
            {authors.map(a => (
              <SelectItem key={a.urn} value={a.urn}>
                {a.name} ({a.mode === "organization" ? "Company page" : "Personal"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="text-xs h-8" onClick={refresh} disabled={refreshing} data-testid={`button-refresh-orgs-${account.id}`}>
          {refreshing ? "..." : "Refresh"}
        </Button>
      </div>
    </div>
  );
}

const DIRECT_PUBLISH_PLATFORMS = new Set(["linkedin", "twitter", "facebook", "instagram", "bluesky"]);
// Platforms that don't use the standard /oauth/connect flow.
const NON_OAUTH_PLATFORMS = new Set(["bluesky"]);

// ─── Bluesky connect dialog (app-password flow, non-OAuth) ───────────────────

function BlueskyConnectDialog({
  account, open, onOpenChange,
}: {
  account: SocialAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [appPassword, setAppPassword] = useState("");

  const connectMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/social-accounts/${account.id}/bluesky/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier: identifier.trim(), appPassword: appPassword.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Connect failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Bluesky connected" });
      onOpenChange(false);
      setIdentifier("");
      setAppPassword("");
    },
    onError: (err: Error) => toast({ title: "Connect failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Bluesky — {account.accountName}</DialogTitle>
          <DialogDescription>
            Bluesky uses app passwords instead of OAuth. Generate one at{" "}
            <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener noreferrer" className="underline">
              bsky.app/settings/app-passwords
            </a>{" "}
            and paste it below. The password is encrypted at rest.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Handle or email</Label>
            <Input
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="alice.bsky.social"
              data-testid="bluesky-input-identifier"
            />
          </div>
          <div>
            <Label className="text-xs">App password</Label>
            <Input
              type="password"
              value={appPassword}
              onChange={e => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              data-testid="bluesky-input-password"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} data-testid="bluesky-cancel">
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => connectMutation.mutate()}
              disabled={!identifier.trim() || !appPassword.trim() || connectMutation.isPending}
              data-testid="bluesky-connect-submit"
            >
              {connectMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Voice Profile Editor ────────────────────────────────────────────────────

type FrameworkRefKind = "long_form" | "grounding" | "global";
interface FrameworkRef { kind: FrameworkRefKind; id: string }
interface FrameworkItem {
  kind: FrameworkRefKind;
  id: string;
  label: string;
  scope: "market" | "tenant" | "global";
  category?: string;
  updatedAt?: string;
}
interface ToneAttrs {
  formal?: number; playful?: number; technical?: number; warm?: number; bold?: number;
}
interface SampleSnippet { label?: string; content: string }
interface VoiceProfile {
  id?: string;
  socialAccountId: string;
  person: "first" | "third";
  authorPerspective: "individual" | "brand";
  toneAttributes?: ToneAttrs | null;
  styleGuidance?: string | null;
  soundLikeMeInstructions?: string | null;
  forbiddenPhrases?: string[] | null;
  preferredPhrases?: string[] | null;
  emojiPolicy: "none" | "sparing" | "liberal";
  hashtagPolicy: "none" | "minimal" | "standard" | "heavy";
  maxLength?: number | null;
  sampleSnippets?: SampleSnippet[];
  defaultPersonaId?: string | null;
  defaultFrameworkRefs?: FrameworkRef[];
  isUnsaved?: boolean;
}
interface PersonaRow { id: string; name: string; role?: string | null; isIcp?: boolean }

const SOUND_LIKE_ME_STARTER = `Banned words & phrases: leverage, unlock, delve, certainly, it's worth noting,
game-changer, deep dive, at the end of the day, empower, seamlessly, groundbreaking,
I'd be happy to, Absolutely!, robust, cutting-edge, in today's fast-paced world.

Style rules:
- Short sentences. One idea per sentence.
- No passive voice.
- Don't open with a rhetorical question.
- No em dashes — use commas or periods.
- No hashtags.
- End on a concrete statement or CTA, never a soft landing.`;

const TONE_DIMENSIONS: Array<{ key: keyof ToneAttrs; label: string }> = [
  { key: "formal",    label: "Formal" },
  { key: "playful",   label: "Playful" },
  { key: "technical", label: "Technical" },
  { key: "warm",      label: "Warm" },
  { key: "bold",      label: "Bold" },
];

function PhraseListEditor({
  label, value, onChange, placeholder, testId,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  testId: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (value.includes(t)) { setDraft(""); return; }
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          data-testid={`${testId}-input`}
        />
        <Button type="button" variant="outline" onClick={add} data-testid={`${testId}-add`}>Add</Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(phrase => (
            <Badge key={phrase} variant="secondary" className="gap-1" data-testid={`${testId}-chip`}>
              {phrase}
              <button
                type="button"
                onClick={() => onChange(value.filter(p => p !== phrase))}
                className="ml-1 hover:text-destructive"
                aria-label={`Remove ${phrase}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function VoiceProfileDialog({
  account, open, onOpenChange,
}: {
  account: SocialAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<VoiceProfile | null>(null);

  const { data: loaded, isLoading } = useQuery<VoiceProfile>({
    queryKey: ["/api/social-accounts", account.id, "voice-profile"],
    queryFn: async () => {
      const r = await fetch(`/api/social-accounts/${account.id}/voice-profile`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load voice profile");
      return r.json();
    },
    enabled: open,
  });

  const { data: personasList = [] } = useQuery<PersonaRow[]>({
    queryKey: ["/api/personas"],
    queryFn: async () => {
      const r = await fetch("/api/personas", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open,
  });

  const { data: frameworksData } = useQuery<{ items: FrameworkItem[] }>({
    queryKey: ["/api/messaging-frameworks/available"],
    queryFn: async () => {
      const r = await fetch("/api/messaging-frameworks/available", { credentials: "include" });
      return r.ok ? r.json() : { items: [] };
    },
    enabled: open,
  });
  const frameworks = frameworksData?.items ?? [];

  useEffect(() => {
    if (loaded) setDraft({ ...loaded, sampleSnippets: loaded.sampleSnippets ?? [] });
  }, [loaded]);

  const saveMutation = useMutation({
    mutationFn: async (next: VoiceProfile) => {
      const r = await fetch(`/api/social-accounts/${account.id}/voice-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", account.id, "voice-profile"] });
      toast({ title: "Voice profile saved" });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/social-accounts/${account.id}/voice-profile`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) throw new Error("Reset failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", account.id, "voice-profile"] });
      toast({ title: "Voice profile reset to defaults" });
    },
    onError: (err: Error) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  if (!open) return null;
  if (isLoading || !draft) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voice — {account.accountName}</DialogTitle>
          </DialogHeader>
          <div className="py-12 text-center text-muted-foreground">Loading...</div>
        </DialogContent>
      </Dialog>
    );
  }

  // Sort personas: ICPs first, then by name.
  const personasSorted = [...personasList].sort((a, b) => {
    if (a.isIcp !== b.isIcp) return a.isIcp ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  // Group frameworks by scope for the picker.
  const frameworksByGroup: Record<string, FrameworkItem[]> = {};
  frameworks.forEach(f => {
    const key = f.scope === "market" || f.scope === "tenant"
      ? (f.kind === "long_form" ? "Messaging Framework" : "Marketing Content (Tenant)")
      : "Brand Voice & Guidelines (Global)";
    (frameworksByGroup[key] ??= []).push(f);
  });

  const tone = draft.toneAttributes ?? {};
  const setTone = (key: keyof ToneAttrs, v: number) =>
    setDraft({ ...draft, toneAttributes: { ...tone, [key]: v } });

  const refKey = (r: FrameworkRef) => `${r.kind}:${r.id}`;
  const selectedRefs = new Set((draft.defaultFrameworkRefs ?? []).map(refKey));

  const toggleRef = (item: FrameworkItem) => {
    const k = `${item.kind}:${item.id}`;
    const current = draft.defaultFrameworkRefs ?? [];
    const next = selectedRefs.has(k)
      ? current.filter(r => refKey(r) !== k)
      : [...current, { kind: item.kind, id: item.id }];
    setDraft({ ...draft, defaultFrameworkRefs: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mic className="w-4 h-4" /> Voice — {account.accountName}</DialogTitle>
          <DialogDescription>
            How AI should write on behalf of this account. Applied to direct-composed posts and AI rewrites.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basics" data-testid="voice-tab-basics">Basics</TabsTrigger>
            <TabsTrigger value="tone" data-testid="voice-tab-tone">Tone</TabsTrigger>
            <TabsTrigger value="phrases" data-testid="voice-tab-phrases">Phrases</TabsTrigger>
            <TabsTrigger value="defaults" data-testid="voice-tab-defaults">Defaults</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Person</Label>
                <Select value={draft.person} onValueChange={(v: any) => setDraft({ ...draft, person: v })}>
                  <SelectTrigger data-testid="voice-select-person"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first">First person ("I", "we")</SelectItem>
                    <SelectItem value="third">Third person ("Synozur", "the team")</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Perspective</Label>
                <Select value={draft.authorPerspective} onValueChange={(v: any) => setDraft({ ...draft, authorPerspective: v })}>
                  <SelectTrigger data-testid="voice-select-perspective"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="brand">Brand / Company</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Emoji policy</Label>
                <Select value={draft.emojiPolicy} onValueChange={(v: any) => setDraft({ ...draft, emojiPolicy: v })}>
                  <SelectTrigger data-testid="voice-select-emoji"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="sparing">Sparing</SelectItem>
                    <SelectItem value="liberal">Liberal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Hashtag policy</Label>
                <Select value={draft.hashtagPolicy} onValueChange={(v: any) => setDraft({ ...draft, hashtagPolicy: v })}>
                  <SelectTrigger data-testid="voice-select-hashtags"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="minimal">Minimal (1–2)</SelectItem>
                    <SelectItem value="standard">Standard (3–5)</SelectItem>
                    <SelectItem value="heavy">Heavy (6+)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Max length <span className="text-muted-foreground font-normal">(characters, optional)</span></Label>
                <Input
                  type="number"
                  min={1}
                  value={draft.maxLength ?? ""}
                  onChange={e => setDraft({ ...draft, maxLength: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="Platform default"
                  data-testid="voice-input-maxlength"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Style guidance</Label>
                <Textarea
                  rows={4}
                  value={draft.styleGuidance ?? ""}
                  onChange={e => setDraft({ ...draft, styleGuidance: e.target.value })}
                  placeholder="e.g., Lead with a sharp insight. Avoid jargon. Always include a concrete example or stat."
                  data-testid="voice-textarea-style"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">"Sound like me" instructions</Label>
                <p className="text-[11px] text-muted-foreground">Paste your personal writing rules, style notes, or AI cliché list here. Markdown is fine.</p>
                <Textarea
                  rows={6}
                  value={draft.soundLikeMeInstructions ?? ""}
                  onChange={e => setDraft({ ...draft, soundLikeMeInstructions: e.target.value })}
                  placeholder="e.g., Short sentences. Never use 'leverage', 'unlock', or 'delve'. No passive voice. End on a concrete statement."
                  data-testid="voice-textarea-sound-like-me"
                />
                <details className="mt-1">
                  <summary className="text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">Need a starting point?</summary>
                  <pre className="mt-2 text-[11px] bg-muted rounded p-3 whitespace-pre-wrap leading-relaxed select-all">{SOUND_LIKE_ME_STARTER}</pre>
                </details>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="tone" className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">Move sliders to bias the model toward each tone dimension. Leave at 0 to ignore.</p>
            {TONE_DIMENSIONS.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <Label>{label}</Label>
                  <span className="text-muted-foreground">{Math.round((tone[key] ?? 0) * 100)}%</span>
                </div>
                <Slider
                  min={0} max={100} step={5}
                  value={[Math.round((tone[key] ?? 0) * 100)]}
                  onValueChange={([v]) => setTone(key, (v ?? 0) / 100)}
                  data-testid={`voice-slider-${key}`}
                />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="phrases" className="space-y-4 pt-4">
            <PhraseListEditor
              label="Preferred phrases"
              value={draft.preferredPhrases ?? []}
              onChange={v => setDraft({ ...draft, preferredPhrases: v })}
              placeholder="e.g., 'orbit around your customers'"
              testId="voice-preferred"
            />
            <PhraseListEditor
              label="Forbidden phrases"
              value={draft.forbiddenPhrases ?? []}
              onChange={v => setDraft({ ...draft, forbiddenPhrases: v })}
              placeholder="e.g., 'synergy', 'leverage'"
              testId="voice-forbidden"
            />
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs">Sample snippets <span className="text-muted-foreground font-normal">(few-shot examples for the AI)</span></Label>
              {(draft.sampleSnippets ?? []).map((snippet, idx) => (
                <div key={idx} className="space-y-1 p-2 border rounded">
                  <div className="flex gap-2">
                    <Input
                      value={snippet.label ?? ""}
                      onChange={e => {
                        const next = [...(draft.sampleSnippets ?? [])];
                        next[idx] = { ...snippet, label: e.target.value };
                        setDraft({ ...draft, sampleSnippets: next });
                      }}
                      placeholder="Label (optional)"
                      className="text-xs h-7"
                      data-testid={`voice-snippet-label-${idx}`}
                    />
                    <Button
                      type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => setDraft({ ...draft, sampleSnippets: (draft.sampleSnippets ?? []).filter((_, i) => i !== idx) })}
                      data-testid={`voice-snippet-remove-${idx}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  <Textarea
                    rows={3}
                    value={snippet.content}
                    onChange={e => {
                      const next = [...(draft.sampleSnippets ?? [])];
                      next[idx] = { ...snippet, content: e.target.value };
                      setDraft({ ...draft, sampleSnippets: next });
                    }}
                    placeholder="A short post that exemplifies this voice"
                    data-testid={`voice-snippet-content-${idx}`}
                  />
                </div>
              ))}
              {(draft.sampleSnippets ?? []).length < 10 && (
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setDraft({ ...draft, sampleSnippets: [...(draft.sampleSnippets ?? []), { content: "" }] })}
                  data-testid="voice-snippet-add"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add snippet
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="defaults" className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              These pre-populate the AI rewrite picker as removable suggestions. Selecting nothing here is fine — every rewrite call lets the user choose explicitly.
            </p>
            <div>
              <Label className="text-xs">Default audience persona <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select
                value={draft.defaultPersonaId ?? "__none__"}
                onValueChange={v => setDraft({ ...draft, defaultPersonaId: v === "__none__" ? null : v })}
              >
                <SelectTrigger data-testid="voice-select-persona"><SelectValue placeholder="No specific audience" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No specific audience</SelectItem>
                  {personasSorted.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.isIcp ? "★ " : ""}{p.name}{p.role ? ` — ${p.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Default messaging frameworks <span className="text-muted-foreground font-normal">(optional, multi-select)</span></Label>
              {frameworks.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No messaging frameworks, marketing-tagged grounding documents, or brand-voice guidelines are available yet.
                </p>
              ) : (
                <div className="space-y-3 mt-2">
                  {Object.entries(frameworksByGroup).map(([group, items]) => (
                    <div key={group}>
                      <div className="text-xs font-medium text-muted-foreground mb-1">{group}</div>
                      <div className="space-y-1">
                        {items.map(item => {
                          const k = `${item.kind}:${item.id}`;
                          const checked = selectedRefs.has(k);
                          return (
                            <label key={k} className="flex items-start gap-2 p-2 border rounded cursor-pointer hover:bg-muted/50" data-testid={`voice-framework-${k}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleRef(item)}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm">{item.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {item.scope === "market" ? "Market" : item.scope === "tenant" ? "Tenant" : "Global"}
                                  {item.category ? ` · ${item.category.replace(/_/g, " ")}` : ""}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 pt-4 border-t mt-4">
          <Button
            variant="outline"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending || draft.isUnsaved}
            data-testid="voice-button-reset"
          >
            Reset to defaults
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="voice-button-cancel">Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate(draft)}
            disabled={saveMutation.isPending}
            data-testid="voice-button-save"
          >
            {saveMutation.isPending ? "Saving..." : "Save voice"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function PostingBehaviourCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tenantInfo } = useQuery<{ socialPostingJitterEnabled?: boolean; features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const jitterEnabled = tenantInfo?.socialPostingJitterEnabled ?? true;

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const r = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ socialPostingJitterEnabled: enabled }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Update failed");
      return r.json();
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/info"] });
      toast({
        title: enabled ? "Naturalistic delay enabled" : "Naturalistic delay disabled",
        description: enabled
          ? "Posts will be published up to 10 minutes after their scheduled time."
          : "Posts will go out at exactly their scheduled times.",
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't update setting", description: err.message, variant: "destructive" }),
  });

  if (!tenantInfo?.features?.socialPosts) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Posting behaviour</CardTitle>
        <CardDescription>Control how the auto-publish worker times your posts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <p className="text-sm font-medium">Naturalistic posting delay</p>
            <p className="text-[12px] text-muted-foreground">
              When on, posts go out at a random time within 10 minutes of the scheduled time — so they
              don't all land at exactly 8:00 AM and look more like human-posted content. Turn this off
              if every post needs to go at a precise time, or tick <strong>Post at exact time</strong>{" "}
              on individual posts in the queue to override on a case-by-case basis.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={jitterEnabled}
            data-testid="toggle-posting-jitter"
            disabled={toggleMutation.isPending}
            onClick={() => toggleMutation.mutate(!jitterEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
              jitterEnabled ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                jitterEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SocialAccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ platform: "linkedin", accountName: "", accountId: "", profileUrl: "", notes: "" });
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ id: string; platform: string; accountName: string; accountId: string; profileUrl: string; notes: string }>({ id: "", platform: "linkedin", accountName: "", accountId: "", profileUrl: "", notes: "" });
  const [voiceAccount, setVoiceAccount] = useState<SocialAccount | null>(null);
  const [blueskyAccount, setBlueskyAccount] = useState<SocialAccount | null>(null);

  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean>; linkedinDirectPublishEnabled?: boolean }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.socialAccounts === true;
  // LinkedIn direct posting is pending LinkedIn's app review. Until it's
  // approved, show a "coming soon" notice instead of a Connect button.
  const linkedinPublishEnabled = tenantInfo?.linkedinDirectPublishEnabled === true;

  const { data: accounts = [], isLoading } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/social-accounts", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      setAddOpen(false);
      setForm({ platform: "linkedin", accountName: "", accountId: "", profileUrl: "", notes: "" });
      toast({ title: "Social account added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async (data: typeof editForm) => {
      const r = await fetch(`/api/social-accounts/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ platform: data.platform, accountName: data.accountName, accountId: data.accountId, profileUrl: data.profileUrl, notes: data.notes }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      setEditOpen(false);
      toast({ title: "Social account updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const connectMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/social-accounts/${id}/oauth/connect`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        // Platforms use a single Synozur-owned OAuth app — tenants never
        // configure credentials. A 503 here means Synozur hasn't enabled the
        // shared app for this platform yet; just surface the message.
        throw new Error(body.error || "Connect failed");
      }
      return r.json() as Promise<{ authorizeUrl: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.authorizeUrl;
    },
    onError: (err: Error) => {
      toast({ title: "Connect failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/social-accounts/${id}/disconnect`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Disconnect failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Account disconnected" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/social-accounts/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({ title: "Social account removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const platformLabel = (p: string) => PLATFORMS.find(x => x.value === p)?.label ?? p;

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle>Social Accounts</CardTitle>
              <CardDescription>Available on the Enterprise plan. Connect your social media accounts to campaigns and export AI-generated posts directly.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="mailto:contactus@synozur.com?subject=Enterprise Plan Inquiry - Social Accounts">Contact Sales</a>
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AtSign className="w-6 h-6" /> Social Accounts
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Manage social media accounts for use in campaigns and post generation.</p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Social Account</DialogTitle>
                <DialogDescription>Add a social media account to use in campaigns and post exports.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Platform</Label>
                  <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                    <SelectTrigger data-testid="select-add-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Account Name</Label>
                  <Input value={form.accountName} onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))} placeholder="Synozur Alliance" data-testid="input-add-account-name" />
                </div>
                <div>
                  <Label>Account ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} placeholder="e.g. SocialPilot or Hootsuite account ID" data-testid="input-add-account-id" />
                  <p className="text-xs text-muted-foreground mt-1">Only needed if you export CSV files for a scheduling tool. Leave blank for manual copy/paste workflows.</p>
                </div>
                <div className="flex gap-4 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)} data-testid="button-cancel-add-account">Cancel</Button>
                  <Button
                    className="flex-1"
                    disabled={!form.accountName.trim() || createMutation.isPending}
                    onClick={() => createMutation.mutate(form)}
                    data-testid="button-submit-add-account"
                  >
                    {createMutation.isPending ? "Adding..." : "Add Account"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : accounts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No social accounts yet. Add an account to link it to your campaigns.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {accounts.map(account => (
              <Card key={account.id} className="group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge className="mb-2">{platformLabel(account.platform)}</Badge>
                      <CardTitle className="text-base">{account.accountName}</CardTitle>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 h-7 w-7 shrink-0"
                        onClick={() => setVoiceAccount(account)}
                        title="Account voice"
                        data-testid={`button-voice-${account.id}`}
                      >
                        <Mic className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 h-7 w-7 shrink-0"
                        onClick={() => {
                          setEditForm({ id: account.id, platform: account.platform, accountName: account.accountName, accountId: account.accountId || "", profileUrl: account.profileUrl || "", notes: account.notes || "" });
                          setEditOpen(true);
                        }}
                        data-testid={`button-edit-account-${account.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 h-7 w-7 shrink-0"
                        onClick={() => removeMutation.mutate(account.id)}
                        data-testid={`button-delete-account-${account.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {account.accountId && (
                    <p className="text-xs text-muted-foreground">ID: <span className="font-mono">{account.accountId}</span></p>
                  )}
                  {account.profileUrl && (
                    <a href={account.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">
                      {account.profileUrl}
                    </a>
                  )}
                  {account.notes && <p className="text-xs text-muted-foreground">{account.notes}</p>}
                  {DIRECT_PUBLISH_PLATFORMS.has(account.platform) && (
                    <div className="pt-2 border-t mt-2 space-y-2">
                      {account.encryptedAccessToken ? (
                        <>
                          {account.status === "needs_reconnect" ? (
                            <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium" data-testid={`status-needs-reconnect-${account.id}`}>
                              <AlertTriangle className="w-3.5 h-3.5" /> Reconnection required — token rejected by platform
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-green-600" data-testid={`status-connected-${account.id}`}>
                              <CheckCircle2 className="w-3.5 h-3.5" /> Connected for direct publishing
                            </div>
                          )}
                          {account.platform === "linkedin" && account.status !== "needs_reconnect" && (
                            <LinkedInAuthorPicker account={account} />
                          )}
                          {account.lastPublishError === "needs_reauth" ? (
                            <div
                              className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-2.5 space-y-1.5"
                              data-testid={`banner-reauth-${account.id}`}
                            >
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                LinkedIn connection expired
                              </div>
                              <p className="text-xs text-amber-700 dark:text-amber-400 leading-snug">
                                The access token has expired and could not be refreshed automatically.
                                Reconnect to restore direct publishing.
                              </p>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 border-amber-400 text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                                onClick={() => connectMutation.mutate(account.id)}
                                disabled={connectMutation.isPending}
                                data-testid={`button-reauth-reconnect-${account.id}`}
                              >
                                <LinkIcon className="w-3 h-3 mr-1" />
                                {connectMutation.isPending ? "Redirecting…" : "Reconnect now"}
                              </Button>
                            </div>
                          ) : account.lastPublishError ? (
                            <div className="flex items-start gap-1.5 text-xs text-amber-600">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>Last error: {account.lastPublishError}</span>
                            </div>
                          ) : null}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7"
                              onClick={() => {
                                if (NON_OAUTH_PLATFORMS.has(account.platform)) {
                                  setBlueskyAccount(account);
                                } else {
                                  connectMutation.mutate(account.id);
                                }
                              }}
                              disabled={connectMutation.isPending}
                              data-testid={`button-reconnect-${account.id}`}
                            >
                              <LinkIcon className="w-3 h-3 mr-1" /> Reconnect
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7"
                              onClick={() => disconnectMutation.mutate(account.id)}
                              disabled={disconnectMutation.isPending}
                              data-testid={`button-disconnect-${account.id}`}
                            >
                              <Unlink className="w-3 h-3 mr-1" /> Disconnect
                            </Button>
                          </div>
                        </>
                      ) : account.platform === "linkedin" && !linkedinPublishEnabled ? (
                        <div
                          className="flex items-start gap-1.5 text-xs text-muted-foreground rounded-md border border-dashed p-2"
                          data-testid={`status-linkedin-coming-soon-${account.id}`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                          <span>Direct posting to LinkedIn is coming soon — it's pending LinkedIn's app review. One-click Connect will turn on automatically once it's approved.</span>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="text-xs h-7 w-full"
                          onClick={() => {
                            if (NON_OAUTH_PLATFORMS.has(account.platform)) {
                              setBlueskyAccount(account);
                            } else {
                              connectMutation.mutate(account.id);
                            }
                          }}
                          disabled={connectMutation.isPending}
                          data-testid={`button-connect-${account.id}`}
                        >
                          <LinkIcon className="w-3 h-3 mr-1" /> Connect for direct publishing
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Social Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Platform</Label>
                <Select value={editForm.platform} onValueChange={v => setEditForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger data-testid="select-edit-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Account Name</Label>
                <Input value={editForm.accountName} onChange={e => setEditForm(f => ({ ...f, accountName: e.target.value }))} data-testid="input-edit-account-name" />
              </div>
              <div>
                <Label>Account ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={editForm.accountId} onChange={e => setEditForm(f => ({ ...f, accountId: e.target.value }))} placeholder="e.g. SocialPilot or Hootsuite account ID" data-testid="input-edit-account-id" />
                <p className="text-xs text-muted-foreground mt-1">Only needed if you export CSV files for a scheduling tool.</p>
              </div>
              <div className="flex gap-4 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit-account">Cancel</Button>
                <Button
                  className="flex-1"
                  disabled={!editForm.accountName.trim() || editMutation.isPending}
                  onClick={() => editMutation.mutate(editForm)}
                  data-testid="button-save-edit-account"
                >
                  {editMutation.isPending ? "Saving..." : "Update"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Posting behaviour settings */}
        <PostingBehaviourCard />

        {voiceAccount && (
          <VoiceProfileDialog
            account={voiceAccount}
            open={!!voiceAccount}
            onOpenChange={(open) => { if (!open) setVoiceAccount(null); }}
          />
        )}

        {blueskyAccount && (
          <BlueskyConnectDialog
            account={blueskyAccount}
            open={!!blueskyAccount}
            onOpenChange={(open) => { if (!open) setBlueskyAccount(null); }}
          />
        )}
      </div>
    </AppLayout>
  );
}
