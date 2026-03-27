import React, { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  RefreshCw,
  Globe,
  Linkedin,
  Newspaper,
  Building2,
  Target,
  FileText,
  Sparkles,
  Clock,
  LayoutDashboard,
  BarChart2,
  Lightbulb,
  Activity,
  Settings,
  Users,
  LineChart,
  Shield,
  BookOpen,
  ClipboardList,
  Package,
  HelpCircle,
  Swords,
  Database,
  Gem,
  Brain,
  Rocket,
  Mail,
  Library,
  Image,
  LayoutList,
  AtSign,
  Puzzle,
  TicketIcon,
  Map,
  Plus,
  Zap,
  Info,
  UserCircle,
  Crown,
  HardDrive,
} from "lucide-react";
import { useLocation } from "wouter";
import { getFullStalenessInfo } from "@/lib/staleness";

interface RefreshAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  action: () => Promise<void>;
  lastUpdated?: string | null;
  staleness?: string;
}

interface NavEntry {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALL_PAGES: NavEntry[] = [
  { id: "nav-dashboard",         label: "Dashboard",             description: "Overview of your competitive landscape", icon: <LayoutDashboard className="w-4 h-4" />, href: "/app" },
  { id: "nav-company-profile",   label: "Company Baseline",      description: "Your company profile and website",       icon: <Building2 className="w-4 h-4" />,        href: "/app/company-profile" },
  { id: "nav-competitors",       label: "Competitors",           description: "Manage tracked competitors",             icon: <Target className="w-4 h-4" />,           href: "/app/competitors" },
  { id: "nav-data-sources",      label: "Data Sources",          description: "Manage data inputs and freshness",       icon: <Database className="w-4 h-4" />,         href: "/app/data-sources" },
  { id: "nav-documents",         label: "Documents",             description: "Grounding documents for AI context",     icon: <FileText className="w-4 h-4" />,         href: "/app/documents" },
  { id: "nav-analysis",          label: "Analysis",              description: "AI competitive analysis",                icon: <BarChart2 className="w-4 h-4" />,        href: "/app/analysis" },
  { id: "nav-battlecards",       label: "Battlecards",           description: "Sales enablement battlecards",           icon: <Swords className="w-4 h-4" />,           href: "/app/battlecards" },
  { id: "nav-action-items",      label: "Action Items",          description: "AI recommendations and gap analysis",    icon: <Lightbulb className="w-4 h-4" />,        href: "/app/action-items" },
  { id: "nav-activity",          label: "Activity Feed",         description: "Competitor changes and social signals",  icon: <Activity className="w-4 h-4" />,         href: "/app/activity" },
  { id: "nav-briefing",          label: "Intelligence Briefing", description: "AI-synthesised market briefing",         icon: <Brain className="w-4 h-4" />,            href: "/app/intelligence-briefing" },
  { id: "nav-baseline-summary",  label: "Baseline Summary",      description: "Your company competitive position",      icon: <Shield className="w-4 h-4" />,           href: "/app/baseline-summary" },
  { id: "nav-executive-summary", label: "Executive Summary",     description: "High-level executive overview",          icon: <BookOpen className="w-4 h-4" />,         href: "/app/executive-summary" },
  { id: "nav-health",            label: "Intelligence Health",   description: "Data freshness and source quality",      icon: <RefreshCw className="w-4 h-4" />,        href: "/app/refresh-center" },
  { id: "nav-products",          label: "Products",              description: "Feature catalog and roadmap",            icon: <Package className="w-4 h-4" />,          href: "/app/products" },
  { id: "nav-roadmap",           label: "Product Roadmap",       description: "Quarterly roadmap view",                 icon: <Map className="w-4 h-4" />,              href: "/app/roadmap" },
  { id: "nav-marketing-planner", label: "Marketing Planner",     description: "AI-driven marketing planning",           icon: <Gem className="w-4 h-4" />,              href: "/app/marketing-planner" },
  { id: "nav-campaigns",         label: "Social Campaigns",      description: "Content campaigns and social posts",     icon: <LayoutList className="w-4 h-4" />,       href: "/app/marketing/campaigns" },
  { id: "nav-email",             label: "Email Newsletters",     description: "AI-generated email content",             icon: <Mail className="w-4 h-4" />,             href: "/app/marketing/email-newsletters" },
  { id: "nav-content-library",   label: "Asset Library",         description: "Content asset management",               icon: <Library className="w-4 h-4" />,          href: "/app/marketing/content-library" },
  { id: "nav-brand-assets",      label: "Brand Assets",          description: "Brand asset library",                    icon: <Image className="w-4 h-4" />,            href: "/app/marketing/brand-library" },
  { id: "nav-social-accounts",   label: "Social Accounts",       description: "Connected social media accounts",        icon: <AtSign className="w-4 h-4" />,           href: "/app/marketing/social-accounts" },
  { id: "nav-personas",          label: "Personas",              description: "Buyer persona and ICP builder",          icon: <UserCircle className="w-4 h-4" />,       href: "/app/marketing/personas" },
  { id: "nav-extension",         label: "Browser Extension",     description: "Saturn capture extension",               icon: <Puzzle className="w-4 h-4" />,           href: "/app/marketing/browser-extension" },
  { id: "nav-reports",           label: "Reports",               description: "Branded PDF reports",                    icon: <FileText className="w-4 h-4" />,         href: "/app/reports" },
  { id: "nav-assessments",       label: "Assessments",           description: "Competitive analysis snapshots",         icon: <ClipboardList className="w-4 h-4" />,    href: "/app/assessments" },
  { id: "nav-users",             label: "User Management",       description: "Manage team members",                    icon: <Users className="w-4 h-4" />,            href: "/app/users" },
  { id: "nav-usage",             label: "Usage and Traffic",     description: "AI usage and analytics",                 icon: <LineChart className="w-4 h-4" />,        href: "/app/usage" },
  { id: "nav-settings",          label: "Settings",              description: "Account and organisation settings",      icon: <Settings className="w-4 h-4" />,         href: "/app/settings" },
  { id: "nav-spe",               label: "Document Storage",      description: "SharePoint Embedded storage",            icon: <HardDrive className="w-4 h-4" />,        href: "/app/admin/spe-storage" },
  { id: "nav-admin",             label: "Admin Dashboard",       description: "Global admin controls",                  icon: <Crown className="w-4 h-4" />,            href: "/app/admin" },
  { id: "nav-ai-settings",       label: "AI Settings",           description: "AI provider and model configuration",    icon: <Brain className="w-4 h-4" />,            href: "/app/admin/ai-settings" },
  { id: "nav-getting-started",   label: "Getting Started",       description: "Onboarding guide",                       icon: <Rocket className="w-4 h-4" />,           href: "/app/getting-started" },
  { id: "nav-support",           label: "Support",               description: "Submit a support ticket",                icon: <TicketIcon className="w-4 h-4" />,       href: "/app/support" },
  { id: "nav-user-guide",        label: "User Guide",            description: "Platform documentation",                 icon: <HelpCircle className="w-4 h-4" />,       href: "/app/guide" },
  { id: "nav-changelog",         label: "Changelog",             description: "Whats new in Orbit",                    icon: <Sparkles className="w-4 h-4" />,         href: "/app/changelog" },
  { id: "nav-about",             label: "About",                 description: "About Orbit",                            icon: <Info className="w-4 h-4" />,             href: "/app/about" },
];

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const [recentActions, setRecentActions] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("recentRefreshActions");
    if (stored) {
      try { setRecentActions(JSON.parse(stored)); } catch {}
    }
  }, []);

  const trackAction = useCallback((actionId: string) => {
    setRecentActions((prev) => {
      const updated = [actionId, ...prev.filter((id) => id !== actionId)].slice(0, 5);
      localStorage.setItem("recentRefreshActions", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const res = await fetch("/api/competitors", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const { data: companyProfile } = useQuery({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open,
  });

  const { data: newsData } = useQuery({
    queryKey: ["/api/data-sources/news"],
    queryFn: async () => {
      const res = await fetch("/api/data-sources/news", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open,
  });

  const { data: recentActivity = [] } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const res = await fetch("/api/activity", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  // Build refresh actions
  const refreshActions: RefreshAction[] = [];

  if (newsData) {
    const newsLastFetched = newsData.results?.[0]?.fetchedAt;
    const staleness = getFullStalenessInfo(newsLastFetched);
    refreshActions.push({
      id: "refresh-news",
      label: "Refresh News Mentions",
      description: "Last updated: " + staleness.timeAgo,
      icon: <Newspaper className="w-4 h-4" />,
      category: "Global",
      lastUpdated: newsLastFetched,
      staleness: staleness.label,
      action: async () => {
        await fetch("/api/data-sources/news/refresh", { method: "POST", credentials: "include" });
        trackAction("refresh-news");
        onOpenChange(false);
      },
    });
  }

  if (companyProfile) {
    const staleness = getFullStalenessInfo(companyProfile.lastCrawl);
    refreshActions.push({
      id: "refresh-baseline-website",
      label: "Refresh " + companyProfile.name + " Website",
      description: "Last updated: " + staleness.timeAgo + " - approx 3-5 min",
      icon: <Globe className="w-4 h-4" />,
      category: "Company Baseline",
      lastUpdated: companyProfile.lastCrawl,
      staleness: staleness.label,
      action: async () => {
        await fetch("/api/company-profile/" + companyProfile.id + "/refresh", { method: "POST", credentials: "include" });
        trackAction("refresh-baseline-website");
        onOpenChange(false);
      },
    });
    if (companyProfile.linkedInUrl) {
      refreshActions.push({
        id: "refresh-baseline-social",
        label: "Refresh " + companyProfile.name + " Social Media",
        description: "LinkedIn only - approx 30s",
        icon: <Linkedin className="w-4 h-4" />,
        category: "Company Baseline",
        action: async () => {
          await fetch("/api/company-profile/" + companyProfile.id + "/refresh-social", { method: "POST", credentials: "include" });
          trackAction("refresh-baseline-social");
          onOpenChange(false);
        },
      });
    }
  }

  (competitors as any[]).forEach((competitor) => {
    const staleness = getFullStalenessInfo(competitor.lastCrawl);
    refreshActions.push({
      id: "refresh-competitor-" + competitor.id,
      label: "Refresh " + competitor.name,
      description: "Last updated: " + staleness.timeAgo,
      icon: <Target className="w-4 h-4" />,
      category: "Competitors",
      lastUpdated: competitor.lastCrawl,
      staleness: staleness.label,
      action: async () => {
        await fetch("/api/competitors/" + competitor.id + "/crawl", { method: "POST", credentials: "include" });
        trackAction("refresh-competitor-" + competitor.id);
        onOpenChange(false);
      },
    });
  });

  const quickActions: QuickAction[] = [
    {
      id: "quick-add-competitor",
      label: "Add Competitor",
      description: "Track a new competitor",
      icon: <Plus className="w-4 h-4" />,
      action: () => { setLocation("/app/competitors"); onOpenChange(false); },
    },
    {
      id: "quick-run-analysis",
      label: "Run Analysis",
      description: "Generate a new competitive analysis",
      icon: <Zap className="w-4 h-4" />,
      action: () => { setLocation("/app/analysis"); onOpenChange(false); },
    },
    {
      id: "quick-new-briefing",
      label: "Generate Intelligence Briefing",
      description: "Create a new AI market briefing",
      icon: <Brain className="w-4 h-4" />,
      action: () => { setLocation("/app/intelligence-briefing"); onOpenChange(false); },
    },
    {
      id: "quick-download-report",
      label: "Download Report",
      description: "Generate a branded PDF report",
      icon: <FileText className="w-4 h-4" />,
      action: () => { setLocation("/app/reports"); onOpenChange(false); },
    },
  ];

  const competitorNavEntries: NavEntry[] = (competitors as any[]).map((c) => ({
    id: "competitor-" + c.id,
    label: c.name,
    description: c.website || "Competitor profile",
    icon: <Target className="w-4 h-4" />,
    href: "/app/competitors/" + c.id,
  }));

  const activityEntries: NavEntry[] = (recentActivity as any[]).slice(0, 5).map((a: any) => ({
    id: "activity-" + a.id,
    label: a.title || a.type || "Activity",
    description: a.summary || a.description || "",
    icon: <Activity className="w-4 h-4" />,
    href: "/app/activity",
  }));

  const staleActions  = refreshActions.filter((a) => a.staleness === "Stale");
  const agingActions  = refreshActions.filter((a) => a.staleness === "Aging");
  const freshActions  = refreshActions.filter((a) => a.staleness === "Fresh");
  const otherActions  = refreshActions.filter((a) => !a.staleness);
  const recentActionObjects = recentActions
    .map((id) => refreshActions.find((a) => a.id === id))
    .filter(Boolean) as RefreshAction[];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, competitors, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick Actions">
          {quickActions.map((qa) => (
            <CommandItem key={qa.id} onSelect={() => qa.action()} className="flex items-center gap-3">
              {qa.icon}
              <div className="flex-1">
                <div className="font-medium">{qa.label}</div>
                <div className="text-xs text-muted-foreground">{qa.description}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate to Page">
          {ALL_PAGES.map((page) => (
            <CommandItem
              key={page.id}
              onSelect={() => { setLocation(page.href); onOpenChange(false); }}
              className="flex items-center gap-3"
            >
              {page.icon}
              <div className="flex-1">
                <div className="font-medium">{page.label}</div>
                <div className="text-xs text-muted-foreground">{page.description}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        {competitorNavEntries.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Competitors">
              {competitorNavEntries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  onSelect={() => { setLocation(entry.href); onOpenChange(false); }}
                  className="flex items-center gap-3"
                >
                  {entry.icon}
                  <div className="flex-1">
                    <div className="font-medium">{entry.label}</div>
                    <div className="text-xs text-muted-foreground">{entry.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {activityEntries.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Activity">
              {activityEntries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  onSelect={() => { setLocation(entry.href); onOpenChange(false); }}
                  className="flex items-center gap-3"
                >
                  {entry.icon}
                  <div className="flex-1">
                    <div className="font-medium">{entry.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{entry.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        {recentActionObjects.length > 0 && (
          <>
            <CommandGroup heading="Recent Refreshes">
              {recentActionObjects.map((action) => (
                <CommandItem key={action.id} onSelect={() => action.action()} className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {staleActions.length > 0 && (
          <>
            <CommandGroup heading="Needs Attention (Stale)">
              {staleActions.map((action) => (
                <CommandItem key={action.id} onSelect={() => action.action()} className="flex items-center gap-3">
                  {action.icon}
                  <div className="flex-1">
                    <div className="font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {agingActions.length > 0 && (
          <>
            <CommandGroup heading="Soon to Refresh (Aging)">
              {agingActions.map((action) => (
                <CommandItem key={action.id} onSelect={() => action.action()} className="flex items-center gap-3">
                  {action.icon}
                  <div className="flex-1">
                    <div className="font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {(freshActions.length > 0 || otherActions.length > 0) && (
          <CommandGroup heading="All Refresh Actions">
            {[...freshActions, ...otherActions].map((action) => (
              <CommandItem key={action.id} onSelect={() => action.action()} className="flex items-center gap-3">
                {action.icon}
                <div className="flex-1">
                  <div className="font-medium">{action.label}</div>
                  <div className="text-xs text-muted-foreground">{action.description}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
