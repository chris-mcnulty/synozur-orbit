/**
 * Saturn Capture — Content Script
 *
 * Runs on every page. Exposes a helper that the popup can trigger via
 * chrome.scripting.executeScript to extract page metadata.
 */

function getPageMetadata() {
  const title = document.title || location.href;
  const url = location.href;

  // Try to get meta description
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
  const description = metaDesc || ogDesc || "";

  // Try to get selected text
  const selectedText = window.getSelection()?.toString().trim() ?? "";

  // Try to get main article content
  const article = document.querySelector("article, main, [role='main']");
  const bodyText = article
    ? article.innerText.substring(0, 5000)
    : document.body.innerText.substring(0, 2000);

  return {
    title,
    url,
    description,
    content: selectedText || bodyText,
  };
}

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_METADATA") {
    sendResponse(getPageMetadata());
  }
});
