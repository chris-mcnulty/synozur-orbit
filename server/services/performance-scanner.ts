/**
 * Built-in performance scanner — loads the application URL in the headless
 * browser and captures Core Web Vitals, navigation timing, and resource
 * metrics. Flags findings where measurements breach configurable SLA thresholds.
 */

import { getBrowserPage, releaseBrowserPage } from "./headless-crawler";
import type { ScannerProvider, ScanRequest, ScanResult, ScannerFinding } from "./observatory-scanners";

// Default SLA thresholds (ms). Override via request.options.thresholds.
const DEFAULT_THRESHOLDS = {
  ttfbMs: 800,        // Time to First Byte
  fcp: 2500,          // First Contentful Paint (Core Web Vital)
  lcp: 4000,          // Largest Contentful Paint (Core Web Vital — needs improvement threshold)
  cls: 0.25,          // Cumulative Layout Shift (needs improvement — float, not ms)
  domReadyMs: 3000,   // DOMContentLoaded
  loadMs: 5000,       // window.onload
};

interface PerfTiming {
  ttfbMs: number;
  domReadyMs: number;
  loadMs: number;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  transferSizeKb: number;
  resourceCount: number;
}

export const performanceScanner: ScannerProvider = {
  key: "observatory_performance",
  name: "Observatory Performance Scanner (built-in)",
  assessmentTypes: ["performance"],

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async runScan(request: ScanRequest): Promise<ScanResult> {
    const startedAt = new Date();
    const targetUrl = request.target.url;
    if (!targetUrl) throw new Error("performance scan requires a target URL");

    const thresholds = { ...DEFAULT_THRESHOLDS, ...(request.options?.thresholds as Partial<typeof DEFAULT_THRESHOLDS> ?? {}) };
    const findings: ScannerFinding[] = [];

    let page: Awaited<ReturnType<typeof getBrowserPage>> | null = null;
    let timing: PerfTiming | null = null;

    try {
      console.log(`[PerformanceScanner] Scanning ${targetUrl}`);
      page = await getBrowserPage();

      // Disable cache for accurate measurement
      await page.setCacheEnabled(false);

      // Enable performance metrics
      await (page as any)._client().send("Performance.enable").catch(() => {});

      const lcpValues: number[] = [];
      const clsValues: number[] = [];

      // Observe LCP and CLS via PerformanceObserver injected before navigation
      await page.evaluateOnNewDocument(() => {
        (window as any).__obs_lcp = [];
        (window as any).__obs_cls = 0;

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              (window as any).__obs_lcp.push(entry.startTime);
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch {}

        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as any[]) {
              if (!entry.hadRecentInput) (window as any).__obs_cls += entry.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
      });

      await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 40000 });

      // Wait a moment for LCP/CLS to settle
      await new Promise(r => setTimeout(r, 2000));

      timing = await page.evaluate((): PerfTiming => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

        const paintEntries = performance.getEntriesByType("paint");
        const fcpEntry = paintEntries.find(e => e.name === "first-contentful-paint");

        const lcpArr = (window as any).__obs_lcp as number[];
        const clsVal = (window as any).__obs_cls as number;

        return {
          ttfbMs: Math.round(nav.responseStart - nav.requestStart),
          domReadyMs: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
          loadMs: Math.round(nav.loadEventEnd - nav.fetchStart),
          fcp: fcpEntry ? Math.round(fcpEntry.startTime) : null,
          lcp: lcpArr.length > 0 ? Math.round(Math.max(...lcpArr)) : null,
          cls: typeof clsVal === "number" ? Math.round(clsVal * 1000) / 1000 : null,
          transferSizeKb: Math.round(resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) / 1024),
          resourceCount: resources.length,
        };
      });

      console.log(`[PerformanceScanner] ${targetUrl} — TTFB:${timing.ttfbMs}ms Load:${timing.loadMs}ms FCP:${timing.fcp}ms LCP:${timing.lcp}ms CLS:${timing.cls}`);

      // ── Flag threshold breaches as findings ────────────────────────────

      if (timing.ttfbMs > thresholds.ttfbMs) {
        findings.push({
          ruleId: "slow-ttfb",
          title: `Slow time to first byte (${timing.ttfbMs}ms, threshold: ${thresholds.ttfbMs}ms)`,
          description: `The server took ${timing.ttfbMs}ms to begin returning a response. This suggests slow server-side processing, database queries, or network latency. Target: under ${thresholds.ttfbMs}ms.`,
          severity: timing.ttfbMs > thresholds.ttfbMs * 2 ? "High" : "Medium",
          location: { url: targetUrl },
          raw: { measured: timing.ttfbMs, threshold: thresholds.ttfbMs },
        });
      }

      if (timing.fcp !== null && timing.fcp > thresholds.fcp) {
        findings.push({
          ruleId: "slow-fcp",
          title: `First Contentful Paint too slow (${timing.fcp}ms, threshold: ${thresholds.fcp}ms)`,
          description: `FCP measures how long until the first text or image is visible. ${timing.fcp}ms exceeds the ${thresholds.fcp}ms threshold. Common causes: render-blocking CSS/JS, large HTML, slow server response.`,
          severity: timing.fcp > 4000 ? "High" : "Medium",
          location: { url: targetUrl },
          raw: { measured: timing.fcp, threshold: thresholds.fcp },
        });
      }

      if (timing.lcp !== null && timing.lcp > thresholds.lcp) {
        findings.push({
          ruleId: "slow-lcp",
          title: `Largest Contentful Paint too slow (${timing.lcp}ms, threshold: ${thresholds.lcp}ms)`,
          description: `LCP measures when the largest visible element is rendered. ${timing.lcp}ms indicates poor perceived load performance. Target: under 2,500ms (good), under 4,000ms (needs improvement).`,
          severity: timing.lcp > 6000 ? "High" : "Medium",
          location: { url: targetUrl },
          raw: { measured: timing.lcp, threshold: thresholds.lcp },
        });
      }

      if (timing.cls !== null && timing.cls > thresholds.cls) {
        findings.push({
          ruleId: "high-cls",
          title: `Cumulative Layout Shift too high (CLS: ${timing.cls}, threshold: ${thresholds.cls})`,
          description: `CLS measures visual stability — how much page content shifts unexpectedly during load. A score of ${timing.cls} indicates elements are moving significantly. Target: under 0.1 (good), under 0.25 (needs improvement).`,
          severity: timing.cls > 0.5 ? "High" : "Medium",
          location: { url: targetUrl },
          raw: { measured: timing.cls, threshold: thresholds.cls },
        });
      }

      if (timing.loadMs > thresholds.loadMs) {
        findings.push({
          ruleId: "slow-load",
          title: `Page load time exceeds SLA (${timing.loadMs}ms, threshold: ${thresholds.loadMs}ms)`,
          description: `Total page load time is ${timing.loadMs}ms across ${timing.resourceCount} resources (${timing.transferSizeKb}KB transferred). This exceeds the ${thresholds.loadMs}ms SLA threshold.`,
          severity: timing.loadMs > thresholds.loadMs * 2 ? "High" : "Medium",
          location: { url: targetUrl },
          raw: { measured: timing.loadMs, threshold: thresholds.loadMs, resourceCount: timing.resourceCount, transferSizeKb: timing.transferSizeKb },
        });
      }

    } finally {
      if (page) releaseBrowserPage(page);
    }

    const rawReport = { url: targetUrl, timing, thresholds, findings: findings.length };

    return {
      findings,
      rawReport: {
        contentType: "application/json",
        body: JSON.stringify(rawReport, null, 2),
      },
      tool: "observatory-performance-scanner@1.0",
      startedAt,
      finishedAt: new Date(),
    };
  },
};
