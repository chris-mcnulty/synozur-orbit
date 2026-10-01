import { create, type Font } from "fontkit";

export interface CompositorFont {
  fontFaces: string;
  fontFamily: string;
  font: Font;
}

function validateFontContainer(bytes: Buffer): void {
  if (bytes.length < 12) throw new Error("the font header is empty or truncated");
  const signature = bytes.toString("ascii", 0, 4);
  const sfnt = bytes.readUInt32BE(0) === 0x00010000 || signature === "OTTO" || signature === "true";
  if (signature === "wOF2") {
    if (bytes.length < 48 || bytes.readUInt32BE(8) !== bytes.length ||
        !bytes.readUInt16BE(12) || bytes.readUInt32BE(20) > bytes.length - 48) {
      throw new Error("invalid or truncated WOFF2 container");
    }
    return;
  }
  const woff = signature === "wOFF";
  if (!sfnt && !woff) throw new Error("unsupported font format (use TTF, OTF, WOFF or WOFF2)");
  if (woff && (bytes.length < 44 || bytes.readUInt32BE(8) !== bytes.length)) {
    throw new Error("invalid or truncated WOFF container");
  }
  const count = bytes.readUInt16BE(woff ? 12 : 4);
  const start = woff ? 44 : 12;
  const stride = woff ? 20 : 16;
  const directoryEnd = start + count * stride;
  if (!count || directoryEnd > bytes.length) throw new Error("truncated font table directory");
  // Parsers may never touch optional tables. Reject truncation even when the
  // specific glyphs requested happen to live in the remaining readable bytes.
  for (let i = 0; i < count; i++) {
    const entry = start + i * stride;
    const offset = bytes.readUInt32BE(entry + (woff ? 4 : 8));
    const length = bytes.readUInt32BE(entry + (woff ? 8 : 12));
    if (offset < directoryEnd || offset + length > bytes.length) {
      throw new Error("font table is outside the file");
    }
  }
}

/** Parse actual bytes, not the upload's extension or MIME type. */
export function parseCompositorFont(bytes: Buffer, family: string): Font {
  try {
    if (!bytes.length) throw new Error("the font file is empty");
    validateFontContainer(bytes);
    const font = create(bytes);
    if (!("layout" in font)) throw new Error("font collections are not supported; upload a single font");
    if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0 || !font.numGlyphs) {
      throw new Error("invalid font metrics");
    }
    // Fontkit reads some tables lazily: exercise shaping and outlines now too.
    for (const glyph of font.layout("Ag").glyphs) {
      const outline = glyph.path.toSVG();
      if (/NaN|Infinity/.test(outline)) throw new Error("invalid glyph outlines");
    }
    return font;
  } catch (error) {
    throw new Error(`Configured brand font "${family}" is invalid or unsupported: ${(error as Error).message}`);
  }
}

/**
 * librsvg does not reliably honour SVG @font-face. Convert our generated text
 * elements to uploaded-font outlines, leaving Sharp no font lookup to perform.
 * This handles only the controlled text markup emitted by the compositors.
 */
export function outlineCompositorText(svg: string, configured?: CompositorFont | null): string {
  if (!configured) return svg;
  try {
    return svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (_tag, attrs: string, encoded: string) => {
      const attr = (name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
      const text = encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name]!);
      const { font } = configured;
      for (const char of text) {
        if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) {
          throw new Error(`missing glyph for U+${char.codePointAt(0)!.toString(16).toUpperCase()}`);
        }
      }
      const scale = Number(attr("font-size")) / font.unitsPerEm;
      const spacing = Number(attr("letter-spacing") ?? 0);
      const run = font.layout(text);
      const width = run.positions.reduce((sum, p) => sum + p.xAdvance * scale + spacing, 0) - (run.glyphs.length ? spacing : 0);
      const anchor = attr("text-anchor");
      let x = Number(attr("x")) - (anchor === "middle" ? width / 2 : anchor === "end" ? width : 0);
      let y = Number(attr("y"));
      const paths = run.glyphs.map((glyph, i) => {
        if (glyph.id === 0) throw new Error("font shaping produced a missing glyph");
        const p = run.positions[i];
        const d = glyph.path.toSVG();
        if (/NaN|Infinity/.test(d)) throw new Error("invalid glyph outlines");
        const result = `<path transform="translate(${x + p.xOffset * scale} ${y - p.yOffset * scale}) scale(${scale} ${-scale})" d="${d}"/>`;
        x += p.xAdvance * scale + spacing;
        y -= p.yAdvance * scale;
        return result;
      }).join("");
      return `<g aria-label="${encoded}" fill="${attr("fill") ?? "#000000"}"${attr("style") ? ` style="${attr("style")}"` : ""}>${paths}</g>`;
    });
  } catch (error) {
    throw new Error(`Configured brand font "${configured.fontFamily}" cannot render this graphic: ${(error as Error).message}`);
  }
}