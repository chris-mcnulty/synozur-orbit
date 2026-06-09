# E2E tests

Playwright specs covering the inline-validation behavior introduced in task #67
and locked in by task #81, plus the marketing-calendar backlog bulk actions.

> **Auth note:** the seeded `e2e-test@synozur.com` password is environment
> specific. Set `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` to override. The
> backlog spec falls back to `TEST_EMAIL` / `TEST_PASSWORD`
> (`test@synozur.com` by default), which is a Standard User on the
> enterprise `synozur.com` tenant.

## Prerequisites

1. The dev server must be running on `http://localhost:5000`
   (`npm run dev`). For tests run against the public dev URL, set
   `E2E_BASE_URL=https://<your-replit-host>` before invoking Playwright.
2. The seeded local-auth user `e2e-test@synozur.com` must exist and have a
   known password. Set `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` in the
   environment, or rely on the defaults `e2e-test@synozur.com` /
   `E2eTestPass!1`.
3. The user's tenant must be on a plan that exposes campaigns and
   personaBuilder (the seeded `synozur.com` tenant has
   `billing_managed_manually=true` so `plan="enterprise"` resolves correctly
   without an active Stripe subscription).

## Running

```
E2E_BASE_URL=http://localhost:5000 npx playwright test
```

Browser binaries are downloaded on demand via
`npx playwright install chromium`. The required system libraries
(glib, nss, dbus, fontconfig, the X11 stack, etc.) are declared in
`replit.nix`.

## Coverage

`inline-validation.spec.ts` exercises:

- **Competitor social-link editor** (`/app/competitors`) — bad LinkedIn,
  Twitter, Instagram, and blog URLs surface inline error messages, set
  `aria-invalid`, and disable the Save button. Clearing the inputs
  re-enables Save.
- **Campaign wizard** (`/app/marketing/campaigns`) — step 0 (Details)
  refuses forward navigation when the name is empty (Next disabled, future
  step badge click reveals `error-campaign-name`); step 3 (Schedule)
  surfaces inline `error-number-of-days` (for 0 and 999) and
  `error-start-date` after clicking Create with invalid input, with
  `aria-invalid` set on the offending input and the inline error
  clearing once the field is fixed.
- **Persona TagInput** (`/app/marketing/personas`) — empty pain-point /
  goal / objection submissions surface the animated inline error,
  duplicate (case-insensitive) tags are rejected, and typing into the
  input clears the error.

The inline-validation flows close their dialog with Escape rather than
saving so they do not mutate any persisted records.

`backlog-bulk-actions.spec.ts` exercises the **Marketing Calendar backlog**
(`/app/marketing/marketing-calendar`, Backlog tab): it seeds ten unscheduled
drafts (social, email, content) via `POST /api/marketing-calendar/items`,
then runs each bulk action through the UI and asserts the outcome —
**schedule** removes items from the backlog (and they appear in the calendar
grid), **approve** flips email/content to the "Approved" lifecycle while they
stay in the backlog, **assign** attaches a campaign, and **discard** removes
items from the backlog. Everything it creates is cleaned up at the end via
`DELETE /api/marketing-calendar/items/:type/:id`.
