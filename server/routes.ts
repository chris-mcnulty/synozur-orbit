import type { Express } from "express";
import type { Server } from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerEntraRoutes } from "./auth/entra-routes";
import { registerSaturnMarketingRoutes } from "./routes/marketing-saturn";
import { registerAuthRoutes } from "./routes/auth";
import { registerCompetitorRoutes } from "./routes/competitors";
import { registerBattlecardRoutes } from "./routes/battlecards";
import { registerNotificationsActivityRoutes } from "./routes/notifications-activity";
import { registerReportsAnalysisRoutes } from "./routes/reports-analysis";
import { registerAdminRoutes } from "./routes/admin";
import { registerConsultantPlansRoutes } from "./routes/consultant-plans";
import { registerClientProjectRoutes } from "./routes/client-projects";
import { registerProductRoutes } from "./routes/products";
import { registerIntelligenceRoutes } from "./routes/intelligence";
import { registerExecutiveRegenRoutes } from "./routes/executive-regen";
import { registerTenantAdminRoutes } from "./routes/tenant-admin";
import { registerOperationsRoutes } from "./routes/operations";
import { registerAnalyticsDataRoutes } from "./routes/analytics-data";
import { registerPlatformRoutes } from "./routes/platform";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  registerObjectStorageRoutes(app);
  registerEntraRoutes(app);
  registerSaturnMarketingRoutes(app);
  
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
  registerNotificationsActivityRoutes(app);
  registerReportsAnalysisRoutes(app);
  registerAdminRoutes(app);
  registerConsultantPlansRoutes(app);
  registerClientProjectRoutes(app);
  registerProductRoutes(app);
  registerIntelligenceRoutes(app);
  registerExecutiveRegenRoutes(app);
  registerTenantAdminRoutes(app);
  registerOperationsRoutes(app);
  registerAnalyticsDataRoutes(app);
  registerPlatformRoutes(app);

  return httpServer;
}
