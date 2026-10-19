---
name: Publishing Bundle diagnostics
description: Limits of publishing build-history visibility while the UI reports Bundle.
---

An attempt shown as Bundle in the Publishing pane may not appear as an in-progress build in the publishing-history API. Do not interpret an older successful build as evidence that the current attempt finished or does not exist.

**Why:** During a reported long Bundle-stage wait, the service returned only older successful builds. The user's Publishing-pane stage was needed to distinguish packaging from application build/startup problems.

**How to apply:** Compare returned build timestamps with the reported attempt. If no matching build is visible, ask for the Publishing-pane stage or last log line. Inspect directory sizes and publish exclusions when Bundle is reported, but do not claim project size caused the stall without evidence. Publish exclusions do not require deleting local files or removing their checkpoint protection.
