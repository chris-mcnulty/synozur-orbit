# Voice DNA — [YOUR_FIRM] outbound

PLACEHOLDER

This file is a stub. The Composer skill checks this file at the start of every draft and STOPS if it still contains the marker `PLACEHOLDER`.

To populate it:

1. Collect 20+ real outbound messages from your team that got replies. Strip recipient PII (keep first name only). Save each as a separate `.txt` file under `OneDrive/sales-harness/corpus/`.
2. Open a fresh Copilot session.
3. Attach the corpus folder.
4. Paste the prompt from `voice-dna-extract.md`.
5. Replace the contents of THIS file with the output.
6. Have a teammate read the voice sample at the bottom of the output. If they say "that doesn't sound like us," add 10 more corpus messages and re-run.

Until this file is populated with your real voice profile, the Composer will refuse to draft. That's intentional — outbound in a generic AI voice underperforms badly enough that draft-and-stop is safer than draft-and-send.

## Required sections (the extraction will fill these)

1. **Tone** — 3 to 5 specific adjectives
2. **Sentence rhythm** — average length, fragment frequency, punctuation patterns
3. **Vocabulary patterns** — distinctive words used and outbound-cliché words avoided
4. **Opening style** — 3 verbatim examples
5. **Closing style** — 3 verbatim examples
6. **Banned phrases** — voice-specific bans (these merge with `compliance/banned-phrases.md`)
7. **Voice sample** — 200-word verification test message
