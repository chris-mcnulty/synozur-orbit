/**
 * LinkedInPublisher — Task #97 + multi-tenant credentials refactor
 *
 * Implements direct publishing to LinkedIn via the UGC Posts API and the
 * standard 3-legged OAuth code flow. Tenants supply their own LinkedIn
 * client_id + client_secret via the tenant-credentials UI; env vars are
 * not consulted (this is a multi-tenant deployment and tenant admins can't
 * set environment variables).
 *
 * Required scopes: `openid profile email w_member_social`,
 * plus `w_organization_social rw_organization_admin` for company pages.
 */

import type {
  SocialPublisher,
  PublishContext,
  PublishResult,
  OAuthAuthorizeRequest,
  OAuthCallbackResult,
} from "./index";
import { decryptSecret } from "../../utils/encryption";
import { getPlatformCredentials } from "../platform-credentials-service";

const AUTH_HOST = "https://www.linkedin.com";
const API_HOST = "https://api.linkedin.com";
const DEFAULT_SCOPE = "openid profile email w_member_social w_organization_social rw_organization_admin";

export class LinkedInPublisher implements SocialPublisher {
  platform = "linkedin";
  supported = true;

  async oauthConfigured(tenantDomain: string): Promise<boolean> {
    const creds = await getPlatformCredentials(tenantDomain, "linkedin");
    return !!(creds?.clientId && creds.clientSecret);
  }

  async getOAuthAuthorizeUrl(req: OAuthAuthorizeRequest): Promise<string> {
    const creds = await getPlatformCredentials(req.tenantDomain, "linkedin");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error("LinkedIn OAuth is not configured for this tenant. Configure your LinkedIn client_id and client_secret in Tenant → Platform Credentials.");
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: req.redirectUri,
      state: req.state,
      scope: req.scope ?? DEFAULT_SCOPE,
    });
    return `${AUTH_HOST}/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
    options: { tenantDomain: string },
  ): Promise<OAuthCallbackResult> {
    const creds = await getPlatformCredentials(options.tenantDomain, "linkedin");
    if (!creds?.clientId || !creds.clientSecret) {
      throw new Error("LinkedIn OAuth is not configured for this tenant.");
    }
    const tokenResp = await fetch(`${AUTH_HOST}/oauth/v2/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }).toString(),
    });
    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => "");
      throw new Error(`LinkedIn token exchange failed: ${tokenResp.status} ${txt}`);
    }
    const tok = await tokenResp.json() as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };

    // Fetch /v2/userinfo (OIDC) to get the member sub (URN id) and display name.
    const userResp = await fetch(`${API_HOST}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!userResp.ok) {
      const txt = await userResp.text().catch(() => "");
      throw new Error(`LinkedIn userinfo failed: ${userResp.status} ${txt}`);
    }
    const userinfo = await userResp.json() as {
      sub: string; name?: string; email?: string; picture?: string;
    };

    const expiresAt = tok.expires_in
      ? new Date(Date.now() + tok.expires_in * 1000)
      : null;

    // Best-effort: fetch organizations the user can administer so we can
    // surface them as alternate author identities (company-page publishing).
    // Failure is non-fatal — personal posting still works.
    const availableAuthors: Array<{
      mode: "person" | "organization";
      urn: string;
      name: string;
      vanityName?: string | null;
    }> = [{
      mode: "person",
      urn: `urn:li:person:${userinfo.sub}`,
      name: userinfo.name ?? "Personal account",
    }];
    try {
      const orgs = await this.fetchAdminOrganizations(tok.access_token);
      for (const o of orgs) availableAuthors.push(o);
    } catch (err: any) {
      console.warn("[LinkedIn] organizationAcls fetch failed:", err?.message || err);
    }

    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt,
      scope: tok.scope ?? null,
      authorMode: "person",
      authorUrn: `urn:li:person:${userinfo.sub}`,
      accountName: userinfo.name ?? null,
      profileUrl: null,
      accountId: userinfo.sub,
      availableAuthors,
    };
  }

  /**
   * Fetch organizations the user has ADMINISTRATOR role on. Returns empty
   * list if the token lacks rw_organization_admin scope or the request
   * fails — callers treat orgs as best-effort, personal posting still works.
   */
  async fetchAdminOrganizations(accessToken: string): Promise<Array<{
    mode: "organization";
    urn: string;
    name: string;
    vanityName?: string | null;
  }>> {
    const url = `${API_HOST}/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName,vanityName)))`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!resp.ok) return [];
    const json = await resp.json().catch(() => null) as any;
    const elements: any[] = Array.isArray(json?.elements) ? json.elements : [];
    const out: Array<{ mode: "organization"; urn: string; name: string; vanityName?: string | null }> = [];
    for (const el of elements) {
      const org = el?.["organization~"];
      const id = org?.id;
      if (!id) continue;
      out.push({
        mode: "organization",
        urn: `urn:li:organization:${id}`,
        name: org.localizedName || `Organization ${id}`,
        vanityName: org.vanityName ?? null,
      });
    }
    return out;
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, post } = ctx;
    if (!account.encryptedAccessToken) {
      return {
        success: false,
        errorCode: "not_connected",
        errorMessage: "LinkedIn account is not connected — re-authorize before publishing.",
      };
    }
    if (!account.authorUrn) {
      return {
        success: false,
        errorCode: "missing_author",
        errorMessage: "LinkedIn account is missing author URN — reconnect to refresh identity.",
      };
    }
    let accessToken: string;
    try {
      accessToken = decryptSecret(account.encryptedAccessToken);
    } catch (err) {
      return {
        success: false,
        errorCode: "token_decrypt_failed",
        errorMessage: "Stored LinkedIn token could not be decrypted — reconnect the account.",
      };
    }
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
      return {
        success: false,
        errorCode: "token_expired",
        errorMessage: "LinkedIn token expired — reconnect the account.",
      };
    }

    const text = post.editedContent || post.content;
    const hashtags = (post.hashtags as string[] | null) ?? [];
    const finalText = hashtags.length > 0
      ? `${text}\n\n${hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ")}`
      : text;

    const body = {
      author: account.authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: finalText },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const resp = await fetch(`${API_HOST}/v2/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(errText); } catch {}
      return {
        success: false,
        errorCode: parsed?.serviceErrorCode ? String(parsed.serviceErrorCode) : `http_${resp.status}`,
        errorMessage: parsed?.message || errText || `LinkedIn UGC post failed: ${resp.status}`,
        responsePayload: parsed ?? errText,
      };
    }

    // LinkedIn returns the new URN in the `x-restli-id` header (URL-encoded)
    // or in the response body as { id }. Both are URNs we can convert into a
    // public feed URL.
    const headerUrn = resp.headers.get("x-restli-id");
    let createdUrn: string | null = null;
    let payload: any = null;
    try {
      payload = await resp.json();
      if (payload?.id) createdUrn = payload.id as string;
    } catch {}
    if (!createdUrn && headerUrn) createdUrn = decodeURIComponent(headerUrn);

    const publishedUrl = createdUrn
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(createdUrn)}/`
      : null;

    return {
      success: true,
      publishedUrl,
      responsePayload: payload ?? { urn: createdUrn },
    };
  }
}
