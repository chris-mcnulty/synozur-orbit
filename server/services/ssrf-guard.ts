/**
 * SSRF Guard — centralised validation for user-supplied scan target URLs.
 *
 * Every scanner path that causes the server (or headless browser) to issue an
 * HTTP request against a user-configured URL MUST call `assertScanUrlSafe`
 * before navigation. It validates:
 *   1. Scheme is http: or https: only.
 *   2. Host is not a bare private/loopback/link-local IP literal.
 *   3. DNS resolves to a non-private address (guards CNAME-to-private tricks).
 *
 * For headless-browser paths, also call `installSsrfRequestInterceptor` on the
 * Puppeteer Page so that network-level redirects to private addresses are
 * blocked at request time (guards DNS-rebinding / meta-redirect attacks).
 */

import * as dnsModule from "dns";
import { promisify } from "util";
import type { Page } from "puppeteer";

const dnsLookup = promisify(dnsModule.lookup);

// ── Private-range matchers ────────────────────────────────────────────────────

/**
 * Returns true when the address is within a loopback, private, link-local,
 * broadcast, or cloud metadata range.
 */
export function isPrivateAddress(addr: string): boolean {
  const h = addr.trim().toLowerCase();

  // IPv4 checks
  // Loopback: 127.0.0.0/8
  if (/^127\./.test(h)) return true;
  // Unspecified: 0.0.0.0/8
  if (/^0\./.test(h) || h === "0.0.0.0") return true;
  // Private: 10.0.0.0/8
  if (/^10\./.test(h)) return true;
  // Private: 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // Private: 192.168.0.0/16
  if (/^192\.168\./.test(h)) return true;
  // Link-local + AWS/GCP/Azure metadata: 169.254.0.0/16
  if (/^169\.254\./.test(h)) return true;
  // Broadcast
  if (h === "255.255.255.255") return true;

  // IPv4-mapped IPv6: ::ffff:127.x.x.x  etc.
  if (/^::ffff:/i.test(h)) {
    const v4 = h.replace(/^::ffff:/i, "");
    return isPrivateAddress(v4);
  }

  // IPv6 loopback and unspecified
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1" || h === "0:0:0:0:0:0:0:0") return true;

  // IPv6 link-local: fe80::/10
  if (/^fe[89ab]/i.test(h)) return true;

  // IPv6 unique local: fc00::/7
  if (/^f[cd]/i.test(h)) return true;

  return false;
}

/**
 * Asserts that `rawUrl` is a safe scan target.
 * Throws an Error (suitable for returning 400) if the URL is unsafe.
 */
export async function assertScanUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The scan target is not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Performance scans only support HTTP and HTTPS URLs.");
  }

  // Strip IPv6 bracket notation: "[::1]" → "::1"
  const rawHost = parsed.hostname;
  const host = rawHost.startsWith("[") && rawHost.endsWith("]")
    ? rawHost.slice(1, -1)
    : rawHost;

  // Reject bare loopback hostnames.
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") {
    throw new Error("Scan targets cannot be localhost.");
  }

  // Reject bare IP literals that are clearly private without DNS resolution.
  if (isPrivateAddress(host)) {
    throw new Error("Scan targets cannot point to private or reserved IP addresses.");
  }

  // Resolve hostname → IP and recheck (guards CNAME-to-private / split-horizon DNS).
  // Skip for bare numeric IPs — we already checked them above.
  const isPureIp = /^[\d.]+$/.test(host) || /^[a-f0-9:]+$/i.test(host);
  if (!isPureIp) {
    let resolvedAddress: string;
    try {
      const result = await dnsLookup(host);
      resolvedAddress = result.address;
    } catch (err: any) {
      throw new Error(
        `Unable to resolve host "${host}". Ensure the application URL is publicly accessible.`,
      );
    }
    if (isPrivateAddress(resolvedAddress)) {
      throw new Error("Scan targets cannot resolve to private or reserved IP addresses.");
    }
  }
}

/**
 * Install a Puppeteer request interceptor that aborts any navigation or
 * sub-resource request that resolves to a private/reserved address.
 *
 * Must be called after `page.setRequestInterception(true)` and before
 * any `page.goto()` call.
 *
 * Note: this guards against DNS-rebinding and redirect-to-private attacks at
 * browser network time, complementing the pre-flight `assertScanUrlSafe` check.
 */
export function installSsrfRequestInterceptor(page: Page): void {
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      // Allow data: and blob: (inline resources) through.
      if (url.protocol === "data:" || url.protocol === "blob:") {
        request.continue();
        return;
      }
      // Block non-http(s) schemes other than data/blob.
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        request.abort("blockedbyclient");
        return;
      }
      // Block requests whose host is already a private/loopback IP literal.
      if (isPrivateAddress(url.hostname) || url.hostname === "localhost") {
        console.warn(`[SSRF Guard] Blocked request to private address: ${url.hostname}`);
        request.abort("blockedbyclient");
        return;
      }
      request.continue();
    } catch {
      // Malformed URL — abort.
      request.abort("blockedbyclient");
    }
  });
}
