import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

export default function WhatsNewModal() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["/api/changelog/whats-new"],
    queryFn: async () => {
      const res = await fetch("/api/changelog/whats-new", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/changelog/dismiss");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/changelog/whats-new"] });
    },
  });

  const handleDismiss = () => {
    dismissMutation.mutate();
  };

  const handleViewChangelog = () => {
    dismissMutation.mutate();
    setLocation("/app/changelog");
  };

  if (!data?.showModal) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md" data-testid="modal-whats-new">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="w-5 h-5 text-primary" />
            What's New in v{data.version}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground" data-testid="text-whats-new-summary">
            {data.summary}
          </p>

          <div className="space-y-3">
            {data.highlights?.map((highlight: { emoji: string; text: string }, i: number) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30" data-testid={`highlight-${i}`}>
                <span className="text-lg">{highlight.emoji}</span>
                <span className="text-sm">{highlight.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={handleDismiss} data-testid="button-dismiss-whats-new">
            Dismiss
          </Button>
          <Button onClick={handleViewChangelog} data-testid="button-view-changelog">
            View Changelog <ArrowRight size={16} className="ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
