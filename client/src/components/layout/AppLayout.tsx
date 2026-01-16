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
  Plus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { label: "Overview", icon: LayoutDashboard, href: "/app" },
    { label: "Competitors", icon: Target, href: "/app/competitors" },
    { label: "Analysis", icon: BarChart2, href: "/app/analysis" },
    { label: "Recommendations", icon: Lightbulb, href: "/app/recommendations" },
    { label: "Activity Feed", icon: Activity, href: "/app/activity" },
    { label: "Reports", icon: FileText, href: "/app/reports" },
    { label: "Settings", icon: Settings, href: "/app/settings" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="font-bold text-xl tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold">
              O
            </div>
            <span>Orbit</span>
          </div>
          <button 
            className="ml-auto lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
           <Button className="w-full bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20" size="sm">
             <Plus className="w-4 h-4 mr-2" /> New Analysis
           </Button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <a className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}>
                  <item.icon size={18} />
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
              JD
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">John Doe</p>
              <p className="text-xs text-muted-foreground truncate">Acme Corp</p>
            </div>
          </div>
          <Link href="/auth/signin">
            <a className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground w-full">
              <LogOut size={18} />
              Sign Out
            </a>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden h-screen">
        {/* Mobile Header */}
        <header className="h-16 lg:hidden flex items-center px-4 border-b border-border bg-card">
          <button 
            className="text-muted-foreground hover:text-foreground mr-4"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={24} />
          </button>
          <div className="font-bold text-lg">Orbit</div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-background">
          {children}
          
          <footer className="mt-12 py-6 border-t border-border text-center text-xs text-muted-foreground">
            Published by The Synozur Alliance LLC. All Rights Reserved © 2026.
          </footer>
        </div>
      </main>
    </div>
  );
}
