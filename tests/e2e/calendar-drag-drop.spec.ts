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

// On first login the "What's New" modal pops up and intercepts pointer events,
// blocking grid interactions. Dismiss it server-side before the calendar mounts
// so the modal's whats-new query returns showModal:false and it never renders.
async function dismissWhatsNew(page: Page) {
  await page.evaluate(async () => {
    try {
      await fetch("/api/changelog/dismiss", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // best-effort; if it fails the test will surface the modal interception
    }
  });
}

// Create an unscheduled content draft via the app's own (monkey-patched) fetch
// so it carries this tab's tenant/market context headers — the same context the
// calendar grid and backlog rail read. Returns the new draft id.
async function seedBacklogDraft(page: Page, title: string): Promise<string> {
  const id = await page.evaluate(async (t) => {
    const res = await fetch("/api/marketing-calendar/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "content", title: t }),
    });
    if (!res.ok) {
      throw new Error(`seed failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { id: string };
    return json.id;
  }, title);
  return id;
}

// HTML5 drag-and-drop is not reliably driven by Playwright's mouse APIs, so we
// dispatch the real drag event sequence sharing ONE DataTransfer object — the
// same object the source's onDragStart writes to and the target's onDrop reads.
async function dragRowOntoDay(page: Page, rowTestId: string, dayTestId: string) {
  await page.evaluate(
    ({ rowSel, daySel }) => {
      const source = document.querySelector(
        `[data-testid="${rowSel}"]`,
      ) as HTMLElement | null;
      const target = document.querySelector(
        `[data-testid="${daySel}"]`,
      ) as HTMLElement | null;
      if (!source) throw new Error(`drag source not found: ${rowSel}`);
      if (!target) throw new Error(`drop target not found: ${daySel}`);

      const dataTransfer = new DataTransfer();
      const fire = (el: Element, type: string) => {
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        );
      };

      fire(source, "dragstart");
      fire(target, "dragenter");
      fire(target, "dragover");
      fire(target, "drop");
      fire(source, "dragend");
    },
    { rowSel: rowTestId, daySel: dayTestId },
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// A day key (yyyy-mm-dd) for the 15th of the month `monthsAhead` from now.
// We schedule into a future month so the target day cell is empty and the
// dropped pill is never hidden by the grid's "+N more" 4-item truncation.
function futureDayKey(monthsAhead: number): {
  key: string;
  monthsAhead: number;
} {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 15);
  return {
    key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    monthsAhead,
  };
}

test.describe("Marketing calendar drag-and-drop scheduling — task #172", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await dismissWhatsNew(page);
    await page.goto("/app/marketing/marketing-calendar");
    // Defaults are month view + calendar view + no grouping, so the backlog
    // rail is present. Wait for it before seeding so tab context is bootstrapped.
    await expect(page.getByTestId("backlog-rail")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("dragging a single backlog draft onto a day schedules it on that date", async ({
    page,
  }) => {
    const title = `DnD single ${Date.now()}`;
    const id = await seedBacklogDraft(page, title);

    // Reload so React Query fetches the backlog including the new draft.
    await page.reload();
    const rail = page.getByTestId("backlog-rail");
    await expect(rail).toBeVisible({ timeout: 30_000 });

    const row = page.getByTestId(`backlog-rail-row-${id}`);
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Move two months forward to an empty target month.
    const { monthsAhead, key } = futureDayKey(2);
    for (let i = 0; i < monthsAhead; i++) {
      await page.getByTestId("button-next-period").click();
    }
    const dayCell = page.getByTestId(`day-cell-${key}`);
    await expect(dayCell).toBeVisible({ timeout: 15_000 });

    await dragRowOntoDay(page, `backlog-rail-row-${id}`, `day-cell-${key}`);

    // The draft is now scheduled: it appears as a pill in the target day cell…
    await expect(dayCell.getByTestId(`item-calendar-${id}`)).toBeVisible({
      timeout: 15_000,
    });
    // …and it has left the backlog rail.
    await expect(page.getByTestId(`backlog-rail-row-${id}`)).toHaveCount(0);
  });

  test("selecting multiple drafts moves all of them on a single drag", async ({
    page,
  }) => {
    const stamp = Date.now();
    const titleA = `DnD multi A ${stamp}`;
    const titleB = `DnD multi B ${stamp}`;
    const titleC = `DnD multi C ${stamp}`;
    const idA = await seedBacklogDraft(page, titleA);
    const idB = await seedBacklogDraft(page, titleB);
    const idC = await seedBacklogDraft(page, titleC);

    await page.reload();
    await expect(page.getByTestId("backlog-rail")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`backlog-rail-row-${idA}`)).toBeVisible({
      timeout: 30_000,
    });

    // Select A and B (leave C unselected to prove only the selection moves).
    await page.getByTestId(`checkbox-rail-${idA}`).click();
    await page.getByTestId(`checkbox-rail-${idB}`).click();

    // Drag one of the selected rows (A); the whole multi-selection should move.
    const { monthsAhead, key } = futureDayKey(3);
    for (let i = 0; i < monthsAhead; i++) {
      await page.getByTestId("button-next-period").click();
    }
    const dayCell = page.getByTestId(`day-cell-${key}`);
    await expect(dayCell).toBeVisible({ timeout: 15_000 });

    await dragRowOntoDay(page, `backlog-rail-row-${idA}`, `day-cell-${key}`);

    // Both selected drafts land on the day cell as pills…
    await expect(dayCell.getByTestId(`item-calendar-${idA}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(dayCell.getByTestId(`item-calendar-${idB}`)).toBeVisible({
      timeout: 15_000,
    });
    // …and both leave the backlog, while the unselected draft C stays.
    await expect(page.getByTestId(`backlog-rail-row-${idA}`)).toHaveCount(0);
    await expect(page.getByTestId(`backlog-rail-row-${idB}`)).toHaveCount(0);
    await expect(page.getByTestId(`backlog-rail-row-${idC}`)).toBeVisible();
  });
});
