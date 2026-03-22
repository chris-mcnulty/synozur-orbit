import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, LayoutList } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface SavedEmail {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
}

export default function EmailNewslettersPage() {
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
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Saved Emails</h2>
            {savedEmails.map(email => (
              <Card key={email.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{email.subject}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(email.createdAt), "MMM d, yyyy 'at' h:mm a")}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{email.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

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
