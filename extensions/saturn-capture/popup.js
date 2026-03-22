/**
 * Saturn Capture — Popup Script
 *
 * Auth model: session cookie. The user must be logged into Orbit in this
 * browser. We call /api/extension/whoami to verify the session is active
 * and that the saturnCapture feature is enabled on their plan.
 */

const DEFAULT_ORBIT_URL = "https://app.synozur.com";

let orbitUrl = DEFAULT_ORBIT_URL;
let currentTab = null;
let pageMetadata = null;

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Load saved orbit URL
  const stored = await chrome.storage.sync.get(["orbitUrl"]);
  orbitUrl = stored.orbitUrl || DEFAULT_ORBIT_URL;
  document.getElementById("orbit-url").value = orbitUrl;

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Try to get page metadata from content script
  try {
    pageMetadata = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_METADATA" });
  } catch {
    pageMetadata = { title: tab.title, url: tab.url, description: "", content: "" };
  }

  if (pageMetadata) {
    document.getElementById("page-title").textContent = pageMetadata.title;
    document.getElementById("page-url").textContent = pageMetadata.url;
    document.getElementById("capture-title").value = pageMetadata.title;
  }

  // Check auth
  await checkAuth();

  // Wire up buttons
  document.getElementById("btn-capture").addEventListener("click", handleCapture);
  document.getElementById("btn-settings").addEventListener("click", showSettings);
  document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
  document.getElementById("btn-back").addEventListener("click", hideSettings);
  document.getElementById("open-orbit").href = orbitUrl;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

async function checkAuth() {
  const statusEl = document.getElementById("auth-status");
  const notAuthEl = document.getElementById("not-authenticated");
  const authEl = document.getElementById("authenticated");

  try {
    const res = await fetch(`${orbitUrl}/api/extension/whoami`, { credentials: "include" });
    if (!res.ok) throw new Error("not authenticated");
    const data = await res.json();

    if (!data.captureEnabled) {
      statusEl.textContent = "Feature locked";
      statusEl.className = "status error";
      showNotAuth("Saturn Capture requires an Enterprise plan. Contact sales to upgrade.");
      return;
    }

    statusEl.textContent = "Connected";
    statusEl.className = "status ok";
    notAuthEl.classList.add("hidden");
    authEl.classList.remove("hidden");
  } catch {
    statusEl.textContent = "Not signed in";
    statusEl.className = "status error";
    showNotAuth();
  }
}

function showNotAuth(message) {
  const notAuthEl = document.getElementById("not-authenticated");
  const authEl = document.getElementById("authenticated");
  if (message) {
    notAuthEl.querySelector(".hint").textContent = message;
  }
  notAuthEl.classList.remove("hidden");
  authEl.classList.add("hidden");
  document.getElementById("open-orbit").href = orbitUrl;
}

// ── Capture ───────────────────────────────────────────────────────────────────

async function handleCapture() {
  const btn = document.getElementById("btn-capture");
  const resultEl = document.getElementById("capture-result");
  const title = document.getElementById("capture-title").value.trim();
  const description = document.getElementById("capture-description").value.trim();
  const includeContent = document.getElementById("include-content").checked;

  if (!title) {
    showResult("Please enter a title.", false);
    return;
  }

  btn.disabled = true;
  btn.textContent = "Adding...";
  resultEl.classList.add("hidden");

  try {
    const payload = {
      title,
      description: description || undefined,
      url: pageMetadata?.url,
      content: includeContent ? pageMetadata?.content : undefined,
    };

    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_PAGE", payload });

    if (response.ok) {
      showResult("Added to Content Library!", true);
      btn.textContent = "Added!";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Add to Content Library";
        resultEl.classList.add("hidden");
      }, 2500);
    } else {
      throw new Error(response.error || "Capture failed");
    }
  } catch (err) {
    showResult(err.message, false);
    btn.disabled = false;
    btn.textContent = "Add to Content Library";
  }
}

function showResult(message, success) {
  const el = document.getElementById("capture-result");
  el.textContent = message;
  el.className = `result ${success ? "success" : "error"}`;
  el.classList.remove("hidden");
}

// ── Settings ──────────────────────────────────────────────────────────────────

function showSettings() {
  document.getElementById("authenticated").classList.add("hidden");
  document.getElementById("not-authenticated").classList.add("hidden");
  document.getElementById("settings-panel").classList.remove("hidden");
  document.getElementById("btn-settings").classList.add("hidden");
}

function hideSettings() {
  document.getElementById("settings-panel").classList.add("hidden");
  document.getElementById("btn-settings").classList.remove("hidden");
  checkAuth(); // re-check after settings change
}

async function saveSettings() {
  const url = document.getElementById("orbit-url").value.trim().replace(/\/$/, "");
  if (!url) return;
  orbitUrl = url;
  await chrome.storage.sync.set({ orbitUrl });
  hideSettings();
}
