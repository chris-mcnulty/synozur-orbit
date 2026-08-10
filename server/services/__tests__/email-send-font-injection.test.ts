/**
 * Integration tests — font injection in the SendGrid send path
 *
 * deliverEmailSend composes four helpers to inject the tenant font into every
 * outgoing email:
 *
 *   1. buildFontStack(fontFamily)        → CSS font-family stack for the body
 *   2. normalizeFontFamily(html, stack)  → rewrites body font-family refs
 *   3. buildFontHeadCss(fontFamily, url) → @font-face / @import head CSS
 *   4. wrapResponsiveDocument(html, css) → full <!DOCTYPE> document with
 *                                          font CSS in the <style> block
 *
 * These tests use the real implementations (no mocks) and assert that the
 * HTML ultimately sent to SendGrid carries the correct font declarations for
 * MetroNova and AvenirNextLTPro, and that a missing/null fontFamily
 * gracefully falls back to Arial without injecting spurious @font-face rules.
 *
 * Mirrors the approach used in email-font-helpers.test.ts so that both the
 * export-html preview path and the live-send path are covered symmetrically.
 */

import { describe, it, expect } from "vitest";
import {
  buildFontStack,
  buildFontHeadCss,
  normalizeFontFamily,
  wrapResponsiveDocument,
  EMAIL_FONT_STACK,
} from "../email-campaign-sender";

const BASE_URL = "https://app.example.com";

// ─── Shared helper ────────────────────────────────────────────────────────────
/**
 * Simulate the two-step font injection that deliverEmailSend applies to
 * effectiveHtmlBody before handing it to wrapResponsiveDocument:
 *
 *   effectiveHtmlBody = normalizeFontFamily(body, buildFontStack(fontFamily))
 *   const fontHeadCss = buildFontHeadCss(fontFamily, baseUrl)
 *   const html = wrapResponsiveDocument(htmlWithFooter, fontHeadCss)
 *
 * We pass a minimal body fragment so the test stays self-contained.
 */
function simulateSendFontInjection(
  fontFamily: string | null | undefined,
  baseUrl = BASE_URL,
): string {
  const bodyFragment = `<p style="font-family:Arial,sans-serif">Hello world</p>`;
  const stack = buildFontStack(fontFamily);
  const normalizedBody = normalizeFontFamily(bodyFragment, stack);
  const fontHeadCss = buildFontHeadCss(fontFamily, baseUrl);
  return wrapResponsiveDocument(normalizedBody, fontHeadCss);
}

// ─── MetroNova ────────────────────────────────────────────────────────────────
describe("send-path font injection — MetroNova", () => {
  let html: string;
  beforeAll(() => {
    html = simulateSendFontInjection("MetroNova");
  });

  it("produces a full <!DOCTYPE> document", () => {
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("injects a @font-face rule into the <style> block", () => {
    expect(html).toContain("@font-face");
  });

  it('sets font-family to "MetroNova" in the @font-face rule', () => {
    expect(html).toContain('"MetroNova"');
  });

  it("references MetroNovaRegular.ttf with the correct base URL", () => {
    expect(html).toContain(`${BASE_URL}/fonts/MetroNovaRegular.ttf`);
  });

  it("references MetroNovaBold.ttf with the correct base URL", () => {
    expect(html).toContain(`${BASE_URL}/fonts/MetroNovaBold.ttf`);
  });

  it("specifies the truetype format", () => {
    expect(html).toContain("format('truetype')");
  });

  it("normalizes the body font-family to include MetroNova", () => {
    // normalizeFontFamily should replace the Arial placeholder in the body
    expect(html).toContain("MetroNova");
  });

  it("does NOT fall back to the bare Arial stack in the <style> block", () => {
    // The @font-face block must come before the body resets, so MetroNova
    // takes precedence; the raw Arial-only EMAIL_FONT_STACK must not appear
    // as the *only* font declaration.
    const styleBlock = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
    expect(styleBlock).toContain("MetroNova");
  });
});

// ─── AvenirNextLTPro ──────────────────────────────────────────────────────────
describe("send-path font injection — AvenirNextLTPro", () => {
  let html: string;
  beforeAll(() => {
    html = simulateSendFontInjection("AvenirNextLTPro");
  });

  it("produces a full <!DOCTYPE> document", () => {
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("injects a @font-face rule into the <style> block", () => {
    expect(html).toContain("@font-face");
  });

  it('sets font-family to "Avenir Next LT Pro" in the @font-face rule', () => {
    expect(html).toContain('"Avenir Next LT Pro"');
  });

  it("references AvenirNextLTPro-Regular.ttf with the correct base URL", () => {
    expect(html).toContain(`${BASE_URL}/fonts/AvenirNextLTPro-Regular.ttf`);
  });

  it("references AvenirNextLTPro-Bold.ttf with the correct base URL", () => {
    expect(html).toContain(`${BASE_URL}/fonts/AvenirNextLTPro-Bold.ttf`);
  });

  it("specifies the truetype format", () => {
    expect(html).toContain("format('truetype')");
  });

  it("normalizes the body font-family to include Avenir Next LT Pro", () => {
    expect(html).toContain("Avenir Next LT Pro");
  });

  it("does NOT fall back to the bare Arial stack in the <style> block", () => {
    const styleBlock = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
    expect(styleBlock).toContain("Avenir Next LT Pro");
  });
});

// ─── Null / undefined fontFamily — safe Arial fallback ───────────────────────
describe("send-path font injection — null fontFamily (Arial fallback)", () => {
  it("produces a full <!DOCTYPE> document for null", () => {
    const html = simulateSendFontInjection(null);
    expect(html).toMatch(/<!DOCTYPE html>/i);
  });

  it("does NOT inject @font-face for null fontFamily", () => {
    const html = simulateSendFontInjection(null);
    expect(html).not.toContain("@font-face");
  });

  it("does NOT inject @font-face for undefined fontFamily", () => {
    const html = simulateSendFontInjection(undefined);
    expect(html).not.toContain("@font-face");
  });

  it("does NOT inject @font-face for empty-string fontFamily", () => {
    const html = simulateSendFontInjection("");
    expect(html).not.toContain("@font-face");
  });

  it("uses the default Arial font stack when fontFamily is null", () => {
    const stack = buildFontStack(null);
    expect(stack).toBe(EMAIL_FONT_STACK);
  });
});

// ─── baseUrl handling in the send path ───────────────────────────────────────
describe("send-path font injection — baseUrl forwarded correctly", () => {
  it("uses the supplied base URL for MetroNova font file paths", () => {
    const customBase = "https://orbit.mycompany.com";
    const html = simulateSendFontInjection("MetroNova", customBase);
    expect(html).toContain(`${customBase}/fonts/MetroNovaRegular.ttf`);
  });

  it("uses the supplied base URL for AvenirNextLTPro font file paths", () => {
    const customBase = "https://orbit.mycompany.com";
    const html = simulateSendFontInjection("AvenirNextLTPro", customBase);
    expect(html).toContain(`${customBase}/fonts/AvenirNextLTPro-Regular.ttf`);
  });

  it("strips a trailing slash from baseUrl before constructing font paths", () => {
    const html = simulateSendFontInjection("MetroNova", `${BASE_URL}/`);
    // Must not produce //fonts/ double-slash
    expect(html).not.toContain("//fonts/");
    expect(html).toContain(`${BASE_URL}/fonts/MetroNovaRegular.ttf`);
  });
});

// ─── wrapResponsiveDocument + buildFontHeadCss composition ───────────────────
describe("wrapResponsiveDocument receives fontHeadCss from buildFontHeadCss", () => {
  it("places fontHeadCss before the body reset rules in the <style> block", () => {
    const fontHeadCss = buildFontHeadCss("MetroNova", BASE_URL);
    const html = wrapResponsiveDocument("<p>body</p>", fontHeadCss);
    const styleBlock = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
    const fontFaceIdx = styleBlock.indexOf("@font-face");
    const bodyResetIdx = styleBlock.indexOf("body {");
    // @font-face must come before body { } reset
    expect(fontFaceIdx).toBeGreaterThanOrEqual(0);
    expect(bodyResetIdx).toBeGreaterThan(fontFaceIdx);
  });

  it("leaves the <style> block free of @font-face when fontHeadCss is empty", () => {
    const html = wrapResponsiveDocument("<p>body</p>", "");
    expect(html).not.toContain("@font-face");
  });

  it("leaves the <style> block free of @font-face when fontHeadCss is omitted", () => {
    const html = wrapResponsiveDocument("<p>body</p>");
    expect(html).not.toContain("@font-face");
  });
});

// ─── needed for beforeAll inside describe ────────────────────────────────────
import { beforeAll } from "vitest";
