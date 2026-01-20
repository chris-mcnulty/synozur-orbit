import puppeteer from "puppeteer";
import { objectStorageClient } from "../replit_integrations/object_storage/objectStorage";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

export interface VisualAssets {
  faviconUrl: string | null;
  screenshotUrl: string | null;
}

async function uploadToObjectStorage(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string | null> {
  try {
    if (!BUCKET_ID) {
      console.log("Object storage not configured, skipping upload");
      return null;
    }

    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(`public/competitor-assets/${filename}`);

    await file.save(buffer, {
      contentType,
      public: true,
    });

    return `https://storage.googleapis.com/${BUCKET_ID}/public/competitor-assets/${filename}`;
  } catch (error) {
    console.error("Failed to upload to object storage:", error);
    return null;
  }
}

export async function fetchFavicon(url: string, competitorId: string): Promise<string | null> {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    const faviconSources = [
      `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
      `${urlObj.origin}/favicon.ico`,
      `${urlObj.origin}/favicon.png`,
    ];

    for (const faviconUrl of faviconSources) {
      try {
        const response = await fetch(faviconUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 100) {
            const ext = faviconUrl.includes(".png") ? "png" : "ico";
            const filename = `${competitorId}-favicon.${ext}`;
            const uploadedUrl = await uploadToObjectStorage(buffer, filename, `image/${ext === "ico" ? "x-icon" : "png"}`);
            return uploadedUrl || faviconUrl;
          }
        }
      } catch {
        continue;
      }
    }

    return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  } catch (error) {
    console.error("Failed to fetch favicon:", error);
    return null;
  }
}

export async function captureScreenshot(url: string, competitorId: string): Promise<string | null> {
  // Screenshot capture disabled - causes puppeteer timeouts in production
  // and is not essential for competitor analysis functionality
  return null;
}

export async function captureVisualAssets(
  url: string,
  competitorId: string
): Promise<VisualAssets> {
  console.log(`Capturing visual assets for ${url}...`);

  const [faviconUrl, screenshotUrl] = await Promise.all([
    fetchFavicon(url, competitorId),
    captureScreenshot(url, competitorId),
  ]);

  console.log(`Visual assets captured: favicon=${!!faviconUrl}, screenshot=${!!screenshotUrl}`);

  return {
    faviconUrl,
    screenshotUrl,
  };
}
