---
name: Compositor font portability
description: Why configured brand typography must not rely on SVG font declarations.
---

Use uploaded-font glyph outlines for deterministic configured brand typography; SVG font-family and embedded @font-face bytes do not prove a rasterizer used the font.

**Why:** Sharp's librsvg can ignore SVG @font-face, including embedded font bytes, and silently render an installed fallback. Font parsers can also accept truncated containers when requested glyphs remain readable.

**How to apply:** Validate container bounds as well as parsed font metrics and glyphs. Verify final PNG glyph identity against independent checked-in outlines and a fallback negative control, not host fonts or platform-specific PNG hashes.