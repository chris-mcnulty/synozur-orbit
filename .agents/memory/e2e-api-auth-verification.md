---
name: E2E API verification behind auth
description: How to verify auth-gated Orbit APIs when the browser preview only shows the login page
---

# E2E API verification behind auth

The app preview is login-gated, so screenshots can't verify app pages. Reliable pattern:

- Log in via `POST /api/login` with curl (`-c cookies.txt`), then call APIs with the cookie jar plus the per-tab `X-Active-Tenant-Id` header. Use a dedicated test user; set a random temporary password hash via SQL and overwrite it with a fresh random hash when done so no known credential remains.
- Frontend compile sanity without a browser: request the page module path from the Vite dev server — a 200 means it transforms cleanly.
- The dev server does NOT hot-reload backend code — restart the workflow after editing server routes or you'll test stale code.
- AI provider calls fail in this dev environment ("Replit AI Integrations is not configured", 404 across the whole model fallback chain) — a 500 from an AI endpoint here is usually environment, not code; confirm in logs that the route reached the provider call.
