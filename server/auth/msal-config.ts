import * as msal from "@azure/msal-node";

const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID || "";
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET || "";
const ENTRA_TENANT_ID = process.env.ENTRA_TENANT_ID || "";

// Log config status on startup (without revealing secrets)
if (process.env.NODE_ENV === "development") {
  console.log("[MSAL Config] Client ID configured:", !!ENTRA_CLIENT_ID);
  console.log("[MSAL Config] Client Secret configured:", !!ENTRA_CLIENT_SECRET);
  console.log("[MSAL Config] Tenant ID configured:", !!ENTRA_TENANT_ID);
}

const getRedirectUri = () => {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/entra/callback`;
  }
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/api/auth/entra/callback`;
  }
  return "http://localhost:5000/api/auth/entra/callback";
};

// For user login, we can use "common" to allow any tenant
// For Graph API (client credentials), we need a specific tenant
const getAuthority = (forClientCredentials: boolean = false) => {
  if (forClientCredentials && ENTRA_TENANT_ID) {
    return `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`;
  }
  // For user auth, "common" allows any tenant to sign in
  return `https://login.microsoftonline.com/${ENTRA_TENANT_ID || "common"}`;
};

export const msalConfig: msal.Configuration = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: getAuthority(false),
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

// Check if Graph API (client credentials) is properly configured
// Requires a specific tenant ID, not "common"
export const isGraphApiConfigured = () => {
  return Boolean(ENTRA_CLIENT_ID && ENTRA_CLIENT_SECRET && ENTRA_TENANT_ID);
};

let msalInstance: msal.ConfidentialClientApplication | null = null;
let msalClientCredentialsInstance: msal.ConfidentialClientApplication | null = null;

export const getMsalInstance = () => {
  if (!isEntraConfigured()) {
    return null;
  }
  if (!msalInstance) {
    msalInstance = new msal.ConfidentialClientApplication(msalConfig);
  }
  return msalInstance;
};

// Separate instance for client credentials (Graph API calls)
// Must use specific tenant, not "common"
export const getMsalClientCredentialsInstance = () => {
  if (!isGraphApiConfigured()) {
    console.error("[MSAL] Graph API not configured - ENTRA_TENANT_ID is required for client credentials flow");
    return null;
  }
  if (!msalClientCredentialsInstance) {
    const clientCredentialsConfig: msal.Configuration = {
      auth: {
        clientId: ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
        clientSecret: ENTRA_CLIENT_SECRET,
      },
      system: msalConfig.system,
    };
    msalClientCredentialsInstance = new msal.ConfidentialClientApplication(clientCredentialsConfig);
  }
  return msalClientCredentialsInstance;
};
