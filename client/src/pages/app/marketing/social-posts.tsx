import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Share2, CheckCircle, Sparkles, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function SocialPostsPage() {
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
          <Card className="max-w-lg text-center" data-testid="card-social-posts-coming-soon">
            <CardHeader>
              <div className="mx-auto mb-4 p-4 bg-primary/10 rounded-full w-fit relative">
                <Share2 className="w-12 h-12 text-primary" />
                <Badge className="absolute -top-1 -right-1 bg-amber-500 text-white border-0 text-[10px] px-1.5">
                  <Clock className="w-3 h-3 mr-0.5" />
                  Coming Soon
                </Badge>
              </div>
              <CardTitle className="text-2xl" data-testid="text-social-posts-title">Social Post Generator</CardTitle>
              <CardDescription className="text-base">
                Generate AI-powered social media posts tailored to your competitive positioning and brand voice.
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
                      AI-generated posts for LinkedIn, Twitter/X, and more
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Posts informed by competitive intelligence
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Brand voice consistency across channels
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Content calendar with scheduling suggestions
                    </li>
                  </ul>
                  <Button className="w-full" asChild data-testid="button-social-posts-contact-sales">
                    <a href="mailto:contactus@synozur.com?subject=Enterprise%20Plan%20Inquiry%20-%20Social%20Posts">
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
                      AI-generated posts for LinkedIn, Twitter/X, and more
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Posts informed by competitive intelligence
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Brand voice consistency across channels
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      Content calendar with scheduling suggestions
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
