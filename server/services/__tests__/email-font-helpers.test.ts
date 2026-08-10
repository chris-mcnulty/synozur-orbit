/**
 * Unit tests — buildFontStack and buildFontHeadCss
 *
 * Guards the email font-injection path against silent regressions that would
 * cause all emails to fall back to Arial when a font lookup breaks.
 */

import { describe, it, expect } from "vitest";
import {
  buildFontStack,
  buildFontHeadCss,
  EMAIL_FONT_STACK,
} from "../email-campaign-sender";

// ─── buildFontStack ──────────────────────────────────────────────────────────

describe("buildFontStack", () => {
  it("returns the correct stack for AvenirNextLTPro", () => {
    const stack = buildFontStack("AvenirNextLTPro");
    expect(stack).toContain("Avenir Next LT Pro");
    expect(stack).toContain("Arial");
  });

  it("returns the correct stack for MetroNova", () => {
    const stack = buildFontStack("MetroNova");
    expect(stack).toContain("MetroNova");
    expect(stack).toContain("sans-serif");
  });

  it("returns an @import-ready stack for OpenSans", () => {
    const stack = buildFontStack("OpenSans");
    expect(stack).toContain("Open Sans");
    expect(stack).toContain("Arial");
  });

  it("falls back to Arial,Helvetica,sans-serif for an unknown value", () => {
    const stack = buildFontStack("UnknownFontXYZ");
    // Unknown fonts get quoted and appended with the safe generic fallback
    expect(stack).toContain("Arial");
    expect(stack).toContain("Helvetica");
    expect(stack).toContain("sans-serif");
  });

  it("returns the default Arial stack for null", () => {
    expect(buildFontStack(null)).toBe(EMAIL_FONT_STACK);
  });

  it("returns the default Arial stack for undefined", () => {
    expect(buildFontStack(undefined)).toBe(EMAIL_FONT_STACK);
  });

  it("returns the default Arial stack for empty string", () => {
    expect(buildFontStack("")).toBe(EMAIL_FONT_STACK);
  });

  it("handles system fonts (Arial) with their correct stack", () => {
    const stack = buildFontStack("Arial");
    expect(stack).toBe("Arial,Helvetica,sans-serif");
  });

  it("handles Georgia with a serif fallback", () => {
    const stack = buildFontStack("Georgia");
    expect(stack).toContain("Georgia");
    expect(stack).toContain("serif");
  });
});

// ─── buildFontHeadCss ────────────────────────────────────────────────────────

describe("buildFontHeadCss", () => {
  const BASE = "https://app.example.com";

  describe("AvenirNextLTPro", () => {
    let css: string;
    beforeAll(() => { css = buildFontHeadCss("AvenirNextLTPro", BASE); });

    it("contains @font-face rules", () => {
      expect(css).toContain("@font-face");
    });

    it('uses font-family "Avenir Next LT Pro"', () => {
      expect(css).toContain('"Avenir Next LT Pro"');
    });

    it("references AvenirNextLTPro-Regular.ttf", () => {
      expect(css).toContain("AvenirNextLTPro-Regular.ttf");
    });

    it("references AvenirNextLTPro-Bold.ttf", () => {
      expect(css).toContain("AvenirNextLTPro-Bold.ttf");
    });

    it("uses the supplied baseUrl as URL prefix", () => {
      expect(css).toContain(`${BASE}/fonts/AvenirNextLTPro-Regular.ttf`);
    });

    it("specifies truetype format", () => {
      expect(css).toContain("format('truetype')");
    });
  });

  describe("MetroNova", () => {
    let css: string;
    beforeAll(() => { css = buildFontHeadCss("MetroNova", BASE); });

    it("contains @font-face rules", () => {
      expect(css).toContain("@font-face");
    });

    it('uses font-family "MetroNova"', () => {
      expect(css).toContain('"MetroNova"');
    });

    it("references MetroNovaRegular.ttf", () => {
      expect(css).toContain("MetroNovaRegular.ttf");
    });

    it("references MetroNovaBold.ttf", () => {
      expect(css).toContain("MetroNovaBold.ttf");
    });

    it("uses the supplied baseUrl as URL prefix", () => {
      expect(css).toContain(`${BASE}/fonts/MetroNovaRegular.ttf`);
    });

    it("specifies truetype format", () => {
      expect(css).toContain("format('truetype')");
    });
  });

  describe("OpenSans", () => {
    it("returns an @import url() pointing at fonts.googleapis.com", () => {
      const css = buildFontHeadCss("OpenSans", BASE);
      expect(css).toContain("@import");
      expect(css).toContain("fonts.googleapis.com");
      expect(css).toContain("Open+Sans");
    });

    it("does NOT contain @font-face for a Google Font", () => {
      const css = buildFontHeadCss("OpenSans", BASE);
      expect(css).not.toContain("@font-face");
    });
  });

  describe("Unknown / system fonts", () => {
    it("returns empty string for Arial (system font, no loading needed)", () => {
      expect(buildFontHeadCss("Arial", BASE)).toBe("");
    });

    it("returns empty string for null", () => {
      expect(buildFontHeadCss(null, BASE)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(buildFontHeadCss(undefined, BASE)).toBe("");
    });

    it("returns empty string for an unknown value", () => {
      expect(buildFontHeadCss("UnknownFontXYZ", BASE)).toBe("");
    });
  });

  describe("baseUrl handling", () => {
    it("strips trailing slash from baseUrl", () => {
      const css = buildFontHeadCss("MetroNova", "https://app.example.com/");
      // Should NOT produce double slashes like //fonts/
      expect(css).not.toContain("//fonts/");
      expect(css).toContain("https://app.example.com/fonts/MetroNovaRegular.ttf");
    });

    it("defaults to relative paths when baseUrl is omitted", () => {
      const css = buildFontHeadCss("MetroNova");
      expect(css).toContain("/fonts/MetroNovaRegular.ttf");
    });
  });
});

// ─── getFontWarning ──────────────────────────────────────────────────────────

import { getFontWarning } from "../email-campaign-sender";

describe("getFontWarning", () => {
  it("returns null for null (no font chosen)", () => {
    expect(getFontWarning(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(getFontWarning(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getFontWarning("")).toBeNull();
  });

  it("returns null for Arial (system-safe font)", () => {
    expect(getFontWarning("Arial")).toBeNull();
  });

  it("returns null for all other curated system fonts", () => {
    const safeKeys = ["Georgia", "TrebuchetMS", "Verdana", "Tahoma", "TimesNewRoman"];
    for (const key of safeKeys) {
      expect(getFontWarning(key), `expected no warning for ${key}`).toBeNull();
    }
  });

  it("returns a warning for curated Google Fonts (Outlook and HubSpot strip @import)", () => {
    const openSans = getFontWarning("OpenSans");
    expect(openSans).not.toBeNull();
    expect(openSans!.toLowerCase()).toContain("outlook");
    expect(openSans!.toLowerCase()).toContain("hubspot");
    expect(getFontWarning("Lato")).not.toBeNull();
    expect(getFontWarning("Montserrat")).not.toBeNull();
  });

  it("returns a warning for AvenirNextLTPro (Outlook strips @font-face)", () => {
    const w = getFontWarning("AvenirNextLTPro") as string;
    expect(w).not.toBeNull();
    expect(w.toLowerCase()).toContain("outlook");
    expect(w.toLowerCase()).toContain("hubspot");
  });

  it("returns a warning for MetroNova and mentions Verdana as the fallback", () => {
    const w = getFontWarning("MetroNova") as string;
    expect(w).not.toBeNull();
    expect(w).toContain("Verdana");
  });

  it("returns a non-null warning string for an unrecognized font value", () => {
    const warning = getFontWarning("Poppins");
    expect(warning).not.toBeNull();
    expect(warning).toContain("Poppins");
  });

  it("warning for unrecognized font mentions HubSpot and Outlook", () => {
    const warning = getFontWarning("Inter") as string;
    expect(warning.toLowerCase()).toContain("hubspot");
    expect(warning.toLowerCase()).toContain("outlook");
  });

  it("warning for unrecognized font mentions Arial fallback", () => {
    const warning = getFontWarning("Raleway") as string;
    expect(warning).toContain("Arial");
  });

  it("handles a raw CSS multi-word font name that isn't curated", () => {
    const warning = getFontWarning("Source Sans Pro");
    expect(warning).not.toBeNull();
    expect(warning).toContain("Source Sans Pro");
  });
});

// ─── normalizeFontFamily ─────────────────────────────────────────────────────

import { normalizeFontFamily, EMAIL_FONT_STACK } from "../email-campaign-sender";

describe("normalizeFontFamily", () => {
  // TARGET uses a quoted font name to stress-test the implementation.
  // In double-quoted HTML attributes the `"` chars are entity-encoded to &quot;;
  // in single-quoted attributes and <style> blocks they appear as literal ".
  const TARGET = '"MetroNova","Arial",Helvetica,sans-serif';
  // Entity-encoded form used when TARGET is injected inside style="…" attributes.
  const TARGET_IN_ATTR = TARGET.replace(/"/g, "&quot;");

  // ── Basic rewriting ──────────────────────────────────────────────────────

  describe("system-font body", () => {
    it("rewrites a plain Arial inline font-family to the target stack", () => {
      const html = `<p style="font-family:Arial,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      // The full original value (including fallback) is replaced — exact style attr value.
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET_IN_ATTR}`);
    });

    it("rewrites Helvetica,sans-serif to the target stack with no residual fallback", () => {
      const html = `<p style="font-family:Helvetica,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET_IN_ATTR}`);
    });

    it("handles font-family with surrounding whitespace after the colon", () => {
      const html = `<p style="font-family:  Arial, sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET_IN_ATTR}`);
    });

    it("rewrites a literal double-quoted font name (including its fallbacks) in a single-quoted attribute", () => {
      // e.g. style='font-family:"Arial",sans-serif' — the CSS value uses real
      // double-quote characters AND comma-separated fallbacks after the quoted name.
      // The complete declaration must be replaced — no trailing ,sans-serif residual.
      const html = `<p style='font-family:"Arial",sans-serif'>Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      // Single-quoted attrs use the raw (unencoded) stack.
      const styleAttr = result.match(/style='([^']*)'/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET}`);
    });
  });

  // ── AI-generated bodies with multiple declarations ───────────────────────

  describe("AI-generated body with multiple font-family declarations", () => {
    it("rewrites every font-family occurrence in an HTML body", () => {
      const html = `
        <p style="font-family:Arial,sans-serif">Paragraph one</p>
        <h1 style="font-family:Georgia,serif">Heading</h1>
        <span style="font-family:Verdana,sans-serif">Span</span>
      `;
      const result = normalizeFontFamily(html, TARGET);
      const matches = result.match(/font-family:/gi) ?? [];
      // All three occurrences must have been rewritten
      expect(matches.length).toBe(3);
      // None of the originals survive
      expect(result).not.toContain("font-family:Arial");
      expect(result).not.toContain("font-family:Georgia");
      expect(result).not.toContain("font-family:Verdana");
      // All replaced with the entity-encoded target (double-quoted attrs)
      const targetMatches = result.match(new RegExp(escapeRegex(`font-family:${TARGET_IN_ATTR}`), "gi")) ?? [];
      expect(targetMatches.length).toBe(3);
    });

    it("rewrites font-family inside a <style> block as well as inline styles", () => {
      const html = `
        <style>body { font-family: Arial, sans-serif; }</style>
        <p style="font-family:Verdana,sans-serif">Hello</p>
      `;
      const result = normalizeFontFamily(html, TARGET);
      // Both contexts must be rewritten — old values gone
      expect(result).not.toContain("font-family: Arial");
      expect(result).not.toContain("font-family:Verdana");
      // <style> block uses the raw stack (literal quotes are valid CSS)
      expect(result).toContain(`font-family:${TARGET}`);
      // Inline double-quoted attr uses entity-encoded stack
      expect(result).toContain(`font-family:${TARGET_IN_ATTR}`);
    });

    it("rewrites font-family in a multi-rule style block", () => {
      const html = `
        <style>
          body { font-family: Arial, sans-serif; color: #333; }
          h1   { font-family: Georgia, serif; font-size: 24px; }
          p    { font-family: Verdana, sans-serif; }
        </style>
        <p>Hello</p>
      `;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).not.toContain("font-family: Arial");
      expect(result).not.toContain("font-family: Georgia");
      expect(result).not.toContain("font-family: Verdana");
    });

    it("handles HTML-entity-encoded font names (&quot;) — complete replacement, no residual fallback", () => {
      // Input: &quot;Helvetica Neue&quot;,sans-serif
      // The full original value (quoted name + its ,sans-serif fallback) must be
      // replaced atomically; ,sans-serif must NOT survive as a residual fragment.
      const html = `<p style="font-family:&quot;Helvetica Neue&quot;,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET_IN_ATTR}`);
    });

    it("handles &#34; entity-encoded quotes — complete replacement, no residual fallback", () => {
      const html = `<p style="font-family:&#34;Helvetica Neue&#34;,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET_IN_ATTR}`);
    });

    it("handles &#39; entity-encoded quotes — complete replacement, no residual fallback", () => {
      const html = `<p style="font-family:&#39;Helvetica Neue&#39;,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toBe(`font-family:${TARGET_IN_ATTR}`);
    });
  });

  // ── Inline styles vs. style blocks ──────────────────────────────────────

  describe("inline styles vs. style blocks", () => {
    it("rewrites only the font-family, leaving surrounding CSS properties intact", () => {
      const html = `<p style="color:red;font-family:Arial,sans-serif;font-size:16px">Hi</p>`;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toContain("color:red");
      expect(result).toContain("font-size:16px");
      // Exact font-family value — entity-encoded in a double-quoted attr; no ,sans-serif residual
      expect(result).toContain(`font-family:${TARGET_IN_ATTR}`);
      // Original unquoted fallback must be fully consumed
      expect(result).not.toContain("font-family:Arial");
    });

    it("does not alter attributes that don't contain font-family", () => {
      const html = `<img src="photo.jpg" alt="Photo" style="width:100%;border:1px solid #ccc">`;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toBe(html);
    });

    it("leaves plain-text prose that mentions font-family: entirely unchanged", () => {
      // The function only rewrites CSS inside style attributes and <style> blocks;
      // it must not touch text node content, even when it contains "font-family:".
      const html = `<p>Your font-family: Arial will be updated.</p>`;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toBe(html);
    });

    it("preserves non-font CSS inside the same style block rule", () => {
      const html = `
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #fff;
          }
        </style>
      `;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toContain("margin: 0");
      expect(result).toContain("background: #fff");
      // <style> block: raw stack (no entity encoding)
      expect(result).toContain(`font-family:${TARGET}`);
    });
  });

  // ── No-op when already using the correct stack ───────────────────────────

  describe("no-op when body already uses the correct stack", () => {
    it("is idempotent when the target stack is already in place (single-quoted attr)", () => {
      // Use a single-quoted attr so the TARGET (with literal ") is the correct form.
      const html = `<p style='font-family:${TARGET}'>Hello</p>`;
      const once = normalizeFontFamily(html, TARGET);
      const twice = normalizeFontFamily(once, TARGET);
      expect(once).toBe(twice);
    });

    it("is idempotent when the target stack is already in place (<style> block)", () => {
      const html = `<style>p { font-family:${TARGET}; }</style>`;
      const once = normalizeFontFamily(html, TARGET);
      const twice = normalizeFontFamily(once, TARGET);
      expect(once).toBe(twice);
    });

    it("leaves HTML unchanged when there are no font-family declarations", () => {
      const html = `<p style="color:blue">No font here</p>`;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toBe(html);
    });

    it("leaves HTML unchanged when it is an empty string", () => {
      expect(normalizeFontFamily("", TARGET)).toBe("");
    });

    it("uses EMAIL_FONT_STACK as the default stack argument", () => {
      const html = `<p style="font-family:Arial,sans-serif">Hello</p>`;
      const withDefault = normalizeFontFamily(html);
      const withExplicit = normalizeFontFamily(html, EMAIL_FONT_STACK);
      expect(withDefault).toBe(withExplicit);
    });
  });

  // ── Quoted-stack injection into double-quoted style attributes ──────────
  // Guards against the MetroNova / Avenir stacks (which contain literal `"`)
  // corrupting double-quoted style attributes.

  describe("quoted stacks in double-quoted style attributes", () => {
    it("entity-encodes the MetroNova stack so the attribute remains valid HTML", () => {
      // MetroNova stack: "MetroNova","Arial",Helvetica,sans-serif
      // Written raw into style="…", the leading `"` would end the attribute.
      const metroStack = buildFontStack("MetroNova");
      const html = `<p style="font-family:Arial,sans-serif" class="body">Hello</p>`;
      const result = normalizeFontFamily(html, metroStack);
      // The attribute must close cleanly — class="body" must still be present
      expect(result).toContain('class="body"');
      // The font-family value inside the attribute must contain MetroNova
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr).toContain("MetroNova");
    });

    it("entity-encodes the AvenirNextLTPro stack so the attribute remains valid HTML", () => {
      const avenirStack = buildFontStack("AvenirNextLTPro");
      const html = `<p style="font-family:Arial,sans-serif" id="intro">Hello</p>`;
      const result = normalizeFontFamily(html, avenirStack);
      // Adjacent attribute must survive intact
      expect(result).toContain('id="intro"');
      // Font name must appear inside the style attribute value
      const styleAttr = result.match(/style="([^"]*)"/)?.[1] ?? "";
      expect(styleAttr.toLowerCase()).toContain("avenir");
    });

    it("uses the raw (unescaped) stack inside <style> blocks where literal quotes are valid CSS", () => {
      const metroStack = buildFontStack("MetroNova");
      const html = `<style>body { font-family: Arial, sans-serif; }</style>`;
      const result = normalizeFontFamily(html, metroStack);
      // Inside a <style> block, literal " is correct CSS — &quot; must NOT appear
      expect(result).not.toContain("&quot;");
      expect(result).toContain("MetroNova");
    });

    it("entity-encodes the stack's single-quotes so single-quoted attributes remain valid HTML", () => {
      // Stacks like Georgia ('Times New Roman',serif) and TrebuchetMS contain `'`.
      // Injecting them raw into style='…' terminates the attribute early.
      const georgiaStack = buildFontStack("Georgia");  // contains 'Times New Roman'
      const html = `<p style='font-family:Arial,sans-serif' class="body">Hello</p>`;
      const result = normalizeFontFamily(html, georgiaStack);
      // Adjacent attribute must survive intact (proves attribute didn't terminate early)
      expect(result).toContain('class="body"');
      // The font-family value inside the attribute must mention Georgia
      const styleAttr = result.match(/style='([^']*)'/)?.[1] ?? "";
      expect(styleAttr.toLowerCase()).toContain("georgia");
      // No bare `'` must appear inside the style attribute value (would break the attr)
      expect(styleAttr).not.toContain("'");
    });

    it("entity-encodes TrebuchetMS stack single-quotes in a single-quoted attribute", () => {
      const trebuchetStack = buildFontStack("TrebuchetMS"); // 'Trebuchet MS',Helvetica,sans-serif
      const html = `<p style='font-family:Arial,sans-serif' id="intro">Hello</p>`;
      const result = normalizeFontFamily(html, trebuchetStack);
      expect(result).toContain('id="intro"');
      const styleAttr = result.match(/style='([^']*)'/)?.[1] ?? "";
      expect(styleAttr.toLowerCase()).toContain("trebuchet");
      expect(styleAttr).not.toContain("'");
    });

    it("uses the raw (unescaped) MetroNova stack inside single-quoted attributes (no single quotes in stack)", () => {
      const metroStack = buildFontStack("MetroNova");
      const html = `<p style='font-family:Arial,sans-serif'>Hello</p>`;
      const result = normalizeFontFamily(html, metroStack);
      // MetroNova stack has no single quotes — &apos;/&#39; must NOT appear
      expect(result).not.toContain("&#39;");
      expect(result).toContain("MetroNova");
    });
  });

  // ── Case-insensitivity ───────────────────────────────────────────────────

  describe("case-insensitive matching", () => {
    it("rewrites FONT-FAMILY (uppercase) declarations", () => {
      const html = `<p style="FONT-FAMILY:Arial,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toContain("MetroNova");
    });

    it("rewrites Font-Family (mixed-case) declarations", () => {
      const html = `<p style="Font-Family:Arial,sans-serif">Hello</p>`;
      const result = normalizeFontFamily(html, TARGET);
      expect(result).toContain("MetroNova");
    });
  });
});

/** Escape special regex characters in a literal string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// ── needed for beforeAll inside describe ─────────────────────────────────────
import { beforeAll } from "vitest";
