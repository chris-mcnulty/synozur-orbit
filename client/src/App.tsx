import { Switch, Route, useParams, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider } from "@/lib/userContext";
import { ThemeProvider } from "next-themes";
import { HelmetProvider } from "react-helmet-async";
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
import Analysis from "@/pages/app/analysis";
import Recommendations from "@/pages/app/recommendations";
import Activity from "@/pages/app/activity";
import Reports from "@/pages/app/reports";
import Competitors from "@/pages/app/competitors";
import CompetitorDetail from "@/pages/app/competitor-detail";
import Documents from "@/pages/app/documents";
import Assessments from "@/pages/app/assessments";
import Settings from "@/pages/app/settings";
import UsersPage from "@/pages/app/users";
import AdminPage from "@/pages/app/admin";
import ProductsPage from "@/pages/app/products";
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
import MarketingLandingPage from "@/pages/app/marketing/index";
import ContentLibraryPage from "@/pages/app/marketing/content-library";
import BrandLibraryPage from "@/pages/app/marketing/brand-library";
import CampaignsPage from "@/pages/app/marketing/campaigns";
import CampaignDetailPage from "@/pages/app/marketing/campaign-detail";
import SocialAccountsPage from "@/pages/app/marketing/social-accounts";
import BrowserExtensionPage from "@/pages/app/marketing/browser-extension";
import RefreshCenter from "@/pages/app/refresh-center";
import ActionItems from "@/pages/app/action-items";
import IntelligenceBriefingPage from "@/pages/app/intelligence-briefing";
import GettingStartedPage from "@/pages/app/getting-started";
import Pricing from "@/pages/pricing";
import AdminOrganizationsPage from "@/pages/app/admin/organizations";
import AISettingsPage from "@/pages/app/admin/ai-settings";
import SpeStoragePage from "@/pages/app/admin/spe-storage";

function ProductFeaturesRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/app/products/${id}?tab=features`} />;
}

function ProductRoadmapRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Redirect to={`/app/products/${id}?tab=roadmap`} />;
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
      
      {/* App Routes */}
      <Route path="/app" component={Dashboard} />
      <Route path="/app/overview" component={Dashboard} />
      <Route path="/app/dashboard" component={Dashboard} />
      <Route path="/app/competitors" component={Competitors} />
      <Route path="/app/company-profile" component={CompanyBaseline} />
      <Route path="/app/competitors/:id" component={CompetitorDetail} />
      <Route path="/app/analysis" component={Analysis} />
      <Route path="/app/recommendations" component={Recommendations} />
      <Route path="/app/activity" component={Activity} />
      <Route path="/app/reports" component={Reports} />
      <Route path="/app/documents" component={Documents} />
      <Route path="/app/assessments" component={Assessments} />
      <Route path="/app/settings" component={Settings} />
      <Route path="/app/users" component={UsersPage} />
      <Route path="/app/admin/organizations" component={AdminOrganizationsPage} />
      <Route path="/app/admin/ai-settings" component={AISettingsPage} />
      <Route path="/app/admin/spe-storage" component={SpeStoragePage} />
      <Route path="/app/admin" component={AdminPage} />
      <Route path="/app/products" component={ProductsPage} />
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
      <Route path="/app/battlecards" component={BattleCardsPage} />
      <Route path="/app/usage" component={UsagePage} />
      <Route path="/app/marketing" component={MarketingLandingPage} />
      <Route path="/app/marketing/gtm-plan" component={GtmPlanPage} />
      <Route path="/app/marketing/messaging-framework" component={MessagingFrameworkPage} />
      <Route path="/app/marketing/social-posts"><Redirect to="/app/marketing/campaigns" /></Route>
      <Route path="/app/marketing/email-newsletters" component={EmailNewslettersPage} />
      <Route path="/app/marketing/content-library" component={ContentLibraryPage} />
      <Route path="/app/marketing/brand-library" component={BrandLibraryPage} />
      <Route path="/app/marketing/campaigns" component={CampaignsPage} />
      <Route path="/app/marketing/campaigns/:id" component={CampaignDetailPage} />
      <Route path="/app/marketing/social-accounts" component={SocialAccountsPage} />
      <Route path="/app/marketing/browser-extension" component={BrowserExtensionPage} />
      <Route path="/app/marketing-planner" component={MarketingPlannerPage} />
      <Route path="/app/marketing-planner/:id" component={MarketingPlanDetail} />
      <Route path="/app/refresh-center" component={RefreshCenter} />
      <Route path="/app/action-items" component={ActionItems} />
      <Route path="/app/intelligence" component={IntelligenceBriefingPage} />
      <Route path="/app/getting-started" component={GettingStartedPage} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <HelmetProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <QueryClientProvider client={queryClient}>
          <UserProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </UserProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </HelmetProvider>
  );
}

export default App;
