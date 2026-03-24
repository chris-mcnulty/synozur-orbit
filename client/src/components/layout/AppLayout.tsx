import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Target, 
  BarChart2, 
  Lightbulb, 
  Activity, 
  FileText, 
  Settings, 
  LogOut,
  Menu,
  X,
  Plus,
  Users,
  LineChart,
  Shield,
  BookOpen,
  ClipboardList,
  Crown,
  Loader2,
  Package,
  HelpCircle,
  Building2,
  Swords,
  Database,
  Info,
  Gem,
  ChevronDown,
  RefreshCw,
  Lock,
  Brain,
  Rocket,
  Megaphone,
  MessageCircle,
  Mail,
  Library,
  Image,
  LayoutList,
  AtSign,
  HardDrive,
  Puzzle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useUser } from "@/lib/userContext";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import CompanySetupDialog from "@/components/onboarding/CompanySetupDialog";
import ProfileCompletionDialog from "@/components/onboarding/ProfileCompletionDialog";
import ContextBar from "@/components/layout/ContextBar";
import RefreshStatusIndicator from "@/components/layout/RefreshStatusIndicator";
import CommandPalette from "@/components/CommandPalette";
import SmartSuggestions from "@/components/SmartSuggestions";
import { SynozurAppSwitcher } from "@/components/SynozurAppSwitcher";
import { calculateStaleness } from "@/lib/staleness";

type NavIndicator = {
  type: "action" | "new" | "count";
  count?: number;
};

interface NavItem {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  enterprise?: boolean;
  comingSoon?: boolean;
}

// Default expanded sections - Setup, Insights, and Help are expanded by default
const DEFAULT_EXPANDED_SECTIONS = ['Setup', 'Insights', 'Help'];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { user, logout, loading, refetch: refetchUser } = useUser();
  
  // Keyboard shortcuts (Cmd/Ctrl + K for command palette, Ctrl+Shift+R for refresh center, etc.)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      
      // Cmd/Ctrl + K: Open command palette (works everywhere)
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      
      // Skip other shortcuts if in input field
      if (isInputField) return;
      
      // Ctrl/Cmd + Shift + R: Full refresh (go to refresh center)
      if (e.key.toLowerCase() === "r" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setLocation("/app/refresh-center");
      }
      
      // Ctrl/Cmd + Shift + A: Run analysis
      if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setLocation("/app/analysis");
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setLocation]);
  
  // Load expanded sections from localStorage or use defaults
  const [expandedSections, setExpandedSections] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_EXPANDED_SECTIONS;
    const saved = localStorage.getItem('orbit-expanded-nav-sections');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_EXPANDED_SECTIONS;
      }
    }
    return DEFAULT_EXPANDED_SECTIONS;
  });

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newSections = prev.includes(sectionId)
        ? prev.filter(s => s !== sectionId)
        : [...prev, sectionId];
      localStorage.setItem('orbit-expanded-nav-sections', JSON.stringify(newSections));
      return newSections;
    });
  }, []);
  
  // Fetch markets data first to get activeMarketId for other queries
  const { data: marketsData } = useQuery<{ markets: Array<{ id: string; name: string; isDefault: boolean }>; activeMarketId: string | null; multiMarketEnabled: boolean }>({
    queryKey: ["/api/markets"],
    queryFn: async () => {
      const response = await fetch("/api/markets", { credentials: "include" });
      if (!response.ok) return { markets: [], activeMarketId: null, multiMarketEnabled: false };
      return response.json();
    },
    enabled: !!user,
  });

  const activeMarketId = marketsData?.activeMarketId;
  const activeMarket = marketsData?.markets?.find(m => m.id === activeMarketId);
  const isNonDefaultMarket = marketsData?.multiMarketEnabled && activeMarket && !activeMarket.isDefault;

  // Reset onboarding dismissed state when market changes
  useEffect(() => {
    if (activeMarketId) {
      setOnboardingDismissed(false);
    }
  }, [activeMarketId]);

  const { data: companyProfile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ["/api/company-profile", activeMarketId],
    queryFn: async () => {
      const response = await fetch("/api/company-profile", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!user,
  });

  const { data: competitors = [] } = useQuery({
    queryKey: ["/api/competitors"],
    queryFn: async () => {
      const response = await fetch("/api/competitors", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ["/api/recommendations"],
    queryFn: async () => {
      const response = await fetch("/api/recommendations", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  const { data: analysis } = useQuery({
    queryKey: ["/api/analysis"],
    queryFn: async () => {
      const response = await fetch("/api/analysis", { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!user,
  });

  const { data: activityData = [] } = useQuery({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const response = await fetch("/api/activity", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["/api/reports"],
    queryFn: async () => {
      const response = await fetch("/api/reports", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  const { data: battleCards = [] } = useQuery({
    queryKey: ["/api/battlecards"],
    queryFn: async () => {
      const response = await fetch("/api/battlecards", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  const { data: tenantSettings } = useQuery<{ plan: string; multiMarketEnabled: boolean }>({
    queryKey: ["/api/tenant/settings"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/settings", { credentials: "include" });
      if (!response.ok) return { plan: "free", multiMarketEnabled: false };
      return response.json();
    },
    enabled: !!user,
  });

  const isEnterprise = tenantSettings?.plan === "enterprise" || tenantSettings?.plan === "unlimited";

  const { data: tenantInfo } = useQuery<{ plan: string; isPremium: boolean; features?: any }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return { plan: "trial", isPremium: false };
      return response.json();
    },
    enabled: !!user,
  });

  const lockedNavItems = useMemo((): Set<string> => {
    const locked = new Set<string>();
    if (!tenantInfo?.features) return locked;
    const f = tenantInfo.features;
    if (f.battlecards === false) locked.add("/app/battlecards");
    if (f.recommendations === false) locked.add("/app/action-items");
    if (f.pdfReports === false) locked.add("/app/reports");
    if (f.marketingPlanner === false) locked.add("/app/marketing-planner");
    if (f.socialMonitoring === false) locked.add("/app/activity");
    if (f.emailNewsletters === false) locked.add("/app/marketing/email-newsletters");
    if (f.contentLibrary === false) locked.add("/app/marketing/content-library");
    if (f.brandLibrary === false) locked.add("/app/marketing/brand-library");
    if (f.campaigns === false) locked.add("/app/marketing/campaigns");
    if (f.socialAccounts === false) locked.add("/app/marketing/social-accounts");
    if (f.saturnCapture === false) locked.add("/app/marketing/browser-extension");
    return locked;
  }, [tenantInfo]);

  const getLastVisited = (path: string): number => {
    try {
      const stored = localStorage.getItem(`orbit_last_visited_${path.replace(/\//g, "_")}`);
      return stored ? parseInt(stored, 10) : 0;
    } catch { return 0; }
  };

  const hasNewContent = (path: string, items: any[]): boolean => {
    const lastVisited = getLastVisited(path);
    if (lastVisited === 0 || items.length === 0) return false;
    return items.some((item: any) => {
      const itemDate = new Date(item.createdAt || item.updatedAt || 0).getTime();
      return itemDate > lastVisited;
    });
  };

  useEffect(() => {
    const path = location;
    localStorage.setItem(`orbit_last_visited_${path.replace(/\//g, "_")}`, Date.now().toString());
  }, [location]);

  const navIndicators = useMemo((): Record<string, NavIndicator> => {
    const indicators: Record<string, NavIndicator> = {};
    
    if (!companyProfile?.websiteUrl) {
      indicators["/app/company-profile"] = { type: "action" };
    }
    
    if (competitors.length === 0) {
      indicators["/app/competitors"] = { type: "action" };
    }
    
    if (!analysis?.themes) {
      indicators["/app/analysis"] = { type: "action" };
    }
    
    const pendingRecs = recommendations.filter((r: any) => r.status === "Open" || r.status === "In Progress" || r.status === "pending");
    if (pendingRecs.length > 0) {
      indicators["/app/action-items"] = { type: "count", count: pendingRecs.length };
    } else if (hasNewContent("/app/action-items", recommendations)) {
      indicators["/app/action-items"] = { type: "new" };
    }
    
    const highImpactActivity = activityData.filter((a: any) => a.impact === "High");
    if (highImpactActivity.length > 0) {
      indicators["/app/activity"] = { type: "count", count: highImpactActivity.length };
    } else if (hasNewContent("/app/activity", activityData)) {
      indicators["/app/activity"] = { type: "new" };
    }

    if (hasNewContent("/app/reports", reports)) {
      indicators["/app/reports"] = { type: "new" };
    }

    // Data Sources staleness indicator
    const staleDatasources = [
      companyProfile?.lastCrawledAt,
      ...competitors.map((c: any) => c.lastCrawledAt),
      ...competitors.map((c: any) => c.socialLastFetchedAt),
    ].filter((ts) => ts && calculateStaleness(ts) === "stale").length;
    if (staleDatasources > 0) {
      indicators["/app/data-sources"] = { type: "count", count: staleDatasources };
    }

    const onboardingTotal = 5;
    const onboardingDone = [
      !!companyProfile?.websiteUrl,
      competitors.length > 0,
      !!analysis?.themes,
      battleCards.length > 0,
      reports.length > 0,
    ].filter(Boolean).length;
    const onboardingRemaining = onboardingTotal - onboardingDone;
    if (onboardingRemaining > 0) {
      indicators["/app/getting-started"] = { type: "count", count: onboardingRemaining };
    }
    
    return indicators;
  }, [companyProfile, competitors, analysis, recommendations, activityData, reports, battleCards]);
  
  // Show profile completion dialog for SSO users missing demographics
  // This should show FIRST before company setup for new SSO users
  const needsProfileCompletion = !!user && !profileCompleted && 
    (!user.jobTitle || !user.industry || !user.companySize || !user.country);
  
  // Show profile completion immediately if user needs it (don't wait for company setup)
  const showProfileCompletion = needsProfileCompletion;
  
  // Only show company onboarding if profile is complete AND no company profile exists
  const showOnboarding = !profileLoading && !companyProfile && !onboardingDismissed && !!user && !needsProfileCompletion;
  
  useEffect(() => {
    if (!loading && !user) {
      setLocation("/auth/signin");
    }
  }, [user, loading, setLocation]);
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!user) {
    return null;
  }

  const navigation: { group: string; items: NavItem[] }[] = [
    {
      group: "Home",
      items: [
        { label: "Overview", icon: LayoutDashboard, href: "/app" },
      ]
    },
    {
      group: "Setup",
      items: [
        { label: "Company Baseline", icon: Building2, href: "/app/company-profile" },
        { label: "Competitors", icon: Target, href: "/app/competitors" },
        { label: "Products", icon: Package, href: "/app/products" },
        { label: "Documents", icon: BookOpen, href: "/app/documents" },
      ]
    },
    {
      group: "Insights",
      items: [
        { label: "Analysis", icon: BarChart2, href: "/app/analysis" },
        { label: "Action Items", icon: Lightbulb, href: "/app/action-items" },
        { label: "Battle Cards", icon: Swords, href: "/app/battlecards" },
        { label: "Data Sources", icon: Database, href: "/app/data-sources" },
        { label: "Activity", icon: Activity, href: "/app/activity" },
        { label: "Intelligence", icon: Brain, href: "/app/intelligence" },
      ]
    },
    {
      group: "Marketing",
      items: [
        { label: "Marketing Home", icon: Megaphone, href: "/app/marketing" },
        { label: "Messaging Framework", icon: MessageCircle, href: "/app/marketing/messaging-framework" },
        { label: "GTM Plan", icon: Rocket, href: "/app/marketing/gtm-plan" },
        ...(isEnterprise ? [{ label: "Marketing Planner", icon: Gem, href: "/app/marketing-planner", enterprise: true }] : []),
        { label: "Social Campaigns", icon: LayoutList, href: "/app/marketing/campaigns", enterprise: true },
        { label: "Email Newsletters", icon: Mail, href: "/app/marketing/email-newsletters", enterprise: true },
        { label: "Asset Library", icon: Library, href: "/app/marketing/content-library", enterprise: true },
        { label: "Brand Assets", icon: Image, href: "/app/marketing/brand-library", enterprise: true },
        { label: "Social Accounts", icon: AtSign, href: "/app/marketing/social-accounts", enterprise: true },
        { label: "Browser Extension", icon: Puzzle, href: "/app/marketing/browser-extension", enterprise: true },
      ]
    },
    {
      group: "Outputs",
      items: [
        { label: "Reports", icon: FileText, href: "/app/reports" },
        { label: "Assessments", icon: ClipboardList, href: "/app/assessments" },
      ]
    },
    {
      group: "System",
      items: [
        { label: "Refresh Center", icon: RefreshCw, href: "/app/refresh-center" },
        { label: "User Management", icon: Users, href: "/app/users" },
        { label: "Usage & Traffic", icon: LineChart, href: "/app/usage" },
        { label: "Settings", icon: Settings, href: "/app/settings" },
        ...((user?.role === "Global Admin" || user?.role === "Domain Admin") ? [
          { label: "Document Storage", icon: HardDrive, href: "/app/admin/spe-storage" },
        ] : []),
        ...(user?.role === "Global Admin" ? [
          { label: "Admin Dashboard", icon: Crown, href: "/app/admin" },
          { label: "AI Settings", icon: Brain, href: "/app/admin/ai-settings" },
        ] : []),
      ]
    },
    {
      group: "Help",
      items: [
        { label: "Getting Started", icon: Rocket, href: "/app/getting-started" },
        { label: "User Guide", icon: HelpCircle, href: "/app/guide" },
        { label: "About", icon: Info, href: "/app/about" },
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden font-sans">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Sidebar Header - Orion Style */}
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <SynozurAppSwitcher currentApp="orbit" forceDark />
          <Link href="/app" className="flex items-center gap-2 ml-2">
            <img 
              src="/brand/synozur-horizontal.png" 
              alt="Synozur" 
              className="h-6 object-contain"
            />
            <span className="text-sidebar-foreground/50 text-lg">|</span>
            <span className="font-semibold text-lg tracking-tight text-sidebar-foreground">Orbit</span>
          </Link>
          <button 
            className="ml-auto lg:hidden text-sidebar-foreground/50 hover:text-sidebar-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {/* Mobile Context Bar - inside sidebar for mobile */}
        <div className="lg:hidden">
          <ContextBar />
        </div>

        {/* Quick Action */}
        <div className="p-6 pb-2">
           <Button 
             className="w-full bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20 transition-all font-medium" 
             size="default"
             onClick={() => setLocation("/app/analysis")}
             data-testid="button-new-analysis"
           >
             <Plus className="w-4 h-4 mr-2" /> New Analysis
           </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-4 py-2">
          <div className="space-y-2">
            {navigation.map((group, i) => {
              const isExpanded = expandedSections.includes(group.group);
              const hasActivePage = group.items.some(item => location === item.href);
              
              return (
                <Collapsible 
                  key={i} 
                  open={isExpanded || hasActivePage} 
                  onOpenChange={() => toggleSection(group.group)}
                >
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between px-2 py-2 text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider hover:bg-sidebar-accent/30 rounded-md transition-colors">
                      <span>{group.group}</span>
                      <ChevronDown 
                        size={14} 
                        className={cn(
                          "transition-transform duration-200",
                          (isExpanded || hasActivePage) && "rotate-180"
                        )} 
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1 mt-1">
                      {group.items.map((item) => {
                        const isActive = location === item.href;
                        const indicator = navIndicators[item.href];
                        const isLocked = lockedNavItems.has(item.href);
                        return (
                          <Link 
                            key={item.href} 
                            href={item.href}
                            data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 relative pl-4",
                              isActive 
                                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm sidebar-item-active-gradient" 
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                              isLocked && !isActive && "opacity-50"
                            )}
                          >
                            <div className="relative">
                              <item.icon size={18} className={cn(isActive ? "text-primary" : "opacity-70")} />
                              {indicator?.type === "action" && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full" />
                              )}
                              {indicator?.type === "new" && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
                              )}
                            </div>
                            <span className="flex-1">{item.label}</span>
                            {item.comingSoon && (
                              <Badge variant="outline" className="h-4 px-1 text-[9px] font-medium border-amber-500/50 text-amber-500">
                                Soon
                              </Badge>
                            )}
                            {isLocked && !item.comingSoon && (
                              <Lock size={14} className="text-muted-foreground" data-testid={`lock-${item.label.toLowerCase().replace(/\s+/g, "-")}`} />
                            )}
                            {indicator?.type === "count" && indicator.count && indicator.count > 0 && !isLocked && (
                              <Badge 
                                variant="secondary" 
                                className="h-5 min-w-[20px] px-1.5 text-[10px] font-semibold bg-primary/20 text-primary border-0"
                              >
                                {indicator.count > 99 ? "99+" : indicator.count}
                              </Badge>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>

        {/* Sidebar Footer - User Profile */}
        <div className="p-4 border-t border-sidebar-border bg-sidebar/50">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs text-sidebar-foreground/50">Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-3 px-2 py-2 mb-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors cursor-pointer group">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary to-secondary p-[2px]">
              <div className="w-full h-full rounded-full bg-sidebar flex items-center justify-center">
                 <span className="text-xs font-bold text-primary">{user?.avatar || user?.name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?"}</span>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-sidebar-foreground group-hover:text-primary transition-colors truncate">{user?.name || "User"}</p>
                {user?.role === "Global Admin" && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 border-primary/20 text-primary bg-primary/5">GA</Badge>
                )}
              </div>
              <p className="text-xs text-sidebar-foreground/50 truncate">{user?.company || ""}</p>
            </div>
            <Settings size={16} className="text-sidebar-foreground/40 group-hover:text-sidebar-foreground transition-colors" />
          </div>
          <Link 
            href="/auth/signin"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors w-full mt-1"
            onClick={logout}
          >
            <LogOut size={14} />
            Sign Out
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden h-screen bg-background">
        {/* Mobile Header - Orion Style */}
        <header className="h-14 lg:hidden flex items-center px-4 border-b border-border bg-sidebar">
          <button 
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground mr-3"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <SynozurAppSwitcher currentApp="orbit" forceDark />
          <div className="flex items-center gap-2 ml-2">
            <img 
              src="/brand/synozur-horizontal.png" 
              alt="Synozur" 
              className="h-5 object-contain"
            />
            <span className="text-sidebar-foreground/50">|</span>
            <span className="font-semibold text-base text-sidebar-foreground">Orbit</span>
          </div>
          <div className="ml-auto">
            <RefreshStatusIndicator />
          </div>
        </header>

        {/* Context Bar - tenant/market switcher for super users and enterprise tenants */}
        <ContextBar />

        <div className="flex-1 overflow-y-auto">
          <div className="container max-w-7xl mx-auto p-4 md:p-8 lg:p-10 space-y-8">
            {children}
          </div>
          
          <footer className="py-8 border-t border-border mt-auto">
            <div className="container max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <img src="/brand/orbit-logo.png" alt="Orbit" className="h-6 object-contain dark:hidden" />
                <img src="/brand/orbit-logo-white.png" alt="Orbit" className="h-6 object-contain hidden dark:block" />
                <span className="text-foreground/30">|</span>
                <p>Published by The Synozur Alliance LLC. All Rights Reserved © 2026.</p>
              </div>
              <div className="flex gap-4">
                <a href="https://www.synozur.com/services/go-to-market-transformation" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GTM Services</a>
                <a href="https://www.synozur.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy Policy</a>
                <a href="https://www.synozur.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Terms of Service</a>
                <a href="https://www.synozur.com/contact" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Support</a>
              </div>
            </div>
          </footer>
        </div>
      </main>

      <CompanySetupDialog 
        open={showOnboarding} 
        onComplete={() => {
          setOnboardingDismissed(true);
          refetchProfile();
        }}
        canSkip={true}
        onSkip={() => setOnboardingDismissed(true)}
        marketName={activeMarket?.name}
      />

      <ProfileCompletionDialog
        open={showProfileCompletion}
        onComplete={() => {
          setProfileCompleted(true);
          refetchUser();
        }}
        userName={user?.name || user?.email?.split("@")[0] || ""}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />
      
      <SmartSuggestions />
    </div>
  );
}
