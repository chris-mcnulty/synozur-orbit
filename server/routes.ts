import type { Express } from "express";
import type { Server } from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerEntraRoutes } from "./auth/entra-routes";
import { registerSaturnMarketingRoutes } from "./routes/marketing-saturn";
import { registerMarketingLinksRoutes } from "./routes/marketing-links";
import { registerMarketingDeliveryPublicRoutes, registerMarketingDeliveryRoutes } from "./routes/marketing-delivery";
import { registerAuthRoutes } from "./routes/auth";
import { registerCompetitorRoutes } from "./routes/competitors";
import { registerBattlecardRoutes } from "./routes/battlecards";
import { registerCompetitorDocumentRoutes } from "./routes/competitor-documents";
import { registerNotificationsActivityRoutes } from "./routes/notifications-activity";
import { registerReportsAnalysisRoutes } from "./routes/reports-analysis";
import { registerAdminRoutes } from "./routes/admin";
import { registerConsultantPlansRoutes } from "./routes/consultant-plans";
import { registerClientProjectRoutes } from "./routes/client-projects";
import { registerProductRoutes } from "./routes/products";
import { registerProductFeedbackRoutes } from "./routes/product-feedback";
import { registerIntelligenceRoutes } from "./routes/intelligence";
import { registerExecutiveRegenRoutes } from "./routes/executive-regen";
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  registerObjectStorageRoutes(app);
  registerEntraRoutes(app);
  registerSaturnMarketingRoutes(app);
  // Register marketing-links BEFORE the Vite/static catch-all so /r/:slug
  // resolves to the redirect handler instead of the SPA HTML.
  registerMarketingLinksRoutes(app);
  // Task #97: public unsubscribe + SendGrid event webhook (no auth required)
  registerMarketingDeliveryPublicRoutes(app);
  // Authenticated marketing delivery routes (oauth, lists, sends, audit)
  registerMarketingDeliveryRoutes(app);
  
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
  registerNotificationsActivityRoutes(app);
  registerReportsAnalysisRoutes(app);
  registerAdminRoutes(app);
  registerConsultantPlansRoutes(app);
  registerClientProjectRoutes(app);
  registerProductRoutes(app);
  registerProductFeedbackRoutes(app);
  registerIntelligenceRoutes(app);
  registerExecutiveRegenRoutes(app);
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

  return httpServer;
}
