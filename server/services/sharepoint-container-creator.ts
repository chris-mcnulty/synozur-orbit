/**
 * SharePoint Embedded Container Creator for Synozur Orbit
 *
 * Creates and manages SharePoint Embedded (SPE) containers using Orbit's
 * dedicated container type.  Each tenant that enables SPE gets its own
 * container so documents are fully isolated.
 *
 * Container type lifecycle (one-time, done by an Azure Global Admin):
 *   1. Register the container type in the owning app registration via
 *      Azure Portal → App Registration → SharePoint Embedded.
 *   2. Set ORBIT_SPE_CONTAINER_TYPE_ID in environment variables.
 *   3. Call registerContainerTypeInTenant() once per consuming tenant.
 *
 * Adapted from Constellation (synozur-scdp) container-creator.ts.
 */

import * as msal from "@azure/msal-node";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContainerCreationResult {
  success: boolean;
  message: string;
  containerId?: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// ContainerCreator
// ---------------------------------------------------------------------------

export class ContainerCreator {
  /**
   * The Orbit-specific SharePoint Embedded container type ID.
   * This must be registered in the Azure App Registration for Synozur Orbit.
   * It is intentionally DIFFERENT from Constellation's container type.
   *
   * Set ORBIT_SPE_CONTAINER_TYPE_ID in your environment. This value is
   * required; an explicit error is thrown if it is missing so that
   * misconfiguration is detected early.
   */
  private get containerTypeId(): string {
    const value = process.env.ORBIT_SPE_CONTAINER_TYPE_ID;
    if (!value) {
      throw new Error(
        "ORBIT_SPE_CONTAINER_TYPE_ID environment variable is not set. " +
          "Configure the SharePoint Embedded container type ID before using ContainerCreator."
      );
    }
    return value;
  }

  private readonly graphBaseUrl = "https://graph.microsoft.com/v1.0";
  private readonly graphBetaUrl = "https://graph.microsoft.com/beta";

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create a new SharePoint Embedded container for a tenant.
   *
   * Steps:
   *   1. Register the container type in the consuming tenant (required before creating containers)
   *   2. POST to /storage/fileStorage/containers
   *   3. Grant the Orbit app owner permissions on the new container
   */
  async createContainer(
    containerName: string,
    description?: string,
    azureTenantId?: string,
    ownerUserPrincipalName?: string
  ): Promise<ContainerCreationResult> {
    console.log(
      "[OrbitContainerCreator] Creating container:",
      containerName,
      azureTenantId ? `(tenant: ${azureTenantId})` : "(default tenant)"
    );

    try {
      const token = await this.getGraphAccessToken(azureTenantId);

      const regResult = await this.registerContainerTypeInTenant(azureTenantId);
      console.log("[OrbitContainerCreator] Container type registration:", regResult.success ? "OK" : regResult.message);
      if (!regResult.success) {
        console.warn("[OrbitContainerCreator] Container type registration failed (continuing anyway):", regResult.message);
      }

      const payload = {
        displayName: containerName,
        description: description || `Synozur Orbit document storage for ${containerName}`,
        containerTypeId: this.containerTypeId,
      };

      console.log("[OrbitContainerCreator] Creating container with payload:", JSON.stringify(payload));

      const createUrl = `${this.graphBetaUrl}/storage/fileStorage/containers`;
      console.log("[OrbitContainerCreator] POST", createUrl);
      const response = await fetch(
        createUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorCode = "";
        try {
          const errData = JSON.parse(errorText);
          if (errData.error) {
            errorMessage = errData.error.message || errorMessage;
            errorCode = errData.error.code || "";
          }
        } catch {
          errorMessage += ` — ${errorText}`;
        }
        console.error("[OrbitContainerCreator] Container creation failed:", {
          status: response.status,
          errorCode,
          containerTypeId: this.containerTypeId,
          tenant: azureTenantId || process.env.ENTRA_TENANT_ID,
          error: errorText,
        });

        if (response.status === 403) {
          const hint = "This may indicate the container type (ID: " + this.containerTypeId + ") " +
            "is not properly registered in the Azure app registration under SharePoint Embedded, " +
            "or the container type registration in the consuming tenant has not completed. " +
            "Verify: 1) The container type exists in Azure Portal > App Registrations > SharePoint Embedded, " +
            "2) The container type ID matches ORBIT_SPE_CONTAINER_TYPE_ID, " +
            "3) FileStorageContainer.Selected application permission has admin consent.";
          console.error("[OrbitContainerCreator] 403 diagnostic hint:", hint);
          return {
            success: false,
            message: `Container creation failed: ${errorMessage}. ${hint}`,
            details: { status: response.status, errorCode, error: errorText, hint, containerTypeId: this.containerTypeId },
          };
        }

        return { success: false, message: `Container creation failed: ${errorMessage}`, details: { status: response.status, error: errorText } };
      }

      const container = await response.json() as { id: string; displayName: string };
      console.log("[OrbitContainerCreator] Container created:", container.id, container.displayName);

      const permResult = await this.grantApplicationPermissions(token, container.id, ownerUserPrincipalName);
      if (!permResult.success) {
        console.warn("[OrbitContainerCreator] Permission grant failed:", permResult.message);
        return {
          success: true,
          message: `Container created but permissions need manual configuration: ${permResult.message}`,
          containerId: container.id,
          details: { container, permissionWarning: permResult.message },
        };
      }

      return {
        success: true,
        message: "Orbit SPE container created and configured successfully",
        containerId: container.id,
        details: { ...container, containerTypeRegistration: regResult },
      };
    } catch (err) {
      console.error("[OrbitContainerCreator] Unexpected error:", err);
      return {
        success: false,
        message: err instanceof Error ? err.message : "Unknown error during container creation",
        details: { error: err },
      };
    }
  }

  /** Delete a container and all its contents permanently. */
  async deleteContainer(
    containerId: string,
    azureTenantId?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const token = await this.getGraphAccessToken(azureTenantId);

      const response = await fetch(
        `${this.graphBaseUrl}/storage/fileStorage/containers/${containerId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.status === 204 || response.status === 200) {
        return { success: true, message: `Container ${containerId} deleted` };
      }
      if (response.status === 404) {
        return { success: true, message: `Container ${containerId} not found (already deleted)` };
      }

      const errorText = await response.text();
      return { success: false, message: `Delete failed: ${response.status} — ${errorText}` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /** Fetch container display name and basic info. */
  async getContainerInfo(
    containerId: string,
    azureTenantId?: string
  ): Promise<{ success: boolean; displayName?: string; status?: string; error?: string }> {
    try {
      const token = await this.getGraphAccessToken(azureTenantId);
      const response = await fetch(
        `${this.graphBaseUrl}/storage/fileStorage/containers/${containerId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        return { success: false, error: `Container not found or inaccessible (${response.status})` };
      }

      const data = await response.json() as { displayName?: string; status?: string };
      return { success: true, displayName: data.displayName, status: data.status };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /**
   * Register Orbit's container type in a specific consuming tenant.
   * Must be called once per tenant before any file operations will work.
   */
  async registerContainerTypeForTenant(
    azureTenantId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.registerContainerTypeInTenant(azureTenantId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async grantApplicationPermissions(
    accessToken: string,
    containerId: string,
    ownerUserPrincipalName?: string
  ): Promise<{ success: boolean; message: string }> {
    const clientId = process.env.ENTRA_CLIENT_ID;
    if (!clientId) {
      return { success: false, message: "ENTRA_CLIENT_ID not set" };
    }

    if (!ownerUserPrincipalName) {
      return { success: false, message: "ownerUserPrincipalName is required to grant container permissions. Pass the admin user's email when creating the container." };
    }

    try {
      const response = await fetch(
        `${this.graphBaseUrl}/storage/fileStorage/containers/${containerId}/permissions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roles: ["owner"],
            grantedToV2: {
              user: {
                userPrincipalName: ownerUserPrincipalName,
              },
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, message: `Permission grant failed: HTTP ${response.status} — ${errorText}` };
      }

      console.log("[OrbitContainerCreator] Owner permission granted to:", ownerUserPrincipalName);
      return { success: true, message: `Owner permissions granted to ${ownerUserPrincipalName}` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /**
   * Register the Orbit container type in the tenant via Graph beta.
   * Uses PUT to containerTypeRegistrations — idempotent.
   */
  private async registerContainerTypeInTenant(
    azureTenantId?: string
  ): Promise<{ success: boolean; message: string }> {
    const clientId = process.env.ENTRA_CLIENT_ID;
    if (!clientId) {
      return { success: false, message: "ENTRA_CLIENT_ID not set — cannot register container type" };
    }

    try {
      const token = await this.getGraphAccessToken(azureTenantId);
      const url = `${this.graphBetaUrl}/storage/fileStorage/containerTypeRegistrations/${this.containerTypeId}`;
      const body = {
        applicationPermissionGrants: [
          {
            appId: clientId,
            delegatedPermissions: ["full"],
            applicationPermissions: ["full"],
          },
        ],
      };

      console.log("[OrbitContainerCreator] Registering container type:", {
        url,
        containerTypeId: this.containerTypeId,
        appId: clientId.substring(0, 8) + "...",
        tenant: azureTenantId || "(default)",
      });

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let msg = `HTTP ${response.status}`;
        try {
          const errData = JSON.parse(errorText);
          if (errData.error) msg = `${errData.error.code || ""}: ${errData.error.message || msg}`;
        } catch {
          msg += `: ${errorText}`;
        }
        console.error("[OrbitContainerCreator] Container type registration failed:", msg);
        return { success: false, message: `Container type registration failed: ${msg}` };
      }

      const result = await response.json() as { id?: string; billingClassification?: string };
      console.log("[OrbitContainerCreator] Container type registered:", result.id, result.billingClassification);
      return {
        success: true,
        message: `Container type registered (billing: ${result.billingClassification || "unknown"})`,
      };
    } catch (err) {
      console.error("[OrbitContainerCreator] Container type registration error:", err);
      return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  private async getGraphAccessToken(azureTenantId?: string): Promise<string> {
    const clientId = process.env.ENTRA_CLIENT_ID;
    const clientSecret = process.env.ENTRA_CLIENT_SECRET;
    let tenantId = azureTenantId || process.env.ENTRA_TENANT_ID;

    if (!clientId || !clientSecret || !tenantId) {
      throw new Error(
        "[OrbitContainerCreator] Missing Azure AD credentials. " +
        "Set ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, and ENTRA_TENANT_ID."
      );
    }

    if (tenantId === "common" || tenantId === "organizations" || tenantId === "consumers") {
      throw new Error(
        `[OrbitContainerCreator] ENTRA_TENANT_ID is set to "${tenantId}" which does not support ` +
        "client credentials flow. SPE operations require a specific Azure AD tenant ID (GUID). " +
        "Either set ENTRA_TENANT_ID to the tenant GUID or pass azureTenantId explicitly."
      );
    }

    console.log("[OrbitContainerCreator] Acquiring token for tenant:", tenantId, "with client:", clientId.substring(0, 8) + "...");

    const msalInstance = new msal.ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
      system: {
        loggerOptions: {
          loggerCallback(_, message) {
            if (process.env.NODE_ENV === "development") {
              console.log("[MSAL-OrbitSPE]", message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: msal.LogLevel.Warning,
        },
      },
    });

    const result = await msalInstance.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });

    if (!result?.accessToken) {
      throw new Error("[OrbitContainerCreator] Failed to acquire access token");
    }

    try {
      const payload = JSON.parse(Buffer.from(result.accessToken.split(".")[1], "base64").toString());
      console.log("[OrbitContainerCreator] Token roles:", JSON.stringify(payload.roles || []));
      console.log("[OrbitContainerCreator] Token audience:", payload.aud);
      console.log("[OrbitContainerCreator] Token app:", payload.appid || payload.azp);
    } catch { /* ignore decode errors */ }

    return result.accessToken;
  }
}

export const containerCreator = new ContainerCreator();
