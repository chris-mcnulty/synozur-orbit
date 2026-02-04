import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";

const BASE_URL = "http://localhost:5000";
const SCREENSHOTS_DIR = path.join(process.cwd(), "client/src/assets/images/screenshots");

const pages = [
  { name: "market-intelligence", path: "/app", selector: ".grid", description: "Dashboard/Overview" },
  { name: "ai-analysis", path: "/app/analysis", selector: ".space-y-6", description: "Gap Analysis" },
  { name: "recommendations", path: "/app/recommendations", selector: ".space-y-6", description: "AI Recommendations" },
  { name: "battlecards", path: "/app/battlecards", selector: ".space-y-6", description: "Battlecards" },
  { name: "marketing-planner", path: "/app/marketing", selector: ".space-y-6", description: "Marketing Planner" },
  { name: "product-roadmap", path: "/app/products", selector: ".space-y-6", description: "Product Roadmap" },
  { name: "reporting", path: "/app/reports", selector: ".space-y-6", description: "Reports" },
];

async function captureScreenshots() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    console.log("Logging in...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2" });
    
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "chris.mcnulty@synozur.com");
    await page.type('input[type="password"]', process.env.TEST_PASSWORD || "test123");
    
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    ]);

    console.log("Logged in, waiting for dashboard...");
    await page.waitForTimeout(2000);

    for (const pageInfo of pages) {
      console.log(`Capturing ${pageInfo.description}...`);
      
      await page.goto(`${BASE_URL}${pageInfo.path}`, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForTimeout(2000);

      try {
        await page.waitForSelector(pageInfo.selector, { timeout: 10000 });
      } catch {
        console.log(`  Selector not found, capturing anyway...`);
      }

      await page.waitForTimeout(1000);

      const screenshotPath = path.join(SCREENSHOTS_DIR, `${pageInfo.name}.png`);
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: false,
      });
      
      console.log(`  Saved: ${screenshotPath}`);
    }

    console.log("\nAll screenshots captured successfully!");
  } catch (error) {
    console.error("Error capturing screenshots:", error);
  } finally {
    await browser.close();
  }
}

captureScreenshots();
