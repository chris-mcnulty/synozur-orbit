import { test, expect, Page } from "@playwright/test";

// Credentials: default to the working local-auth user. Override with
// E2E_TEST_EMAIL / E2E_TEST_PASSWORD (or TEST_EMAIL / TEST_PASSWORD) in the env.
const E2E_EMAIL =
  process.env.E2E_TEST_EMAIL || process.env.TEST_EMAIL || "test@synozur.com";
const E2E_PASSWORD =
  process.env.E2E_TEST_PASSWORD || process.env.TEST_PASSWORD || "TestPass123!";

const CALENDAR_PATH = "/app/marketing/marketing-calendar";

async function login(page: Page) {
  await page.goto("/auth/signin");
  await page.getByTestId("input-signin-email").fill(E2E_EMAIL);
  await page.getByTestId("input-signin-password").fill(E2E_PASSWORD);
  await page.getByTestId("button-signin").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
    timeout: 15_000,
  });
}

// Create an unscheduled draft (no date → lands in the backlog) via the same
// in-browser fetch the app uses, so the monkey-patched tab-context headers are
// applied and the seeded item is read back in the exact same tenant/market
// context as the backlog query.
async function seed(
  page: Page,
  type: "social" | "email" | "content",
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const result = await page.evaluate(
    async ({ type, title, extra }) => {
      const r = await fetch("/api/marketing-calendar/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title, ...extra }),
      });
      if (!r.ok) throw new Error(`seed failed ${r.status}: ${await r.text()}`);
      return (await r.json()) as { type: string; id: string };
    },
    { type, title, extra },
  );
  return result.id;
}

async function firstCampaignId(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const r = await fetch("/api/marketing-calendar/filters");
    if (!r.ok) return null;
    const data = await r.json();
    return data?.campaigns?.[0]?.id ?? null;
  });
}

async function openBacklog(page: Page) {
  await page.goto(CALENDAR_PATH);
  await expect(page.getByTestId("text-page-title")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("button-view-backlog").click();
  await expect(page.getByTestId("backlog-panel")).toBeVisible();
}

async function selectItems(page: Page, ids: string[]) {
  for (const id of ids) {
    const cb = page.getByTestId(`checkbox-item-${id}`);
    await cb.scrollIntoViewIfNeeded();
    await cb.click();
  }
  await expect(page.getByTestId("bulk-action-bar")).toBeVisible();
}

test.describe("Marketing calendar — backlog bulk actions (task #165)", () => {
  test("schedule, approve, assign, and discard move drafts out of / through the backlog", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // After login the SPA is already loaded (post-login landing page), so the
    // tab-context fetch monkey-patch is installed and the session cookie is set
    // — we can seed immediately without a separate heavy calendar page load.
    await login(page);

    const run = Date.now().toString(36);

    // ── Seed four independent sets of unscheduled drafts. ──
    // Schedule set — one of each type.
    const schedSocial = await seed(page, "social", `bulk-${run}-sched-social`);
    const schedEmailTitle = `bulk-${run}-sched-email`;
    const schedEmail = await seed(page, "email", schedEmailTitle);
    const schedContentTitle = `bulk-${run}-sched-content`;
    const schedContent = await seed(page, "content", schedContentTitle);

    // Approve set — email + content (social has no approve step).
    const apprEmail = await seed(page, "email", `bulk-${run}-appr-email`);
    const apprContent = await seed(page, "content", `bulk-${run}-appr-content`);

    // Assign set — social + content.
    const asgnSocial = await seed(page, "social", `bulk-${run}-asgn-social`);
    const asgnContent = await seed(page, "content", `bulk-${run}-asgn-content`);

    // Discard set — one of each type.
    const discSocial = await seed(page, "social", `bulk-${run}-disc-social`);
    const discEmail = await seed(page, "email", `bulk-${run}-disc-email`);
    const discContent = await seed(page, "content", `bulk-${run}-disc-content`);

    const campaignId = await firstCampaignId(page);

    // ── Open the backlog (fresh load picks up the seeded rows). ──
    await openBacklog(page);

    // All ten seeded rows should be present in the backlog.
    for (const id of [
      schedSocial, schedEmail, schedContent,
      apprEmail, apprContent,
      asgnSocial, asgnContent,
      discSocial, discEmail, discContent,
    ]) {
      await expect(page.getByTestId(`backlog-row-${id}`)).toBeVisible();
    }

    // ── 1) SCHEDULE: pick a date in the current month so it lands in view. ──
    await selectItems(page, [schedSocial, schedEmail, schedContent]);
    const today = new Date();
    const scheduleDate = `${today.getFullYear()}-${String(
      today.getMonth() + 1,
    ).padStart(2, "0")}-15`;
    await page.getByTestId("input-bulk-date").fill(scheduleDate);
    await page.getByTestId("button-bulk-schedule").click();

    // Scheduled items leave the backlog entirely.
    await expect(page.getByTestId(`backlog-row-${schedSocial}`)).toHaveCount(0);
    await expect(page.getByTestId(`backlog-row-${schedEmail}`)).toHaveCount(0);
    await expect(page.getByTestId(`backlog-row-${schedContent}`)).toHaveCount(0);

    // ── 2) APPROVE: email + content flip to the "Approved" lifecycle and
    // stay in the backlog (approve does not schedule them). ──
    await selectItems(page, [apprEmail, apprContent]);
    await page.getByTestId("button-bulk-approve").click();

    await expect(
      page.getByTestId(`backlog-row-${apprEmail}`).getByText("Approved"),
    ).toBeVisible();
    await expect(
      page.getByTestId(`backlog-row-${apprContent}`).getByText("Approved"),
    ).toBeVisible();

    // ── 3) ASSIGN: attach a campaign (or clear, if no campaign exists). The
    // success toast confirms the bulk endpoint applied the assignment. ──
    await selectItems(page, [asgnSocial, asgnContent]);
    if (campaignId) {
      // assignKind defaults to "campaign"; choose the first campaign value.
      await page.getByTestId("select-assign-value").click();
      await page
        .getByRole("option")
        .filter({ hasNotText: "None (clear)" })
        .first()
        .click();
    }
    await page.getByTestId("button-bulk-assign").click();
    await expect(page.getByText(/Assignment updated 2 items/i)).toBeVisible();
    // Still unscheduled → remain in the backlog.
    await expect(page.getByTestId(`backlog-row-${asgnSocial}`)).toBeVisible();
    await expect(page.getByTestId(`backlog-row-${asgnContent}`)).toBeVisible();

    // ── 4) DISCARD: remove one of each type from the backlog. ──
    await selectItems(page, [discSocial, discEmail, discContent]);
    await page.getByTestId("button-bulk-discard").click();

    await expect(page.getByTestId(`backlog-row-${discSocial}`)).toHaveCount(0);
    await expect(page.getByTestId(`backlog-row-${discEmail}`)).toHaveCount(0);
    await expect(page.getByTestId(`backlog-row-${discContent}`)).toHaveCount(0);

    // ── Calendar grid shows the scheduled email/content and NOT the
    // unscheduled (approved / discarded) drafts. ──
    await page.getByTestId("button-view-calendar").click();
    await expect(page.getByText(schedEmailTitle)).toBeVisible();
    await expect(page.getByText(schedContentTitle)).toBeVisible();
    // Approved-but-unscheduled and discarded items never reach the grid.
    await expect(page.getByText(`bulk-${run}-appr-content`)).toHaveCount(0);
    await expect(page.getByText(`bulk-${run}-disc-content`)).toHaveCount(0);

    // ── Cleanup: hard-delete everything this test created so the shared dev
    // DB / backlog is not polluted across runs. ──
    await page.evaluate(
      async (items) => {
        for (const it of items) {
          await fetch(`/api/marketing-calendar/items/${it.type}/${it.id}`, {
            method: "DELETE",
          });
        }
      },
      [
        { type: "social", id: schedSocial },
        { type: "email", id: schedEmail },
        { type: "content", id: schedContent },
        { type: "email", id: apprEmail },
        { type: "content", id: apprContent },
        { type: "social", id: asgnSocial },
        { type: "content", id: asgnContent },
        // discard set already removed (email hard-deleted; social/content soft-deleted)
        { type: "social", id: discSocial },
        { type: "content", id: discContent },
      ],
    );
  });
});
