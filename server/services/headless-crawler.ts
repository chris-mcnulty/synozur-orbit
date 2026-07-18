import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs";

interface HeadlessCrawlResult {
  html: string;
  finalUrl: string;
  renderedContent: string;
}

// Find system Chromium executable for production deployment
async function findChromiumPath(): Promise<string | undefined> {
  const possiblePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean) as string[];
  
  for (const execPath of possiblePaths) {
    try {
      if (fs.existsSync(execPath)) {
        return execPath;
      }
    } catch {
      continue;
    }
  }
  
  return undefined;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let browserInstance: Browser | null = null;
let activeCrawls = 0;
const MAX_CONCURRENT_CRAWLS = 2;
const crawlWaitQueue: Array<() => void> = [];

// Acquire a headless crawl slot, WAITING (queuing) when at capacity rather than
// bailing out. Previously we returned null when full, which forced callers to
// fall back to plain HTTP — for client-rendered SPAs that yields only the empty
// app shell, making multi-page crawls both content-poor and nondeterministic
// (a different subset of pages won the race each run, causing false "change"
// alerts). Queuing guarantees every page is actually rendered.
async function acquireCrawlSlot(): Promise<void> {
  if (activeCrawls < MAX_CONCURRENT_CRAWLS) {
    activeCrawls++;
    return;
  }
  await new Promise<void>((resolve) => crawlWaitQueue.push(resolve));
  // Slot ownership was handed directly to us by releaseCrawlSlot (activeCrawls
  // was left incremented on our behalf), so we do not increment again here.
}

function releaseCrawlSlot(): void {
  const next = crawlWaitQueue.shift();
  if (next) {
    next(); // Hand our slot to the next waiter; activeCrawls stays the same.
  } else {
    activeCrawls--;
  }
}

// Circuit breaker: in some production environments Chromium cannot launch at
// all (puppeteer waits 30s for the WS endpoint, then throws). Without a
// breaker every page burns ~90-120s of launch retries before falling back to
// HTTP, so multi-page crawls always exceed the job timeout and nothing ever
// completes. After repeated launch failures we disable headless for a
// cooldown window and callers skip straight to HTTP.
let launchFailureCount = 0;
let headlessDisabledUntil = 0;
const LAUNCH_FAILURE_THRESHOLD = 2;
const HEADLESS_COOLDOWN_MS = 10 * 60 * 1000;

function recordLaunchFailure(err: unknown): void {
  launchFailureCount++;
  if (launchFailureCount >= LAUNCH_FAILURE_THRESHOLD) {
    headlessDisabledUntil = Date.now() + HEADLESS_COOLDOWN_MS;
    console.error(
      `[Headless Crawler] Browser failed to launch ${launchFailureCount}x — disabling headless for ${HEADLESS_COOLDOWN_MS / 60000} min, falling back to HTTP. Last error: ${(err as any)?.message?.substring(0, 150)}`
    );
  }
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    try {
      if (browserInstance.connected) {
        return browserInstance;
      }
    } catch {
      // Browser reference is stale
    }
    // Clean up dead browser instance
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
  }

  const executablePath = await findChromiumPath();
  console.log(`[Headless Crawler] Using chromium path: ${executablePath || 'auto-detect'}`);

  try {
    browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    protocolTimeout: 30000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
      "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--js-flags=--max-old-space-size=256",
    ],
    });
    launchFailureCount = 0;
  } catch (err) {
    browserInstance = null;
    recordLaunchFailure(err);
    throw err;
  }

  browserInstance.on("disconnected", () => {
    console.log("[Headless Crawler] Browser disconnected, will recreate on next request");
    browserInstance = null;
  });

  return browserInstance;
}

async function setupStealthPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  const userAgent = getRandomUserAgent();

  await page.setUserAgent(userAgent);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client", filename: "internal-nacl-plugin" },
      ],
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });

    Object.defineProperty(navigator, "hardwareConcurrency", {
      get: () => 8,
    });

    Object.defineProperty(navigator, "deviceMemory", {
      get: () => 8,
    });

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: PermissionDescriptor) => {
      if (parameters.name === "notifications") {
        return Promise.resolve({ state: "denied" } as PermissionStatus);
      }
      return originalQuery(parameters);
    };

    Object.defineProperty(window, "chrome", {
      get: () => ({
        runtime: {},
        loadTimes: () => {},
        csi: () => {},
        app: {},
      }),
    });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      const originalGetImageData = context.getImageData;
      context.getImageData = function(...args: Parameters<typeof originalGetImageData>) {
        return originalGetImageData.apply(this, args);
      };
    }
  });

  return page;
}

export async function fetchPageHeadless(
  url: string,
  options: {
    waitForSelector?: string;
    waitTime?: number;
    retries?: number;
    timeout?: number;
  } = {}
): Promise<HeadlessCrawlResult | null> {
  // Circuit breaker tripped — skip headless entirely so callers fall back to
  // HTTP immediately instead of queueing behind doomed launch attempts.
  if (!isHeadlessAvailable()) {
    return null;
  }
  await acquireCrawlSlot();
  try {
    return await _fetchPageHeadlessInner(url, options);
  } finally {
    releaseCrawlSlot();
  }
}

async function _fetchPageHeadlessInner(
  url: string,
  options: {
    waitForSelector?: string;
    waitTime?: number;
    retries?: number;
    timeout?: number;
  } = {}
): Promise<HeadlessCrawlResult | null> {
  const {
    waitForSelector,
    waitTime = 2000,
    retries = 2,
    timeout = 30000,
  } = options;

  let page: Page | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Breaker may have tripped during a previous attempt (or another
      // concurrent crawl) — stop retrying immediately.
      if (!isHeadlessAvailable()) return null;
      if (attempt > 0) {
        await delay(1000 + Math.random() * 2000);
      }

      const hardTimeout = new Promise<null>((resolve) => {
        setTimeout(() => {
          console.warn(`[Headless] Hard timeout reached for ${url} (attempt ${attempt + 1})`);
          resolve(null);
        }, timeout + 10000);
      });

      const crawlWork = async (): Promise<HeadlessCrawlResult | null> => {
        const browser = await getBrowser();
        page = await setupStealthPage(browser);

        page.setDefaultNavigationTimeout(timeout);
        page.setDefaultTimeout(timeout);

        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout,
        });

        if (waitForSelector) {
          try {
            // Allow up to 10 s for slow SPAs to inject OG tags; failure is
            // non-fatal — we'll snapshot whatever the page has at that point.
            await page.waitForSelector(waitForSelector, { timeout: 10000 });
          } catch {
            // Selector never appeared; continue and snapshot what we have.
          }
        }

        await delay(waitTime + Math.random() * 1000);

        const html = await page.content();
        const finalUrl = page.url();

        const renderedContent = await page.evaluate(() => {
          const elementsToRemove = document.querySelectorAll(
            "script, style, nav, footer, header, noscript, svg, iframe"
          );
          elementsToRemove.forEach(el => el.remove());
          return document.body?.innerText || "";
        });

        await page.close();
        page = null;

        return {
          html,
          finalUrl,
          renderedContent: renderedContent.replace(/\s+/g, " ").trim(),
        };
      };

      const result = await Promise.race([crawlWork(), hardTimeout]);
      if (result) return result;
      
      try { if (page) await (page as Page).close(); } catch {}
      page = null;
      
      if (attempt >= retries) return null;
    } catch (error: any) {
      const isProtocolError = error?.message?.includes("ProtocolError") || 
                               error?.message?.includes("timed out") ||
                               error?.message?.includes("Target closed") ||
                               error?.message?.includes("Session closed");

      if (isProtocolError) {
        console.warn(`[Headless] Protocol error for ${url}, resetting browser: ${error.message?.substring(0, 100)}`);
        try { if (browserInstance) await browserInstance.close(); } catch {}
        browserInstance = null;
      } else {
        console.error(`Headless fetch failed for ${url} (attempt ${attempt + 1}):`, error);
      }

      try { if (page) await (page as Page).close(); } catch {}
      page = null;

      if (attempt >= retries) {
        return null;
      }
    }
  }

  return null;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
  }
}

export async function fetchMultiplePagesHeadless(
  urls: string[],
  options: {
    waitTime?: number;
    timeout?: number;
    concurrency?: number;
  } = {}
): Promise<Map<string, HeadlessCrawlResult | null>> {
  const { waitTime = 2000, timeout = 30000, concurrency = 3 } = options;
  const results = new Map<string, HeadlessCrawlResult | null>();

  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    chunks.push(urls.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(async (url) => {
        const result = await fetchPageHeadless(url, { waitTime, timeout });
        return { url, result };
      })
    );

    for (const { url, result } of chunkResults) {
      results.set(url, result);
    }

    if (chunk !== chunks[chunks.length - 1]) {
      await delay(500 + Math.random() * 1000);
    }
  }

  return results;
}

export function isHeadlessAvailable(): boolean {
  return Date.now() >= headlessDisabledUntil;
}

process.on("exit", () => {
  if (browserInstance) {
    try {
      browserInstance.close();
    } catch {}
  }
});

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});
