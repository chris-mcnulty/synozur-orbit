import { useState } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId } from "@/lib/tabContext";
import { STUDY_DEPTHS, type StudyDepth } from "@shared/market-intelligence";
import { Telescope, Loader2, ArrowRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Study {
  id: string;
  inputType: string;
  inputValue: string | null;
  depth: string;
  status: string;
  currentStage: string | null;
  createdAt: string;
}

function statusBadge(status: string) {
  if (status === "completed") return <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />completed</Badge>;
  if (status === "failed") return <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400"><XCircle className="h-3 w-3 mr-1" />failed</Badge>;
  if (status === "running") return <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400"><Loader2 className="h-3 w-3 mr-1 animate-spin" />running</Badge>;
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />pending</Badge>;
}

export default function MarketStudiesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [brief, setBrief] = useState("");
  const [depth, setDepth] = useState<StudyDepth>("focus");
  const [acv, setAcv] = useState("");

  const { data: studies = [], isLoading } = useQuery<Study[]>({
    queryKey: ["/api/market-studies", getTabMarketId()],
    queryFn: async () => (await apiRequest("GET", "/api/market-studies")).json(),
    refetchInterval: (q) => ((q.state.data ?? []).some((s: Study) => s.status === "running" || s.status === "pending") ? 4000 : false),
  });

  const start = useMutation({
    mutationFn: async () => {
      const inputType = /^https?:\/\//i.test(brief.trim()) ? "url" : "brief";
      return (await apiRequest("POST", "/api/market-studies", {
        inputType, inputValue: brief.trim(), depth, acv: acv ? Number(acv) : undefined,
      })).json();
    },
    onSuccess: (r: { studyId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/market-studies"] });
      navigate(`/app/marketing/market-studies/${r.studyId}`);
    },
    onError: (e: any) => toast({ title: "Couldn't start study", description: e.message, variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Telescope className="h-6 w-6" /> Market Study Wizard</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            From a brief or company URL, Orbit models your segments, sizes TAM/SAM, builds the GTM
            opportunity matrix, and writes an executive summary — one guided run.
          </p>
        </div>

        {/* Start */}
        <Card>
          <CardContent className="py-5 space-y-4">
            <div>
              <Label>Brief or company URL</Label>
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={3}
                placeholder="e.g. https://acme.com  —  or  —  We sell RevOps automation to mid-market B2B SaaS…"
                data-testid="input-study-brief"
              />
            </div>
            <div>
              <Label className="text-xs">Study depth</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {STUDY_DEPTHS.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setDepth(d.key)}
                    className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${depth === d.key ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                    data-testid={`depth-${d.key}`}
                  >
                    <div className="font-medium">{d.label}</div>
                    <div className="text-[11px] text-muted-foreground">{d.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Average contract value (optional, USD)</Label>
              <Input
                type="number"
                min={0}
                value={acv}
                onChange={(e) => setAcv(e.target.value)}
                placeholder="e.g. 25000 — enables Census bottom-up sizing + triangulation"
                className="mt-1 max-w-sm"
                data-testid="input-study-acv"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Without an ACV, sizing uses top-down web-search estimation only.</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => start.mutate()} disabled={!brief.trim() || start.isPending} data-testid="button-run-study">
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                <span className="ml-2">Run study</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* History */}
        <div>
          <h2 className="text-sm font-semibold mb-2">Studies</h2>
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : studies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No studies yet — run your first one above.</p>
          ) : (
            <div className="grid gap-2">
              {studies.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/app/marketing/market-studies/${s.id}`)}
                  className="text-left rounded-lg border p-3 hover:border-primary/50 transition-colors flex items-center gap-3"
                  data-testid={`study-${s.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {statusBadge(s.status)}
                      <Badge variant="secondary" className="text-[10px] capitalize">{s.depth}</Badge>
                    </div>
                    <div className="text-sm mt-1 truncate">{s.inputValue || "(no brief)"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.status === "running" && s.currentStage ? `${s.currentStage} · ` : ""}
                      {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
