/**
 * Saturn Capture for Orbit — Background Service Worker
 *
 * Handles:
 *  - Context menu registration for image capture
 *  - Forwarding captured items to the Orbit API via session cookie
 *
 * Auth: The user must be logged into Orbit in the same browser profile.
 * The session cookie is automatically included in fetch() calls to the
 * Orbit domain because credentials: "include" is set.
 *
 * The Orbit API base URL is stored in chrome.storage.sync so the user
 * can configure it once from the popup settings.
 */

const DEFAULT_ORBIT_URL = "https://app.synozur.com";

// ── Context menu ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saturn-capture-image",
    title: "Add image to Orbit Content Library",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "saturn-capture-page",
    title: "Add page to Orbit Content Library",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const orbitUrl = await getOrbitUrl();

  if (info.menuItemId === "saturn-capture-image" && info.srcUrl) {
    await captureAsset(orbitUrl, {
      title: tab?.title ?? info.srcUrl,
      url: info.srcUrl,
      description: `Image captured from ${tab?.url}`,
    });
  }

  if (info.menuItemId === "saturn-capture-page" && tab?.url) {
    await captureAsset(orbitUrl, {
      title: tab.title ?? tab.url,
      url: tab.url,
      description: `Page captured via Saturn Capture`,
    });
  }
});

// ── Message handler (from popup.js) ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CAPTURE_PAGE") {
    getOrbitUrl().then((orbitUrl) =>
      captureAsset(orbitUrl, message.payload)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }))
    );
    return true; // keep channel open for async response
  }

  if (message.type === "CHECK_AUTH") {
    getOrbitUrl().then((orbitUrl) =>
      checkAuth(orbitUrl)
        .then((user) => sendResponse({ ok: true, user }))
        .catch((err) => sendResponse({ ok: false, error: err.message }))
    );
    return true;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getOrbitUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["orbitUrl"], (result) => {
      resolve(result.orbitUrl || DEFAULT_ORBIT_URL);
    });
  });
}

async function checkAuth(orbitUrl) {
  const res = await fetch(`${orbitUrl}/api/extension/whoami`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

async function captureAsset(orbitUrl, payload) {
  const res = await fetch(`${orbitUrl}/api/extension/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}
