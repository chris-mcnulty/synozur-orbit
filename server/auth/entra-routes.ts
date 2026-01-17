import type { Express, Request, Response } from "express";
import { getMsalInstance, isEntraConfigured, REDIRECT_URI, SCOPES } from "./msal-config";
import { storage } from "../storage";
import * as msal from "@azure/msal-node";
import bcrypt from "bcrypt";

export function registerEntraRoutes(app: Express) {
  app.get("/api/auth/entra/status", (req: Request, res: Response) => {
    res.json({ configured: isEntraConfigured() });
  });

  app.get("/api/auth/entra", async (req: Request, res: Response) => {
    const msalInstance = getMsalInstance();
    if (!msalInstance) {
      return res.status(503).json({ error: "Microsoft Entra SSO is not configured" });
    }

    const authCodeUrlParameters: msal.AuthorizationUrlRequest = {
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
      responseMode: msal.ResponseMode.QUERY,
    };

    try {
      const authCodeUrl = await msalInstance.getAuthCodeUrl(authCodeUrlParameters);
      res.redirect(authCodeUrl);
    } catch (error: any) {
      console.error("[Entra] Error generating auth URL:", error);
      res.redirect("/auth/signin?error=sso_init_failed");
    }
  });

  app.get("/api/auth/entra/callback", async (req: Request, res: Response) => {
    const msalInstance = getMsalInstance();
    if (!msalInstance) {
      return res.redirect("/auth/signin?error=sso_not_configured");
    }

    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      console.error("[Entra] Auth error:", req.query.error_description);
      return res.redirect(`/auth/signin?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return res.redirect("/auth/signin?error=no_auth_code");
    }

    try {
      const tokenRequest: msal.AuthorizationCodeRequest = {
        code,
        scopes: SCOPES,
        redirectUri: REDIRECT_URI,
      };

      const response = await msalInstance.acquireTokenByCode(tokenRequest);

      const entraId = response.account?.homeAccountId || response.uniqueId;
      const email = response.account?.username || "";
      const name = response.account?.name || email.split("@")[0];

      if (!email) {
        return res.redirect("/auth/signin?error=no_email_in_token");
      }

      let user = await storage.getUserByEntraId(entraId);

      if (!user) {
        user = await storage.getUserByEmail(email);
        
        if (user) {
          user = await storage.updateUser(user.id, {
            entraId,
            authProvider: "entra",
          });
        } else {
          const domain = email.split("@")[1];
          let role = "Standard User";
          
          const globalAdmin = await storage.getGlobalAdmin();
          if (!globalAdmin) {
            role = "Global Admin";
          } else {
            const domainAdmin = await storage.getDomainAdmin(domain);
            if (!domainAdmin) {
              role = "Domain Admin";
            }
          }

          const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);

          user = await storage.createUser({
            email,
            password: randomPassword,
            name,
            company: domain,
            companySize: "",
            jobTitle: "",
            industry: "",
            country: "",
            avatar: name.charAt(0).toUpperCase(),
            role,
            entraId,
            authProvider: "entra",
          });

          const existingTenant = await storage.getTenantByDomain(domain);
          if (!existingTenant) {
            await storage.createTenant({
              domain,
              name: domain,
              plan: "free",
              status: "active",
              userCount: 0,
              competitorLimit: 3,
              analysisLimit: 5,
            });
          }
        }
      }

      req.session.userId = user.id;

      res.redirect("/app");
    } catch (error: any) {
      console.error("[Entra] Token acquisition error:", error);
      res.redirect("/auth/signin?error=token_acquisition_failed");
    }
  });
}
