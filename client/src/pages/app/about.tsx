import { useState } from "react";
import { 
  Map, CheckCircle2, Clock, Rocket, Star, Info,
  Shield, BarChart3, Users, Zap, Target, Globe,
  FileText, ListTodo
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/layout/AppLayout";
import MarkdownViewer from "@/components/MarkdownViewer";

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: "completed" | "in-progress" | "planned" | "future";
  category: string;
  icon: React.ReactNode;
}

interface Milestone {
  id: string;
  name: string;
  quarter: string;
  progress: number;
  items: RoadmapItem[];
}

const milestones: Milestone[] = [
  {
    id: "q1-2026",
    name: "Foundation Complete",
    quarter: "Q1 2026",
    progress: 100,
    items: [
      {
        id: "multi-tenant",
        title: "Multi-Tenant Architecture",
        description: "Secure tenant isolation with role-based access control",
        status: "completed",
        category: "Platform",
        icon: <Users className="h-4 w-4" />
      },
      {
        id: "competitor-tracking",
        title: "Competitor Tracking",
        description: "Add and manage competitors with automated web crawling",
        status: "completed",
        category: "Core",
        icon: <Target className="h-4 w-4" />
      },
      {
        id: "ai-analysis",
        title: "AI-Powered Analysis",
        description: "Claude Sonnet integration for competitive intelligence",
        status: "completed",
        category: "AI",
        icon: <Zap className="h-4 w-4" />
      },
      {
        id: "sso",
        title: "Microsoft Entra ID SSO",
        description: "Enterprise single sign-on with Azure AD integration",
        status: "completed",
        category: "Security",
        icon: <Shield className="h-4 w-4" />
      },
      {
        id: "overview-dashboard",
        title: "Unified Overview Dashboard",
        description: "Consolidated dashboard for holistic competitive intelligence",
        status: "completed",
        category: "Core",
        icon: <BarChart3 className="h-4 w-4" />
      }
    ]
  },
  {
    id: "q2-2026",
    name: "Enhanced Intelligence",
    quarter: "Q2 2026",
    progress: 25,
    items: [
      {
        id: "consolidated-actions",
        title: "Consolidated Action Items",
        description: "Dashboard view of all action items with assignment and commenting",
        status: "in-progress",
        category: "Core",
        icon: <CheckCircle2 className="h-4 w-4" />
      },
      {
        id: "battlecard-pdf",
        title: "Battlecard PDF Export",
        description: "Export battlecards as branded PDF documents",
        status: "planned",
        category: "Reporting",
        icon: <Star className="h-4 w-4" />
      },
      {
        id: "ai-usage-tracker",
        title: "AI Usage Tracker",
        description: "System-level tracking of AI API usage with admin dashboard",
        status: "planned",
        category: "Platform",
        icon: <BarChart3 className="h-4 w-4" />
      },
      {
        id: "input-validation",
        title: "Enhanced Input Safety",
        description: "Pre-validate URLs and uploads for security threats",
        status: "in-progress",
        category: "Security",
        icon: <Shield className="h-4 w-4" />
      }
    ]
  },
  {
    id: "q3-2026",
    name: "Scale & Monitor",
    quarter: "Q3 2026",
    progress: 0,
    items: [
      {
        id: "google-sso",
        title: "Google SSO",
        description: "Google OAuth as alternative to Microsoft Entra ID",
        status: "planned",
        category: "Security",
        icon: <Globe className="h-4 w-4" />
      },
      {
        id: "recaptcha",
        title: "reCAPTCHA Protection",
        description: "Bot prevention for signup forms",
        status: "planned",
        category: "Security",
        icon: <Shield className="h-4 w-4" />
      },
      {
        id: "social-monitoring",
        title: "Social & Blog Monitoring",
        description: "Scheduled monitoring with AI-summarized change diffs",
        status: "planned",
        category: "Core",
        icon: <Clock className="h-4 w-4" />
      },
      {
        id: "visual-assets",
        title: "Visual Competitor Assets",
        description: "Screenshot capture and visual analysis",
        status: "planned",
        category: "Core",
        icon: <Target className="h-4 w-4" />
      }
    ]
  },
  {
    id: "future",
    name: "Future Vision",
    quarter: "Beyond",
    progress: 0,
    items: [
      {
        id: "tenant-branding",
        title: "Per-Tenant Branding",
        description: "Custom logos and colors for each tenant",
        status: "future",
        category: "Platform",
        icon: <Star className="h-4 w-4" />
      },
      {
        id: "domain-blocklist",
        title: "Domain Blocklist",
        description: "Prevent signups from specific email domains",
        status: "future",
        category: "Security",
        icon: <Shield className="h-4 w-4" />
      }
    ]
  }
];

const getStatusColor = (status: string) => {
  switch (status) {
    case "completed": return "bg-green-500/10 text-green-400 border-green-500/30";
    case "in-progress": return "bg-blue-500/10 text-blue-400 border-blue-500/30";
    case "planned": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
    default: return "bg-muted text-muted-foreground border-muted";
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case "completed": return "Completed";
    case "in-progress": return "In Progress";
    case "planned": return "Planned";
    default: return "Future";
  }
};

const getCategoryColor = (category: string) => {
  switch (category) {
    case "Core": return "bg-primary/10 text-primary";
    case "AI": return "bg-purple-500/10 text-purple-400";
    case "Security": return "bg-red-500/10 text-red-400";
    case "Platform": return "bg-cyan-500/10 text-cyan-400";
    case "Reporting": return "bg-orange-500/10 text-orange-400";
    default: return "bg-muted text-muted-foreground";
  }
};

export default function AboutPage() {
  const [activeTab, setActiveTab] = useState("roadmap");

  const allItems = milestones.flatMap(m => m.items);
  const completedCount = allItems.filter(i => i.status === "completed").length;
  const inProgressCount = allItems.filter(i => i.status === "in-progress").length;
  const plannedCount = allItems.filter(i => i.status === "planned").length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Info className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">About Orbit</h1>
              <p className="text-muted-foreground text-sm">Product information, roadmap, and updates</p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="roadmap" className="flex items-center gap-2" data-testid="tab-roadmap">
              <Map className="w-4 h-4" />
              Roadmap
            </TabsTrigger>
            <TabsTrigger value="changelog" className="flex items-center gap-2" data-testid="tab-changelog">
              <FileText className="w-4 h-4" />
              Changelog
            </TabsTrigger>
            <TabsTrigger value="backlog" className="flex items-center gap-2" data-testid="tab-backlog">
              <ListTodo className="w-4 h-4" />
              Backlog
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roadmap" className="mt-6">
            <div className="flex items-center gap-4 text-sm mb-6">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>{completedCount} Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span>{inProgressCount} In Progress</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span>{plannedCount} Planned</span>
              </div>
            </div>

            <div className="space-y-8">
              {milestones.map((milestone, index) => (
                <div key={milestone.id} className="relative">
                  {index < milestones.length - 1 && (
                    <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-border" />
                  )}
                  
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full shrink-0 ${
                      milestone.progress === 100 
                        ? "bg-green-500/20 text-green-400" 
                        : milestone.progress > 0 
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-muted text-muted-foreground"
                    }`}>
                      {milestone.progress === 100 ? (
                        <CheckCircle2 className="h-6 w-6" />
                      ) : milestone.progress > 0 ? (
                        <Clock className="h-6 w-6" />
                      ) : (
                        <Rocket className="h-6 w-6" />
                      )}
                    </div>
                    
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-xl font-semibold">{milestone.name}</h2>
                          <p className="text-sm text-muted-foreground">{milestone.quarter}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">{milestone.progress}%</span>
                          <Progress value={milestone.progress} className="w-32 h-2" />
                        </div>
                      </div>
                      
                      <div className="grid gap-3 md:grid-cols-2">
                        {milestone.items.map(item => (
                          <Card key={item.id} className="border-border/50" data-testid={`card-roadmap-${item.id}`}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className={`p-1.5 rounded ${getCategoryColor(item.category)}`}>
                                    {item.icon}
                                  </div>
                                  <div>
                                    <h3 className="font-medium text-sm">{item.title}</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                                  </div>
                                </div>
                                <Badge variant="outline" className={`shrink-0 text-xs ${getStatusColor(item.status)}`}>
                                  {getStatusLabel(item.status)}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="changelog" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Changelog
                </CardTitle>
                <CardDescription>
                  A detailed history of all updates, improvements, and new features.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MarkdownViewer url="/api/content/changelog.md" maxHeight="600px" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="backlog" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListTodo className="w-5 h-5" />
                  Backlog
                </CardTitle>
                <CardDescription>
                  Features and improvements we're tracking for future releases.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MarkdownViewer url="/api/content/backlog.md" maxHeight="600px" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
