import { Switch, Route, useParams, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider, useUser } from "@/lib/userContext";
import { UpgradeModalProvider, PageFeatureGate } from "@/components/UpgradePrompt";
import { ThemeProvider } from "next-themes";
import { HelmetProvider } from "react-helmet-async";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/landing";
import About from "@/pages/about";
import Changelog from "@/pages/changelog";
import Roadmap from "@/pages/roadmap";
import AuthPage from "@/pages/auth";
import VerifyPending from "@/pages/auth/verify-pending";
import ForgotPassword from "@/pages/auth/forgot-password";
import ResetPassword from "@/pages/auth/reset-password";
import Dashboard from "@/pages/app/dashboard";
import HomePage from "@/pages/app/home";
import ContentPipelinePage from "@/pages/app/marketing/pipeline";
import SalesHubPage from "@/pages/app/sales";
import OutreachCampaignsPage from "@/pages/app/sales/outreach-campaigns";
import OutreachInterviewPage from "@/pages/app/sales/outreach-interview";
import OutreachCampaignDetailPage from "@/pages/app/sales/campaign-detail";
import OutreachSettingsPage from "@/pages/app/sales/outreach-settings";
import Analysis from "@/pages/app/analysis";
import Recommendations from "@/pages/app/recommendations";
import Activity from "@/pages/app/activity";
import Reports from "@/pages/app/reports";
import RelationshipReportsPage from "@/pages/app/relationship-reports";
import RelationshipReportDetailPage from "@/pages/app/relationship-report-detail";
import Competitors from "@/pages/app/competitors";
import CompetitorDetail from "@/pages/app/competitor-detail";
import Documents from "@/pages/app/documents";
import Assessments from "@/pages/app/assessments";
import Settings from "@/pages/app/settings";
import UsersPage from "@/pages/app/users";
import AdminPage from "@/pages/app/admin";
import ProductsPage from "@/pages/app/products";
import ProductCollateralPage from "@/pages/app/products/collateral";
import ProductDetail from "@/pages/app/product-detail";
import ExecutiveSummary from "@/pages/app/executive-summary";
import BaselineSummary from "@/pages/app/baseline-summary";
import UserGuidePage from "@/pages/app/user-guide";
import BattleCardsPage from "@/pages/app/battlecards";
import UsagePage from "@/pages/app/usage";
import AppAbout from "@/pages/app/about";
import SupportPage from "@/pages/app/support";
import AppChangelogPage from "@/pages/app/changelog";
import AppRoadmapPage from "@/pages/app/roadmap";
import DataSourcesPage from "@/pages/app/data-sources";
import CompanyBaseline from "@/pages/app/company-baseline";
import MarketingPlannerPage from "@/pages/app/marketing-planner";
import MarketingPlanDetail from "@/pages/app/marketing-plan-detail";
import GtmPlanPage from "@/pages/app/marketing/gtm-plan";
import MessagingFrameworkPage from "@/pages/app/marketing/messaging-framework";
import EmailNewslettersPage from "@/pages/app/marketing/email-newsletters";
import EditorialCalendarPage from "@/pages/app/marketing/editorial-calendar";
import MarketingCalendarPage from "@/pages/app/marketing/marketing-calendar";
import MarketingPerformancePage from "@/pages/app/marketing/performance";
import MarketingLandingPage from "@/pages/app/marketing/index";
import ContentLibraryPage from "@/pages/app/marketing/content-library";
import BrandLibraryPage from "@/pages/app/marketing/brand-library";
import SolutionAreasPage from "@/pages/app/marketing/solution-areas";
import CampaignsPage from "@/pages/app/marketing/campaigns";
import CampaignInterviewPage from "@/pages/app/marketing/campaign-interview";
import ConferencePromotionPage from "@/pages/app/marketing/conference-promotion";
import ConferenceDetailPage from "@/pages/app/marketing/conference-detail";
import CampaignDetailPage from "@/pages/app/marketing/campaign-detail";
import PlanningHubPage from "@/pages/app/marketing/planning-hub";
import SocialAccountsPage from "@/pages/app/marketing/social-accounts";
import ComposerPage from "@/pages/app/marketing/composer";
import CalendarPage from "@/pages/app/marketing/calendar";
import SendsPage from "@/pages/app/marketing/sends";
import SubscriptionTypesPage from "@/pages/app/marketing/subscription-types";
import QueuePage from "@/pages/app/marketing/queue";
import BrowserExtensionPage from "@/pages/app/marketing/browser-extension";
import PersonasPage from "@/pages/app/marketing/personas";
import ContactsPage from "@/pages/app/marketing/contacts";
import RefreshCenter from "@/pages/app/refresh-center";
import ActionItems from "@/pages/app/action-items";
import IntelligenceBriefingPage from "@/pages/app/intelligence-briefing";
import GettingStartedPage from "@/pages/app/getting-started";
import InboxPage from "@/pages/app/inbox";
import Pricing from "@/pages/pricing";
import AdminOrganizationsPage from "@/pages/app/admin/organizations";
import AISettingsPage from "@/pages/app/admin/ai-settings";
import SpeStoragePage from "@/pages/app/admin/spe-storage";
import CompanyRosterPage from "@/pages/app/company-roster";
import PositioningMapPage from "@/pages/app/positioning-map";
import PublicFeedbackPage from "@/pages/feedback-public";
import SeoDashboard from "@/pages/app/seo-dashboard";
import InsightsOutcomesPage from "@/pages/app/insights-outcomes";
import InsightsVisualizationsPage from "@/pages/app/insights-visualizations";
import SettingsIntegrationsPage from "@/pages/app/settings-integrations";
import OAuthClientsAdminPage from "@/pages/app/admin/oauth-clients";
import GlobalPlatformCredentialsPage from "@/pages/app/admin/platform-credentials";
import DeveloperPortalPage from "@/pages/app/developer";
import LeadScoringPage from "@/pages/app/marketing/lead-scoring";

function GlobalAdminOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();
  if (loading) return null;
  if (!user || user.role !== "Global Admin") return <NotFound />;
  return <>{children}</>;
}

function ProductFeaturesRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/app/products/${id}?tab=features`} />;
}

function ProductRoadmapRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/app/products/${id}?tab=roadmap`} />;
}

// Marketing Projects was renamed from "Marketing Planner" and moved from
// /app/marketing-planner into the /app/marketing/* namespace. Redirect the
// legacy detail path, preserving the plan id.
function MarketingProjectsDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/app/marketing/projects/${id}`} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/about" component={About} />
      <Route path="/changelog" component={Changelog} />
      <Route path="/roadmap" component={Roadmap} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/auth/signin" component={AuthPage} />
      <Route path="/auth/signup" component={AuthPage} />
      <Route path="/auth/verify-pending" component={VerifyPending} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/auth/reset-password" component={ResetPassword} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/feedback/:token" component={PublicFeedbackPage} />

      {/* App Routes */}
      {/* Global Home (company at a glance); the research dashboard keeps its
          /app/dashboard and /app/overview URLs under the Research area. */}
      <Route path="/app" component={HomePage} />
      <Route path="/app/overview" component={Dashboard} />
      <Route path="/app/dashboard" component={Dashboard} />
      <Route path="/app/competitors" component={Competitors} />
      <Route path="/app/company-profile" component={CompanyBaseline} />
      <Route path="/app/competitors/:id" component={CompetitorDetail} />
      <Route path="/app/analysis" component={Analysis} />
      <Route path="/app/recommendations" component={Recommendations} />
      <Route path="/app/activity" component={Activity} />
      <Route path="/app/reports">{() => <PageFeatureGate featureKey="pdfReports" label="PDF Reports" description="Generate branded PDF competitive reports. Upgrade to unlock this feature."><Reports /></PageFeatureGate>}</Route>
      <Route path="/app/relationship-reports">{() => <PageFeatureGate featureKey="relationshipReports" label="Relationship Reports" description="On-demand 12-month engagement plans for competitors and market peers. Upgrade to unlock this feature."><RelationshipReportsPage /></PageFeatureGate>}</Route>
      <Route path="/app/relationship-reports/:id">{() => <PageFeatureGate featureKey="relationshipReports" label="Relationship Reports" description="On-demand 12-month engagement plans for competitors and market peers. Upgrade to unlock this feature."><RelationshipReportDetailPage /></PageFeatureGate>}</Route>
      <Route path="/app/documents" component={Documents} />
      <Route path="/app/assessments" component={Assessments} />
      <Route path="/app/settings" component={Settings} />
      <Route path="/app/settings/integrations">{() => <PageFeatureGate featureKey="outcomeMetrics" label="Integrations" description="Connect Google Analytics and other services to enrich your outcomes data."><SettingsIntegrationsPage /></PageFeatureGate>}</Route>
      <Route path="/app/users" component={UsersPage} />
      <Route path="/app/admin/organizations" component={AdminOrganizationsPage} />
      <Route path="/app/admin/ai-settings" component={AISettingsPage} />
      <Route path="/app/admin/spe-storage" component={SpeStoragePage} />
      <Route path="/app/admin/oauth-clients">{() => <GlobalAdminOnly><PageFeatureGate featureKey="partnerApi" label="Partner API" description="Manage OAuth client apps and access tokens. Available on Enterprise and Unlimited plans."><OAuthClientsAdminPage /></PageFeatureGate></GlobalAdminOnly>}</Route>
      <Route path="/app/admin/platform-credentials">{() => <GlobalAdminOnly><GlobalPlatformCredentialsPage /></GlobalAdminOnly>}</Route>
      <Route path="/app/developer">{() => <PageFeatureGate featureKey="partnerApi" label="Developer Portal" description="Build third-party integrations using Orbit's OAuth 2.0 Partner API. Available on Enterprise and Unlimited plans."><DeveloperPortalPage /></PageFeatureGate>}</Route>
      <Route path="/app/company-roster" component={CompanyRosterPage} />
      <Route path="/app/admin" component={AdminPage} />
      <Route path="/app/products">{() => <PageFeatureGate featureKey="productManagement" label="Product Management" description="Roadmap prioritization and feature tracking. Upgrade to unlock this feature."><ProductsPage /></PageFeatureGate>}</Route>
      {/* Literal /collateral must precede the /:id route so it isn't captured as a product id.
          Gated on clientProjects to match the server guard on /api/projects[/artifact-summary]. */}
      <Route path="/app/products/collateral">{() => <PageFeatureGate featureKey="clientProjects" label="Product Collateral" description="Generated strategy and go-to-market artifacts across your products. Upgrade to unlock this feature."><ProductCollateralPage /></PageFeatureGate>}</Route>
      <Route path="/app/products/:id/features" component={ProductFeaturesRedirect} />
      <Route path="/app/products/:id/roadmap" component={ProductRoadmapRedirect} />
      <Route path="/app/products/:productId/executive-summary" component={ExecutiveSummary} />
      <Route path="/app/executive-summary" component={BaselineSummary} />
      <Route path="/app/products/:id" component={ProductDetail} />
      <Route path="/app/guide" component={UserGuidePage} />
      <Route path="/app/support" component={SupportPage} />
      <Route path="/app/changelog" component={AppChangelogPage} />
      <Route path="/app/roadmap" component={AppRoadmapPage} />
      <Route path="/app/about" component={AppAbout} />
      <Route path="/app/data-sources" component={DataSourcesPage} />
      <Route path="/app/sales" component={SalesHubPage} />
      <Route path="/app/sales/outreach">{() => <PageFeatureGate featureKey="salesOutreachCampaigns" label="Sales Outreach" description="Goal-driven outbound: prospect, score, draft in your voice, and sequence follow-ups — you approve every send. Upgrade to unlock this feature."><OutreachCampaignsPage /></PageFeatureGate>}</Route>
      <Route path="/app/sales/outreach/new">{() => <PageFeatureGate featureKey="salesOutreachCampaigns" label="Sales Outreach" description="Goal-driven outbound: prospect, score, draft in your voice, and sequence follow-ups — you approve every send. Upgrade to unlock this feature."><OutreachInterviewPage /></PageFeatureGate>}</Route>
      <Route path="/app/sales/outreach/settings">{() => <PageFeatureGate featureKey="salesOutreachCampaigns" label="Sales Outreach" description="Goal-driven outbound: prospect, score, draft in your voice, and sequence follow-ups — you approve every send. Upgrade to unlock this feature."><OutreachSettingsPage /></PageFeatureGate>}</Route>
      <Route path="/app/sales/outreach/:id">{() => <PageFeatureGate featureKey="salesOutreachCampaigns" label="Sales Outreach" description="Goal-driven outbound: prospect, score, draft in your voice, and sequence follow-ups — you approve every send. Upgrade to unlock this feature."><OutreachCampaignDetailPage /></PageFeatureGate>}</Route>
      <Route path="/app/battlecards">{() => <PageFeatureGate featureKey="battlecards" label="Sales Battlecards" description="Generate competitive battlecards for sales teams. Upgrade to unlock this feature."><BattleCardsPage /></PageFeatureGate>}</Route>
      <Route path="/app/usage" component={UsagePage} />
      <Route path="/app/marketing" component={MarketingLandingPage} />
      <Route path="/app/marketing/pipeline" component={ContentPipelinePage} />
      <Route path="/app/marketing/queue" component={QueuePage} />
      <Route path="/app/marketing/gtm-plan" component={GtmPlanPage} />
      <Route path="/app/marketing/messaging-framework" component={MessagingFrameworkPage} />
      <Route path="/app/marketing/social-posts"><Redirect to="/app/marketing/campaigns" /></Route>
      <Route path="/app/marketing/email-newsletters" component={EmailNewslettersPage} />
      <Route path="/app/marketing/subscription-types">{() => <PageFeatureGate featureKey="directEmailDelivery" label="Email Subscriptions" description="Manage subscription types and recipient preferences. Upgrade to unlock this feature."><SubscriptionTypesPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/editorial-calendar" component={EditorialCalendarPage} />
      <Route path="/app/marketing/marketing-calendar">{() => <PageFeatureGate featureKey="editorialCalendar" label="Content Calendar" description="One calendar for all your social posts, emails, and content. Upgrade to unlock this feature."><MarketingCalendarPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/performance" component={MarketingPerformancePage} />
      <Route path="/app/marketing/content-library">{() => <PageFeatureGate featureKey="contentLibrary" label="Digital/Web Assets" description="Manage URLs, articles, and web-based content assets. Upgrade to unlock this feature."><ContentLibraryPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/brand-library">{() => <PageFeatureGate featureKey="brandLibrary" label="Visual/Brand Assets" description="Manage approved images, logos, and visual brand identity. Upgrade to unlock this feature."><BrandLibraryPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/solution-areas" component={SolutionAreasPage} />
      <Route path="/app/marketing/campaigns">{() => <PageFeatureGate featureKey="campaigns" label="Campaigns" description="Campaign management with asset coordination. Upgrade to unlock this feature."><CampaignsPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/campaign-interview">{() => <PageFeatureGate featureKey="editorialCalendar" label="Content Interview" description="Answer a few questions to generate, curate, and schedule a full content plan. Upgrade to unlock this feature."><CampaignInterviewPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/campaigns/:id" component={CampaignDetailPage} />
      <Route path="/app/marketing/planning-hub">{() => <PageFeatureGate featureKey="campaigns" label="Themes Hub" description="Plan all marketing for a solution-area theme or campaign in one view. Upgrade to unlock this feature."><PlanningHubPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/conferences">{() => <PageFeatureGate featureKey="conferencePromotion" label="Event Promotion" description="Drive coordinated social promotion for an event: anchor posts plus a matched post and graphic for every session. Upgrade to unlock this feature."><ConferencePromotionPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/conferences/:id">{() => <PageFeatureGate featureKey="conferencePromotion" label="Event Promotion" description="Drive coordinated social promotion for an event: anchor posts plus a matched post and graphic for every session. Upgrade to unlock this feature."><ConferenceDetailPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/social-accounts" component={SocialAccountsPage} />
      <Route path="/app/marketing/composer" component={ComposerPage} />
      <Route path="/app/marketing/calendar" component={CalendarPage} />
      <Route path="/app/marketing/sends" component={SendsPage} />
      <Route path="/app/marketing/browser-extension" component={BrowserExtensionPage} />
      <Route path="/app/marketing/personas">{() => <PageFeatureGate featureKey="personaBuilder" label="Persona & ICP Builder" description="Define buyer personas and inject audience context. Upgrade to unlock this feature."><PersonasPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/contacts">{() => <PageFeatureGate featureKey="marketingContacts" label="Marketing Contacts" description="First-party contact database with lifecycle stages and activity timeline. Upgrade to unlock this feature."><ContactsPage /></PageFeatureGate>}</Route>
      <Route path="/app/marketing/lead-scoring">{() => <PageFeatureGate featureKey="marketingContacts" label="Lead Scoring" description="Rule-based lead scoring with lifecycle stage transitions. Upgrade to unlock this feature."><LeadScoringPage /></PageFeatureGate>}</Route>
      {/* Marketing Projects (formerly "Marketing Planner" at /app/marketing-planner). */}
      <Route path="/app/marketing/projects" component={MarketingPlannerPage} />
      <Route path="/app/marketing/projects/:id" component={MarketingPlanDetail} />
      <Route path="/app/marketing-planner"><Redirect to="/app/marketing/projects" /></Route>
      <Route path="/app/marketing-planner/:id" component={MarketingProjectsDetailRedirect} />
      <Route path="/app/refresh-center" component={RefreshCenter} />
      <Route path="/app/action-items" component={ActionItems} />
      <Route path="/app/intelligence">{() => <PageFeatureGate featureKey="intelligenceBriefings" label="Intelligence Briefings" description="AI-synthesized periodic market intelligence reports. Upgrade to unlock this feature."><IntelligenceBriefingPage /></PageFeatureGate>}</Route>
      <Route path="/app/getting-started" component={GettingStartedPage} />
      <Route path="/app/inbox" component={InboxPage} />
      <Route path="/app/positioning-map" component={PositioningMapPage} />
      <Route path="/app/seo-dashboard">{() => <PageFeatureGate featureKey="seoTracking" label="SEO &amp; Share of Voice" description="Track keyword rankings and competitive share-of-voice. Upgrade to unlock this feature."><SeoDashboard /></PageFeatureGate>}</Route>
      <Route path="/app/insights/outcomes">{() => <PageFeatureGate featureKey="outcomeMetrics" label="Outcome Metrics & Orbit Score" description="ROI dashboard with Orbit Score, GA4 analytics, and outcome trend charts. Upgrade to unlock this feature."><InsightsOutcomesPage /></PageFeatureGate>}</Route>
      <Route path="/app/insights/visualizations">{() => <PageFeatureGate featureKey="visualizationDashboard" label="Visualization Dashboard" description="Interactive engagement, posting, sentiment, and pricing trends. Upgrade to Enterprise to unlock this feature."><InsightsVisualizationsPage /></PageFeatureGate>}</Route>

      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <HelmetProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <UserProvider>
              <UpgradeModalProvider>
                <TooltipProvider>
                  <Toaster />
                  <Router />
                </TooltipProvider>
              </UpgradeModalProvider>
            </UserProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
