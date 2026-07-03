import { test, expect, Page } from "@playwright/test";

const E2E_EMAIL =
  process.env.E2E_TEST_EMAIL || "e2e-test@synozur.com";
const E2E_PASSWORD =
  process.env.E2E_TEST_PASSWORD || "E2eTestPass!1";

async function login(page: Page) {
  await page.goto("/auth/signin");
  await page.getByTestId("input-signin-email").fill(E2E_EMAIL);
  await page.getByTestId("input-signin-password").fill(E2E_PASSWORD);
  await page.getByTestId("button-signin").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
    timeout: 15_000,
  });
}

/**
 * Seed a blog-post brief with a linked content asset (including a leadImageUrl
 * so the asset shows up in the media picker's Asset Library grid) via the
 * test-helper endpoint.
 *
 * Uses in-browser fetch so the monkey-patched tab-context headers (tenant /
 * market) are automatically included — the same context the editorial calendar
 * and content-asset routes use.
 */
async function seedBlogBrief(
  page: Page,
  label: string,
): Promise<{
  briefId: string;
  assetId: string;
  calendarId: string;
  assetLeadImageUrl: string;
}> {
  return page.evaluate(async (lbl) => {
    const r = await fetch("/api/_test/seed-blog-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: lbl }),
    });
    if (!r.ok) throw new Error(`seed failed ${r.status}: ${await r.text()}`);
    return r.json();
  }, label);
}

async function cleanupBlogBrief(page: Page, briefId: string) {
  await page.evaluate(async (id) => {
    await fetch(`/api/_test/seed-blog-brief/${id}`, { method: "DELETE" });
  }, briefId);
}

/**
 * Opens the Insert Image media picker in the blog draft editor and returns
 * after the dialog is confirmed open.  Caller is responsible for the prior
 * navigation to the editorial calendar and opening the draft.
 */
async function openMediaPicker(page: Page) {
  const rteImageBtn = page.getByTestId("rte-image");
  await expect(rteImageBtn).toBeVisible({ timeout: 10_000 });
  await rteImageBtn.click();
  await expect(page.getByText("Insert Image")).toBeVisible({ timeout: 5_000 });
}

test.describe("Editorial calendar — media picker image insertion", () => {
  test("Asset Library tab: selecting an asset tile inserts the image into the draft", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await login(page);

    const run = Date.now().toString(36);
    const { briefId, assetId, assetLeadImageUrl } = await seedBlogBrief(
      page,
      `mediapicker-lib-${run}`,
    );

    try {
      await page.goto("/app/marketing/editorial-calendar");

      // Wait for the brief card to appear.
      const briefCard = page.getByTestId(`brief-${briefId}`);
      await expect(briefCard).toBeVisible({ timeout: 20_000 });

      // The brief has a linked draft asset — "Ready" badge must be shown.
      await expect(
        briefCard.getByTestId(`linked-draft-${briefId}`),
      ).toContainText("Ready");

      // Open the blog draft editor.
      await briefCard.getByTestId(`open-draft-${briefId}`).click();

      await openMediaPicker(page);

      // Dialog should default to the Asset Library tab.
      const tabToggle = page.getByTestId("media-picker-tab-toggle");
      await expect(tabToggle).toBeVisible();
      await expect(
        page.getByTestId("button-media-picker-tab-library"),
      ).toBeVisible();
      await expect(
        page.getByTestId("input-media-picker-search"),
      ).toBeVisible();

      // The seeded asset (which has a leadImageUrl) must appear as a tile.
      const assetTile = page.getByTestId(`button-media-asset-${assetId}`);
      await expect(assetTile).toBeVisible({ timeout: 8_000 });

      // Clicking the tile should close the dialog and insert the image.
      await assetTile.click();

      // Dialog must close.
      await expect(page.getByText("Insert Image")).toHaveCount(0, {
        timeout: 5_000,
      });

      // The editor content area should now contain an <img> sourced from
      // the asset's leadImageUrl.
      const editorImg = page.locator(".rte-content img");
      await expect(editorImg).toHaveCount(1, { timeout: 5_000 });
      await expect(editorImg).toHaveAttribute("src", assetLeadImageUrl);
    } finally {
      await cleanupBlogBrief(page, briefId);
    }
  });

  test("URL fallback tab: entering a URL enables Insert and the image renders in the editor", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await login(page);

    const run = Date.now().toString(36);
    const { briefId } = await seedBlogBrief(page, `mediapicker-url-${run}`);

    try {
      await page.goto("/app/marketing/editorial-calendar");

      const briefCard = page.getByTestId(`brief-${briefId}`);
      await expect(briefCard).toBeVisible({ timeout: 20_000 });
      await briefCard.getByTestId(`open-draft-${briefId}`).click();

      await openMediaPicker(page);

      // Switch to the Enter URL tab.
      await page.getByTestId("button-media-picker-tab-url").click();

      const urlInput = page.getByTestId("input-media-picker-url");
      const insertBtn = page.getByTestId("button-media-picker-insert-url");

      await expect(urlInput).toBeVisible();
      await expect(insertBtn).toBeVisible();
      // Insert button starts disabled (empty field).
      await expect(insertBtn).toBeDisabled();

      const testImageUrl = "https://picsum.photos/400/300";
      await urlInput.fill(testImageUrl);

      // Button becomes enabled once a URL is typed.
      await expect(insertBtn).toBeEnabled();

      await insertBtn.click();

      // Dialog closes after insertion.
      await expect(page.getByText("Insert Image")).toHaveCount(0, {
        timeout: 5_000,
      });

      // An <img> with the inserted URL must appear in the editor.
      const editorImg = page.locator(".rte-content img");
      await expect(editorImg).toHaveCount(1, { timeout: 5_000 });
      await expect(editorImg).toHaveAttribute("src", testImageUrl);
    } finally {
      await cleanupBlogBrief(page, briefId);
    }
  });
});
