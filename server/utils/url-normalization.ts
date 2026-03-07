export function normalizeToCanonicalDomain(urlInput: string): string {
  let url = urlInput.trim();

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
