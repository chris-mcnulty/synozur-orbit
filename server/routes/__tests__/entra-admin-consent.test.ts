import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerEntraRoutes } from "../../auth/entra-routes";
import { REDIRECT_URI } from "../../auth/msal-config";
import { registerTenantAdminRoutes } from "../tenant-admin";

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getTenant: vi.fn(),
  getTenantByDomain: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: storageMock,
}));

const DOMAIN_ADMIN = {
  id: "user-1",
  email: "admin@reveillere.com",
  role: "Domain Admin",
};

const GLOBAL_ADMIN = {
  id: "user-2",
  email: "admin@synozur.com",
  role: "Global Admin",
};

const REVEILLE = {
  id: "tenant-reveille",
  domain: "reveillere.com",
  entraTenantId: "entra-reveille",
};

const OTHER_TENANT = {
  id: "tenant-other",
  domain: "other.example",
  entraTenantId: "entra-other",
};

function buildApp(session: Record<string, any>) {
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  registerEntraRoutes(app);
  registerTenantAdminRoutes(app);
  return app;
}

function consentRequest(app: express.Express) {
  return request(app)
    .get("/api/team/entra/admin-consent-url")
    .set("X-Forwarded-Proto", "https")
    .set("X-Forwarded-Host", "orbit.example.test");
}

const originalClientId = process.env.ENTRA_CLIENT_ID;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENTRA_CLIENT_ID = "orbit-shared-client-id";
  storageMock.getUser.mockResolvedValue(DOMAIN_ADMIN);
  storageMock.getTenantByDomain.mockResolvedValue(REVEILLE);
  storageMock.getTenant.mockResolvedValue(OTHER_TENANT);
});

afterAll(() => {
  if (originalClientId === undefined) {
    delete process.env.ENTRA_CLIENT_ID;
  } else {
    process.env.ENTRA_CLIENT_ID = originalClientId;
  }
});

describe("Microsoft Entra admin permission re-consent", () => {
  it("requires an authenticated administrator", async () => {
    const app = buildApp({});

    const response = await consentRequest(app);

    expect(response.status).toBe(401);
  });

  it("rejects standard users", async () => {
    storageMock.getUser.mockResolvedValue({ ...DOMAIN_ADMIN, role: "Standard User" });
    const app = buildApp({ userId: "user-1" });

    const response = await consentRequest(app);

    expect(response.status).toBe(403);
  });

  it("builds a tenant-specific v2 admin-consent URL with protected state", async () => {
    const session: Record<string, any> = { userId: "user-1" };
    const app = buildApp(session);

    const response = await consentRequest(app);

    expect(response.status).toBe(200);
    const url = new URL(response.body.url);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/entra-reveille/v2.0/adminconsent");
    expect(url.searchParams.get("client_id")).toBe("orbit-shared-client-id");
    expect(url.searchParams.get("scope")).toBe("https://graph.microsoft.com/.default");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe(session.entraAdminConsent.state);
    expect(session.entraAdminConsent).toMatchObject({
      tenantId: "entra-reveille",
      initiatedAt: expect.any(Number),
    });
  });

  it("keeps Domain Admins scoped to their own tenant despite an active-tenant header", async () => {
    const app = buildApp({ userId: "user-1" });

    const response = await consentRequest(app).set("X-Active-Tenant-Id", OTHER_TENANT.id);

    expect(response.status).toBe(200);
    expect(new URL(response.body.url).pathname).toBe("/entra-reveille/v2.0/adminconsent");
    expect(storageMock.getTenant).not.toHaveBeenCalled();
  });

  it("uses the active tenant for Global Admins", async () => {
    storageMock.getUser.mockResolvedValue(GLOBAL_ADMIN);
    const app = buildApp({ userId: "user-2" });

    const response = await consentRequest(app).set("X-Active-Tenant-Id", OTHER_TENANT.id);

    expect(response.status).toBe(200);
    expect(storageMock.getTenant).toHaveBeenCalledWith(OTHER_TENANT.id);
    expect(new URL(response.body.url).pathname).toBe("/entra-other/v2.0/adminconsent");
  });

  it("reports the same active tenant that a Global Admin will re-consent", async () => {
    storageMock.getUser.mockResolvedValue(GLOBAL_ADMIN);
    const app = buildApp({ userId: "user-2" });

    const response = await request(app)
      .get("/api/team/entra/admin-consent-status")
      .set("X-Active-Tenant-Id", OTHER_TENANT.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      available: true,
      tenantDomain: OTHER_TENANT.domain,
    });
    expect(storageMock.getTenant).toHaveBeenCalledWith(OTHER_TENANT.id);
  });

  it("returns to Settings after Microsoft approves consent for the expected tenant", async () => {
    const session: Record<string, any> = { userId: "user-1" };
    const app = buildApp(session);
    const start = await consentRequest(app);
    const state = new URL(start.body.url).searchParams.get("state");

    const callback = await request(app)
      .get("/api/auth/entra/callback")
      .query({ admin_consent: "True", tenant: REVEILLE.entraTenantId, state });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/app/settings?entraConsent=approved");
    expect(session.entraAdminConsent).toBeUndefined();
  });

  it("reports a cancellation without exposing Microsoft error details", async () => {
    const session: Record<string, any> = { userId: "user-1" };
    const app = buildApp(session);
    const start = await consentRequest(app);
    const state = new URL(start.body.url).searchParams.get("state");

    const callback = await request(app)
      .get("/api/auth/entra/callback")
      .query({
        error: "access_denied",
        error_description: "This should never be returned to the Orbit UI",
        state,
      });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/app/settings?entraConsent=cancelled");
    expect(callback.headers.location).not.toContain("error_description");
  });

  it("rejects expired and mismatched consent returns", async () => {
    const expiredSession: Record<string, any> = {
      userId: "user-1",
      entraAdminConsent: {
        state: "expired-state",
        tenantId: REVEILLE.entraTenantId,
        initiatedAt: Date.now() - 16 * 60 * 1000,
      },
    };
    const expiredApp = buildApp(expiredSession);
    const expired = await request(expiredApp)
      .get("/api/auth/entra/callback")
      .query({ admin_consent: "True", tenant: REVEILLE.entraTenantId, state: "expired-state" });
    expect(expired.headers.location).toBe("/app/settings?entraConsent=expired");

    const session: Record<string, any> = { userId: "user-1" };
    const app = buildApp(session);
    const start = await consentRequest(app);
    const state = new URL(start.body.url).searchParams.get("state");
    const mismatched = await request(app)
      .get("/api/auth/entra/callback")
      .query({ admin_consent: "True", tenant: OTHER_TENANT.entraTenantId, state });
    expect(mismatched.headers.location).toBe("/app/settings?entraConsent=failed");
  });
});