import React from "react";
import { Link, useLocation } from "wouter";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Home } from "lucide-react";

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

// Static label map for top-level routes. Used when a page doesn't pass
// explicit breadcrumbs so that static sections still benefit from a trail.
const STATIC_ROUTE_LABELS: Record<string, string> = {
  "/app": "Overview",
  "/app/overview": "Overview",
  "/app/dashboard": "Overview",
  "/app/company-profile": "Company Baseline",
  "/app/competitors": "Competitors",
  "/app/products": "Products",
  "/app/documents": "Documents",
  "/app/analysis": "Analysis",
  "/app/action-items": "Action Items",
  "/app/battlecards": "Battle Cards",
  "/app/data-sources": "Data Sources",
  "/app/activity": "Activity",
  "/app/refresh-center": "Intelligence Health",
  "/app/intelligence": "Intelligence",
  "/app/positioning-map": "Positioning Map",
  "/app/marketing": "Marketing",
  "/app/marketing/messaging-framework": "Messaging Framework",
  "/app/marketing/gtm-plan": "GTM Plan",
  "/app/marketing/personas": "Personas",
  "/app/marketing/contacts": "Contacts",
  "/app/marketing/lead-scoring": "Lead Scoring",
  "/app/marketing/workflows": "Workflows",
  "/app/marketing/projects": "Marketing Projects",
  "/app/marketing/campaigns": "Campaigns",
  "/app/marketing/email-newsletters": "Email Newsletters",
  "/app/marketing/content-library": "Digital/Web Assets",
  "/app/marketing/brand-library": "Visual/Brand Assets",
  "/app/marketing/social-accounts": "Social Accounts",
  "/app/admin/platform-credentials": "Platform Credentials",
  "/app/marketing/composer": "Composer",
  "/app/marketing/marketing-calendar": "Content Calendar",
  "/app/marketing/editorial-calendar": "Content Briefs",
  "/app/marketing/calendar": "Social Posts",
  "/app/marketing/browser-extension": "Browser Extension",
  "/app/reports": "Reports",
  "/app/assessments": "Assessments",
  "/app/users": "User Management",
  "/app/usage": "Usage & Traffic",
  "/app/settings": "Settings",
  "/app/company-roster": "Company Roster",
  "/app/admin/spe-storage": "Document Storage",
  "/app/admin": "Admin Dashboard",
  "/app/admin/ai-settings": "AI Settings",
  "/app/getting-started": "Getting Started",
  "/app/support": "Support",
  "/app/guide": "User Guide",
  "/app/changelog": "Changelog",
  "/app/roadmap": "Roadmap",
  "/app/about": "About",
};

// Section mapping that places a route under a higher-level section link.
const SECTION_PARENTS: { prefix: string; parent: BreadcrumbCrumb }[] = [
  { prefix: "/app/marketing/", parent: { label: "Marketing", href: "/app/marketing" } },
  { prefix: "/app/admin/", parent: { label: "Admin", href: "/app/admin" } },
];

function deriveCrumbs(location: string): BreadcrumbCrumb[] {
  // Normalize "/app" to the overview
  if (location === "/app" || location === "/app/overview" || location === "/app/dashboard") {
    return [];
  }

  // Exact static match
  const exact = STATIC_ROUTE_LABELS[location];
  if (exact) {
    // Add section parent if applicable
    const section = SECTION_PARENTS.find((s) => location.startsWith(s.prefix) && location !== s.parent.href);
    const crumbs: BreadcrumbCrumb[] = [];
    if (section && location !== section.parent.href) {
      crumbs.push(section.parent);
    }
    crumbs.push({ label: exact });
    return crumbs;
  }

  // Fall back: attempt to match the parent of a nested dynamic route
  // e.g. /app/competitors/abc123 -> Competitors
  const segments = location.split("/").filter(Boolean);
  if (segments.length >= 3 && segments[0] === "app") {
    const parentPath = `/app/${segments[1]}`;
    const parentLabel = STATIC_ROUTE_LABELS[parentPath];
    if (parentLabel) {
      return [{ label: parentLabel, href: parentPath }, { label: "Details" }];
    }
  }

  return [];
}

export interface PageBreadcrumbsProps {
  /**
   * Explicit breadcrumb trail. When omitted, the component attempts to
   * derive a sensible default from the current route.
   */
  items?: BreadcrumbCrumb[];
  className?: string;
}

/**
 * Renders a breadcrumb trail rooted at the Overview home. Always prepends a
 * Home icon linking to /app. Used inside AppLayout above page content.
 */
export default function PageBreadcrumbs({ items, className }: PageBreadcrumbsProps) {
  const [location] = useLocation();
  const crumbs = items ?? deriveCrumbs(location);

  // Suppress on the root overview — a breadcrumb of just "Home" adds noise.
  if (crumbs.length === 0) return null;

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link
              href="/app"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              data-testid="breadcrumb-home"
            >
              <Home className="h-3.5 w-3.5" />
              <span className="sr-only">Home</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <React.Fragment key={`${crumb.label}-${i}`}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage
                    className="max-w-[200px] truncate sm:max-w-[320px]"
                    data-testid={`breadcrumb-${i}`}
                  >
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      href={crumb.href}
                      className="max-w-[160px] truncate text-muted-foreground hover:text-foreground sm:max-w-[220px]"
                      data-testid={`breadcrumb-${i}`}
                    >
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
