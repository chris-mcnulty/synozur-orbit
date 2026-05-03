export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const GOOGLE_SCOPES = ["openid", "email", "profile"];

export const isGoogleConfigured = () =>
  Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);

export const getGoogleClientId = () => process.env.GOOGLE_OAUTH_CLIENT_ID || "";
export const getGoogleClientSecret = () => process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

export function getGoogleRedirectUri(): string {
  if (process.env.PRODUCTION_URL) {
    return `${process.env.PRODUCTION_URL}/api/auth/google/callback`;
  }
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}/api/auth/google/callback`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/google/callback`;
  }
  return "http://localhost:5000/api/auth/google/callback";
}
