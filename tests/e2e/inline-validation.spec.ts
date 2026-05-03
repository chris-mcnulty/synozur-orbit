import { test, expect, Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_TEST_EMAIL || "e2e-test@synozur.com";
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD || "E2eTestPass!1";

async function login(page: Page) {
  await page.goto("/auth/signin");
  await page.getByTestId("input-signin-email").fill(E2E_EMAIL);
  await page.getByTestId("input-signin-password").fill(E2E_PASSWORD);
  await page.getByTestId("button-signin").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
    timeout: 15_000,
  });
}

async function clearReactInput(page: Page, testId: string) {
  // Native date inputs (and some controlled inputs) resist .fill('') —
  // dispatch a real input/change event so React's state updates.
  await page.evaluate((id) => {
    const el = document.querySelector(
      `[data-testid="${id}"]`,
    ) as HTMLInputElement | null;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, testId);
}

test.describe("Inline validation — task #81", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("competitor social-link editor surfaces inline errors and disables Save", async ({
    page,
  }) => {
    await page.goto("/app/competitors");

    // Open the actions menu on the first competitor row via its stable
    // `button-competitor-actions-<id>` test id, then click "Edit Details".
    const actionsBtn = page
      .locator('[data-testid^="button-competitor-actions-"]')
      .first();
    await actionsBtn.waitFor({ state: "visible", timeout: 30_000 });
    await actionsBtn.click();

    const editButton = page
      .locator('[data-testid^="button-edit-links-"]')
      .first();
    await editButton.waitFor({ state: "visible", timeout: 10_000 });
    await editButton.click();

    const linkedin = page.getByTestId("input-linkedin-url");
    const twitter = page.getByTestId("input-twitter-url");
    const instagram = page.getByTestId("input-instagram-url");
    const blog = page.getByTestId("input-blog-url");
    const save = page.getByTestId("button-save-links");

    await expect(linkedin).toBeVisible();

    // A1 — bad LinkedIn URL
    await linkedin.fill("");
    await linkedin.fill("not a url");
    await expect(page.getByTestId("error-linkedin-url")).toBeVisible();
    await expect(linkedin).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();

    // A2 — bad Twitter URL
    await linkedin.fill("");
    await twitter.fill("javascript:alert(1)");
    await expect(page.getByTestId("error-twitter-url")).toBeVisible();
    await expect(save).toBeDisabled();

    // A3 — bad Instagram URL
    await twitter.fill("");
    await instagram.fill("ftp://something");
    await expect(page.getByTestId("error-instagram-url")).toBeVisible();
    await expect(save).toBeDisabled();

    // A4 — bad blog URL
    await instagram.fill("");
    await blog.fill("blog");
    await expect(page.getByTestId("error-blog-url")).toBeVisible();
    await expect(save).toBeDisabled();

    // A5 — clearing all inputs re-enables Save
    await blog.fill("");
    await expect(page.getByTestId("error-linkedin-url")).toHaveCount(0);
    await expect(page.getByTestId("error-twitter-url")).toHaveCount(0);
    await expect(page.getByTestId("error-instagram-url")).toHaveCount(0);
    await expect(page.getByTestId("error-blog-url")).toHaveCount(0);
    await expect(save).toBeEnabled();

    await page.keyboard.press("Escape");
  });

  test("campaign wizard surfaces inline errors on step 0 and step 3", async ({
    page,
  }) => {
    await page.goto("/app/marketing/campaigns");
    const newCampaign = page.getByTestId("button-new-campaign");
    await newCampaign.waitFor({ state: "visible", timeout: 20_000 });
    await newCampaign.click();

    const stepDetails = page.getByTestId("step-details");
    const stepAssets = page.getByTestId("step-assets");
    const stepSchedule = page.getByTestId("step-schedule");
    const nameInput = page.getByTestId("input-campaign-name");
    const nextToAssets = page.getByTestId("button-next-to-assets");

    await expect(stepDetails).toBeVisible();

    // B1 — empty name disables Next; future-step badge click reveals the error.
    await nameInput.fill("");
    await expect(nextToAssets).toBeDisabled();
    await expect(page.getByTestId("error-campaign-name")).toHaveCount(0);
    await stepAssets.click();
    await expect(nameInput).toBeVisible();
    await expect(page.getByTestId("error-campaign-name")).toBeVisible();
    await expect(nameInput).toHaveAttribute("aria-invalid", "true");

    // B2 — typing a name clears the error and enables Next.
    await nameInput.fill("Test Campaign Validation");
    await expect(page.getByTestId("error-campaign-name")).toHaveCount(0);
    await expect(nextToAssets).toBeEnabled();

    // B3 — advance to Schedule.
    await nextToAssets.click();
    await page.getByTestId("button-next-to-accounts").click();
    await page.getByTestId("button-next-to-schedule").click();

    const startDate = page.getByTestId("input-start-date");
    const numberOfDays = page.getByTestId("input-number-of-days");
    const create = page.getByTestId("button-create-campaign");

    await expect(startDate).toBeVisible();
    await expect(numberOfDays).toBeVisible();
    // Step 3 starts valid, no errors visible yet.
    await expect(page.getByTestId("error-number-of-days")).toHaveCount(0);
    await expect(page.getByTestId("error-start-date")).toHaveCount(0);

    // B4 — out-of-range days (0): Create stays clickable, click triggers
    // inline error-number-of-days and aria-invalid on the input.
    await numberOfDays.fill("");
    await numberOfDays.fill("0");
    await create.click();
    await expect(page.getByTestId("error-number-of-days")).toBeVisible();
    await expect(numberOfDays).toHaveAttribute("aria-invalid", "true");

    // B5 — out-of-range days (999) keeps the inline error in sync.
    await numberOfDays.fill("");
    await numberOfDays.fill("999");
    await expect(page.getByTestId("error-number-of-days")).toBeVisible();

    // B6 — fixing days clears its error; clearing start date triggers
    // error-start-date once Create is clicked again.
    await numberOfDays.fill("");
    await numberOfDays.fill("7");
    await expect(page.getByTestId("error-number-of-days")).toHaveCount(0);
    await clearReactInput(page, "input-start-date");
    await create.click();
    await expect(page.getByTestId("error-start-date")).toBeVisible();
    await expect(startDate).toHaveAttribute("aria-invalid", "true");

    // B7 — restoring a valid start date clears the inline error.
    await startDate.evaluate((el: HTMLInputElement) => {
      const today = new Date().toISOString().slice(0, 10);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(el, today);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.getByTestId("error-start-date")).toHaveCount(0);

    // B8 — round-trip back to step 0 still surfaces step 0 errors when
    // re-emptying the name and stepping forward via the badge.
    await stepDetails.click();
    await nameInput.fill("");
    await stepSchedule.click();
    await expect(nameInput).toBeVisible();
    await expect(page.getByTestId("error-campaign-name")).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("persona TagInput rejects empty and duplicate tags with animated inline message", async ({
    page,
  }) => {
    await page.goto("/app/marketing/personas");

    // Open the create-persona dialog via the stable header button.
    const createBtn = page.getByTestId("button-create-persona");
    await createBtn.waitFor({ state: "visible", timeout: 20_000 });
    await createBtn.click();

    const painInput = page.getByTestId(
      "input-tag-add-a-pain-point-and-press-enter",
    );
    const painAdd = page.getByTestId(
      "button-add-tag-add-a-pain-point-and-press-enter",
    );
    const painError = page.getByTestId(
      "error-tag-add-a-pain-point-and-press-enter",
    );

    await expect(painInput).toBeVisible();

    // C1 — empty submission shows animated inline error.
    await painInput.click();
    await painAdd.click();
    await expect(painError).toBeVisible();
    await expect(painError).toContainText(/Enter a value/i);
    await expect(painInput).toHaveAttribute("aria-invalid", "true");
    const painErrorClass = await painError.getAttribute("class");
    expect(painErrorClass || "").toContain("animate-in");

    // C2 — duplicate (case-insensitive) is rejected.
    await painInput.fill("Slow onboarding");
    await painInput.press("Enter");
    await expect(painInput).toHaveValue("");
    await painInput.fill("slow onboarding");
    await painInput.press("Enter");
    await expect(painError).toBeVisible();
    await expect(painError).toContainText(/already added/i);

    // C3 — Goals input rejects empty.
    const goalAdd = page.getByTestId(
      "button-add-tag-add-a-goal-and-press-enter",
    );
    const goalError = page.getByTestId(
      "error-tag-add-a-goal-and-press-enter",
    );
    await goalAdd.click();
    await expect(goalError).toBeVisible();
    await expect(goalError).toContainText(/Enter a value/i);

    // C4 — Objections input rejects empty.
    const objInput = page.getByTestId(
      "input-tag-add-an-objection-and-press-enter",
    );
    const objAdd = page.getByTestId(
      "button-add-tag-add-an-objection-and-press-enter",
    );
    const objError = page.getByTestId(
      "error-tag-add-an-objection-and-press-enter",
    );
    await objAdd.click();
    await expect(objError).toBeVisible();

    // C5 — typing into the input clears the error eagerly.
    await objInput.fill("x");
    await expect(objError).toHaveCount(0);

    await page.keyboard.press("Escape");
  });
});
