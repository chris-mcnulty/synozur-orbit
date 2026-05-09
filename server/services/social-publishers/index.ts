/**
 * SocialPublisher interface — Task #97
 *
 * One implementation per platform. The marketing publish worker calls
 * `publish()` for an approved+scheduled GeneratedPost; on success the post
 * is marked `published` with the returned `publishedUrl`, on failure it is
 * marked `publish_failed` with the error message and the SocialPublisher
 * implementation is responsible for logging a `social_publish_attempts` row.
 *
 * `getOAuthAuthorizeUrl()` and `exchangeOAuthCode()` are used by the
 * `/api/social-accounts/:id/oauth/connect` and `/oauth/callback` routes to
 * complete the connect flow. Platforms that do not support OAuth (e.g.
 * stubbed Bluesky) return null and rely on manual API key entry.
 */

import type { SocialAccount, GeneratedPost } from "@shared/schema";
import { LinkedInPublisher } from "./linkedin";
import { TwitterPublisher } from "./twitter";
import { BlueskyPublisher } from "./bluesky";
import { FacebookPublisher } from "./facebook";
import { InstagramPublisher } from "./instagram";

export interface PublishContext {
  account: SocialAccount;
  post: GeneratedPost;
  attemptedBy?: string | null;
}

export interface PublishResult {
  success: boolean;
  publishedUrl?: string | null;
  errorCode?: string;
  errorMessage?: string;
  responsePayload?: unknown;
  /** When platform issued a refreshed access token, persist these fields. */
  refreshedAccessToken?: string | null;
  refreshedRefreshToken?: string | null;
  refreshedTokenExpiresAt?: Date | null;
}

export interface OAuthAuthorizeRequest {
  redirectUri: string;
  state: string;
  /** Optional override for the publisher's default scope set. */
  scope?: string;
}

export interface OAuthAuthorizeResult {
  url: string;
  /** PKCE code_verifier — caller must persist alongside the state and pass
   *  it back to exchangeOAuthCode. Omitted when the flow doesn't use PKCE. */
  codeVerifier?: string;
}

export interface AuthorIdentity {
  mode: "person" | "organization";
  urn: string;
  name: string;
  vanityName?: string | null;
}

export interface OAuthCallbackResult {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
  authorMode: "person" | "organization";
  authorUrn: string;
  accountName?: string | null;
  profileUrl?: string | null;
  accountId?: string | null;
  /** All author identities the user can publish as (personal + admin orgs). */
  availableAuthors?: AuthorIdentity[];
}

export interface SocialPublisher {
  platform: string;
  /** Whether direct publishing is implemented; stubs return false. */
  supported: boolean;
  /** Whether OAuth credentials (client id/secret) are configured. */
  oauthConfigured(): boolean;
  /** May return either a plain URL string (legacy) or an object including
   *  a codeVerifier for PKCE flows (Twitter/X). The route layer normalises
   *  both shapes. */
  getOAuthAuthorizeUrl?(req: OAuthAuthorizeRequest): string | OAuthAuthorizeResult;
  exchangeOAuthCode?(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<OAuthCallbackResult>;
  publish(ctx: PublishContext): Promise<PublishResult>;
}

const linkedinPublisher = new LinkedInPublisher();
const twitterPublisher = new TwitterPublisher();
const blueskyPublisher = new BlueskyPublisher();
const facebookPublisher = new FacebookPublisher();
const instagramPublisher = new InstagramPublisher();

const PUBLISHERS: Record<string, SocialPublisher> = {
  linkedin: linkedinPublisher,
  twitter: twitterPublisher,
  bluesky: blueskyPublisher,
  facebook: facebookPublisher,
  instagram: instagramPublisher,
};

export function getPublisher(platform: string): SocialPublisher | null {
  return PUBLISHERS[platform.toLowerCase()] ?? null;
}

export function listPublishers(): SocialPublisher[] {
  return Object.values(PUBLISHERS);
}
