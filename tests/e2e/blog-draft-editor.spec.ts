import { test, expect, Page } from "@playwright/test";

const E2E_EMAIL =
  process.env.E2E_TEST_EMAIL || process.env.TEST_EMAIL || "test@synozur.com";
const E2E_PASSWORD =
  process.env.E2E_TEST_PASSWORD || process.env.TEST_PASSWORD || "TestPass123!";

const EDITORIAL_PATH = "/app/marketing/editorial-calendar";

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
 * Use in-browser fetch (monkey-patched by the app to carry tab-context headers)
 * to look up a blog_post brief that already has a draft asset linked.
 * Returns { briefId, assetId } if one is found, null otherwise.
 */
async function findBlogPostBriefWithDraft(
  page: Page,
): Promise<{ briefId: string; assetId: string } | null> {
  return page.evaluate(async () => {
    const r = await fetch("/api/content-briefs");
    if (!r.ok) return null;
    const briefs: Array<{
      id: string;
      format: string;
      contentAssetId: string | null;
    }> = await r.json();
    const match = briefs.find(
      (b) => b.format === "blog_post" && b.contentAssetId,
    );
    if (!match) return null;
    return { briefId: match.id, assetId: match.contentAssetId! };
  });
}

test.describe("Blog post draft editor — Tiptap smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("Tiptap toolbar is present, editor accepts edits, and manual save persists the body", async ({
    page,
  }) => {
    // ── 1. Find (or skip) a blog_post brief that already has a draft ──────────
    const found = await findBlogPostBriefWithDraft(page);
    test.skip(!found, "No blog_post brief with a generated draft found in dev DB — seed one first.");
    const { briefId, assetId } = found!;

    // ── 2. Navigate to the editorial calendar and open the draft dialog ───────
    await page.goto(EDITORIAL_PATH);

    const openBtn = page.getByTestId(`open-draft-${briefId}`);
    await openBtn.waitFor({ state: "visible", timeout: 30_000 });
    await openBtn.click();

    // ── 3. Verify the dialog opened ───────────────────────────────────────────
    const dialogHeading = page.getByRole("heading", { name: /edit draft/i });
    await dialogHeading.waitFor({ state: "visible", timeout: 10_000 });

    // ── 4. Assert the Tiptap toolbar buttons are rendered ────────────────────
    // The RichTextEditor places data-testid attributes directly on each toolbar
    // button (rte-bold, rte-italic, rte-h1, rte-h2, rte-h3, rte-link, etc.)
    await expect(page.getByTestId("rte-bold")).toBeVisible();
    await expect(page.getByTestId("rte-italic")).toBeVisible();
    await expect(page.getByTestId("rte-h1")).toBeVisible();
    await expect(page.getByTestId("rte-h2")).toBeVisible();
    await expect(page.getByTestId("rte-h3")).toBeVisible();
    await expect(page.getByTestId("rte-link")).toBeVisible();
    await expect(page.getByTestId("rte-undo")).toBeVisible();

    // ── 5. Type unique text into the Tiptap editor ───────────────────────────
    // EditorContent renders a div.ProseMirror inside the [data-testid] wrapper.
    const editorWrapper = page.getByTestId("input-draft-body");
    await editorWrapper.waitFor({ state: "visible", timeout: 10_000 });

    // The ProseMirror div is the actual contenteditable node
    const proseMirror = editorWrapper.locator(".ProseMirror");
    await proseMirror.click();

    // Move to end of content and append a distinguishable test marker
    await page.keyboard.press("Control+End");
    const uniqueMarker = `E2E-tiptap-${Date.now()}`;
    await page.keyboard.type(` ${uniqueMarker}`);

    // ── 6. The save button should be enabled once the editor is dirty ─────────
    const saveBtn = page.getByTestId("button-save-draft");
    await expect(saveBtn).toBeEnabled();
    await expect(saveBtn).toHaveText(/save/i);

    // ── 7. Save and confirm the mutation completed ────────────────────────────
    await saveBtn.click();

    // After a successful save, draftDirty becomes false and the button label
    // switches from "Save" to "Saved" (and becomes disabled until next edit).
    await expect(saveBtn).toHaveText(/saved/i, { timeout: 15_000 });
    await expect(saveBtn).toBeDisabled();

    // ── 8. Verify the body was actually persisted via the API ─────────────────
    const persisted = await page.evaluate(async (id) => {
      const r = await fetch(`/api/content-assets/${id}`);
      if (!r.ok) return null;
      const a = await r.json();
      return (a.content as string | null) ?? null;
    }, assetId);

    expect(persisted).toContain(uniqueMarker);

    // ── 9. The "Push to website" button is rendered for blog_post drafts ─────
    await expect(page.getByTestId("button-push-to-website")).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("Metadata auto-save (patchBlogMeta) persists SEO fields without clicking Save", async ({
    page,
  }) => {
    // patchBlogMeta is a 300ms-debounced fire-and-forget PATCH triggered by
    // any change to the right-column metadata inputs (seoTitle, metaDescription,
    // seoSlug, excerpt, etc.). This test verifies the debounce fires and the
    // server persists the change — distinct from the manual saveDraft flow.
    const found = await findBlogPostBriefWithDraft(page);
    test.skip(!found, "No blog_post brief with a generated draft found in dev DB.");
    const { briefId, assetId } = found!;

    await page.goto(EDITORIAL_PATH);

    const openBtn = page.getByTestId(`open-draft-${briefId}`);
    await openBtn.waitFor({ state: "visible", timeout: 30_000 });
    await openBtn.click();

    await page
      .getByRole("heading", { name: /edit draft/i })
      .waitFor({ state: "visible", timeout: 10_000 });

    // The SEO title input is in the right-column metadata panel
    const seoTitle = page.getByTestId("input-blog-seo-title");
    await seoTitle.waitFor({ state: "visible", timeout: 10_000 });

    // Clear + type a unique SEO title to trigger patchBlogMeta
    const uniqueSeoTitle = `E2E-seo-${Date.now()}`;
    await seoTitle.fill(uniqueSeoTitle);

    // Wait well past the 300ms debounce to ensure the PATCH was sent
    await page.waitForTimeout(800);

    // Verify server persisted the SEO title — no manual save click needed
    const persisted = await page.evaluate(
      async ({ id, expected }) => {
        const r = await fetch(`/api/content-assets/${id}`);
        if (!r.ok) return null;
        const a = await r.json();
        return (a.seoTitle as string | null) ?? null;
      },
      { id: assetId, expected: uniqueSeoTitle },
    );

    expect(persisted).toBe(uniqueSeoTitle);

    await page.keyboard.press("Escape");
  });

  test("Tiptap formatting toolbar buttons toggle correctly", async ({
    page,
  }) => {
    const found = await findBlogPostBriefWithDraft(page);
    test.skip(!found, "No blog_post brief with a generated draft found in dev DB.");
    const { briefId } = found!;

    await page.goto(EDITORIAL_PATH);

    const openBtn = page.getByTestId(`open-draft-${briefId}`);
    await openBtn.waitFor({ state: "visible", timeout: 30_000 });
    await openBtn.click();

    await page
      .getByRole("heading", { name: /edit draft/i })
      .waitFor({ state: "visible", timeout: 10_000 });

    const editorWrapper = page.getByTestId("input-draft-body");
    await editorWrapper.waitFor({ state: "visible", timeout: 10_000 });
    const proseMirror = editorWrapper.locator(".ProseMirror");
    await proseMirror.click();

    // Select some text to test Bold toggle
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" BoldTest");
    await page.keyboard.down("Shift");
    for (let i = 0; i < "BoldTest".length; i++) {
      await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.up("Shift");

    // Click Bold — the toolbar button should become "active" (bg-primary class)
    const boldBtn = page.getByTestId("rte-bold");
    await boldBtn.click();
    // Active state uses "bg-primary" class
    await expect(boldBtn).toHaveClass(/bg-primary/);

    // Click Bold again to toggle off
    await boldBtn.click();
    await expect(boldBtn).not.toHaveClass(/bg-primary/);

    await page.keyboard.press("Escape");
  });

  test("Blog-post metadata panel (SEO fields) is rendered beside the editor", async ({
    page,
  }) => {
    const found = await findBlogPostBriefWithDraft(page);
    test.skip(!found, "No blog_post brief with a generated draft found in dev DB.");
    const { briefId } = found!;

    await page.goto(EDITORIAL_PATH);

    const openBtn = page.getByTestId(`open-draft-${briefId}`);
    await openBtn.waitFor({ state: "visible", timeout: 30_000 });
    await openBtn.click();

    await page
      .getByRole("heading", { name: /edit draft/i })
      .waitFor({ state: "visible", timeout: 10_000 });

    // The two-column blog layout exposes SEO metadata inputs in the right panel
    await expect(page.getByTestId("input-blog-seo-title")).toBeVisible();
    await expect(page.getByTestId("input-blog-seo-desc")).toBeVisible();
    await expect(page.getByTestId("input-blog-seo-slug")).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("Push to website dialog opens and renders without crashing (connected or not)", async ({
    page,
  }) => {
    const found = await findBlogPostBriefWithDraft(page);
    test.skip(!found, "No blog_post brief with a generated draft found in dev DB.");
    const { briefId } = found!;

    await page.goto(EDITORIAL_PATH);

    const openBtn = page.getByTestId(`open-draft-${briefId}`);
    await openBtn.waitFor({ state: "visible", timeout: 30_000 });
    await openBtn.click();

    await page
      .getByRole("heading", { name: /edit draft/i })
      .waitFor({ state: "visible", timeout: 10_000 });

    // The "Push to website" button is always rendered for blog_post format
    const pushBtn = page.getByTestId("button-push-to-website");
    await expect(pushBtn).toBeVisible();

    // Click it — the WebsitePublishDialog must open without crashing
    await pushBtn.click();

    // The dialog header "Post draft to website" (or "Update website draft")
    // must appear regardless of connection state
    const websiteDialogHeading = page
      .getByRole("heading")
      .filter({ hasText: /post draft to website|update website draft/i });
    await websiteDialogHeading.waitFor({ state: "visible", timeout: 10_000 });

    // Determine whether the website integration is connected for this tenant
    const isConnected = await page.evaluate(async () => {
      const r = await fetch("/api/integrations/website/status", { credentials: "include" });
      if (!r.ok) return false;
      const d = await r.json().catch(() => ({}));
      return !!d.connected;
    });

    if (isConnected) {
      // When connected: the full form is rendered, including the confirm button
      const confirmBtn = page.getByTestId("button-website-publish-confirm");
      await expect(confirmBtn).toBeVisible();
    } else {
      // When not connected: the "website not connected" empty state is shown
      // instead of the form (no crash, no 502 leak into the UI)
      const notConnected = page.getByTestId("website-not-connected");
      await expect(notConnected).toBeVisible();
      await expect(notConnected).toContainText(/website not connected/i);
    }

    // Close the dialog
    await page.keyboard.press("Escape");
  });
});
