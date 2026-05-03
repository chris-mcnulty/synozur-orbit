import type { Express, Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { storage } from "../storage";
import { sendVerificationEmail, sendWelcomeEmail } from "../services/email-service";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GOOGLE_SCOPES,
  isGoogleConfigured,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleRedirectUri,
} from "./google-config";
import { logAuditEvent } from "./recaptcha";
import { providerAllowedForTenant } from "./auth-policy";

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function consumePostLoginRedirect(req: Request): string {
  const target = req.session.postLoginRedirect;
  req.session.postLoginRedirect = undefined;
  if (target && target.startsWith("/") && !target.startsWith("//")) return target;
  return "/app";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function registerGoogleRoutes(app: Express) {
  app.get("/api/auth/google/status", (_req: Request, res: Response) => {
    res.json({ configured: isGoogleConfigured() });
  });

  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (!isGoogleConfigured()) {
      return res.status(503).json({ error: "Google SSO is not configured" });
    }
    if (req.session.userId) req.session.userId = undefined;

    const nextParam = typeof req.query.next === "string" ? req.query.next : "";
    if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
      req.session.postLoginRedirect = nextParam;
    } else {
      req.session.postLoginRedirect = undefined;
    }

    const state = generateToken();
    req.session.googleOAuthState = state;

    const params = new URLSearchParams({
      client_id: getGoogleClientId(),
      redirect_uri: getGoogleRedirectUri(),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "online",
      include_granted_scopes: "true",
      prompt: "select_account",
      state,
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    if (!isGoogleConfigured()) {
      return res.redirect("/auth/signin?error=sso_not_configured");
    }
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    if (oauthError) {
      return res.redirect(`/auth/signin?error=${encodeURIComponent(oauthError)}`);
    }
    if (!code) return res.redirect("/auth/signin?error=no_auth_code");

    const expectedState = req.session.googleOAuthState;
    req.session.googleOAuthState = undefined;
    if (!state || !expectedState || state !== expectedState) {
      return res.redirect("/auth/signin?error=invalid_state");
    }

    try {
      const tokenParams = new URLSearchParams({
        code,
        client_id: getGoogleClientId(),
        client_secret: getGoogleClientSecret(),
        redirect_uri: getGoogleRedirectUri(),
        grant_type: "authorization_code",
      });
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams.toString(),
      });
      if (!tokenRes.ok) {
        const txt = await tokenRes.text();
        console.error("[Google] Token exchange failed:", txt);
        return res.redirect("/auth/signin?error=token_acquisition_failed");
      }
      const tokenJson: any = await tokenRes.json();
      const accessToken: string = tokenJson.access_token;
      if (!accessToken) {
        return res.redirect("/auth/signin?error=token_acquisition_failed");
      }

      const userinfoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userinfoRes.ok) {
        return res.redirect("/auth/signin?error=userinfo_failed");
      }
      const profile: any = await userinfoRes.json();
      const googleId: string | undefined = profile.sub;
      const email: string | undefined = (profile.email || "").toLowerCase();
      const emailVerified: boolean = !!profile.email_verified;
      const name: string = profile.name || (email ? email.split("@")[0] : "Google User");

      if (!googleId || !email) {
        return res.redirect("/auth/signin?error=invalid_token");
      }
      if (!emailVerified) {
        return res.redirect("/auth/signin?error=google_email_unverified");
      }

      const domain = email.split("@")[1].toLowerCase();

      // 1. Existing user with this googleId — log in.
      let user = await storage.getUserByGoogleId(googleId);
      if (user) {
        const tenant = await storage.getTenantByDomain(user.email.split("@")[1].toLowerCase());
        if (tenant && !providerAllowedForTenant(tenant, "google")) {
          logAuditEvent("auth_provider_blocked", { provider: "google", tenantDomain: tenant.domain, userId: user.id });
          return res.redirect("/auth/signin?error=provider_not_allowed_google");
        }
        if (user.status === "pending_verification") {
          return res.redirect(`/auth/verify-pending?email=${encodeURIComponent(email)}`);
        }
        req.session.userId = user.id;
        return res.redirect(consumePostLoginRedirect(req));
      }

      // 2. Existing user matched by email — offer account-linking.
      user = await storage.getUserByEmail(email);
      if (user) {
        // Reject silently if a non-matching googleId is already on the account
        if (user.googleId && user.googleId !== googleId) {
          logAuditEvent("auth_link_rejected", { reason: "different_google_id", userId: user.id });
          return res.redirect("/auth/signin?error=account_already_linked");
        }
        const tenant = await storage.getTenantByDomain(domain);
        if (tenant && !providerAllowedForTenant(tenant, "google")) {
          logAuditEvent("auth_provider_blocked", { provider: "google", tenantDomain: tenant.domain, userId: user.id });
          return res.redirect("/auth/signin?error=provider_not_allowed_google");
        }
        // Stash pending link in session and render confirmation page.
        req.session.pendingGoogleLink = { googleId, email, name, userId: user.id };
        return res.redirect("/api/auth/google/link");
      }

      // 3. New user — JIT provision (mirrors Entra flow).
      const isBlocked = await storage.isdomainBlocked(domain);
      const existingTenant = await storage.getTenantByDomain(domain);

      if (existingTenant && !providerAllowedForTenant(existingTenant, "google")) {
        logAuditEvent("auth_provider_blocked", { provider: "google", tenantDomain: existingTenant.domain });
        return res.redirect("/auth/signin?error=provider_not_allowed_google");
      }

      if (!existingTenant && isBlocked) {
        return res.redirect("/auth/signin?error=domain_blocked");
      }

      if (existingTenant) {
        const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);
        const newUser = await storage.createUser({
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
          googleId,
          authProvider: "google",
          emailVerified: true,
          status: "active",
        });
        req.session.userId = newUser.id;
        logAuditEvent("auth_provisioned", { provider: "google", userId: newUser.id, tenantDomain: domain });
        return res.redirect(consumePostLoginRedirect(req));
      }

      // First-user-of-domain — create pending verification user.
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
        role: "Standard User",
        googleId,
        authProvider: "google",
        emailVerified: false,
        status: "pending_verification",
      });

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.createEmailVerificationToken({
        token,
        email,
        name,
        company: domain,
        entraId: null,
        azureTenantId: null,
        expiresAt,
      } as any);

      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
      const baseUrl = `${protocol}://${host}`;
      const sent = await sendVerificationEmail(email, name, token, baseUrl);
      if (!sent) {
        return res.redirect("/auth/signin?error=email_send_failed");
      }
      logAuditEvent("auth_provisioned_pending", { provider: "google", userId: pendingUser.id, tenantDomain: domain });
      return res.redirect(`/auth/verify-pending?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      console.error("[Google] Callback error:", err);
      return res.redirect("/auth/signin?error=token_acquisition_failed");
    }
  });

  // Server-rendered confirmation page for account linking.
  app.get("/api/auth/google/link", (req: Request, res: Response) => {
    const pending = req.session.pendingGoogleLink;
    if (!pending) {
      return res.redirect("/auth/signin?error=link_session_expired");
    }
    const safeEmail = escapeHtml(pending.email);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Link Google Account · Orbit</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#0b0b14;color:#f3f3f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#15162a;border:1px solid #2a2b44;border-radius:12px;padding:32px;max-width:440px;width:90%}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#b6b6c8;line-height:1.5}
.row{display:flex;gap:8px;margin-top:20px}
button,a.btn{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #3a3b58;background:#1f2040;color:#fff;font-size:0.95rem;cursor:pointer;text-align:center;text-decoration:none}
button.primary{background:#810FFB;border-color:#810FFB}
</style></head><body>
<div class="card">
<h1>Link Google to your Orbit account?</h1>
<p>We found an existing Orbit account for <strong>${safeEmail}</strong>. If this is you, link Google so you can sign in either way. Your password will keep working.</p>
<form method="POST" action="/api/auth/google/link/confirm" class="row">
<a class="btn" href="/api/auth/google/link/cancel">No, cancel</a>
<button class="primary" type="submit">Yes, link my account</button>
</form>
</div></body></html>`);
  });

  app.post("/api/auth/google/link/confirm", async (req: Request, res: Response) => {
    const pending = req.session.pendingGoogleLink;
    req.session.pendingGoogleLink = undefined;
    if (!pending) {
      return res.redirect("/auth/signin?error=link_session_expired");
    }
    try {
      const user = await storage.getUser(pending.userId);
      if (!user) return res.redirect("/auth/signin?error=user_not_found");
      // Reject silently if a different googleId is already linked
      if (user.googleId && user.googleId !== pending.googleId) {
        logAuditEvent("auth_link_rejected", { reason: "different_google_id_at_confirm", userId: user.id });
        return res.redirect("/auth/signin?error=account_already_linked");
      }
      await storage.updateUser(user.id, {
        googleId: pending.googleId,
        // Keep authProvider as "google" so the sign-in page knows which to highlight.
        authProvider: user.authProvider === "entra" ? user.authProvider : "google",
      });
      logAuditEvent("auth_link_confirmed", { provider: "google", userId: user.id });
      req.session.userId = user.id;
      return res.redirect(consumePostLoginRedirect(req));
    } catch (err: any) {
      console.error("[Google] Link confirm error:", err);
      return res.redirect("/auth/signin?error=link_failed");
    }
  });

  app.get("/api/auth/google/link/cancel", (req: Request, res: Response) => {
    const pending = req.session.pendingGoogleLink;
    req.session.pendingGoogleLink = undefined;
    if (pending) {
      logAuditEvent("auth_link_cancelled", { provider: "google", userId: pending.userId });
    }
    res.redirect("/auth/signin?error=link_cancelled");
  });
}
