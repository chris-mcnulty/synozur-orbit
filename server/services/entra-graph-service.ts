import { getMsalClientCredentialsInstance, isGraphApiConfigured } from "../auth/msal-config";

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

async function getGraphAccessToken(): Promise<string | null> {
  const msalInstance = getMsalClientCredentialsInstance();
  if (!msalInstance) {
    console.error("MSAL client credentials not configured - requires ENTRA_TENANT_ID");
    return null;
  }

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
  tenantId?: string
): Promise<EntraSearchResult> {
  if (!isGraphApiConfigured()) {
    return { users: [], error: "Microsoft Graph API is not configured. ENTRA_TENANT_ID is required to search users." };
  }

  const accessToken = await getGraphAccessToken();
  if (!accessToken) {
    return { users: [], error: "Failed to authenticate with Microsoft Graph" };
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

export async function getEntraUser(userId: string): Promise<EntraUser | null> {
  if (!isGraphApiConfigured()) {
    return null;
  }

  const accessToken = await getGraphAccessToken();
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

export { isGraphApiConfigured };
