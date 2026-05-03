/**
 * OAuth 2.0 Authorization Server endpoints (Task #96 — Galaxy partner API).
 *
 * Endpoints:
 *   GET  /oauth/authorize              — render consent screen (session auth)
 *   POST /oauth/authorize              — handle consent submission
 *   POST /oauth/token                  — exchange code or refresh token
 *   POST /oauth/revoke                 — revoke a token
 *   GET  /oauth/userinfo               — return id of bearer-token user
 *   GET  /.well-known/oauth-authorization-server — server metadata
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { getRequestContext, ContextError } from "../context";
import {
  PARTNER_API_SCOPES,
  PARTNER_API_SCOPE_LABELS,
} from "@shared/schema";
import {
  getClientById,
  createAuthorizationCode,
  lookupAuthorizationCode,
  markAuthorizationCodeUsed,
  issueTokenPair,
  rotateRefreshToken,
  revokeToken,
  verifyPkceS256,
  parseScopeString,
  hashClientSecret,
  isValidScope,
} from "../services/oauth-service";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildErrorRedirect(redirectUri: string, error: string, description: string, state?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

function buildCodeRedirect(redirectUri: string, code: string, state?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

interface StoredConsent {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  tenantDomain: string;
  marketId: string;
  expiresAt: number;
}

function generateConsentToken(): string {
  // 32 random bytes, base64url-encoded → unguessable per-session CSRF token
  return crypto.randomBytes(32).toString("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function renderConsentPage(params: {
  client: { id: string; name: string; logoUrl: string | null; description: string | null };
  scopes: string[];
  state: string;
  user: { name: string; email: string };
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  consentToken: string;
}) {
  const scopeList = params.scopes
    .map((s) => {
      const label = (PARTNER_API_SCOPE_LABELS as Record<string, string>)[s] || s;
      return `<li><code>${escapeHtml(s)}</code> — ${escapeHtml(label)}</li>`;
    })
    .join("");
  const denyUrl = buildErrorRedirect(params.redirectUri, "access_denied", "User denied consent", params.state);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Authorize ${escapeHtml(params.client.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark light; }
  body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; margin: 0; background:#0a0a0a; color:#f3f3f3; }
  .card { max-width: 480px; margin: 64px auto; background:#111; border:1px solid #2a2a2a; border-radius:12px; padding:32px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#aaa; line-height:1.5; }
  .client { display:flex; gap:12px; align-items:center; margin: 16px 0 24px; }
  .client img { width:48px; height:48px; border-radius:8px; background:#222; }
  ul { padding-left:20px; }
  ul li { margin: 6px 0; color:#ddd; }
  code { background:#222; padding:2px 6px; border-radius:4px; font-size:12px; }
  .actions { display:flex; gap:12px; margin-top:24px; }
  button, a.btn { flex:1; padding:10px 16px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff; cursor:pointer; font-size:14px; text-align:center; text-decoration:none; }
  button.primary { background:#3b82f6; border-color:#3b82f6; }
  .user { font-size:12px; color:#888; margin-top:16px; border-top:1px solid #222; padding-top:12px; }
</style></head>
<body>
<div class="card">
  <div class="client">
    ${params.client.logoUrl ? `<img src="${escapeHtml(params.client.logoUrl)}" alt="" />` : `<div style="width:48px;height:48px;border-radius:8px;background:#222"></div>`}
    <div>
      <h1>${escapeHtml(params.client.name)} wants access to your Orbit account</h1>
      ${params.client.description ? `<p style="margin:4px 0 0">${escapeHtml(params.client.description)}</p>` : ""}
    </div>
  </div>
  <p>This app is requesting permission to:</p>
  <ul>${scopeList}</ul>
  <form method="POST" action="/oauth/authorize" data-testid="form-oauth-consent">
    <input type="hidden" name="consent_token" value="${escapeHtml(params.consentToken)}" />
    <div class="actions">
      <a class="btn" href="${escapeHtml(denyUrl)}" data-testid="link-oauth-deny">Cancel</a>
      <button type="submit" name="approve" value="1" class="primary" data-testid="button-oauth-approve">Allow</button>
    </div>
  </form>
  <div class="user">Signed in as ${escapeHtml(params.user.name)} (${escapeHtml(params.user.email)})</div>
</div>
</body></html>`;
}

function getOrigin(req: Request) {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers.host || "localhost";
  return `${proto}://${host}`;
}

/**
 * CORS for the public OAuth endpoints (`/oauth/token`, `/oauth/revoke`,
 * `/oauth/userinfo`) and the well-known metadata. Bearer-token auth — not
 * cookies — secures these endpoints, so allowing any origin is safe and
 * required for browser-based PKCE / public clients.
 */
function applyOAuthCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin as string | undefined;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  else res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function registerOAuthProviderRoutes(app: Express) {
  // CORS preflight + headers for public OAuth endpoints
  app.use(["/oauth/token", "/oauth/revoke", "/oauth/userinfo", "/.well-known/oauth-authorization-server"], (req, res, next) => {
    if (applyOAuthCors(req, res)) return;
    next();
  });

  // ────────── /.well-known/oauth-authorization-server ──────────
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const origin = getOrigin(req);
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      userinfo_endpoint: `${origin}/oauth/userinfo`,
      scopes_supported: PARTNER_API_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    });
  });

  // ────────── GET /oauth/authorize — consent screen ──────────
  app.get("/oauth/authorize", async (req: Request, res: Response) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query as Record<string, string | undefined>;

    if (!client_id || !redirect_uri || !response_type || !code_challenge) {
      return res.status(400).send("Missing required OAuth parameters");
    }
    if (response_type !== "code") {
      return res.status(400).send("Unsupported response_type (must be 'code')");
    }
    if (code_challenge_method && code_challenge_method !== "S256") {
      return res.status(400).send("Unsupported code_challenge_method (must be 'S256')");
    }

    const client = await getClientById(client_id);
    if (!client || client.status !== "active") {
      return res.status(400).send("Unknown or disabled client");
    }
    if (!(client.redirectUris || []).includes(redirect_uri)) {
      return res.status(400).send("redirect_uri not registered for this client");
    }

    if (!req.session?.userId) {
      const back = encodeURIComponent(req.originalUrl);
      return res.redirect(`/auth/signin?next=${back}`);
    }

    let ctx;
    try {
      ctx = await getRequestContext(req);
    } catch (err: any) {
      const back = encodeURIComponent(req.originalUrl);
      return res.redirect(`/auth/signin?next=${back}`);
    }

    // Plan gate: partnerApi requires Enterprise/Unlimited
    const tenant = await storage.getTenantByDomain(ctx.tenantDomain);
    const plan = tenant?.plan ?? "free";
    const { checkFeatureAccessAsync } = await import("../services/plan-policy");
    const gate = await checkFeatureAccessAsync(plan, "partnerApi");
    if (!gate.allowed) {
      return res
        .status(403)
        .send(
          `<h1>Partner API not available on your plan</h1><p>${escapeHtml(gate.reason || "Upgrade to Enterprise to use third-party integrations.")}</p>`
        );
    }

    const requestedScopes = parseScopeString(scope);
    if (requestedScopes.length === 0) {
      return res.redirect(buildErrorRedirect(redirect_uri, "invalid_scope", "No scopes requested", state));
    }
    const unknown = requestedScopes.filter((s) => !isValidScope(s));
    if (unknown.length > 0) {
      return res.redirect(buildErrorRedirect(redirect_uri, "invalid_scope", `Unknown scope(s): ${unknown.join(", ")}`, state));
    }
    const disallowed = requestedScopes.filter((s) => !(client.allowedScopes || []).includes(s));
    if (disallowed.length > 0) {
      return res.redirect(buildErrorRedirect(redirect_uri, "invalid_scope", `Scope(s) not allowed for this client: ${disallowed.join(", ")}`, state));
    }
    const allowed = requestedScopes;

    const user = await storage.getUser(ctx.userId);
    if (!user) return res.status(401).send("User not found");

    // CSRF / consent binding: server-issued one-time consent token kept in
    // session. The POST handler validates the submitted parameters against
    // this stored payload, so an attacker cannot forge a consent submission.
    const consentToken = generateConsentToken();
    if (!req.session) {
      return res.status(500).send("Session not available");
    }
    const sess = req.session as typeof req.session & {
      oauthConsents?: Record<string, StoredConsent>;
    };
    sess.oauthConsents = sess.oauthConsents || {};
    // Drop any consents older than 10 min before storing a new one.
    const now = Date.now();
    for (const [k, v] of Object.entries(sess.oauthConsents)) {
      if (v.expiresAt < now) delete sess.oauthConsents[k];
    }
    sess.oauthConsents[consentToken] = {
      clientId: client.id,
      redirectUri: redirect_uri,
      scopes: allowed,
      state: state || "",
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || "S256",
      userId: ctx.userId,
      tenantDomain: ctx.tenantDomain,
      marketId: ctx.marketId,
      expiresAt: now + 10 * 60 * 1000,
    };

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderConsentPage({
        client: {
          id: client.id,
          name: client.name,
          logoUrl: client.logoUrl,
          description: client.description,
        },
        scopes: allowed,
        state: state || "",
        user: { name: user.name, email: user.email },
        redirectUri: redirect_uri,
        responseType: response_type,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || "S256",
        consentToken,
      })
    );
  });

  // ────────── POST /oauth/authorize — consent submission ──────────
  app.post("/oauth/authorize", async (req: Request, res: Response) => {
    const { consent_token, approve } = req.body as Record<string, string | undefined>;
    if (!consent_token) {
      return res.status(400).send("Missing consent token");
    }
    if (!req.session) {
      return res.status(401).send("Session expired — please re-authorize");
    }

    // The session must have an active user to redeem a consent token.
    let ctx;
    try {
      ctx = await getRequestContext(req);
    } catch {
      return res.status(401).send("Not authenticated");
    }

    const sess = req.session as typeof req.session & {
      oauthConsents?: Record<string, StoredConsent>;
    };
    const consents = sess.oauthConsents || {};
    // Constant-time match against any stored token to avoid leaking which
    // token slot existed via timing differences.
    let matched: StoredConsent | undefined;
    let matchedKey: string | undefined;
    for (const [k, v] of Object.entries(consents)) {
      if (timingSafeStringEqual(k, consent_token)) {
        matched = v;
        matchedKey = k;
      }
    }
    if (!matched || !matchedKey) {
      return res.status(403).send("Invalid or expired consent token (CSRF protection)");
    }
    // Single-use: drop the token immediately so the same form post cannot be
    // replayed by another tab / attacker.
    delete consents[matchedKey];
    sess.oauthConsents = consents;

    if (matched.expiresAt < Date.now()) {
      return res.status(403).send("Consent expired — please re-authorize");
    }
    // The consent must belong to the currently authenticated user (defense
    // in depth: prevents one user from completing another user's consent).
    if (matched.userId !== ctx.userId) {
      return res.status(403).send("Consent does not match the signed-in user");
    }

    // If the user clicked Cancel/Deny we end here with access_denied.
    if (!approve) {
      return res.redirect(
        buildErrorRedirect(matched.redirectUri, "access_denied", "User denied consent", matched.state)
      );
    }

    const client = await getClientById(matched.clientId);
    if (!client || client.status !== "active") return res.status(400).send("Unknown client");

    const { code } = await createAuthorizationCode({
      clientId: client.id,
      userId: matched.userId,
      tenantDomain: matched.tenantDomain,
      marketId: matched.marketId || null,
      redirectUri: matched.redirectUri,
      scopes: matched.scopes,
      codeChallenge: matched.codeChallenge,
      codeChallengeMethod: matched.codeChallengeMethod,
    });

    return res.redirect(buildCodeRedirect(matched.redirectUri, code, matched.state));
  });

  // ────────── POST /oauth/token ──────────
  app.post("/oauth/token", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");

    const params = req.body as Record<string, string | undefined>;
    const grantType = params.grant_type;

    if (grantType === "authorization_code") {
      const { code, redirect_uri, client_id, code_verifier, client_secret } = params;
      if (!code || !redirect_uri || !client_id || !code_verifier) {
        return res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
      }
      const client = await getClientById(client_id);
      if (!client || client.status !== "active") {
        return res.status(401).json({ error: "invalid_client", error_description: "Unknown client" });
      }
      // If confidential client, verify secret
      if (client.clientSecretHash) {
        if (!client_secret || hashClientSecret(client_secret) !== client.clientSecretHash) {
          return res.status(401).json({ error: "invalid_client", error_description: "Invalid client_secret" });
        }
      }
      const lookup = await lookupAuthorizationCode(code);
      if ("error" in lookup) {
        return res.status(400).json({ error: lookup.error, error_description: lookup.message });
      }
      const codeRow = lookup.row;
      if (codeRow.clientId !== client.id) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Client mismatch" });
      }
      if (codeRow.redirectUri !== redirect_uri) {
        return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
      }
      if (codeRow.codeChallengeMethod !== "S256") {
        return res.status(400).json({ error: "invalid_grant", error_description: "Unsupported PKCE method" });
      }
      if (!verifyPkceS256(code_verifier, codeRow.codeChallenge)) {
        return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      }
      // All validations passed → atomically mark code used (single-use guard).
      const claimed = await markAuthorizationCodeUsed(codeRow.id);
      if (!claimed) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Authorization code already used" });
      }
      const pair = await issueTokenPair({
        clientId: client.id,
        userId: codeRow.userId,
        tenantDomain: codeRow.tenantDomain,
        marketId: codeRow.marketId ?? null,
        scopes: codeRow.scopes || [],
      });
      return res.json({
        access_token: pair.accessToken,
        token_type: "Bearer",
        expires_in: pair.expiresIn,
        refresh_token: pair.refreshToken,
        scope: pair.scopes.join(" "),
      });
    }

    if (grantType === "refresh_token") {
      const { refresh_token, client_id, client_secret } = params;
      if (!refresh_token || !client_id) {
        return res.status(400).json({ error: "invalid_request", error_description: "Missing parameters" });
      }
      const client = await getClientById(client_id);
      if (!client || client.status !== "active") {
        return res.status(401).json({ error: "invalid_client" });
      }
      if (client.clientSecretHash) {
        if (!client_secret || hashClientSecret(client_secret) !== client.clientSecretHash) {
          return res.status(401).json({ error: "invalid_client", error_description: "Invalid client_secret" });
        }
      }
      const result = await rotateRefreshToken(refresh_token, client.id);
      if ("error" in result) {
        return res.status(400).json({ error: result.error, error_description: result.message });
      }
      const pair = result.pair;
      return res.json({
        access_token: pair.accessToken,
        token_type: "Bearer",
        expires_in: pair.expiresIn,
        refresh_token: pair.refreshToken,
        scope: pair.scopes.join(" "),
      });
    }

    return res.status(400).json({ error: "unsupported_grant_type" });
  });

  // ────────── POST /oauth/revoke ──────────
  app.post("/oauth/revoke", async (req: Request, res: Response) => {
    const { token } = req.body as Record<string, string | undefined>;
    if (!token) return res.status(400).json({ error: "invalid_request" });
    await revokeToken(token);
    res.status(200).json({ revoked: true });
  });

  // ────────── GET /oauth/userinfo ──────────
  app.get("/oauth/userinfo", async (req: Request, res: Response) => {
    try {
      const ctx = await getRequestContext(req);
      if (!ctx.isPartnerApi) {
        return res.status(401).json({ error: "invalid_token", error_description: "Bearer token required" });
      }
      const user = await storage.getUser(ctx.userId);
      if (!user) return res.status(401).json({ error: "invalid_token" });
      return res.json({
        sub: user.id,
        name: user.name,
        email: user.email,
        tenant_domain: ctx.tenantDomain,
        scopes: ctx.tokenScopes || [],
      });
    } catch (err: any) {
      const status = err instanceof ContextError ? err.status : 401;
      return res.status(status).json({ error: "invalid_token", error_description: err.message });
    }
  });
}
