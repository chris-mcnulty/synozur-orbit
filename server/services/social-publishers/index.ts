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
  getOAuthAuthorizeUrl?(req: OAuthAuthorizeRequest): string;
  exchangeOAuthCode?(code: string, redirectUri: string): Promise<OAuthCallbackResult>;
  publish(ctx: PublishContext): Promise<PublishResult>;
}

const linkedinPublisher = new LinkedInPublisher();

const PUBLISHERS: Record<string, SocialPublisher> = {
  linkedin: linkedinPublisher,
  // Stubs — keep type-safe so the rest of the system can tolerate any platform
  // value persisted today; they always return `supported: false` so the worker
  // skips them and the UI shows "Export instead".
  twitter: makeStubPublisher("twitter"),
  instagram: makeStubPublisher("instagram"),
  facebook: makeStubPublisher("facebook"),
  bluesky: makeStubPublisher("bluesky"),
};

function makeStubPublisher(platform: string): SocialPublisher {
  return {
    platform,
    supported: false,
    oauthConfigured: () => false,
    async publish() {
      return {
        success: false,
        errorCode: "platform_unsupported",
        errorMessage: `${platform} direct publishing is not yet supported — please export to CSV and upload manually.`,
      };
    },
  };
}

export function getPublisher(platform: string): SocialPublisher | null {
  return PUBLISHERS[platform.toLowerCase()] ?? null;
}

export function listPublishers(): SocialPublisher[] {
  return Object.values(PUBLISHERS);
}
