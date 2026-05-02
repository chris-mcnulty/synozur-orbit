import React, { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, MessagesSquare, ThumbsUp, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PublicItem {
  id: string;
  title: string;
  description: string | null;
  status: "new" | "planned" | "shipped" | "declined";
  category: string | null;
  voteCount: number;
  createdAt: string;
}

interface PublicResponse {
  productName: string;
  productDescription: string | null;
  items: PublicItem[];
  captcha: { question: string; token: string };
}

const STATUS_LABELS: Record<PublicItem["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  planned: { label: "Planned", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  shipped: { label: "Shipped", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  declined: { label: "Declined", tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};

export default function PublicFeedbackPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", email: "", name: "", captchaAnswer: "", honeypot: "" });
  const [voteEmail, setVoteEmail] = useState("");
  const [voteCaptchaInput, setVoteCaptchaInput] = useState<Record<string, string>>({});
  const [voteOpen, setVoteOpen] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<PublicResponse>({
    queryKey: ["/api/public/feedback", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/feedback/${token}`);
      if (!res.ok) throw new Error("Feedback board not available");
      return res.json();
    },
    enabled: !!token,
    refetchOnWindowFocus: false,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Captcha unavailable");
      const res = await fetch(`/api/public/feedback/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          email: form.email.trim() || null,
          name: form.name.trim() || null,
          captchaToken: data.captcha.token,
          captchaAnswer: parseInt(form.captchaAnswer, 10),
          honeypot: form.honeypot,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setForm({ title: "", description: "", email: "", name: "", captchaAnswer: "", honeypot: "" });
      setIsOpen(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/public/feedback", token] });
      toast({ title: "Thanks for your feedback!" });
    },
    onError: (err: any) => toast({ title: "Submission failed", description: err.message, variant: "destructive" }),
  });

  const voteMutation = useMutation({
    mutationFn: async ({ id, captchaAnswer }: { id: string; captchaAnswer: number }) => {
      if (!data) throw new Error("Captcha unavailable");
      const res = await fetch(`/api/public/feedback/${token}/vote/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: voteEmail || null,
          captchaToken: data.captcha.token,
          captchaAnswer,
          honeypot: "",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Vote failed");
      }
      return res.json();
    },
    onSuccess: (result, vars) => {
      refetch();
      setVoteOpen(null);
      setVoteCaptchaInput(prev => ({ ...prev, [vars.id]: "" }));
      toast({ title: result.voted ? "Vote recorded" : "Vote removed" });
    },
    onError: (err: any) => toast({ title: "Vote failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading feedback...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Feedback board not available</CardTitle>
            <CardDescription>The link may have been disabled or rotated. Please contact whoever shared it for an updated URL.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const captchaQuestion = data.captcha.question;

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-public-title">
              <MessagesSquare className="h-7 w-7" /> {data.productName} feedback
            </h1>
            {data.productDescription && (
              <p className="text-muted-foreground mt-2 max-w-2xl">{data.productDescription}</p>
            )}
            <p className="text-sm text-muted-foreground mt-2">Share an idea or upvote what others have suggested.</p>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-public-submit-open">
                <Plus className="h-4 w-4 mr-2" /> Submit feedback
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit feedback</DialogTitle>
                <DialogDescription>Tell us what you would like to see in {data.productName}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label htmlFor="public-title">Title</Label>
                  <Input id="public-title" data-testid="input-public-title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="public-description">Details (optional)</Label>
                  <Textarea id="public-description" data-testid="input-public-description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} maxLength={4000} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="public-name">Your name (optional)</Label>
                    <Input id="public-name" data-testid="input-public-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={120} />
                  </div>
                  <div>
                    <Label htmlFor="public-email">Email (optional)</Label>
                    <Input id="public-email" type="email" data-testid="input-public-email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} maxLength={200} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="public-captcha">{captchaQuestion}</Label>
                  <Input id="public-captcha" type="number" data-testid="input-public-captcha" value={form.captchaAnswer} onChange={e => setForm(f => ({ ...f, captchaAnswer: e.target.value }))} />
                </div>
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.honeypot}
                  onChange={e => setForm(f => ({ ...f, honeypot: e.target.value }))}
                  style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px" }}
                  aria-hidden="true"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={!form.title.trim() || !form.captchaAnswer || submitMutation.isPending}
                  data-testid="button-public-submit"
                >
                  {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Submit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {data.items.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="empty-public-feedback">
              No feedback yet. Be the first!
            </CardContent>
          </Card>
        )}

        {data.items.map(item => (
          <Card key={item.id} data-testid={`card-public-feedback-${item.id}`}>
            <CardContent className="pt-4 flex gap-3">
              <div className="flex flex-col items-center min-w-[3.5rem]">
                <Dialog open={voteOpen === item.id} onOpenChange={(open) => setVoteOpen(open ? item.id : null)}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-12 w-12 flex-col gap-0.5" data-testid={`button-public-vote-${item.id}`}>
                      <ThumbsUp className="h-4 w-4" />
                      <span className="text-xs font-semibold">{item.voteCount}</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirm your vote</DialogTitle>
                      <DialogDescription>Quick check to keep this clean of bots.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div>
                        <Label htmlFor={`vote-email-${item.id}`}>Email (optional, helps prevent duplicate votes)</Label>
                        <Input
                          id={`vote-email-${item.id}`}
                          type="email"
                          value={voteEmail}
                          onChange={e => setVoteEmail(e.target.value)}
                          placeholder="you@example.com"
                          data-testid={`input-vote-email-${item.id}`}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`vote-captcha-${item.id}`}>{captchaQuestion}</Label>
                        <Input
                          id={`vote-captcha-${item.id}`}
                          type="number"
                          value={voteCaptchaInput[item.id] || ""}
                          onChange={e => setVoteCaptchaInput(prev => ({ ...prev, [item.id]: e.target.value }))}
                          data-testid={`input-vote-captcha-${item.id}`}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setVoteOpen(null)}>Cancel</Button>
                      <Button
                        onClick={() => voteMutation.mutate({ id: item.id, captchaAnswer: parseInt(voteCaptchaInput[item.id] || "", 10) })}
                        disabled={!voteCaptchaInput[item.id] || voteMutation.isPending}
                        data-testid={`button-confirm-vote-${item.id}`}
                      >
                        {voteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Vote
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold leading-snug" data-testid={`text-public-title-${item.id}`}>{item.title}</h3>
                {item.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{item.description}</p>}
                <div className="flex flex-wrap gap-2 items-center mt-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className={STATUS_LABELS[item.status].tone}>{STATUS_LABELS[item.status].label}</Badge>
                  {item.category && <Badge variant="secondary">{item.category}</Badge>}
                  <span>· {new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
