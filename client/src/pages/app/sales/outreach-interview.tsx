import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sparkles,
  Target,
  Megaphone,
  Users,
  Filter,
  MousePointerClick,
  CalendarDays,
  Mic,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Persona {
  id: string;
  name: string;
  role: string | null;
  isIcp?: boolean;
}

interface ConferenceLite {
  id: string;
  name: string;
  startDate?: string | null;
}

// Wizard steps, mirroring the server interview step graph.
const STEPS = [
  { key: "goal", label: "Goal", icon: Target },
  { key: "message", label: "Message", icon: Megaphone },
  { key: "icp", label: "Target ICP", icon: Users },
  { key: "refinements", label: "Refinements", icon: Filter },
  { key: "cta", label: "Call to action", icon: MousePointerClick },
  { key: "event", label: "Event", icon: CalendarDays },
  { key: "voice", label: "Voice & channels", icon: Mic },
] as const;

function toList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Outreach onboarding wizard. Walks goal → message → ICP → refinements → CTA →
 * event → voice/channels, then creates the campaign (server derives goal type +
 * default cadence) and redirects to the campaign detail.
 */
export default function OutreachInterviewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [stepIdx, setStepIdx] = useState(0);

  // Form state
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [message, setMessage] = useState("");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [targetRoles, setTargetRoles] = useState("");
  const [geographies, setGeographies] = useState("");
  const [industries, setIndustries] = useState("");
  const [segments, setSegments] = useState("");
  const [cta, setCta] = useState("");
  const [conferenceId, setConferenceId] = useState<string>("");
  const [eventDate, setEventDate] = useState("");
  const [channels, setChannels] = useState<string[]>(["email"]);

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
    queryFn: async () => {
      const r = await fetch("/api/personas", { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : d?.items ?? [];
    },
  });

  const { data: conferences = [] } = useQuery<ConferenceLite[]>({
    queryKey: ["/api/conferences"],
    queryFn: async () => {
      const r = await fetch("/api/conferences", { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : d?.items ?? d?.conferences ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sales-outreach/campaigns", {
        name: name.trim(),
        targetPersonaIds: personaIds,
        conferenceId: conferenceId || null,
        eventDate: eventDate || null,
        answers: {
          goal: goal.trim(),
          message: message.trim(),
          callToAction: cta.trim(),
          channels,
          refinements: {
            targetRoles: toList(targetRoles),
            geographies: toList(geographies),
            industries: toList(industries),
            segments: toList(segments),
          },
        },
      });
      return res.json();
    },
    onSuccess: (data: { campaign: { id: string } }) => {
      toast({ title: "Campaign created", description: "Default cadence generated from your goal." });
      navigate(`/app/sales/outreach/${data.campaign.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create campaign", description: err?.message ?? "Try again.", variant: "destructive" });
    },
  });

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const canAdvance =
    step.key === "goal" ? Boolean(name.trim() && goal.trim())
    : step.key === "message" ? Boolean(message.trim())
    : step.key === "icp" ? personaIds.length > 0 || Boolean(targetRoles.trim())
    : step.key === "cta" ? Boolean(cta.trim())
    : true;

  function toggle<T>(list: T[], value: T, setter: (v: T[]) => void) {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6" data-testid="page-outreach-interview">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/sales/outreach")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Campaigns
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" /> New outreach campaign
          </h1>
          <p className="text-muted-foreground mt-1">
            Answer a few questions — we'll build the targeting and a default cadence.
          </p>
        </div>

        <div className="space-y-2">
          <Progress value={((stepIdx + 1) / STEPS.length) * 100} />
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <Badge
                key={s.key}
                variant={i === stepIdx ? "default" : i < stepIdx ? "secondary" : "outline"}
                className="text-[11px]"
              >
                {s.label}
              </Badge>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <step.icon className="w-5 h-5 text-primary" /> {step.label}
            </CardTitle>
            <CardDescription>{stepDescription(step.key)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step.key === "goal" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Campaign name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 PE CIO meetings" data-testid="input-campaign-name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal">What outcome do you want?</Label>
                  <Textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Book 10 discovery calls about our AI value-realization services" data-testid="input-goal" />
                  <p className="text-xs text-muted-foreground">We classify this into a goal type (meeting, event invite, intro, nurture) to pick a cadence.</p>
                </div>
              </>
            )}

            {step.key === "message" && (
              <div className="space-y-1.5">
                <Label htmlFor="message">Core message / offering</Label>
                <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What we're offering and why it matters to them" rows={4} data-testid="input-message" />
              </div>
            )}

            {step.key === "icp" && (
              <>
                <div className="space-y-2">
                  <Label>Target personas</Label>
                  {personas.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No personas defined yet — add target roles below, or create personas first.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {personas.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/50" data-testid={`persona-${p.id}`}>
                          <Checkbox checked={personaIds.includes(p.id)} onCheckedChange={() => toggle(personaIds, p.id, setPersonaIds)} />
                          <span className="text-sm">
                            {p.name}
                            {p.role ? <span className="text-muted-foreground"> — {p.role}</span> : null}
                            {p.isIcp ? <Badge variant="secondary" className="ml-1.5 text-[10px]">ICP</Badge> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="roles">Target roles (comma-separated)</Label>
                  <Input id="roles" value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} placeholder="PE CIO, ops leader, IT director" data-testid="input-roles" />
                </div>
              </>
            )}

            {step.key === "refinements" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="geo">Geographies</Label>
                  <Input id="geo" value={geographies} onChange={(e) => setGeographies(e.target.value)} placeholder="Seattle, Pacific NW" data-testid="input-geographies" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ind">Industries</Label>
                  <Input id="ind" value={industries} onChange={(e) => setIndustries(e.target.value)} placeholder="Private equity, financial services" data-testid="input-industries" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="seg">Company size / segment</Label>
                  <Input id="seg" value={segments} onChange={(e) => setSegments(e.target.value)} placeholder="mid-market" data-testid="input-segments" />
                </div>
              </div>
            )}

            {step.key === "cta" && (
              <div className="space-y-1.5">
                <Label htmlFor="cta">Call to action</Label>
                <Textarea id="cta" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book a 30-minute discovery call (scheduler link)" data-testid="input-cta" />
              </div>
            )}

            {step.key === "event" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="conf">Tied to an event? (optional)</Label>
                  <select
                    id="conf"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={conferenceId}
                    onChange={(e) => setConferenceId(e.target.value)}
                    data-testid="select-conference"
                  >
                    <option value="">No event</option>
                    {conferences.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-date">Event date (anchors the cadence)</Label>
                  <Input id="event-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} data-testid="input-event-date" />
                  <p className="text-xs text-muted-foreground">For event campaigns, follow-ups are back-dated from this date.</p>
                </div>
              </>
            )}

            {step.key === "voice" && (
              <div className="space-y-2">
                <Label>Channels</Label>
                <div className="flex gap-4">
                  {["email", "linkedin"].map((ch) => (
                    <label key={ch} className="flex items-center gap-2 cursor-pointer" data-testid={`channel-${ch}`}>
                      <Checkbox checked={channels.includes(ch)} onCheckedChange={() => toggle(channels, ch, setChannels)} />
                      <span className="text-sm capitalize">{ch}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Drafts will use your personal voice profile once your mailbox is connected (Settings).
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0} data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {isLast ? (
            <Button onClick={() => create.mutate()} disabled={!canAdvance || create.isPending} data-testid="button-create-campaign">
              {create.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              Create campaign
            </Button>
          ) : (
            <Button onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))} disabled={!canAdvance} data-testid="button-next">
              Next <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function stepDescription(key: string): string {
  switch (key) {
    case "goal": return "Name the campaign and describe the outcome you want.";
    case "message": return "The core value prop this outreach carries.";
    case "icp": return "Who we target — pick personas and/or list roles.";
    case "refinements": return "Narrow the list by geography, industry, and size.";
    case "cta": return "The specific ask and how they act on it.";
    case "event": return "Optionally anchor the campaign to an event.";
    case "voice": return "Pick channels; drafts use your personal voice.";
    default: return "";
  }
}
