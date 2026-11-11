---
name: Compositor font portability
description: Why configured brand typography must not rely on SVG font declarations.
---

Use uploaded-font glyph outlines for deterministic configured brand typography; SVG font-family and embedded @font-face bytes do not prove a rasterizer used the font.

**Why:** Sharp's librsvg can ignore SVG @font-face, including embedded font bytes, and silently render an installed fallback. Font parsers can also accept truncated containers when requested glyphs remain readable.

**How to apply:** Validate container bounds as well as parsed font metrics and glyphs. Verify final PNG glyph identity against independent checked-in outlines and a fallback negative control, not host fonts or platform-specific PNG hashes.

Treat a media-rendering test timeout separately from an assertion failure under load.

**Why:** Rasterization can exceed the default five-second test budget, and the timed-out asynchronous work may finish during the next test and contaminate shared mock call counts.

**How to apply:** Rerun the affected rendering tests with a bounded larger timeout and limited worker concurrency before attributing later mock-count failures to a rendering regression. Do not weaken glyph assertions to make a timeout disappear.