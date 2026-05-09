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
  Puzzle,
  TicketIcon,
  Map,
  FileText as FileTextIcon,
  UserCircle,
  Handshake,
  PencilLine,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/lib/userContext";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import CompanySetupDialog from "@/components/onboarding/CompanySetupDialog";
import ProfileCompletionDialog from "@/components/onboarding/ProfileCompletionDialog";
import ContextBar from "@/components/layout/ContextBar";
import RefreshStatusIndicator from "@/components/layout/RefreshStatusIndicator";
import NotificationCentre from "@/components/layout/NotificationCentre";
import CommandPalette from "@/components/CommandPalette";
import SmartSuggestions from "@/components/SmartSuggestions";
import WhatsNewModal from "@/components/WhatsNewModal";
import { SynozurAppSwitcher } from "@/components/SynozurAppSwitcher";
import { calculateStaleness } from "@/lib/staleness";
import PageBreadcrumbs, { type BreadcrumbCrumb } from "@/components/layout/PageBreadcrumbs";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import { useIsMobile } from "@/hooks/use-mobile";

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

interface NavSubGroup {
  label: string;
  items: NavItem[];
}

type NavGroup =
  | { group: string; items: NavItem[]; subgroups?: never }
  | { group: string; subgroups: NavSubGroup[]; items?: never };

// Default expanded sections - Workspace and Intelligence are expanded by default;
// Marketing/Deliverables/Admin start collapsed to keep the sidebar short.
const DEFAULT_EXPANDED_SECTIONS = ['Workspace', 'Intelligence'];
// Bumped key so users on the old structure get the new defaults on first render.
const EXPANDED_SECTIONS_STORAGE_KEY = 'orbit-expanded-nav-sections-v2';

export interface AppLayoutProps {
  children: React.ReactNode;
  /**
   * Optional explicit breadcrumb trail. When omitted, AppLayout derives a
   * sensible default from the current route via PageBreadcrumbs.
   * Pass an empty array to suppress the trail entirely on a page.
   */
  breadcrumbs?: BreadcrumbCrumb[];
}

export default function AppLayout({ children, breadcrumbs }: AppLayoutProps) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Reset the main scroll container to the top whenever the route changes.
  // Without this, navigating between pages keeps the previous page's scroll
  // offset, and any focus/scrollIntoView call inside the new page (e.g. an
  // active sidebar link) drags the viewport to the bottom — leaving users
  // staring at a blank area until they manually scroll back up.
  const mainScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const isMobile = useIsMobile();
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
    const saved = localStorage.getItem(EXPANDED_SECTIONS_STORAGE_KEY);
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
      localStorage.setItem(EXPANDED_SECTIONS_STORAGE_KEY, JSON.stringify(newSections));
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

  // Pin this tab's per-tab context (sessionStorage) on first load if not yet
  // set. Without this, this tab would keep silently following session changes
  // made by other tabs in the same browser.
  useEffect(() => {
    if (!activeMarketId) return;
    import("@/lib/tabContext").then(({ getTabMarketId, setTabMarketId }) => {
      if (!getTabMarketId()) setTabMarketId(activeMarketId);
    });
  }, [activeMarketId]);
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

  const { data: tenantInfo } = useQuery<{ plan: string; isPremium: boolean; features?: any; billing?: any }>({
    queryKey: ["/api/tenant/info"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/info", { credentials: "include" });
      if (!response.ok) return { plan: "trial", isPremium: false };
      return response.json();
    },
    enabled: !!user,
  });

  const isAdminUser = user?.role === "Domain Admin" || user?.role === "Global Admin";
  const inPaymentGrace = !!tenantInfo?.billing?.inPaymentGrace;
  const paymentGraceUntilRaw: string | null = tenantInfo?.billing?.paymentGraceUntil ?? null;
  const graceUntil = paymentGraceUntilRaw
    ? new Date(paymentGraceUntilRaw).toLocaleDateString()
    : null;

  // Dismissal is keyed off the grace deadline so a new failed-payment cycle
  // (different paymentGraceUntil) re-shows the banner even if previously dismissed.
  const graceDismissKey = paymentGraceUntilRaw
    ? `orbit-payment-grace-dismissed-${paymentGraceUntilRaw}`
    : null;
  const [graceBannerDismissed, setGraceBannerDismissed] = useState(false);

  useEffect(() => {
    if (!graceDismissKey) {
      setGraceBannerDismissed(false);
      return;
    }
    try {
      setGraceBannerDismissed(localStorage.getItem(graceDismissKey) === "1");
    } catch {
      setGraceBannerDismissed(false);
    }
  }, [graceDismissKey]);

  const dismissGraceBanner = useCallback(() => {
    if (graceDismissKey) {
      try {
        localStorage.setItem(graceDismissKey, "1");
      } catch {
        /* ignore */
      }
    }
    setGraceBannerDismissed(true);
  }, [graceDismissKey]);

  const showGraceBanner = isAdminUser && inPaymentGrace && !graceBannerDismissed;

  async function openBillingPortalFromBanner() {
    try {
      const r = await fetch("/api/billing/portal-session", {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (r.ok && data.url) window.location.href = data.url;
    } catch {
      /* ignore */
    }
  }

  const lockedNavItems = useMemo((): Set<string> => {
    const locked = new Set<string>();
    if (!tenantInfo?.features) return locked;
    const f = tenantInfo.features;
    if (f.battlecards === false) locked.add("/app/battlecards");
    if (f.recommendations === false) locked.add("/app/action-items");
    if (f.pdfReports === false) locked.add("/app/reports");
    if (f.relationshipReports === false) locked.add("/app/relationship-reports");
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

  // UX1: Track last-visited page for post-login redirect and per-page freshness
  useEffect(() => {
    const path = location;
    localStorage.setItem(`orbit_last_visited_${path.replace(/\//g, "_")}`, Date.now().toString());
    // Persist last app page so login can redirect back
    if (path.startsWith("/app")) {
      localStorage.setItem("orbit_last_page", path);
    }
  }, [location]);

  // Force the main content area back to the top on every route change. Use
  // both the scoped ref and window as a fallback (some browsers/embeds let
  // the document itself accumulate scroll). Done after a microtask so it
  // wins against any layout-time scrollIntoView inside the new page.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    return () => window.cancelAnimationFrame(id);
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

  // Items shown in the top-header Help dropdown (no longer in the sidebar).
  const helpItems: NavItem[] = [
    { label: "Getting Started", icon: Rocket, href: "/app/getting-started" },
    { label: "Support", icon: TicketIcon, href: "/app/support" },
    { label: "User Guide", icon: HelpCircle, href: "/app/guide" },
    { label: "Changelog", icon: FileTextIcon, href: "/app/changelog" },
    { label: "Roadmap", icon: Map, href: "/app/roadmap" },
    { label: "About", icon: Info, href: "/app/about" },
  ];

  const navigation: NavGroup[] = [
    {
      group: "Workspace",
      items: [
        { label: "Overview", icon: LayoutDashboard, href: "/app" },
        { label: "Company Profile", icon: Building2, href: "/app/company-profile" },
        { label: "Competitors", icon: Target, href: "/app/competitors" },
        { label: "Products", icon: Package, href: "/app/products" },
        { label: "Documents", icon: BookOpen, href: "/app/documents" },
      ]
    },
    {
      group: "Intelligence",
      subgroups: [
        {
          label: "",
          items: [
            { label: "Analysis", icon: BarChart2, href: "/app/analysis" },
            { label: "Action Items", icon: Lightbulb, href: "/app/action-items" },
            { label: "Positioning Map", icon: Map, href: "/app/positioning-map" },
            { label: "Intelligence Feed", icon: Brain, href: "/app/intelligence" },
          ],
        },
        {
          label: "Sources",
          items: [
            { label: "Data Sources", icon: Database, href: "/app/data-sources" },
            { label: "Activity", icon: Activity, href: "/app/activity" },
            { label: "Intelligence Health", icon: RefreshCw, href: "/app/refresh-center" },
          ],
        },
      ],
    },
    {
      group: "Marketing",
      subgroups: [
        {
          label: "Plan",
          items: [
            { label: "Marketing Home", icon: Megaphone, href: "/app/marketing" },
            { label: "Messaging Framework", icon: MessageCircle, href: "/app/marketing/messaging-framework" },
            { label: "GTM Plan", icon: Rocket, href: "/app/marketing/gtm-plan" },
            { label: "Personas", icon: UserCircle, href: "/app/marketing/personas" },
            { label: "Battle Cards", icon: Swords, href: "/app/battlecards" },
            ...(isEnterprise ? [{ label: "Marketing Planner", icon: Gem, href: "/app/marketing-planner", enterprise: true }] : []),
          ],
        },
        {
          label: "Execute",
          items: [
            { label: "Composer", icon: PencilLine, href: "/app/marketing/composer", enterprise: true },
            { label: "Social Calendar", icon: CalendarDays, href: "/app/marketing/calendar", enterprise: true },
            { label: "Social Campaigns", icon: LayoutList, href: "/app/marketing/campaigns", enterprise: true },
            { label: "Email Newsletters", icon: Mail, href: "/app/marketing/email-newsletters", enterprise: true },
            { label: "Digital/Web Assets", icon: Library, href: "/app/marketing/content-library", enterprise: true },
            { label: "Visual/Brand Assets", icon: Image, href: "/app/marketing/brand-library", enterprise: true },
            { label: "Social Accounts", icon: AtSign, href: "/app/marketing/social-accounts", enterprise: true },
            { label: "Browser Extension", icon: Puzzle, href: "/app/marketing/browser-extension", enterprise: true },
          ],
        },
      ],
    },
    {
      group: "Deliverables",
      items: [
        { label: "Reports", icon: FileText, href: "/app/reports" },
        { label: "Relationship Plans", icon: Handshake, href: "/app/relationship-reports" },
        { label: "Assessments", icon: ClipboardList, href: "/app/assessments" },
      ]
    },
    // Admin renders only when the user has at least one admin-only item.
    ...(isAdminUser ? [{
      group: "Admin",
      items: [
        { label: "User Management", icon: Users, href: "/app/users" },
        { label: "Usage & Traffic", icon: LineChart, href: "/app/usage" },
        { label: "Company Roster", icon: Building2, href: "/app/company-roster" },
        { label: "Document Storage", icon: HardDrive, href: "/app/admin/spe-storage" },
        ...(user?.role === "Global Admin" ? [
          { label: "Admin Dashboard", icon: Crown, href: "/app/admin" },
          { label: "AI Settings", icon: Brain, href: "/app/admin/ai-settings" },
        ] : []),
      ],
    } as NavGroup] : []),
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
          <div className="ml-auto hidden lg:flex items-center gap-1">
            <RefreshStatusIndicator />
          </div>
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
              const groupItems: NavItem[] = group.items
                ? group.items
                : group.subgroups.flatMap(sg => sg.items);
              const hasActivePage = groupItems.some(item => location === item.href);

              const renderItem = (item: NavItem) => {
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
              };

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
                      {group.items
                        ? group.items.map(renderItem)
                        : group.subgroups.map((sg, sgi) => (
                            <div key={sgi} className={sgi > 0 ? "mt-3" : ""}>
                              {sg.label && (
                                <div className="px-3 pb-1 pt-1 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                                  {sg.label}
                                </div>
                              )}
                              <div className="space-y-1">
                                {sg.items.map(renderItem)}
                              </div>
                            </div>
                          ))}
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
          <div className="ml-auto flex items-center gap-1">
            {isMobile && <NotificationCentre />}
            <RefreshStatusIndicator />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  data-testid="header-help-trigger-mobile"
                  aria-label="Help"
                >
                  <HelpCircle size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Help</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {helpItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className="flex items-center gap-2 cursor-pointer" data-testid={`mobile-help-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon size={14} className="opacity-70" />
                      <span>{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Link
              href="/app/settings"
              className="inline-flex items-center justify-center h-8 w-8 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
              data-testid="header-settings-mobile"
              aria-label="Settings"
            >
              <Settings size={18} />
            </Link>
          </div>
        </header>

        {/* Desktop Header - global utility bar (Notifications, Help, Settings) */}
        <header className="h-12 hidden lg:flex items-center justify-end gap-1 px-4 border-b border-border bg-background">
          {!isMobile && <NotificationCentre />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                data-testid="header-help-trigger"
                aria-label="Help"
              >
                <HelpCircle size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Help</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {helpItems.map((item) => {
                const indicator = navIndicators[item.href];
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className="flex items-center gap-2 cursor-pointer"
                      data-testid={`desktop-help-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon size={14} className="opacity-70" />
                      <span className="flex-1">{item.label}</span>
                      {indicator?.type === "count" && indicator.count && indicator.count > 0 && (
                        <Badge
                          variant="secondary"
                          className="h-4 min-w-[18px] px-1 text-[10px] font-semibold bg-primary/20 text-primary border-0"
                        >
                          {indicator.count > 99 ? "99+" : indicator.count}
                        </Badge>
                      )}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            href="/app/settings"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            data-testid="header-settings"
            aria-label="Settings"
          >
            <Settings size={18} />
          </Link>
        </header>

        {/* Context Bar - tenant/market switcher for super users and enterprise tenants */}
        <ContextBar />

        {/* Payment grace banner hidden — Stripe billing not yet active */}
        <div ref={mainScrollRef} className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          <div className="container max-w-7xl mx-auto p-4 md:p-8 lg:p-10 space-y-8">
            {breadcrumbs === undefined ? (
              <PageBreadcrumbs />
            ) : breadcrumbs.length > 0 ? (
              <PageBreadcrumbs items={breadcrumbs} />
            ) : null}
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
                <a href="/app/support" className="hover:text-foreground transition-colors">Support</a>
              </div>
            </div>
          </footer>
        </div>
        <MobileBottomNav onOpenMenu={() => setSidebarOpen(true)} onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
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
      <WhatsNewModal />
    </div>
  );
}
