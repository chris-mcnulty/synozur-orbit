import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, LayoutList, Filter, Pencil } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface SavedEmail {
  id: string;
  subject: string;
  htmlBody: string;
  format?: string;
  status: string;
  campaignId?: string;
  createdAt: string;
}

export default function EmailNewslettersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [editingEmail, setEditingEmail] = useState<SavedEmail | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const { data: tenantInfo } = useQuery<{ features?: Record<string, boolean> }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/info", { credentials: "include" });
      return r.ok ? r.json() : {};
    },
  });

  const isAllowed = tenantInfo?.features?.emailNewsletters === true;

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
    queryFn: async () => {
      const r = await fetch("/api/campaigns", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const { data: savedEmails = [] } = useQuery<SavedEmail[]>({
    queryKey: ["/api/email/saved"],
    queryFn: async () => {
      const r = await fetch("/api/email/saved", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAllowed,
  });

  const updateEmailMutation = useMutation({
    mutationFn: async ({ emailId, subject, htmlBody }: { emailId: string; subject: string; htmlBody: string }) => {
      const r = await fetch(`/api/email/saved/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subject, htmlBody }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/saved"] });
      setEditingEmail(null);
      toast({ title: "Email updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredEmails = savedEmails.filter(e => {
    if (campaignFilter === "all") return true;
    if (campaignFilter === "none") return !e.campaignId;
    return e.campaignId === campaignFilter;
  });

  const getCampaignName = (cId?: string) => {
    if (!cId) return null;
    return campaigns.find(c => c.id === cId)?.name || null;
  };

  if (!isAllowed) {
    return (
      <AppLayout>
        <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md text-center" data-testid="card-email-newsletters-coming-soon">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <CardTitle data-testid="text-email-newsletters-title">Email Newsletter Generator</CardTitle>
              <CardDescription>
                Create AI-powered promotional emails from your campaign assets and market intelligence. Available on the Enterprise plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" asChild data-testid="button-email-newsletters-contact-sales">
                <a href="mailto:contactus@synozur.com?subject=Enterprise%20Plan%20Inquiry%20-%20Email%20Newsletters">
                  Contact Sales
                </a>
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
              <Mail className="w-6 h-6" /> Email Newsletters
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Generate and save AI-drafted emails from within campaigns. Saved emails appear below.
            </p>
          </div>
          <Link href="/app/marketing/campaigns">
            <Button className="gap-2">
              <LayoutList className="w-4 h-4" /> View Campaigns
            </Button>
          </Link>
        </div>

        {savedEmails.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Saved Emails</h2>
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                  <SelectTrigger className="w-48" data-testid="select-email-campaign-filter">
                    <SelectValue placeholder="Filter by campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Campaigns</SelectItem>
                    <SelectItem value="none">No Campaign</SelectItem>
                    {campaigns.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {filteredEmails.map(email => (
              <Card key={email.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{email.subject}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {email.format && email.format !== "promotional" && (
                          <Badge variant="secondary" className="text-[10px] capitalize">{email.format.replace(/-/g, " ")}</Badge>
                        )}
                        <p className="text-xs text-muted-foreground">{format(new Date(email.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                        {getCampaignName(email.campaignId) && (
                          <Badge variant="secondary" className="text-[10px]">{getCampaignName(email.campaignId)}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{email.status}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingEmail(email);
                          setEditSubject(email.subject);
                          setEditBody(email.htmlBody);
                        }}
                        data-testid={`button-edit-email-${email.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!editingEmail} onOpenChange={v => { if (!v) setEditingEmail(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Email</DialogTitle>
              <DialogDescription>Modify the subject line and email body.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Subject</Label>
                <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} data-testid="input-edit-email-subject" />
              </div>
              <div>
                <Label>HTML Body</Label>
                <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={12} className="font-mono text-xs" data-testid="input-edit-email-body" />
              </div>
              <Button
                className="w-full"
                disabled={!editSubject.trim() || updateEmailMutation.isPending}
                onClick={() => {
                  if (editingEmail) {
                    updateEmailMutation.mutate({ emailId: editingEmail.id, subject: editSubject, htmlBody: editBody });
                  }
                }}
                data-testid="button-save-edit-email"
              >
                {updateEmailMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <Mail className="w-10 h-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium">No campaigns yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create a campaign, add content assets, then use the Email tab in the campaign detail to generate and save emails.
                </p>
              </div>
              <Link href="/app/marketing/campaigns">
                <Button variant="outline" className="gap-2">
                  Go to Campaigns <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Generate from a Campaign</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {campaigns.map(c => (
                <Card key={c.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{c.name}</CardTitle>
                      <Badge variant="outline" className="capitalize">{c.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Link href={`/app/marketing/campaigns/${c.id}`}>
                      <Button variant="ghost" size="sm" className="gap-1 w-full justify-between">
                        Open &amp; generate email <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
