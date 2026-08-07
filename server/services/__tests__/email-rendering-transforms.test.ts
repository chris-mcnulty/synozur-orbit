/**
 * Unit tests — email send-time HTML transform regressions (Task 653).
 *
 * Covers:
 *  1. wrapOutboundLinksInText: img src= attributes must NEVER be /r/-wrapped;
 *     anchor hrefs DO get wrapped.
 *  2. hardenCtaButtons: CTA anchors gain inline background-color; non-CTA
 *     anchors are unchanged.
 *  3. prepareEmailImages: tenant-ownership gate, non-image MIME, oversized
 *     files are all skipped; owned valid images are absolutized.
 *  4. injectFooter: mailing-address line present when mailingAddress is set,
 *     absent when not set; footer injected before </body> when present.
 */

import { strict as assert } from "node:assert";
import { describe, it, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the module before const
// declarations, so any variables the factory closes over must be declared via
// vi.hoisted() to ensure they are initialised before the factory runs.

const {
  mockSelectLimit,
  mockSelectWhere,
  mockSelectFrom,
  mockSelectCall,
  mockInsertValues,
  mockInsertCall,
  mockSearchPublicObject,
  mockGetObjectEntityFile,
  mockGetPublicObjectSearchPaths,
  mockFileSave,
  mockBucketFile,
  mockBucket,
} = vi.hoisted(() => {
  const mockSelectLimit = vi.fn();
  const mockSelectWhere = vi.fn();
  const mockSelectFrom = vi.fn();
  const mockSelectCall = vi.fn();
  const mockInsertValues = vi.fn();
  const mockInsertCall = vi.fn();
  const mockSearchPublicObject = vi.fn();
  const mockGetObjectEntityFile = vi.fn();
  const mockGetPublicObjectSearchPaths = vi.fn(() => ["/test-bucket/public-objects"]);
  const mockFileSave = vi.fn().mockResolvedValue(undefined);
  const mockBucketFile = vi.fn(() => ({ save: mockFileSave }));
  const mockBucket = vi.fn(() => ({ file: mockBucketFile }));
  return {
    mockSelectLimit,
    mockSelectWhere,
    mockSelectFrom,
    mockSelectCall,
    mockInsertValues,
    mockInsertCall,
    mockSearchPublicObject,
    mockGetObjectEntityFile,
    mockGetPublicObjectSearchPaths,
    mockFileSave,
    mockBucketFile,
    mockBucket,
  };
});

// ─── DB mock ──────────────────────────────────────────────────────────────────

vi.mock("../../db", () => ({
  db: {
    select: (...args: any[]) => mockSelectCall(...args),
    insert: (...args: any[]) => mockInsertCall(...args),
  },
}));

// ─── Object-storage mock ──────────────────────────────────────────────────────
// prepareEmailImages dynamically imports the object storage service. We provide
// a constructible (non-arrow) mock so `new ObjectStorageService()` works.

vi.mock("../../replit_integrations/object_storage/objectStorage", () => {
  // Must be a regular function so it can be called with `new`.
  function ObjectStorageService(this: any) {
    this.searchPublicObject = mockSearchPublicObject;
    this.getObjectEntityFile = mockGetObjectEntityFile;
    this.getPublicObjectSearchPaths = mockGetPublicObjectSearchPaths;
  }
  return {
    ObjectStorageService,
    objectStorageClient: { bucket: mockBucket },
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  hardenCtaButtons,
  prepareEmailImages,
  injectFooter,
} from "../email-campaign-sender";
import { wrapOutboundLinksInText } from "../marketing-links-helpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reset the fluent db.select chain to resolve with the given rows. */
function resetSelectChain(limitResult: any[]) {
  mockSelectLimit.mockResolvedValue(limitResult);
  mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
  mockSelectFrom.mockReturnValue({ where: mockSelectWhere, limit: mockSelectLimit });
  mockSelectCall.mockReturnValue({ from: mockSelectFrom });
}

/** Make getObjectEntityFile return a fake file with the given MIME/size. */
function mockFileWith({
  contentType,
  size,
  data = Buffer.from("fake-image"),
}: {
  contentType: string;
  size: number;
  data?: Buffer;
}) {
  const fakeFile = {
    getMetadata: vi.fn().mockResolvedValue([{ contentType, size }]),
    download: vi.fn().mockResolvedValue([data]),
  };
  mockGetObjectEntityFile.mockResolvedValue(fakeFile);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. wrapOutboundLinksInText — img src= protection
// ═════════════════════════════════════════════════════════════════════════════

describe("wrapOutboundLinksInText — img src must never become a /r/ redirect", () => {
  const ctx = {
    tenantDomain: "acme.com",
    marketId: "m1",
    campaignId: null,
    userId: "u1",
    utm: { source: "email", medium: "email" },
    source: "email-wrap" as const,
    redirectBase: { protocol: "https", host: "app.example.com" },
  };

  beforeEach(() => {
    // generateUniqueSlug: select returns [] (slug not taken); insert succeeds.
    resetSelectChain([]);
    mockInsertValues.mockResolvedValue(undefined);
    mockInsertCall.mockReturnValue({ values: mockInsertValues });
  });

  it("does NOT rewrite src= to a /r/ redirect URL (lowercase)", async () => {
    const url = "https://cdn.example.com/logo.png";
    const text = `<img src="${url}" alt="logo">`;
    const { text: out } = await wrapOutboundLinksInText(text, ctx);
    assert.ok(out.includes(`src="${url}"`), `src must remain unchanged; got: ${out}`);
    assert.ok(!out.includes("/r/"), `no /r/ redirect must appear in img src; got: ${out}`);
  });

  it("does NOT rewrite uppercase SRC= to a /r/ redirect", async () => {
    const url = "https://cdn.example.com/banner.jpg";
    const text = `<img SRC="${url}" alt="banner">`;
    const { text: out } = await wrapOutboundLinksInText(text, ctx);
    assert.ok(out.includes(url), `URL must remain in output; got: ${out}`);
    assert.ok(!out.includes("/r/"), `no /r/ in SRC= variant; got: ${out}`);
  });

  it("does NOT rewrite src = (with spaces around equals) to a /r/ redirect", async () => {
    const url = "https://cdn.example.com/hero.png";
    const text = `<img src = "${url}" alt="hero">`;
    const { text: out } = await wrapOutboundLinksInText(text, ctx);
    assert.ok(out.includes(url), `URL must remain in output; got: ${out}`);
    assert.ok(!out.includes("/r/"), `no /r/ in src= (spaced) variant; got: ${out}`);
  });

  it("wraps a bare https:// URL that is NOT an img src", async () => {
    const url = "https://example.com/landing";
    const text = `Click here: ${url}`;
    const { text: out, createdSlugs } = await wrapOutboundLinksInText(text, ctx);
    assert.ok(createdSlugs.length > 0, "at least one slug must be created");
    assert.ok(out.includes("/r/"), `bare URL must be wrapped; got: ${out}`);
    assert.ok(!out.includes(url), `original URL should be replaced; got: ${out}`);
  });

  it("leaves already-wrapped /r/ URLs alone (no double-wrap)", async () => {
    const text = "See https://app.example.com/r/abcdefgh for details";
    const { text: out, createdSlugs } = await wrapOutboundLinksInText(text, ctx);
    assert.equal(createdSlugs.length, 0, "already-wrapped URLs must not generate a new slug");
    assert.ok(out.includes("r/abcdefgh"), `original /r/ URL must be preserved; got: ${out}`);
  });

  it("wraps bare link URLs but leaves a nearby img src= untouched in the same string", async () => {
    const imgUrl = "https://cdn.example.com/img.png";
    const linkUrl = "https://example.com/offer";
    const text = `<img src="${imgUrl}"> Visit ${linkUrl}`;
    const { text: out } = await wrapOutboundLinksInText(text, ctx);
    assert.ok(out.includes(`src="${imgUrl}"`), `img src must remain unchanged; got: ${out}`);
    assert.ok(!out.includes(linkUrl), `bare link must be replaced; got: ${out}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. hardenCtaButtons
// ═════════════════════════════════════════════════════════════════════════════

describe("hardenCtaButtons", () => {
  it("adds background-color and border-radius to an anchor inside a bgcolor td", () => {
    const html = `<td bgcolor="#0057ff"><a href="https://example.com" style="color:#fff;font-weight:bold;">Buy Now</a></td>`;
    const out = hardenCtaButtons(html);
    assert.ok(out.includes("background-color:#0057ff"), `anchor must gain background-color; got: ${out}`);
    assert.ok(out.includes("border-radius:6px"), `anchor must gain border-radius; got: ${out}`);
  });

  it("does NOT alter an anchor that already has a background-color (no duplication)", () => {
    const html = `<td bgcolor="#ff0000"><a href="https://example.com" style="color:#fff;background-color:#cc0000;">Click</a></td>`;
    const out = hardenCtaButtons(html);
    // Original markup must pass through unchanged.
    assert.equal(out, html, "anchor with existing background-color must not be touched");
  });

  it("handles anchor with no existing style attribute — adds style from scratch", () => {
    const html = `<td bgcolor="#333"><a href="https://example.com">Plain CTA</a></td>`;
    const out = hardenCtaButtons(html);
    assert.ok(out.includes('style="background-color:#333;border-radius:6px"'), `got: ${out}`);
  });

  it("does NOT alter anchors that are not inside a bgcolor td", () => {
    const html = `<td><a href="https://example.com" style="color:blue;">Regular link</a></td>`;
    const out = hardenCtaButtons(html);
    assert.equal(out, html, "non-CTA anchor must be unchanged");
  });

  it("handles 3-digit hex bgcolor", () => {
    const html = `<td bgcolor="#abc"><a href="https://example.com">Go</a></td>`;
    const out = hardenCtaButtons(html);
    assert.ok(out.includes("background-color:#abc"), `3-digit hex must be copied; got: ${out}`);
  });

  it("handles bgcolor td with surrounding attributes", () => {
    const html = `<td align="center" bgcolor="#4caf50" style="padding:12px"><a href="https://x.com">Join</a></td>`;
    const out = hardenCtaButtons(html);
    assert.ok(out.includes("background-color:#4caf50"), `got: ${out}`);
  });

  it("does not mangle a table with multiple tds — only the bgcolor one is touched", () => {
    const html =
      `<table><tr>` +
      `<td bgcolor="#0057ff"><a href="https://example.com/cta">CTA</a></td>` +
      `<td><a href="https://example.com/plain">Plain</a></td>` +
      `</tr></table>`;
    const out = hardenCtaButtons(html);
    assert.ok(out.includes("background-color:#0057ff"), "CTA anchor must be hardened");
    // The plain link's anchor must not gain a background-color.
    assert.ok(
      !out.includes(`<a href="https://example.com/plain" style=`),
      `plain link must not get a style attribute; got: ${out}`,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. prepareEmailImages — tenant-ownership gate + MIME/size filtering
// ═════════════════════════════════════════════════════════════════════════════

describe("prepareEmailImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicObjectSearchPaths.mockReturnValue(["/test-bucket/public-objects"]);
  });

  it("leaves /objects/ paths not owned by the tenant unchanged", async () => {
    // Both DB selects return [] → not owned.
    resetSelectChain([]);
    const html = `<img src="/objects/secret/photo.png">`;
    const out = await prepareEmailImages(html, "https://app.example.com", "other-tenant.com");
    assert.ok(out.includes(`src="/objects/secret/photo.png"`), `got: ${out}`);
  });

  it("leaves /objects/ path unchanged when tenantDomain is not provided", async () => {
    const html = `<img src="/objects/some/image.png">`;
    const out = await prepareEmailImages(html, "https://app.example.com");
    assert.ok(out.includes(`src="/objects/some/image.png"`), `got: ${out}`);
  });

  it("skips /objects/ path with non-image MIME type", async () => {
    // DB returns a row (tenant owns it) but the file is a PDF.
    resetSelectChain([{ id: "ca-1" }]);
    mockSearchPublicObject.mockResolvedValue(null);
    mockFileWith({ contentType: "application/pdf", size: 1024 });

    const html = `<img src="/objects/docs/report.pdf">`;
    const out = await prepareEmailImages(html, "https://app.example.com", "tenant.com");
    assert.ok(out.includes(`src="/objects/docs/report.pdf"`), `non-image must be skipped; got: ${out}`);
  });

  it("skips /objects/ path when file exceeds the 10 MB size cap", async () => {
    resetSelectChain([{ id: "ca-2" }]);
    mockSearchPublicObject.mockResolvedValue(null);
    const ELEVEN_MB = 11 * 1024 * 1024;
    mockFileWith({ contentType: "image/jpeg", size: ELEVEN_MB });

    const html = `<img src="/objects/huge/photo.jpg">`;
    const out = await prepareEmailImages(html, "https://app.example.com", "tenant.com");
    assert.ok(out.includes(`src="/objects/huge/photo.jpg"`), `oversized image must be skipped; got: ${out}`);
  });

  it("absolutizes an owned valid image and rewrites src", async () => {
    resetSelectChain([{ id: "ca-3" }]);
    mockSearchPublicObject.mockResolvedValue(null); // not cached — will be published
    mockFileWith({ contentType: "image/png", size: 50_000 });

    const html = `<img src="/objects/logo/brand.png">`;
    const out = await prepareEmailImages(html, "https://app.example.com", "tenant.com");
    assert.ok(
      out.includes("https://app.example.com/public-objects/"),
      `owned image must be absolutized; got: ${out}`,
    );
    assert.ok(!out.includes(`src="/objects/`), `original private path must be replaced; got: ${out}`);
  });

  it("reuses an already-published public object without re-uploading", async () => {
    resetSelectChain([{ id: "ca-4" }]);
    mockSearchPublicObject.mockResolvedValue("exists"); // already published
    // getObjectEntityFile must not be called — no re-upload needed.
    mockGetObjectEntityFile.mockResolvedValue(null);

    const html = `<img src="/objects/cached/image.png">`;
    const out = await prepareEmailImages(html, "https://app.example.com", "tenant.com");
    assert.ok(out.includes("https://app.example.com/public-objects/"), `got: ${out}`);
    assert.equal(
      mockGetObjectEntityFile.mock.calls.length,
      0,
      "must not re-fetch an already-published object",
    );
  });

  it("absolutizes a /public-objects/ relative src without touching object storage", async () => {
    // No DB or storage calls expected — /public-objects/ paths just get prefixed.
    const html = `<img src="/public-objects/email-images/hero.png">`;
    const out = await prepareEmailImages(html, "https://app.example.com", "tenant.com");
    assert.ok(
      out.includes("https://app.example.com/public-objects/email-images/hero.png"),
      `relative public-objects path must be absolutized; got: ${out}`,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. injectFooter — mailing-address line + footer placement
// ═════════════════════════════════════════════════════════════════════════════

describe("injectFooter", () => {
  const UNSUB = "https://app.example.com/unsubscribe/TOKEN";
  const PREFS = "https://app.example.com/preferences/TOKEN";

  it("includes the mailing address when mailingAddress is set", () => {
    const out = injectFooter("<p>Body</p>", UNSUB, PREFS, "123 Main St, Springfield, IL 62701");
    assert.ok(
      out.includes("123 Main St, Springfield, IL 62701"),
      `mailing address must appear in footer; got: ${out}`,
    );
  });

  it("omits the address content when mailingAddress is null", () => {
    const out = injectFooter("<p>Body</p>", UNSUB, PREFS, null);
    assert.ok(!out.includes("Main St"), `no address text must appear when null; got: ${out}`);
  });

  it("omits the address content when mailingAddress is undefined", () => {
    const out = injectFooter("<p>Body</p>", UNSUB, PREFS);
    // The footer always has exactly one <br/> (after "You're receiving…").
    // An address line adds a second <br/>. With undefined there must be only one.
    const brCount = (out.match(/<br\/>/g) || []).length;
    assert.equal(brCount, 1, `footer must have exactly 1 <br/> when no address; got ${brCount} in: ${out}`);
  });

  it("omits the address content when mailingAddress is whitespace-only", () => {
    const out = injectFooter("<p>Body</p>", UNSUB, PREFS, "   ");
    const brCount = (out.match(/<br\/>/g) || []).length;
    assert.equal(brCount, 1, `whitespace-only address must produce no extra <br/>; got ${brCount} in: ${out}`);
  });

  it("always includes the Unsubscribe link", () => {
    const out = injectFooter("<p>Body</p>", UNSUB, PREFS, null);
    assert.ok(out.includes(UNSUB), `Unsubscribe URL must appear; got: ${out}`);
  });

  it("always includes the Manage preferences link", () => {
    const out = injectFooter("<p>Body</p>", UNSUB, PREFS, null);
    assert.ok(out.includes(PREFS), `Preferences URL must appear; got: ${out}`);
  });

  it("injects footer before </body> when present", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const out = injectFooter(html, UNSUB, PREFS, "456 Oak Ave");
    const bodyClose = out.indexOf("</body>");
    const footerStart = out.indexOf("456 Oak Ave");
    assert.ok(footerStart < bodyClose, "address must appear before </body>");
    assert.ok(out.endsWith("</body></html>"), `</body> must close the document; tail: ${out.slice(-30)}`);
  });

  it("appends footer after body content when no </body> tag", () => {
    const html = "<p>No body tag here</p>";
    const out = injectFooter(html, UNSUB, PREFS, "789 Elm Rd");
    assert.ok(out.startsWith(html), "original content must come first");
    assert.ok(out.includes("789 Elm Rd"), "address must still appear");
  });

  it("HTML-escapes special characters in the mailing address", () => {
    const out = injectFooter("<p>Hi</p>", UNSUB, PREFS, "Acme & Co <Suite 100>");
    assert.ok(out.includes("Acme &amp; Co"), `& must be escaped; got: ${out}`);
    assert.ok(out.includes("&lt;Suite 100&gt;"), `< > must be escaped; got: ${out}`);
  });

  it("converts newlines in the mailing address to commas", () => {
    const addr = "123 Main St\nSpringfield\nIL 62701";
    const out = injectFooter("<p>Hi</p>", UNSUB, PREFS, addr);
    assert.ok(out.includes("123 Main St, Springfield, IL 62701"), `newlines must become commas; got: ${out}`);
  });
});
