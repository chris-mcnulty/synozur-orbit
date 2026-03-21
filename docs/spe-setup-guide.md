# SharePoint Embedded (SPE) Setup Guide

## Overview

SharePoint Embedded (SPE) is Orbit's optional document storage backend. When enabled for a tenant, grounding documents are stored in Microsoft SharePoint rather than Orbit's default storage, keeping files inside the customer's own Microsoft 365 environment.

There are two distinct scopes to this setup:

| Scope | Who does it | Frequency | What it creates |
|-------|------------|-----------|----------------|
| **Platform-level** | Synozur (Azure Global Admin) | Once — never repeated | The container type + app registration permissions |
| **Per-tenant** | Synozur Global Admin via Orbit admin API | Once per customer that enables SPE | A container inside that customer's own SharePoint tenant |

Each customer's files are stored in their own isolated container **inside their own Microsoft 365 environment**. There is no commingled storage across tenants.

---

## Part A — Platform Setup (Synozur, one time only)

Done in **Synozur's Azure tenant** on the Orbit app registration. Never repeated.

### A.1 — Add API Permissions to the Orbit App Registration

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory → App registrations**
2. Open the **Synozur Orbit** app registration (Client ID = `ENTRA_CLIENT_ID`)
3. Go to **API permissions → Add a permission → Microsoft Graph → Application permissions**

Add these two permissions:

| Permission | Type | Purpose |
|------------|------|---------|
| `FileStorageContainer.Selected` | Application | Read/write files inside containers |
| `FileStorageContainerType.Selected` | Application | Register the container type in consuming tenants |

4. Click **Grant admin consent for Synozur** → confirm → both must show a green checkmark

> Do NOT add `Sites.ReadWrite.All` or `Files.ReadWrite.All`. The `*.Selected` permissions are the correct SPE-scoped approach and have a narrower blast radius.

---

### A.2 — Create the Orbit Container Type

This generates the `ORBIT_SPE_CONTAINER_TYPE_ID` that all customer containers will reference.

1. In the app registration left sidebar, click **SharePoint Embedded**
   - If not visible: go to **Overview → Add a capability → SharePoint Embedded**
2. Click **Create new container type** and fill in:
   - **Container type name:** `Synozur Orbit Documents`
   - **Billing classification:** `Standard`
   - **Owning application:** auto-populated as the current app registration
3. Click **Create**
4. **Copy the Container type ID** (a GUID) → this becomes `ORBIT_SPE_CONTAINER_TYPE_ID`

---

### A.3 — Set Platform Environment Variables

| Variable | Value | Where to get it |
|----------|-------|----------------|
| `ORBIT_SPE_CONTAINER_TYPE_ID` | Container type GUID | Azure Portal → step A.2 |
| `ENTRA_CLIENT_ID` | App registration Client ID | Azure Portal → App registration Overview |
| `ENTRA_CLIENT_SECRET` | Valid client secret | Azure Portal → Certificates & secrets |
| `ENTRA_TENANT_ID` | Synozur Directory (tenant) GUID | Azure Portal → App registration Overview |

> `ENTRA_TENANT_ID` must be a specific tenant GUID. The value `"common"` will not work for SPE operations.

**Check secret expiry:** In **Certificates & secrets**, confirm `ENTRA_CLIENT_SECRET` is not expiring within 30 days. Rotate it now if so — copy the new value immediately (shown only once) and update the environment variable.

---

## Part B — Per-Tenant Setup (once per customer that enables SPE)

Each customer tenant stores files in its own container inside their Microsoft 365 environment. Orbit authenticates to the customer's tenant using their `entraTenantId`, which is automatically captured from the `tid` claim in the user's JWT when they first log in via Entra SSO.

**Prerequisite:** The customer's `entra_tenant_id` column must be populated in the `tenants` table. This happens automatically after any user from that tenant completes Entra SSO login. Verify with:

```sql
SELECT domain, entra_tenant_id FROM tenants WHERE domain = 'customer-domain.com';
```

---

### B.1 — Register the Container Type in the Customer's Tenant

This tells the customer's SharePoint to recognize and trust Orbit's container type. It is **idempotent** — safe to call again if it previously failed.

```
POST /api/admin/spe/register-container-type
Content-Type: application/json

{
  "azureTenantId": "<customer's entra_tenant_id>"
}
```

Expected response:
```json
{
  "success": true,
  "message": "Container type registered (billing: Standard)"
}
```

Internally this authenticates to the customer's tenant using Orbit's client credentials and calls `PUT /beta/storage/fileStorage/containerTypeRegistrations/{containerTypeId}`.

If this fails with `"insufficient privileges"`, the customer's Microsoft 365 admin must grant consent to the Orbit app in their Entra admin portal before proceeding.

---

### B.2 — Create the Customer's Container

Creates the actual container **inside the customer's SharePoint tenant**. Run this once for dev and once for prod.

**Development container:**
```
POST /api/admin/spe/container
Content-Type: application/json

{
  "containerName": "Acme Corp Orbit Documents (Dev)",
  "description": "Synozur Orbit document storage — development",
  "azureTenantId": "<customer's entra_tenant_id>"
}
```

**Production container:**
```
POST /api/admin/spe/container
Content-Type: application/json

{
  "containerName": "Acme Corp Orbit Documents",
  "description": "Synozur Orbit document storage — production",
  "azureTenantId": "<customer's entra_tenant_id>"
}
```

Expected response:
```json
{
  "success": true,
  "message": "Orbit SPE container created and configured successfully",
  "containerId": "b!xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Internally this:
1. Authenticates to the customer's tenant
2. `POST /v1.0/storage/fileStorage/containers` with Orbit's container type ID
3. Grants Orbit's app `owner` permissions on the new container
4. Re-runs step B.1 as a safety net

---

### B.3 — Link the Container to the Orbit Tenant Record

Store the returned `containerId` values on the customer's tenant row:

```sql
UPDATE tenants
SET spe_container_id_dev  = 'b!<dev-container-id>',
    spe_container_id_prod = 'b!<prod-container-id>',
    spe_storage_enabled   = true,
    updated_at            = now()
WHERE domain = 'customer-domain.com';
```

Once this is set, `sharepoint-file-storage.ts` automatically uses the correct container and authenticates to the correct tenant for all file operations for that customer.

---

### B.4 — Verify the Container is Accessible

```
GET /api/admin/spe/status
```

Expected response:
```json
{
  "configured": true,
  "containerId": "b!xxxx…",
  "success": true,
  "displayName": "Acme Corp Orbit Documents",
  "status": "active"
}
```

If `configured: false` is returned, the container ID column is not set on the tenant row or the server needs a restart.

---

## Tenant Record Requirements

For SPE to work for a given customer, their row in the `tenants` table needs all four of these populated:

| Column | Source |
|--------|--------|
| `entra_tenant_id` | Auto-populated from JWT `tid` claim on first Entra SSO login |
| `spe_container_id_dev` | Returned from `POST /api/admin/spe/container` (dev run) |
| `spe_container_id_prod` | Returned from `POST /api/admin/spe/container` (prod run) |
| `spe_storage_enabled` | Set to `true` after containers are confirmed accessible |

---

## Full Setup Checklist

```
Part A — Platform (Synozur, once only)
  [ ] FileStorageContainer.Selected permission added + admin consent granted (green checkmark)
  [ ] FileStorageContainerType.Selected permission added + admin consent granted (green checkmark)
  [ ] Container type "Synozur Orbit Documents" created in app registration
  [ ] ORBIT_SPE_CONTAINER_TYPE_ID env var set to the container type GUID
  [ ] ENTRA_TENANT_ID is Synozur's specific GUID (not "common")
  [ ] ENTRA_CLIENT_SECRET is valid and not expiring within 30 days

Part B — Per Customer Tenant (repeat for each customer)
  [ ] Customer has logged in via Entra SSO (entra_tenant_id is populated in tenants table)
  [ ] POST /api/admin/spe/register-container-type succeeded for their azureTenantId
  [ ] POST /api/admin/spe/container (dev) → containerId saved to spe_container_id_dev
  [ ] POST /api/admin/spe/container (prod) → containerId saved to spe_container_id_prod
  [ ] spe_storage_enabled = true on tenant row
  [ ] GET /api/admin/spe/status returns configured: true and status: active
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `"not supported for AAD accounts"` | Container type not registered in customer tenant | Run B.1 `register-container-type` for their `azureTenantId` |
| `401 Unauthorized` | Expired/invalid secret or wrong `ENTRA_TENANT_ID` | Rotate `ENTRA_CLIENT_SECRET`; confirm `ENTRA_TENANT_ID` is a specific GUID |
| `403 Forbidden` | Missing permission or admin consent not granted | Re-add `FileStorageContainer.Selected` + grant consent in Azure Portal |
| `"insufficient privileges"` on B.1 | Customer's M365 admin has not consented to Orbit | Customer's IT admin must grant Orbit app consent in their Entra admin portal |
| `404` on file operations | Container ID wrong or container deleted | Verify `spe_container_id_dev/prod` on tenant row; re-create container if needed |
| `configured: false` from `/spe/status` | `speContainerIdDev/Prod` not set on tenant row | Run B.3 to update the tenant record |
| `BadRequest` on container list | Known Graph API preview behaviour | Expected — the code uses direct container access, not list, to avoid this |

---

## Related Code

| File | Purpose |
|------|---------|
| `server/services/sharepoint-container-creator.ts` | Creates containers, registers container type per tenant |
| `server/services/sharepoint-file-storage.ts` | File read/write using per-tenant container + Graph client |
| `server/services/sharepoint-graph-client.ts` | Graph API authentication per tenant |
| `server/auth/msal-config.ts` | MSAL configuration and client credentials setup |
| `server/routes.ts` | Admin API routes: `/api/admin/spe/*` |
| `shared/schema.ts` | Tenant columns: `entra_tenant_id`, `spe_container_id_*`, `spe_storage_enabled` |
