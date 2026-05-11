/**
 * Repair URLs that are missing the colon in the scheme separator.
 * e.g. "https///example.com"  →  "https://example.com"
 *      "http//example.com"    →  "http://example.com"
 */
function repairScheme(url: string): string {
  return url.replace(/^(https?)\/{1,3}([^/])/i, "$1://$2");
}

export function normalizeToCanonicalDomain(urlInput: string): string {
  let url = urlInput.trim();

  url = repairScheme(url);

  if (!url.includes("://")) {
    url = "https://" + url;
  }

  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    hostname = url.replace(/^https?:\/\//i, "").split("/")[0].split("?")[0].split("#")[0].toLowerCase();
  }

  hostname = hostname.replace(/^www\d*\./, "");

  hostname = hostname.replace(/\.$/, "");

  return hostname;
}

export function normalizeUrl(urlInput: string): string {
  let url = urlInput.trim();
  url = repairScheme(url);
  if (!url.includes("://")) {
    url = "https://" + url;
  }
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return url;
  }
}

/**
 * Returns true if the given URL string is parseable and has a non-empty
 * hostname. Use this to guard crawl/fetch entry points before attempting
 * network requests.
 */
export function isValidUrl(urlInput: string): boolean {
  if (!urlInput || typeof urlInput !== "string") return false;
  const repaired = normalizeUrl(urlInput);
  try {
    const parsed = new URL(repaired);
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}
