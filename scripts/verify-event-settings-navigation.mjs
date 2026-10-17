// Browser smoke test with API fixtures only: no credentials, real-account
// changes, or application auth bypass. Run against the development server.
import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const baseUrl = process.argv[2];
if (!baseUrl) throw new Error("Pass the development app URL.");
const chromiumPath = readdirSync("/nix/store")
  .filter(name => /chromium-1(25|31)\./.test(name))
  .map(name => `/nix/store/${name}/bin/chromium`)
  .find(path => existsSync(path));
const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const user = {
    id: "browser-fixture", name: "Fixture Editor", email: "editor@fixture.example",
    role: "Domain Admin", avatar: "FE", company: "Fixture Company",
    companySize: "11-50", jobTitle: "Editor", industry: "Technology", country: "United States",
  };
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data = [];
    if (pathname === "/api/me") data = user;
    else if (pathname === "/api/tenant/info") data = {
      name: "Fixture Company", plan: "unlimited",
      features: { socialAccounts: true, socialPosts: true, brandLibrary: true, conferencePromotion: true },
    };
    else if (pathname === "/api/tenant/settings") data = { plan: "unlimited", multiMarketEnabled: false };
    else if (pathname === "/api/company-profile") data = { id: "fixture-company", name: "Fixture Company", domain: "fixture.example" };
    else if (pathname === "/api/context") data = {
      activeTenantId: "fixture-tenant", activeMarketId: "fixture-market",
      activeTenant: { id: "fixture-tenant", name: "Fixture Company", domain: "fixture.example", plan: "unlimited" },
      activeMarket: { id: "fixture-market", name: "Default" },
    };
    else if (pathname === "/api/tenants/accessible") data = { tenants: [] };
    else if (pathname === "/api/markets") data = { markets: [] };
    else if (pathname === "/api/notifications") data = { notifications: [], unreadCount: 0 };
    else if (pathname === "/api/jobs/active") data = { active: [], count: 0 };
    else if (pathname === "/api/changelog/whats-new") data = { showModal: false };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto(`${baseUrl}/app/settings`);
  await page.getByTestId("header-settings").click({ timeout: 60000 });
  await page.getByTestId("desktop-settings-social-accounts").click();
  await page.waitForURL("**/app/marketing/social-accounts");
  await page.getByTestId("header-settings").click();
  await page.getByTestId("desktop-settings-settings").click();
  await page.waitForURL("**/app/settings");
  assert.ok(await page.getByRole("heading", { name: "Settings", exact: true }).isVisible());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("header-settings-mobile").click();
  await page.getByTestId("mobile-settings-social-accounts").click();
  await page.waitForURL("**/app/marketing/social-accounts");
  await page.getByTestId("header-settings-mobile").click();
  await page.getByTestId("mobile-settings-settings").click();
  await page.waitForURL("**/app/settings");
  assert.ok(await page.getByRole("heading", { name: "Settings", exact: true }).isVisible());
  assert.deepEqual(errors, [], `Browser render errors: ${errors.join("; ")}`);
  console.log("Desktop and mobile gear → Settings / Social Accounts navigation passed (API fixtures).");
} finally {
  await browser.close();
}
