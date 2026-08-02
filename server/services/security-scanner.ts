/**
 * Built-in security scanner — checks registered application URLs for common
 * security misconfigurations: missing/weak security headers, information
 * disclosure, insecure cookies, mixed content, and exposed sensitive paths.
 *
 * Runs entirely in-process using Node fetch + the existing headless browser.
 * No external scanning service required.
 */

import { getBrowserPage, releaseBrowserPage } from "./headless-crawler";
import type { ScannerProvider, ScanRequest, ScanResult, ScannerFinding } from "./observatory-scanners";

// ── Header checks ────────────────────────────────────────────────────────────

interface HeaderCheck {
  ruleId: string;
  title: string;
  description: string;
  recommendation: string;
  severity: string;
  wcagOrCwe?: string;
  test: (headers: Record<string, string>, url: string) => boolean; // true = finding (bad)
}

const HEADER_CHECKS: HeaderCheck[] = [
  {
    ruleId: "missing-hsts",
    title: "Strict-Transport-Security (HSTS) header missing",
    description: "The server does not set the Strict-Transport-Security header. Without HSTS, browsers may connect over plain HTTP, exposing users to downgrade attacks.",
    recommendation: "Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
    severity: "High",
    wcagOrCwe: "CWE-319",
    test: (h, url) => url.startsWith("https") && !h["strict-transport-security"],
  },
  {
    ruleId: "missing-csp",
    title: "Content-Security-Policy header missing",
    description: "No Content-Security-Policy header found. CSP reduces XSS risk by controlling which resources the browser is allowed to load.",
    recommendation: "Define a restrictive CSP appropriate to your application's resource requirements.",
    severity: "High",
    wcagOrCwe: "CWE-1021",
    test: (h) => !h["content-security-policy"],
  },
  {
    ruleId: "missing-xcto",
    title: "X-Content-Type-Options header missing",
    description: "The X-Content-Type-Options: nosniff header is absent. This allows browsers to MIME-sniff responses away from the declared content type.",
    recommendation: "Add: X-Content-Type-Options: nosniff",
    severity: "Medium",
    wcagOrCwe: "CWE-693",
    test: (h) => !h["x-content-type-options"],
  },
  {
    ruleId: "missing-xframe",
    title: "Clickjacking protection missing",
    description: "No X-Frame-Options or frame-ancestors CSP directive found. The page may be embeddable in iframes, enabling clickjacking attacks.",
    recommendation: "Add X-Frame-Options: DENY or SAMEORIGIN, or include frame-ancestors in your CSP.",
    severity: "Medium",
    wcagOrCwe: "CWE-1021",
    test: (h) => {
      const hasXFrame = !!h["x-frame-options"];
      const csp = h["content-security-policy"] ?? "";
      const hasFrameAncestors = csp.includes("frame-ancestors");
      return !hasXFrame && !hasFrameAncestors;
    },
  },
  {
    ruleId: "missing-referrer-policy",
    title: "Referrer-Policy header missing",
    description: "No Referrer-Policy header found. Browsers may send the full URL as a Referer, leaking sensitive path or query parameters to third parties.",
    recommendation: "Add: Referrer-Policy: strict-origin-when-cross-origin",
    severity: "Low",
    test: (h) => !h["referrer-policy"],
  },
  {
    ruleId: "server-version-disclosure",
    title: "Server version information disclosed in headers",
    description: "The Server or X-Powered-By header includes version information that helps attackers fingerprint the stack and target known vulnerabilities.",
    recommendation: "Remove version tokens from Server and X-Powered-By headers.",
    severity: "Low",
    wcagOrCwe: "CWE-200",
    test: (h) => {
      const server = h["server"] ?? "";
      const xPoweredBy = h["x-powered-by"] ?? "";
      return /[\d.]/.test(server) || xPoweredBy.length > 0;
    },
  },
];

// Sensitive paths to probe (returns 200 = potential exposure)
const SENSITIVE_PATHS = [
  { path: "/.env",              ruleId: "exposed-env-file",        title: "Environment file (.env) publicly accessible",       severity: "Critical", cwe: "CWE-538" },
  { path: "/.git/config",       ruleId: "exposed-git-config",      title: "Git repository config publicly accessible",          severity: "Critical", cwe: "CWE-538" },
  { path: "/phpinfo.php",       ruleId: "exposed-phpinfo",         title: "PHP configuration info page publicly accessible",    severity: "High",     cwe: "CWE-200" },
  { path: "/admin",             ruleId: "exposed-admin-path",      title: "Admin interface accessible without authentication",  severity: "High",     cwe: "CWE-287" },
  { path: "/wp-admin",          ruleId: "exposed-wp-admin",        title: "WordPress admin panel accessible",                  severity: "Medium",   cwe: "CWE-287" },
  { path: "/.DS_Store",         ruleId: "exposed-ds-store",        title: "macOS .DS_Store metadata file exposed",             severity: "Low",      cwe: "CWE-538" },
  { path: "/server-status",     ruleId: "exposed-server-status",   title: "Apache server-status page accessible",              severity: "Medium",   cwe: "CWE-200" },
  { path: "/actuator/health",   ruleId: "exposed-actuator",        title: "Spring Boot actuator endpoints accessible",         severity: "Medium",   cwe: "CWE-200" },
  { path: "/swagger-ui.html",   ruleId: "exposed-swagger",         title: "Swagger UI accessible in production",               severity: "Low",      cwe: "CWE-200" },
  { path: "/api-docs",          ruleId: "exposed-api-docs",        title: "API documentation exposed publicly",                severity: "Low",      cwe: "CWE-200" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function headersToLower(raw: Record<string, string> | Headers): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    raw.forEach((v, k) => { out[k.toLowerCase()] = v; });
  } else {
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v;
  }
  return out;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Scanner implementation ───────────────────────────────────────────────────

export const securityScanner: ScannerProvider = {
  key: "observatory_security",
  name: "Observatory Security Scanner (built-in)",
  assessmentTypes: ["penetration_test", "security_source_review"],

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async runScan(request: ScanRequest): Promise<ScanResult> {
    const startedAt = new Date();
    const targetUrl = request.target.url;
    if (!targetUrl) throw new Error("security scan requires a target URL");

    const findings: ScannerFinding[] = [];
    const rawReport: Record<string, unknown> = { url: targetUrl, checks: [] };

    // ── 1. Header analysis ─────────────────────────────────────────────────
    console.log(`[SecurityScanner] Checking headers for ${targetUrl}`);
    const headResp = await fetchWithTimeout(targetUrl);
    if (headResp) {
      const headers = headersToLower(headResp.headers);
      rawReport.responseStatus = headResp.status;
      rawReport.headers = headers;

      for (const check of HEADER_CHECKS) {
        if (check.test(headers, targetUrl)) {
          findings.push({
            ruleId: check.ruleId,
            title: check.title,
            description: check.description,
            severity: check.severity,
            cweId: check.wcagOrCwe?.startsWith("CWE") ? check.wcagOrCwe : undefined,
            location: { url: targetUrl },
            raw: { header: check.ruleId, presentHeaders: Object.keys(headers) },
          });
        }
      }
    } else {
      findings.push({
        ruleId: "unreachable-url",
        title: "Application URL not reachable",
        description: `Could not connect to ${targetUrl}. Verify the URL is correct and publicly accessible from the scanner.`,
        severity: "High",
        location: { url: targetUrl },
      });
    }

    // ── 2. Sensitive path probe ────────────────────────────────────────────
    console.log(`[SecurityScanner] Probing sensitive paths on ${targetUrl}`);
    const baseUrl = new URL(targetUrl).origin;
    const pathResults = await Promise.all(
      SENSITIVE_PATHS.map(async (sp) => {
        const probeUrl = `${baseUrl}${sp.path}`;
        const resp = await fetchWithTimeout(probeUrl, 8000);
        return { sp, status: resp?.status ?? null, probeUrl };
      }),
    );

    for (const { sp, status, probeUrl } of pathResults) {
      if (status === 200) {
        findings.push({
          ruleId: sp.ruleId,
          title: sp.title,
          description: `The path \`${sp.path}\` returned HTTP 200. This resource may expose sensitive information or allow unauthorised access.`,
          severity: sp.severity,
          cweId: sp.cwe,
          location: { url: probeUrl },
          raw: { path: sp.path, status },
        });
      }
    }
    rawReport.sensitivePathResults = pathResults.map(({ sp, status }) => ({ path: sp.path, status }));

    // ── 3. Mixed content detection (headless) ──────────────────────────────
    if (targetUrl.startsWith("https://")) {
      let page: Awaited<ReturnType<typeof getBrowserPage>> | null = null;
      try {
        console.log(`[SecurityScanner] Checking mixed content on ${targetUrl}`);
        page = await getBrowserPage();
        const mixedContentUrls: string[] = [];

        page.on("response", (response) => {
          const url = response.url();
          if (url.startsWith("http://") && response.status() < 400) {
            mixedContentUrls.push(url);
          }
        });

        await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 20000 });
        await new Promise(r => setTimeout(r, 1000));

        if (mixedContentUrls.length > 0) {
          findings.push({
            ruleId: "mixed-content",
            title: "Mixed content — HTTP resources loaded on HTTPS page",
            description: `The page loads ${mixedContentUrls.length} resource(s) over HTTP:\n${mixedContentUrls.slice(0, 10).map(u => `• ${u}`).join("\n")}`,
            severity: "Medium",
            cweId: "CWE-319",
            location: { url: targetUrl },
            raw: { mixedContentUrls },
          });
        }
        rawReport.mixedContentUrls = mixedContentUrls;
      } catch (err) {
        console.warn(`[SecurityScanner] Mixed content check failed: ${(err as Error).message}`);
      } finally {
        if (page) releaseBrowserPage(page);
      }
    }

    // ── 4. Cookie security (headless) ─────────────────────────────────────
    {
      let page: Awaited<ReturnType<typeof getBrowserPage>> | null = null;
      try {
        page = await getBrowserPage();
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        const cookies = await page.cookies();
        const insecureCookies = cookies.filter(c =>
          !c.httpOnly || !c.secure || !c.sameSite || c.sameSite === "None",
        );
        if (insecureCookies.length > 0) {
          findings.push({
            ruleId: "insecure-cookies",
            title: "Cookies missing security flags",
            description: `${insecureCookies.length} cookie(s) are missing HttpOnly, Secure, or SameSite flags:\n${insecureCookies.map(c => `• ${c.name} (httpOnly:${c.httpOnly}, secure:${c.secure}, sameSite:${c.sameSite ?? "not set"})`).join("\n")}`,
            severity: "Medium",
            cweId: "CWE-614",
            location: { url: targetUrl },
            raw: { insecureCookies: insecureCookies.map(c => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })) },
          });
        }
        rawReport.cookieCheck = { total: cookies.length, insecure: insecureCookies.length };
      } catch (err) {
        console.warn(`[SecurityScanner] Cookie check failed: ${(err as Error).message}`);
      } finally {
        if (page) releaseBrowserPage(page);
      }
    }

    console.log(`[SecurityScanner] ${targetUrl} — ${findings.length} findings`);

    return {
      findings,
      rawReport: {
        contentType: "application/json",
        body: JSON.stringify(rawReport, null, 2),
      },
      tool: "observatory-security-scanner@1.0",
      startedAt,
      finishedAt: new Date(),
    };
  },
};
