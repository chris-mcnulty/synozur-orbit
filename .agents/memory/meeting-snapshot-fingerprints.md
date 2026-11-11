---
name: Meeting snapshot fingerprints
description: JSONB key ordering must not invalidate unchanged relationship snapshots.
---

Fingerprint comparisons must survive database JSONB key reordering, including nested activity objects. Preserve compatibility with fingerprints issued before changing serialization.

**Why:** A newly composed conference email was blocked on approval because its in-memory relationship snapshot and persisted snapshot serialized in different key orders. Sharpen merely preceded the approval attempt; it did not change the relationship facts.

**How to apply:** Test generation followed by a recursively reordered persistence round-trip and approval. Keep genuine fact-change, suppression, new-activity and coverage-loss checks. Accepting a rewrite must save its text before approval; never treat a style edit as fresh relationship evidence.
