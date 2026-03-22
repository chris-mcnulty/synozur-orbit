# Saturn Capture for Orbit

A Chromium-compatible browser extension that lets users capture web pages and images directly into the Orbit Content Library.

## How it works

- **Auth**: Uses the existing Orbit session cookie. The user must be signed into Orbit in the same browser profile. No API keys or separate login required.
- **Capture modes**: Toolbar popup (full page) or right-click context menu (specific image or page).
- **Destination**: All captured items land in `/app/marketing/content-library`, scoped to the user's active tenant and market.
- **Feature gate**: Requires the `saturnCapture` feature to be enabled (Enterprise plan).

## Installation (development)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory (`extensions/saturn-capture`)

## Configuration

By default the extension targets `https://app.synozur.com`. To point it at a local dev server:

1. Click the extension icon → **Settings**
2. Set Orbit URL to `http://localhost:5000`
3. Click **Save**

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker — context menus, API calls |
| `content.js` | Content script — extracts page metadata |
| `popup.html/css/js` | Toolbar popup UI |
