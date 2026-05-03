# E2E tests

Playwright specs covering the inline-validation behavior introduced in task #67
and locked in by task #81.

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

All flows close their dialog with Escape rather than saving so the tests
do not mutate any persisted records.
