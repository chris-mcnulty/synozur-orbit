import * as msal from "@azure/msal-node";

const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID || "";
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET || "";
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID || "common";

const getRedirectUri = () => {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/entra/callback`;
  }
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/api/auth/entra/callback`;
  }
  return "http://localhost:5000/api/auth/entra/callback";
};

export const msalConfig: msal.Configuration = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
    clientSecret: ENTRA_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message) {
        if (process.env.NODE_ENV === "development") {
          console.log("[MSAL]", message);
        }
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Warning,
    },
  },
};

export const REDIRECT_URI = getRedirectUri();
export const SCOPES = ["user.read", "openid", "profile", "email"];

export const isEntraConfigured = () => {
  return Boolean(ENTRA_CLIENT_ID && ENTRA_CLIENT_SECRET);
};

let msalInstance: msal.ConfidentialClientApplication | null = null;

export const getMsalInstance = () => {
  if (!isEntraConfigured()) {
    return null;
  }
  if (!msalInstance) {
    msalInstance = new msal.ConfidentialClientApplication(msalConfig);
  }
  return msalInstance;
};
