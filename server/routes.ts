import type { Express } from "express";
import type { Server } from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerEntraRoutes } from "./auth/entra-routes";
import { registerGoogleRoutes } from "./auth/google-routes";
import { registerSaturnMarketingRoutes } from "./routes/marketing-saturn";
import { registerMarketingLinksRoutes } from "./routes/marketing-links";
import { registerMarketingDeliveryPublicRoutes, registerMarketingDeliveryRoutes } from "./routes/marketing-delivery";
import { registerMarketingPostsRoutes } from "./routes/marketing-posts";
import { registerConferencePromotionRoutes } from "./routes/conference-promotion";
import { registerPlannerWebhookPublicRoutes } from "./routes/planner-webhook";
import { registerAuthRoutes } from "./routes/auth";
import { registerCompetitorRoutes } from "./routes/competitors";
import { registerBattlecardRoutes } from "./routes/battlecards";
import { registerCompetitorDocumentRoutes } from "./routes/competitor-documents";
import { registerPricingIntelligenceRoutes } from "./routes/pricing-intelligence";
import { registerDashboardVisualizationRoutes } from "./routes/dashboard-visualizations";
import { registerNotificationsActivityRoutes } from "./routes/notifications-activity";
import { registerCollaborationRoutes } from "./routes/collaboration";
import { registerReportsAnalysisRoutes } from "./routes/reports-analysis";
import { registerAdminRoutes } from "./routes/admin";
import { registerConsultantPlansRoutes } from "./routes/consultant-plans";
import { registerClientProjectRoutes } from "./routes/client-projects";
import { registerProductRoutes } from "./routes/products";
import { registerProductFeedbackRoutes } from "./routes/product-feedback";
import { registerIntelligenceRoutes } from "./routes/intelligence";
import { registerExecutiveRegenRoutes } from "./routes/executive-regen";
import { registerRelationshipReportRoutes } from "./routes/relationship-reports";
import { registerTenantAdminRoutes } from "./routes/tenant-admin";
import { registerIntegrationRoutes } from "./routes/integrations";
import { registerOperationsRoutes } from "./routes/operations";
import { registerAnalyticsDataRoutes } from "./routes/analytics-data";
import { registerPlatformRoutes } from "./routes/platform";
import { registerPositioningMapRoutes } from "./routes/positioning-map";
import { registerPlannerRoutes } from "./routes/planner";
import { registerSeoRoutes } from "./routes/seo";
import { registerInsightsOutcomesRoutes } from "./routes/insights-outcomes";
import { registerOAuthProviderRoutes } from "./routes/oauth-provider";
import { registerPartnerApiRoutes } from "./routes/partner-api";
import { registerAdminOAuthClientRoutes } from "./routes/admin-oauth-clients";
import { registerBillingRoutes } from "./routes/billing";
import { registerTenantFontRoutes } from "./routes/tenant-fonts";
import { registerMarketingContextRoutes } from "./routes/marketing-context";
import { registerEditorialCalendarRoutes } from "./routes/editorial-calendar";
import { registerBriefInterviewRoutes } from "./routes/brief-interview";
import { registerMarketingCalendarRoutes } from "./routes/marketing-calendar";
import { registerContentProductionRoutes } from "./routes/content-production";
import { registerCampaignIdeationRoutes } from "./routes/campaign-ideation";
import { registerDistributionPlannerRoutes } from "./routes/distribution-planner";
import { registerSalesOutreachRoutes } from "./routes/sales-outreach";
import { registerMarketingPerformanceRoutes } from "./routes/marketing-performance";
import { registerPlanningHubRoutes } from "./routes/planning-hub";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  registerObjectStorageRoutes(app);
  registerEntraRoutes(app);
  registerGoogleRoutes(app);
  registerSaturnMarketingRoutes(app);
  // Register marketing-links BEFORE the Vite/static catch-all so /r/:slug
  // resolves to the redirect handler instead of the SPA HTML.
  registerMarketingLinksRoutes(app);
  // Task #97: public unsubscribe + SendGrid event webhook (no auth required)
  registerMarketingDeliveryPublicRoutes(app);
  registerPlannerWebhookPublicRoutes(app);
  // Authenticated marketing delivery routes (oauth, lists, sends, audit)
  registerMarketingDeliveryRoutes(app);
  // Phase 2/3/4: rewrite, standalone post CRUD, calendar
  registerMarketingPostsRoutes(app);
  // Conference social promotion: conferences, sessions, image space, generation
  registerConferencePromotionRoutes(app);

  app.get("/api/content/:filename", (req, res) => {
    const allowedFiles = ["changelog.md", "backlog.md", "user_guide.md"];
    const filename = req.params.filename;
    
    if (!allowedFiles.includes(filename)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    const filePath = join(process.cwd(), "public", filename);
    
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    
    try {
      const content = readFileSync(filePath, "utf-8");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(content);
    } catch (error) {
      console.error("Error reading file:", error);
      res.status(500).json({ error: "Failed to read file" });
    }
  });

  registerAuthRoutes(app);
  registerCompetitorRoutes(app);
  registerBattlecardRoutes(app);
  registerCompetitorDocumentRoutes(app);
  registerPricingIntelligenceRoutes(app);
  registerDashboardVisualizationRoutes(app);
  registerNotificationsActivityRoutes(app);
  registerCollaborationRoutes(app);
  registerReportsAnalysisRoutes(app);
  registerAdminRoutes(app);
  registerConsultantPlansRoutes(app);
  registerClientProjectRoutes(app);
  registerProductRoutes(app);
  registerProductFeedbackRoutes(app);
  registerIntelligenceRoutes(app);
  registerExecutiveRegenRoutes(app);
  registerRelationshipReportRoutes(app);
  registerTenantAdminRoutes(app);
  registerIntegrationRoutes(app);
  registerOperationsRoutes(app);
  registerAnalyticsDataRoutes(app);
  registerPlatformRoutes(app);
  registerPositioningMapRoutes(app);
  registerPlannerRoutes(app);
  registerSeoRoutes(app);
  registerInsightsOutcomesRoutes(app);
  registerOAuthProviderRoutes(app);
  registerPartnerApiRoutes(app);
  registerAdminOAuthClientRoutes(app);
  registerBillingRoutes(app);
  registerTenantFontRoutes(app);
  registerMarketingContextRoutes(app);
  registerEditorialCalendarRoutes(app);
  registerBriefInterviewRoutes(app);
  registerMarketingCalendarRoutes(app);
  registerContentProductionRoutes(app);
  registerCampaignIdeationRoutes(app);
  registerDistributionPlannerRoutes(app);
  registerMarketingPerformanceRoutes(app);
  registerPlanningHubRoutes(app);
  registerSalesOutreachRoutes(app);

  return httpServer;
}
