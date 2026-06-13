import type { ComponentType } from "react";
import {
  Home,
  Rocket,
  LayoutDashboard,
  Building2,
  Target,
  BarChart2,
  Lightbulb,
  Sparkles,
  Activity,
  Brain,
  Map,
  Database,
  RefreshCw,
  BookOpen,
  Package,
  FolderOpen,
  Telescope,
  Megaphone,
  ListChecks,
  CalendarRange,
  Share2,
  MessageCircle,
  UserCircle,
  Layers,
  Gem,
  LayoutList,
  PencilLine,
  ClipboardList,
  Mail,
  TicketIcon,
  Library,
  Image,
  LineChart,
  Swords,
  FileText,
  Send,
  Gauge,
  Code,
  Handshake,
  Settings,
  Plug,
  AtSign,
  KeyRound,
  Puzzle,
  Users,
  HardDrive,
  Crown,
} from "lucide-react";

export interface AreaNavItem {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  href: string;
  enterprise?: boolean;
  comingSoon?: boolean;
  /** Renders as a subordinate/nested item beneath the preceding primary entry. */
  indent?: boolean;
  description?: string;
  /** Optional section heading rendered above this item when it differs from the previous item's section. */
  section?: string;
}

export type AreaId = "home" | "research" | "product" | "marketing" | "sales" | "settings";

export interface AppArea {
  id: AreaId;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Landing page for the area — what the header tab links to. */
  hubHref: string;
  /** Areas shown as labeled tabs in the header. Settings is reached via the gear instead. */
  inHeader: boolean;
  items: AreaNavItem[];
}

export interface BuildAreasOptions {
  isEnterprise: boolean;
  isAdminUser: boolean;
  isGlobalAdmin: boolean;
}

/**
 * The app's top-level information architecture: the value chain
 * Home → Research → Product → Marketing → Sales, plus Admin & Settings
 * behind the header gear. Each area owns a short contextual sidebar;
 * the header switches between areas.
 */
export function buildAreas({ isEnterprise, isAdminUser, isGlobalAdmin }: BuildAreasOptions): AppArea[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: Home,
      hubHref: "/app",
      inHeader: false,
      items: [
        { label: "Home", icon: Home, href: "/app", description: "Your company at a glance: signals, summary, and what needs attention." },
        { label: "Getting Started", icon: Rocket, href: "/app/getting-started" },
      ],
    },
    {
      id: "research",
      label: "Research",
      icon: Telescope,
      hubHref: "/app/dashboard",
      inHeader: true,
      // Grouped into scannable sections (Workspace / Analysis / Signals /
      // Insights / Sources) so the long Research surface reads as a handful
      // of clusters rather than a flat 16-item list.
      items: [
        { label: "Overview", icon: LayoutDashboard, href: "/app/dashboard", section: "Workspace" },
        { label: "Company Profile", icon: Building2, href: "/app/company-profile", section: "Workspace" },
        { label: "Competitors", icon: Target, href: "/app/competitors", section: "Workspace" },
        { label: "Analysis", icon: BarChart2, href: "/app/analysis", section: "Analysis" },
        { label: "Action Items", icon: Lightbulb, href: "/app/action-items", section: "Analysis" },
        { label: "AI Recommendations", icon: Sparkles, href: "/app/recommendations", section: "Analysis" },
        { label: "Activity", icon: Activity, href: "/app/activity", section: "Signals" },
        { label: "Intelligence Feed", icon: Brain, href: "/app/intelligence", section: "Signals" },
        { label: "SEO & Share of Voice", icon: LineChart, href: "/app/seo-dashboard", section: "Signals", description: "Keyword rankings (SERP) and competitive share-of-voice tracking." },
        { label: "Positioning Map", icon: Map, href: "/app/positioning-map", section: "Insights" },
        { label: "Executive Summary", icon: FileText, href: "/app/executive-summary", section: "Insights", description: "Baseline executive summary: company snapshot, market position, landscape, opportunities." },
        { label: "Visualizations", icon: BarChart2, href: "/app/insights/visualizations", section: "Insights" },
        { label: "Outcomes & Orbit Score", icon: Gauge, href: "/app/insights/outcomes", section: "Insights", description: "ROI dashboard: Orbit Score, GA4 analytics, and outcome trends." },
        { label: "Data Sources", icon: Database, href: "/app/data-sources", section: "Sources" },
        { label: "Intelligence Health", icon: RefreshCw, href: "/app/refresh-center", section: "Sources" },
        { label: "Documents", icon: BookOpen, href: "/app/documents", section: "Sources" },
      ],
    },
    {
      id: "product",
      label: "Product",
      icon: Package,
      hubHref: "/app/products",
      inHeader: true,
      items: [
        {
          label: "Products",
          icon: Package,
          href: "/app/products",
          description: "Portfolio of products — each generates battlecards, one-sheets, GTM plans, roadmaps, and exec summaries.",
        },
        {
          label: "Collateral",
          icon: FolderOpen,
          href: "/app/products/collateral",
          description: "Every product's generated strategy and go-to-market artifacts in one view.",
        },
      ],
    },
    {
      id: "marketing",
      label: "Marketing",
      icon: Megaphone,
      hubHref: "/app/marketing",
      inHeader: true,
      items: [
        { label: "Marketing Home", icon: Megaphone, href: "/app/marketing" },
        {
          label: "Content Pipeline",
          icon: ListChecks,
          href: "/app/marketing/pipeline",
          enterprise: true,
          description: "One board for every piece of in-flight content: social posts, emails, and briefs, draggable between stages.",
        },
        { label: "Content Calendar", icon: CalendarRange, href: "/app/marketing/marketing-calendar", enterprise: true, description: "Cross-channel overview of every scheduled social post, email, and content piece." },
        { label: "Messaging Framework", icon: MessageCircle, href: "/app/marketing/messaging-framework", section: "Plan" },
        { label: "GTM Plan", icon: Rocket, href: "/app/marketing/gtm-plan", section: "Plan" },
        { label: "Personas", icon: UserCircle, href: "/app/marketing/personas", section: "Plan" },
        { label: "Solution Areas", icon: Layers, href: "/app/marketing/solution-areas", enterprise: true, section: "Plan" },
        ...(isEnterprise
          ? [{ label: "Marketing Planner", icon: Gem, href: "/app/marketing-planner", enterprise: true, section: "Plan" }]
          : []),
        { label: "Campaigns", icon: LayoutList, href: "/app/marketing/campaigns", enterprise: true, section: "Create", description: "Coordinate multi-channel campaigns and generate their content." },
        { label: "Composer", icon: PencilLine, href: "/app/marketing/composer", enterprise: true, section: "Create" },
        { label: "Content Briefs", icon: ClipboardList, href: "/app/marketing/editorial-calendar", enterprise: true, section: "Create", description: "Plan and draft long-form content briefs grounded in your strategy." },
        { label: "Email Newsletters", icon: Mail, href: "/app/marketing/email-newsletters", enterprise: true, section: "Create" },
        { label: "Email Sends", icon: Send, href: "/app/marketing/sends", enterprise: true, section: "Create", indent: true, description: "Delivery tracking: recipient lists, send status, and suppressions." },
        { label: "Event Promotion", icon: TicketIcon, href: "/app/marketing/conferences", enterprise: true, section: "Create" },
        { label: "Social Calendar", icon: Share2, href: "/app/marketing/calendar", enterprise: true, section: "Create", description: "Social-only view to schedule, reschedule, and add graphics to posts." },
        { label: "Planning Hub", icon: Target, href: "/app/marketing/planning-hub", enterprise: true, section: "Create", description: "Plan every piece of marketing for a campaign or theme in one view." },
        { label: "Digital/Web Assets", icon: Library, href: "/app/marketing/content-library", enterprise: true, section: "Libraries" },
        { label: "Visual/Brand Assets", icon: Image, href: "/app/marketing/brand-library", enterprise: true, section: "Libraries" },
        { label: "Performance", icon: LineChart, href: "/app/marketing/performance", enterprise: true, section: "Measure" },
      ],
    },
    {
      id: "sales",
      label: "Sales",
      icon: Handshake,
      hubHref: "/app/sales",
      inHeader: true,
      items: [
        { label: "Sales Home", icon: Handshake, href: "/app/sales" },
        { label: "Battle Cards", icon: Swords, href: "/app/battlecards", description: "Competitive one-pagers for sellers — generated per product in the Product area." },
        { label: "Reports", icon: FileText, href: "/app/reports" },
        { label: "Relationship Plans", icon: Handshake, href: "/app/relationship-reports" },
        { label: "Assessments", icon: ClipboardList, href: "/app/assessments" },
      ],
    },
    {
      id: "settings",
      label: "Admin & Settings",
      icon: Settings,
      hubHref: "/app/settings",
      inHeader: false,
      items: [
        { label: "Settings", icon: Settings, href: "/app/settings" },
        { label: "Integrations", icon: Plug, href: "/app/settings/integrations" },
        { label: "Developer Portal", icon: Code, href: "/app/developer", description: "OAuth 2.0 Partner API for third-party integrations." },
        // One-time setup surfaces moved out of the daily-work Marketing menu.
        { label: "Social Accounts", icon: AtSign, href: "/app/marketing/social-accounts", section: "Connections" },
        { label: "Platform Credentials", icon: KeyRound, href: "/app/marketing/platform-credentials", section: "Connections" },
        { label: "Browser Extension", icon: Puzzle, href: "/app/marketing/browser-extension", section: "Connections" },
        ...(isAdminUser
          ? [
              { label: "User Management", icon: Users, href: "/app/users", section: "Administration" },
              { label: "Usage & Traffic", icon: LineChart, href: "/app/usage", section: "Administration" },
              { label: "Company Roster", icon: Building2, href: "/app/company-roster", section: "Administration" },
              { label: "Document Storage", icon: HardDrive, href: "/app/admin/spe-storage", section: "Administration" },
            ]
          : []),
        ...(isGlobalAdmin
          ? [
              { label: "Admin Dashboard", icon: Crown, href: "/app/admin", section: "Administration" },
              { label: "Organizations", icon: Building2, href: "/app/admin/organizations", section: "Administration" },
              { label: "OAuth Clients", icon: KeyRound, href: "/app/admin/oauth-clients", section: "Administration" },
              { label: "AI Settings", icon: Brain, href: "/app/admin/ai-settings", section: "Administration" },
            ]
          : []),
      ],
    },
  ];
}

// Route → area classification. Order matters: more specific prefixes are
// checked before broader ones (the Connections pages live under
// /app/marketing/* but belong to Settings).
const SETTINGS_PREFIXES = [
  "/app/settings",
  "/app/users",
  "/app/usage",
  "/app/company-roster",
  "/app/admin",
  "/app/developer",
  "/app/marketing/social-accounts",
  "/app/marketing/platform-credentials",
  "/app/marketing/browser-extension",
];

const SALES_PREFIXES = ["/app/sales", "/app/battlecards", "/app/reports", "/app/relationship-reports", "/app/assessments"];

const PRODUCT_PREFIXES = ["/app/products"];

const MARKETING_PREFIXES = ["/app/marketing", "/app/marketing-planner"];

const RESEARCH_PREFIXES = [
  "/app/dashboard",
  "/app/overview",
  "/app/company-profile",
  "/app/competitors",
  "/app/analysis",
  "/app/recommendations",
  "/app/action-items",
  "/app/activity",
  "/app/intelligence",
  "/app/positioning-map",
  "/app/data-sources",
  "/app/refresh-center",
  "/app/insights",
  "/app/seo-dashboard",
  "/app/executive-summary",
  "/app/documents",
];

function matchesPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

export function getActiveAreaId(path: string): AreaId {
  if (matchesPrefix(path, SETTINGS_PREFIXES)) return "settings";
  if (matchesPrefix(path, SALES_PREFIXES)) return "sales";
  if (matchesPrefix(path, PRODUCT_PREFIXES)) return "product";
  if (matchesPrefix(path, MARKETING_PREFIXES)) return "marketing";
  if (matchesPrefix(path, RESEARCH_PREFIXES)) return "research";
  return "home";
}

export function getActiveArea(areas: AppArea[], path: string): AppArea {
  const id = getActiveAreaId(path);
  return areas.find((a) => a.id === id) ?? areas[0];
}
