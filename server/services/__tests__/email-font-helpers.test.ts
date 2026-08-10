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

// ── needed for beforeAll inside describe ─────────────────────────────────────
import { beforeAll } from "vitest";
