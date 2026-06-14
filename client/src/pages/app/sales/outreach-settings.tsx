import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, ShieldAlert, Loader2, CheckCircle2, Plug, Mic } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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

interface MailboxStatus {
  connected: boolean;
  canDraft: boolean;
  scopes: string[];
}
interface VoiceProfile {
  id: string;
  styleGuidance: string | null;
  preferredPhrases: string[] | null;
  soundLikeMeInstructions: string | null;
}
interface OutreachSettings {
  globalPause: boolean;
  masterDailyCap: number;
  emailDailyCap: number;
  emailWeeklyCap: number;
  linkedinDailyCap: number;
  linkedinWeeklyCap: number;
  weeklyPerDomainCap: number;
  minReplyRateFloor: number;
}

const CAP_FIELDS: { key: keyof OutreachSettings; label: string; hint: string }[] = [
  { key: "masterDailyCap", label: "Master daily cap", hint: "Hard ceiling on total approvals/day — trips the breaker." },
  { key: "emailDailyCap", label: "Email / day", hint: "Per-seller email approvals per day." },
  { key: "emailWeeklyCap", label: "Email / week", hint: "Email approvals per week." },
  { key: "linkedinDailyCap", label: "LinkedIn / day", hint: "Kept low — LinkedIn restricts volume." },
  { key: "linkedinWeeklyCap", label: "LinkedIn / week", hint: "LinkedIn approvals per week." },
  { key: "weeklyPerDomainCap", label: "Per-domain / week", hint: "Max touches into one company's domain per week." },
];

export default function OutreachSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draftSettings, setDraftSettings] = useState<OutreachSettings | null>(null);
  const [soundLikeMeText, setSoundLikeMeText] = useState<string>("");

  const { data: mailbox } = useQuery<MailboxStatus>({
    queryKey: ["/api/sales-outreach/mailbox/status"],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/mailbox/status", { credentials: "include" });
      if (!r.ok) return { connected: false, canDraft: false, scopes: [] };
      return r.json();
    },
  });

  const { data: voice } = useQuery<VoiceProfile | null>({
    queryKey: ["/api/sales-outreach/voice"],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/voice", { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  useEffect(() => {
    if (voice !== undefined) {
      setSoundLikeMeText(voice?.soundLikeMeInstructions ?? "");
    }
  }, [voice]);

  const extractVoice = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-outreach/voice/extract", {});
      return res.json();
    },
    onSuccess: (data: { sampleCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/voice"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/readiness"] });
      toast({ title: "Voice extracted", description: `Analyzed ${data.sampleCount} sent emails.` });
    },
    onError: (err: any) => toast({ title: "Couldn't extract voice", description: err?.message, variant: "destructive" }),
  });

  const saveSoundLikeMe = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/sales-outreach/voice", { soundLikeMeInstructions: soundLikeMeText || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/voice"] });
      toast({ title: "Writing instructions saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err?.message, variant: "destructive" }),
  });

  const { data: settings } = useQuery<OutreachSettings>({
    queryKey: ["/api/sales-outreach/settings"],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/settings", { credentials: "include" });
      return r.json();
    },
  });

  useEffect(() => {
    if (settings && !draftSettings) setDraftSettings(settings);
  }, [settings, draftSettings]);

  const connectMailbox = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sales-outreach/mailbox/consent-url?returnTo=/app/sales/outreach/settings", {
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error || "Couldn't start consent");
      return r.json() as Promise<{ url: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: any) => toast({ title: "Couldn't connect mailbox", description: err?.message, variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/sales-outreach/settings", draftSettings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err?.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-6" data-testid="page-outreach-settings">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/app/sales/outreach"><ArrowLeft className="w-4 h-4 mr-1" /> Campaigns</Link>
        </Button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Outreach settings</h1>
          <p className="text-muted-foreground mt-1">Connect your mailbox and set the circuit breakers.</p>
        </div>

        {/* Mailbox connection (per-seller) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" /> Your Outlook mailbox</CardTitle>
            <CardDescription>Approved drafts are created in your mailbox — you click Send.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {mailbox?.canDraft ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> Connected with draft permission
                </span>
              ) : mailbox?.connected ? (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="w-4 h-4" /> Connected, but draft permission not granted
                </span>
              ) : (
                <span className="text-muted-foreground">Not connected</span>
              )}
            </div>
            <Button onClick={() => connectMailbox.mutate()} disabled={connectMailbox.isPending} data-testid="button-connect-mailbox">
              {connectMailbox.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plug className="w-4 h-4 mr-1" />}
              {mailbox?.canDraft ? "Reconnect" : "Connect mailbox"}
            </Button>
          </CardContent>
        </Card>

        {/* Personal voice */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Mic className="w-4 h-4" /> Your voice</CardTitle>
            <CardDescription>Extracted from your Sent Items so drafts sound like you. Refresh anytime.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm">
                {voice ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" /> Voice profile set
                  </span>
                ) : (
                  <span className="text-muted-foreground">No personal voice yet</span>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => extractVoice.mutate()}
                disabled={extractVoice.isPending || !mailbox?.canDraft}
                title={!mailbox?.canDraft ? "Connect your mailbox first" : undefined}
                data-testid="button-extract-voice"
              >
                {extractVoice.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mic className="w-4 h-4 mr-1" />}
                {voice ? "Re-extract" : "Extract from Sent Items"}
              </Button>
            </div>
            {voice?.styleGuidance && (
              <p className="text-xs text-muted-foreground border-l-2 pl-2 leading-relaxed">{voice.styleGuidance}</p>
            )}

            {/* "Sound like me" freeform writing instructions */}
            <div className="space-y-1 pt-2 border-t">
              <Label className="text-xs">"Sound like me" instructions</Label>
              <p className="text-[11px] text-muted-foreground">Paste your personal writing rules, style notes, or AI cliché list here. Markdown is fine.</p>
              <Textarea
                rows={6}
                value={soundLikeMeText}
                onChange={e => setSoundLikeMeText(e.target.value)}
                placeholder="e.g., Short sentences. Never use 'leverage', 'unlock', or 'delve'. No passive voice. End on a concrete statement."
                data-testid="voice-textarea-sound-like-me-outreach"
              />
              <details className="mt-1">
                <summary className="text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors">Need a starting point?</summary>
                <pre className="mt-2 text-[11px] bg-muted rounded p-3 whitespace-pre-wrap leading-relaxed select-all">{SOUND_LIKE_ME_STARTER}</pre>
              </details>
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveSoundLikeMe.mutate()}
                  disabled={saveSoundLikeMe.isPending}
                  data-testid="button-save-sound-like-me"
                >
                  {saveSoundLikeMe.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Save instructions
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Circuit breakers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Circuit breakers</CardTitle>
            <CardDescription>Hard limits that fail closed. LinkedIn defaults stay conservative.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium text-sm flex items-center gap-2">
                  Global pause {draftSettings?.globalPause && <Badge variant="destructive" className="text-[10px]">PAUSED</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">Halts all outreach approvals immediately.</p>
              </div>
              <Switch
                checked={!!draftSettings?.globalPause}
                onCheckedChange={(v) => draftSettings && setDraftSettings({ ...draftSettings, globalPause: v })}
                data-testid="switch-global-pause"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {CAP_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <Input
                    id={f.key}
                    type="number"
                    min={0}
                    value={draftSettings ? (draftSettings[f.key] as number) : 0}
                    onChange={(e) =>
                      draftSettings && setDraftSettings({ ...draftSettings, [f.key]: Number(e.target.value) })
                    }
                    data-testid={`cap-${f.key}`}
                  />
                  <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={() => saveSettings.mutate()} disabled={!draftSettings || saveSettings.isPending} data-testid="button-save-settings">
                {saveSettings.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Save settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
