import React, { useState } from "react";
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
  Crown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUser } from "@/lib/userContext";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useUser();

  const navigation = [
    {
      group: "Intelligence",
      items: [
        { label: "Overview", icon: LayoutDashboard, href: "/app" },
        { label: "Competitors", icon: Target, href: "/app/competitors" },
        { label: "Analysis", icon: BarChart2, href: "/app/analysis" },
        { label: "Recommendations", icon: Lightbulb, href: "/app/recommendations" },
        { label: "Activity", icon: Activity, href: "/app/activity" },
        { label: "Reports", icon: FileText, href: "/app/reports" },
        { label: "Documents", icon: BookOpen, href: "/app/documents" },
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
           <Button className="w-full bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20 transition-all font-medium" size="default">
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
                    return (
                      <Link 
                        key={item.href} 
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                          isActive 
                            ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" 
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <item.icon size={18} className={cn(isActive ? "text-primary" : "opacity-70")} />
                        {item.label}
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
    </div>
  );
}
