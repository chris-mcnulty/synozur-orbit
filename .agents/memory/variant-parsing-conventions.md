---
name: Copy-variant parsing has two incompatible conventions
description: The AI copy-variant prompt format must match the parser; JSON-array prompts break the ---VARIANT--- separator parser.
---

# Copy-variant prompt format must match its parser

There are two variant output formats in the voice/copy generation code:
- `---VARIANT---` separator text, parsed by `parseVariants()` in voice-service.
- A JSON array of strings (used by conference copy generation).

**Why:** If a prompt asks for a JSON array but the result is fed to
`parseVariants()` (which splits on `---VARIANT---`), the separator never
matches and the parser falls back to `[text.trim()]` — storing the entire JSON
array (brackets, quotes, escaped newlines) as ONE post's body. That blob then
fails downstream length limits (e.g. LinkedIn >3000 chars).

**How to apply:** When adding/changing a copy-generation prompt, confirm the
parser matches the requested format. For JSON-array prompts, parse JSON first
(strip ``` code fences, slice from first `[` to last `]`) and only fall back to
separator parsing. Existing rows generated under the mismatch are corrupted and
must be regenerated — they can't be salvaged cleanly.
