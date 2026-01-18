import React, { useState, useEffect, useMemo } from "react";
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
  FolderKanban,
  HelpCircle,
  Building2,
  Swords,
  Zap,
  Map
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUser } from "@/lib/userContext";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery } from "@tanstack/react-query";
import CompanySetupDialog from "@/components/onboarding/CompanySetupDialog";
import ContextBar from "@/components/layout/ContextBar";

type NavIndicator = {
  type: "action" | "new" | "count";
  count?: number;
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const { user, logout, loading } = useUser();
  
  const { data: companyProfile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ["/api/company-profile"],
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
    
    if (!companyProfile?.url) {
      indicators["/app/company-profile"] = { type: "action" };
    }
    
    if (competitors.length === 0) {
      indicators["/app/competitors"] = { type: "action" };
    }
    
    if (!analysis?.themes) {
      indicators["/app/analysis"] = { type: "action" };
    }
    
    const pendingRecs = recommendations.filter((r: any) => r.status === "Open" || r.status === "In Progress");
    if (pendingRecs.length > 0) {
      indicators["/app/recommendations"] = { type: "count", count: pendingRecs.length };
    } else if (hasNewContent("/app/recommendations", recommendations)) {
      indicators["/app/recommendations"] = { type: "new" };
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
    
    return indicators;
  }, [companyProfile, competitors, analysis, recommendations, activityData, reports]);
  
  const showOnboarding = !profileLoading && !companyProfile && !onboardingDismissed && !!user;
  
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

  const navigation = [
    {
      group: "Command",
      items: [
        { label: "Command Center", icon: Zap, href: "/app/command-center" },
      ]
    },
    {
      group: "Setup",
      items: [
        { label: "Overview", icon: LayoutDashboard, href: "/app/dashboard" },
        { label: "Company Baseline", icon: Building2, href: "/app/company-profile" },
        { label: "Competitors", icon: Target, href: "/app/competitors" },
        { label: "Documents", icon: BookOpen, href: "/app/documents" },
      ]
    },
    {
      group: "Insights",
      items: [
        { label: "Analysis", icon: BarChart2, href: "/app/analysis" },
        { label: "Recommendations", icon: Lightbulb, href: "/app/recommendations" },
        { label: "Battle Cards", icon: Swords, href: "/app/battlecards" },
        { label: "Activity", icon: Activity, href: "/app/activity" },
      ]
    },
    {
      group: "Outputs",
      items: [
        { label: "Reports", icon: FileText, href: "/app/reports" },
        { label: "Projects", icon: FolderKanban, href: "/app/projects" },
        { label: "Assessments", icon: ClipboardList, href: "/app/assessments" },
      ]
    },
    {
      group: "System",
      items: [
        { label: "User Management", icon: Users, href: "/app/users" },
        { label: "Usage & Traffic", icon: LineChart, href: "/app/usage" },
        { label: "Settings", icon: Settings, href: "/app/settings" },
        ...(user?.role === "Global Admin" ? [{ label: "Admin Dashboard", icon: Crown, href: "/app/admin" }] : []),
      ]
    },
    {
      group: "Help",
      items: [
        { label: "User Guide", icon: HelpCircle, href: "/app/guide" },
        { label: "Roadmap", icon: Map, href: "/app/roadmap" },
        { label: "About & Changelog", icon: FileText, href: "/about" },
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
        {/* Sidebar Header - Vega Style */}
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <img 
              src="/brand/synozur-mark.png" 
              alt="Synozur Mark" 
              className="w-8 h-8 object-contain"
            />
            <span className="font-bold text-xl tracking-tight text-sidebar-foreground">Orbit</span>
          </div>
          <button 
            className="ml-auto lg:hidden text-sidebar-foreground/50 hover:text-sidebar-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
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
          <div className="space-y-6">
            {navigation.map((group, i) => (
              <div key={i}>
                <h3 className="px-2 mb-2 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                  {group.group}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = location === item.href;
                    const indicator = navIndicators[item.href];
                    return (
                      <Link 
                        key={item.href} 
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 relative",
                          isActive 
                            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" 
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
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
                        {indicator?.type === "count" && indicator.count && indicator.count > 0 && (
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
              </div>
            ))}
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
        {/* Mobile Header */}
        <header className="h-16 lg:hidden flex items-center px-4 border-b border-border bg-sidebar">
          <button 
            className="text-sidebar-foreground/70 hover:text-sidebar-foreground mr-4"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-2">
            <img 
              src="/brand/synozur-mark.png" 
              alt="Synozur Mark" 
              className="w-6 h-6 object-contain"
            />
            <span className="font-bold text-lg text-sidebar-foreground">Orbit</span>
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
              <p>Published by The Synozur Alliance LLC. All Rights Reserved © 2026.</p>
              <div className="flex gap-4">
                <a href="https://www.synozur.com/services/go-to-market-transformation" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GTM Services</a>
                <Link href="#" className="hover:text-foreground transition-colors">Privacy Policy</Link>
                <Link href="#" className="hover:text-foreground transition-colors">Terms of Service</Link>
                <Link href="#" className="hover:text-foreground transition-colors">Support</Link>
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
      />
    </div>
  );
}
