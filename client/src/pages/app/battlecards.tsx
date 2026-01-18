import React, { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Swords, Plus, Download, RefreshCw, Target, ArrowRight, 
  CheckCircle, XCircle, MinusCircle, ChevronRight, Loader2,
  Building2, Sparkles
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type HarveyBall = "full" | "three-quarter" | "half" | "quarter" | "empty";

interface BattleCardData {
  id: string;
  competitorId: string;
  competitorName: string;
  lastGeneratedAt?: string;
  createdAt: string;
  strengths?: string[];
  weaknesses?: string[];
  ourAdvantages?: string[];
  comparison?: { category: string; us: HarveyBall; them: HarveyBall; notes?: string }[];
  objections?: { objection: string; response: string }[];
  talkTracks?: { scenario: string; script: string }[];
  quickStats?: { pricing?: string; marketPosition?: string; targetAudience?: string; keyProducts?: string };
  customNotes?: string;
  status: string;
}

const HarveyBallIcon = ({ value, className = "" }: { value: HarveyBall; className?: string }) => {
  const baseClass = cn("w-5 h-5", className);
  
  switch (value) {
    case "full":
      return <div className={cn(baseClass, "rounded-full bg-primary")} />;
    case "three-quarter":
      return <div className={cn(baseClass, "rounded-full bg-primary/75 border-2 border-primary")} />;
    case "half":
      return <div className={cn(baseClass, "rounded-full bg-gradient-to-r from-primary from-50% to-muted to-50%")} />;
    case "quarter":
      return <div className={cn(baseClass, "rounded-full bg-primary/25 border-2 border-primary/50")} />;
    case "empty":
      return <div className={cn(baseClass, "rounded-full border-2 border-muted-foreground/30")} />;
  }
};

const harveyBallToLabel = (value: HarveyBall): string => {
  switch (value) {
    case "full": return "Excellent";
    case "three-quarter": return "Strong";
    case "half": return "Adequate";
    case "quarter": return "Weak";
    case "empty": return "None";
  }
};

export default function BattleCardsPage() {
  const queryClient = useQueryClient();
  const [selectedCompetitor, setSelectedCompetitor] = useState<string>("");
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<BattleCardData | null>(null);

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: battleCards = [], isLoading: loadingCards } = useQuery({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const response = await fetch("/api/battlecards", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (competitorId: string) => {
      const response = await fetch(`/api/battlecards/generate/${competitorId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate battle card");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/battlecards"] });
      setGeneratingFor(null);
    },
    onError: () => {
      setGeneratingFor(null);
    },
  });

  const handleGenerate = (competitorId: string) => {
    setGeneratingFor(competitorId);
    generateMutation.mutate(competitorId);
  };

  const competitorsWithCards = competitors.filter((c: any) => 
    battleCards.some((bc: BattleCardData) => bc.competitorId === c.id)
  );
  const competitorsWithoutCards = competitors.filter((c: any) => 
    !battleCards.some((bc: BattleCardData) => bc.competitorId === c.id)
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Swords className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Battle Cards</h1>
              <p className="text-muted-foreground text-sm">Sales enablement cards for competitive positioning</p>
            </div>
          </div>
          
          {competitors.length > 0 && (
            <Dialog>
              <DialogTrigger asChild>
                <Button data-testid="button-generate-battlecard">
                  <Plus className="w-4 h-4 mr-2" />
                  Generate Battle Card
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Generate Battle Card</DialogTitle>
                  <DialogDescription>
                    Select a competitor to generate a sales battle card comparing them against your company.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <Select value={selectedCompetitor} onValueChange={setSelectedCompetitor}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a competitor" />
                    </SelectTrigger>
                    <SelectContent>
                      {competitors.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {battleCards.some((bc: BattleCardData) => bc.competitorId === c.id) && (
                            <span className="text-muted-foreground ml-2">(has card)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    className="w-full" 
                    disabled={!selectedCompetitor || generatingFor === selectedCompetitor}
                    onClick={() => handleGenerate(selectedCompetitor)}
                  >
                    {generatingFor === selectedCompetitor ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate Battle Card
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {competitors.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Target className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Competitors Yet</h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                Add competitors to generate battle cards that help your sales team win deals.
              </p>
              <Link href="/app/competitors">
                <Button data-testid="button-add-competitors">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Competitors
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : battleCards.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Swords className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Battle Cards Yet</h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                Generate your first battle card to help your sales team compete effectively.
              </p>
              <Dialog>
                <DialogTrigger asChild>
                  <Button data-testid="button-generate-first-battlecard">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate First Battle Card
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Generate Battle Card</DialogTitle>
                    <DialogDescription>
                      Select a competitor to generate a sales battle card.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <Select value={selectedCompetitor} onValueChange={setSelectedCompetitor}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a competitor" />
                      </SelectTrigger>
                      <SelectContent>
                        {competitors.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button 
                      className="w-full" 
                      disabled={!selectedCompetitor || generatingFor === selectedCompetitor}
                      onClick={() => handleGenerate(selectedCompetitor)}
                    >
                      {generatingFor === selectedCompetitor ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Generate Battle Card
                        </>
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {battleCards.map((card: BattleCardData) => (
              <Card key={card.id} className="hover:border-primary/50 transition-colors group" data-testid={`battlecard-${card.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
                        <Building2 className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{card.competitorName}</CardTitle>
                        <CardDescription className="text-xs">
                          vs {companyProfile?.companyName || "Your Company"}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {new Date(card.lastGeneratedAt || card.createdAt).toLocaleDateString()}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Quick Comparison</p>
                    <div className="space-y-1.5">
                      {(card.comparison || []).slice(0, 3).map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{item.category}</span>
                          <div className="flex items-center gap-2">
                            <HarveyBallIcon value={item.us} className="w-3.5 h-3.5" />
                            <span className="text-muted-foreground">vs</span>
                            <HarveyBallIcon value={item.them} className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {(card.objections || []).length} objection{(card.objections || []).length !== 1 ? 's' : ''}
                    </span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => setSelectedCard(card)}
                      data-testid={`btn-view-card-${card.id}`}
                    >
                      View Full Card <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {competitorsWithoutCards.length > 0 && (
              <Card className="border-dashed hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="flex flex-col items-center justify-center h-full py-8">
                  <Plus className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors mb-2" />
                  <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                    Generate for {competitorsWithoutCards.length} more competitor{competitorsWithoutCards.length > 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

      </div>

      <Dialog open={!!selectedCard} onOpenChange={(open) => !open && setSelectedCard(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-primary" />
              {selectedCard?.competitorName} Battle Card
            </DialogTitle>
            <DialogDescription>
              Competitive comparison vs {companyProfile?.companyName || "Your Company"}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 py-4">
              {(selectedCard?.strengths?.length || selectedCard?.weaknesses?.length) ? (
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Competitor Overview</h3>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    {selectedCard?.strengths && selectedCard.strengths.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-green-500">
                          <CheckCircle className="w-4 h-4" />
                          <span className="font-medium text-sm">Their Strengths</span>
                        </div>
                        <ul className="space-y-1 pl-6">
                          {selectedCard.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedCard?.weaknesses && selectedCard.weaknesses.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-red-500">
                          <XCircle className="w-4 h-4" />
                          <span className="font-medium text-sm">Their Weaknesses</span>
                        </div>
                        <ul className="space-y-1 pl-6">
                          {selectedCard.weaknesses.map((w, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {selectedCard?.ourAdvantages && selectedCard.ourAdvantages.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Our Advantages
                    </h3>
                    <ul className="space-y-2">
                      {selectedCard.ourAdvantages.map((advantage, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span className="text-sm">{advantage}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {selectedCard?.comparison && selectedCard.comparison.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Feature Comparison
                    </h3>
                    <div className="space-y-3">
                      {selectedCard.comparison.map((item, i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm">{item.category}</span>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Us:</span>
                                <HarveyBallIcon value={item.us} className="w-4 h-4" />
                                <span className="text-xs">{harveyBallToLabel(item.us)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Them:</span>
                                <HarveyBallIcon value={item.them} className="w-4 h-4" />
                                <span className="text-xs">{harveyBallToLabel(item.them)}</span>
                              </div>
                            </div>
                          </div>
                          {item.notes && (
                            <p className="text-xs text-muted-foreground">{item.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedCard?.objections && selectedCard.objections.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Common Objections & Responses
                    </h3>
                    <div className="space-y-3">
                      {selectedCard.objections.map((obj, i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30">
                          <div className="flex items-start gap-2 mb-2">
                            <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                            <p className="text-sm font-medium">{obj.objection}</p>
                          </div>
                          <p className="text-sm text-muted-foreground pl-6">{obj.response}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedCard?.talkTracks && selectedCard.talkTracks.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Talk Tracks
                    </h3>
                    <div className="space-y-3">
                      {selectedCard.talkTracks.map((track, i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30">
                          <p className="text-sm font-medium mb-2">{track.scenario}</p>
                          <p className="text-sm text-muted-foreground">{track.script}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedCard?.quickStats && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Quick Stats
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {selectedCard.quickStats.pricing && (
                        <div className="p-3 rounded-lg bg-muted/30">
                          <p className="text-xs text-muted-foreground">Pricing</p>
                          <p className="text-sm font-medium">{selectedCard.quickStats.pricing}</p>
                        </div>
                      )}
                      {selectedCard.quickStats.marketPosition && (
                        <div className="p-3 rounded-lg bg-muted/30">
                          <p className="text-xs text-muted-foreground">Market Position</p>
                          <p className="text-sm font-medium">{selectedCard.quickStats.marketPosition}</p>
                        </div>
                      )}
                      {selectedCard.quickStats.targetAudience && (
                        <div className="p-3 rounded-lg bg-muted/30">
                          <p className="text-xs text-muted-foreground">Target Audience</p>
                          <p className="text-sm font-medium">{selectedCard.quickStats.targetAudience}</p>
                        </div>
                      )}
                      {selectedCard.quickStats.keyProducts && (
                        <div className="p-3 rounded-lg bg-muted/30">
                          <p className="text-xs text-muted-foreground">Key Products</p>
                          <p className="text-sm font-medium">{selectedCard.quickStats.keyProducts}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {selectedCard?.customNotes && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                      Notes
                    </h3>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-sm whitespace-pre-wrap">{selectedCard.customNotes}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
