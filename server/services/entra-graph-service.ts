import * as msal from "@azure/msal-node";

interface EntraUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
}

interface EntraSearchResult {
  users: EntraUser[];
  error?: string;
}

// Check if the base Entra credentials (client ID and secret) are configured
// The tenant-specific Azure Tenant ID comes from the database
export function isGraphApiConfigured(): boolean {
  return Boolean(
    process.env.ENTRA_CLIENT_ID && 
    process.env.ENTRA_CLIENT_SECRET
  );
}

// Get access token for a specific Azure tenant
async function getGraphAccessToken(azureTenantId: string): Promise<string | null> {
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.error("MSAL client credentials not configured - requires ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET");
    return null;
  }

  if (!azureTenantId) {
    console.error("Azure Tenant ID is required for Graph API calls");
    return null;
  }

  const authority = `https://login.microsoftonline.com/${azureTenantId}`;
  console.log("[Graph API] Acquiring token for tenant:", azureTenantId);

  const msalConfig: msal.Configuration = {
    auth: {
      clientId,
      authority,
      clientSecret,
    },
    system: {
      loggerOptions: {
        loggerCallback(loglevel, message) {
          if (process.env.NODE_ENV === "development") {
            console.log("[MSAL-Graph]", message);
          }
        },
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Warning,
      },
    },
  };

  const msalInstance = new msal.ConfidentialClientApplication(msalConfig);

  try {
    const result = await msalInstance.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
    return result?.accessToken || null;
  } catch (error: any) {
    console.error("Failed to acquire Graph API token:", error.message);
    return null;
  }
}

export async function searchEntraUsers(
  searchQuery: string,
  azureTenantId: string
): Promise<EntraSearchResult> {
  if (!isGraphApiConfigured()) {
    return { users: [], error: "Microsoft Graph API is not configured. ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET are required." };
  }

  if (!azureTenantId) {
    return { users: [], error: "Azure Tenant ID is not configured for this organization. Please contact your administrator." };
  }

  const accessToken = await getGraphAccessToken(azureTenantId);
  if (!accessToken) {
    return { users: [], error: "Failed to authenticate with Microsoft Graph. Please verify your organization's Azure configuration." };
  }

  try {
    const encodedQuery = encodeURIComponent(searchQuery);
    const filterQuery = `startswith(displayName,'${searchQuery}') or startswith(mail,'${searchQuery}') or startswith(userPrincipalName,'${searchQuery}')`;
    
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filterQuery)}&$top=10&$select=id,displayName,mail,userPrincipalName,jobTitle,department`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Graph API error:", response.status, errorData);
      return { 
        users: [], 
        error: `Microsoft Graph API error: ${response.status}` 
      };
    }

    const data = await response.json();
    const users: EntraUser[] = (data.value || []).map((user: any) => ({
      id: user.id,
      displayName: user.displayName || "",
      mail: user.mail || null,
      userPrincipalName: user.userPrincipalName || "",
      jobTitle: user.jobTitle || null,
      department: user.department || null,
    }));

    return { users };
  } catch (error: any) {
    console.error("Failed to search Entra users:", error.message);
    return { users: [], error: error.message };
  }
}

export async function getEntraUser(userId: string, azureTenantId: string): Promise<EntraUser | null> {
  if (!isGraphApiConfigured() || !azureTenantId) {
    return null;
  }

  const accessToken = await getGraphAccessToken(azureTenantId);
  if (!accessToken) {
    return null;
  }

  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userId}?$select=id,displayName,mail,userPrincipalName,jobTitle,department`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const user = await response.json();
    return {
      id: user.id,
      displayName: user.displayName || "",
      mail: user.mail || null,
      userPrincipalName: user.userPrincipalName || "",
      jobTitle: user.jobTitle || null,
      department: user.department || null,
    };
  } catch (error: any) {
    console.error("Failed to get Entra user:", error.message);
    return null;
  }
}
