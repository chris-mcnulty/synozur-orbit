import type { Express, Request, Response } from "express";
import { getMsalInstance, isEntraConfigured, REDIRECT_URI, SCOPES } from "./msal-config";
import { storage } from "../storage";
import { sendVerificationEmail, sendWelcomeEmail } from "../services/email-service";
import * as msal from "@azure/msal-node";
import bcrypt from "bcrypt";
import crypto from "crypto";

function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
  return `${protocol}://${host}`;
}

export function registerEntraRoutes(app: Express) {
  app.get("/api/auth/entra/status", (req: Request, res: Response) => {
    res.json({ configured: isEntraConfigured() });
  });

  app.get("/api/auth/entra", async (req: Request, res: Response) => {
    const msalInstance = getMsalInstance();
    if (!msalInstance) {
      return res.status(503).json({ error: "Microsoft Entra SSO is not configured" });
    }

    // Clear any existing session to force fresh authentication
    if (req.session.userId) {
      req.session.userId = undefined;
    }

    const authCodeUrlParameters: msal.AuthorizationUrlRequest = {
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
      responseMode: msal.ResponseMode.QUERY,
      prompt: "select_account", // Always prompt user to select account
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

      const claims = response.idTokenClaims as Record<string, any> | undefined;
      const entraId = claims?.oid || response.account?.homeAccountId;
      const email = claims?.preferred_username || claims?.email || response.account?.username || "";
      const name = claims?.name || response.account?.name || email.split("@")[0];
      const azureTenantId = claims?.tid; // Azure tenant ID from token

      if (!entraId) {
        console.error("[Entra] No oid or homeAccountId in token response");
        return res.redirect("/auth/signin?error=invalid_token");
      }

      if (!email) {
        return res.redirect("/auth/signin?error=no_email_in_token");
      }

      const domain = email.split("@")[1].toLowerCase();
      
      // Auto-populate tenant's Azure Tenant ID if not set
      const existingTenantForUpdate = await storage.getTenantByDomain(domain);
      if (existingTenantForUpdate && azureTenantId && !existingTenantForUpdate.entraTenantId) {
        await storage.updateTenant(existingTenantForUpdate.id, { 
          entraTenantId: azureTenantId,
          entraEnabled: true // Auto-enable SSO when first user logs in via Entra
        });
        console.log(`[Entra] Auto-populated tenant ID ${azureTenantId} for domain ${domain}`);
      }

      let user = await storage.getUserByEntraId(entraId);

      if (user) {
        if (user.status === "pending_verification") {
          return res.redirect(`/auth/verify-pending?email=${encodeURIComponent(email)}`);
        }
        req.session.userId = user.id;
        return res.redirect("/app");
      }

      user = await storage.getUserByEmail(email);
      
      if (user) {
        if (user.status === "pending_verification") {
          await storage.updateUser(user.id, {
            entraId,
            authProvider: "entra",
          });
          return res.redirect(`/auth/verify-pending?email=${encodeURIComponent(email)}`);
        }
        user = await storage.updateUser(user.id, {
          entraId,
          authProvider: "entra",
        });
        req.session.userId = user.id;
        return res.redirect("/app");
      }

      const existingTenant = await storage.getTenantByDomain(domain);
      
      if (existingTenant) {
        const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
        
        user = await storage.createUser({
          email,
          password: randomPassword,
          name,
          company: existingTenant.name || domain,
          companySize: "",
          jobTitle: "",
          industry: "",
          country: "",
          avatar: name.charAt(0).toUpperCase(),
          role: "Standard User",
          entraId,
          authProvider: "entra",
          emailVerified: true,
          status: "active",
        });

        req.session.userId = user.id;
        return res.redirect("/app");
      }

      // Check if domain is blocked from auto-provisioning before creating pending user
      const isBlocked = await storage.isdomainBlocked(domain);
      if (isBlocked) {
        return res.redirect("/auth/signin?error=domain_blocked");
      }

      // SECURITY: Self-service SSO ONLY creates Standard User
      // Consultant is a privileged cross-tenant role assigned only by Global Admin
      const role = "Standard User";

      const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
      
      const pendingUser = await storage.createUser({
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
        emailVerified: false,
        status: "pending_verification",
      });

      const token = generateVerificationToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await storage.createEmailVerificationToken({
        token,
        email,
        name,
        company: domain,
        entraId,
        azureTenantId,
        expiresAt,
      });

      const baseUrl = getBaseUrl(req);
      const emailSent = await sendVerificationEmail(email, name, token, baseUrl);

      if (!emailSent) {
        console.error("[Entra] Failed to send verification email to:", email);
        return res.redirect("/auth/signin?error=email_send_failed");
      }

      console.log(`[Entra] Verification email sent to ${email} for new domain ${domain}`);
      return res.redirect(`/auth/verify-pending?email=${encodeURIComponent(email)}`);

    } catch (error: any) {
      console.error("[Entra] Token acquisition error:", error);
      res.redirect("/auth/signin?error=token_acquisition_failed");
    }
  });

  app.get("/api/auth/verify-email", async (req: Request, res: Response) => {
    const token = req.query.token as string;

    if (!token) {
      return res.redirect("/auth/signin?error=missing_token");
    }

    try {
      const verificationToken = await storage.getEmailVerificationToken(token);

      if (!verificationToken) {
        return res.redirect("/auth/signin?error=invalid_token");
      }

      if (verificationToken.used) {
        return res.redirect("/auth/signin?error=token_already_used");
      }

      if (new Date() > verificationToken.expiresAt) {
        return res.redirect("/auth/signin?error=token_expired");
      }

      const { email, name, company, entraId, azureTenantId } = verificationToken;
      const domain = email.split("@")[1].toLowerCase();

      // Check if domain is blocked from auto-provisioning BEFORE marking token used
      const existingTenantForBlock = await storage.getTenantByDomain(domain);
      if (!existingTenantForBlock) {
        const isBlocked = await storage.isdomainBlocked(domain);
        if (isBlocked) {
          return res.redirect("/auth/signin?error=domain_blocked");
        }
      }

      // Mark token as used only after blocklist check passes
      await storage.markEmailVerificationTokenUsed(token);

      let user = await storage.getUserByEmail(email);

      if (user) {
        user = await storage.updateUser(user.id, {
          emailVerified: true,
          status: "active",
          entraId: entraId || user.entraId,
          authProvider: entraId ? "entra" : user.authProvider,
        });
      } else {
        // SECURITY: Self-service SSO ONLY creates Standard User
        // Consultant is a privileged cross-tenant role assigned only by Global Admin
        const role = "Standard User";

        const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
        
        user = await storage.createUser({
          email,
          password: randomPassword,
          name,
          company: company || domain,
          companySize: "",
          jobTitle: "",
          industry: "",
          country: "",
          avatar: name.charAt(0).toUpperCase(),
          role,
          entraId: entraId || undefined,
          authProvider: entraId ? "entra" : "local",
          emailVerified: true,
          status: "active",
        });
      }

      const existingTenant = await storage.getTenantByDomain(domain);
      if (!existingTenant) {
        await storage.createTenant({
          domain,
          name: company || domain,
          plan: "trial",
          status: "active",
          userCount: 1,
          competitorLimit: 3,
          analysisLimit: 5,
          entraTenantId: azureTenantId || undefined,
          entraEnabled: !!azureTenantId,
        });
      }

      await sendWelcomeEmail(email, name, company || domain);

      req.session.userId = user.id;

      console.log(`[Entra] Email verified for ${email}, activated user as ${user.role} for domain ${domain}`);
      return res.redirect("/app?verified=true");

    } catch (error: any) {
      console.error("[Entra] Email verification error:", error);
      return res.redirect("/auth/signin?error=verification_failed");
    }
  });

  app.post("/api/auth/resend-verification", async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    try {
      const existingUser = await storage.getUserByEmail(email);
      
      if (!existingUser || existingUser.status !== "pending_verification") {
        return res.status(400).json({ error: "No pending verification found for this email" });
      }
      
      const token = generateVerificationToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await storage.createEmailVerificationToken({
        token,
        email,
        name: existingUser.name,
        company: existingUser.company,
        entraId: existingUser.entraId,
        expiresAt,
      });

      const baseUrl = getBaseUrl(req);
      const emailSent = await sendVerificationEmail(email, existingUser.name, token, baseUrl);

      if (!emailSent) {
        return res.status(500).json({ error: "Failed to send verification email" });
      }

      return res.json({ success: true, message: "Verification email sent" });
    } catch (error: any) {
      console.error("[Entra] Resend verification error:", error);
      return res.status(500).json({ error: "Failed to resend verification email" });
    }
  });
}
