import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, CheckCircle, Sparkles, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function EmailNewslettersPage() {
  const { data: tenantInfo } = useQuery<{ plan: string; isPremium: boolean; features?: any }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return { plan: "trial", isPremium: false };
      return response.json();
    },
  });

  const isEnterprise = tenantInfo?.plan === "enterprise" || tenantInfo?.plan === "unlimited";

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-lg text-center" data-testid="card-email-newsletters-coming-soon">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit relative">
                <Mail className="w-12 h-12 text-primary" />
                <Badge className="absolute -top-1 -right-1 bg-amber-500 text-white border-0 text-[10px] px-1.5">
                  <Clock className="w-3 h-3 mr-0.5" />
                  Coming Soon
                </Badge>
              </div>
              <CardTitle className="text-2xl" data-testid="text-email-newsletters-title">Email Newsletter Generator</CardTitle>
              <CardDescription className="text-base">
                Create AI-powered email newsletters that leverage your competitive insights and market intelligence.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isEnterprise ? (
                <>
                  <p className="text-muted-foreground">
                    This feature will be available on the Enterprise plan. Upgrade to unlock when ready:
                  </p>
                  <ul className="text-sm text-left space-y-2 text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      AI-generated newsletter content from intelligence briefings
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Customizable templates and brand styling
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Competitive landscape summaries for stakeholders
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Scheduled delivery and audience management
                    </li>
                  </ul>
                  <Button className="w-full" asChild data-testid="button-email-newsletters-contact-sales">
                    <a href="mailto:contactus@synozur.com?subject=Enterprise%20Plan%20Inquiry%20-%20Email%20Newsletters">
                      Contact Sales
                    </a>
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-2 py-4">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    <p className="text-muted-foreground font-medium">
                      We're building something great. This feature is coming soon.
                    </p>
                  </div>
                  <ul className="text-sm text-left space-y-2 text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      AI-generated newsletter content from intelligence briefings
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Customizable templates and brand styling
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Competitive landscape summaries for stakeholders
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Scheduled delivery and audience management
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground pt-2">
                    Your Enterprise plan includes this feature. You'll be notified when it launches.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
