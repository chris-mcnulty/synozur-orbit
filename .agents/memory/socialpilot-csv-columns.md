---
name: SocialPilot CSV column order
description: Required positional fields for SocialPilot bulk-upload CSV exports.
---

SocialPilot bulk CSV rows use this order: Content, Image URL, Scheduled Date, Account ID, First Comment, Tags, Link URL. Do not insert an Account Name field.

**Why:** SocialPilot interprets fields positionally. An extra account-name value becomes the first comment, producing comments such as a person or company name.

**How to apply:** Keep SocialPilot exports headerless and preserve the seven-field order. Keep First Comment blank for every platform; SocialPilot tags belong only in the Tags field.