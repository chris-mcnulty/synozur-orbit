# Suppression List

Append-only list of email addresses and domains never to contact.

## Format

One entry per line. Comments allowed with `#`. Entries are case-insensitive. Two entry kinds:

- **Email**: a full email address (`foo@bar.com`). Matches that exact address only.
- **Domain**: a bare domain (`bar.com`, no `@` prefix). Matches every address on that domain.

There is no `@domain.com` syntax — a leading `@` is invalid and will be ignored by the parser.

The Cadence skill appends an entry on every opt-out. Removals require an explicit human operator decision.

```
# Format examples (delete these examples before going live):
# example@example.com   # opted out 2026-04-12 via reply
# competitor.com        # competitor — never contact (domain match)
# [YOUR_FIRM_DOMAIN]    # internal — never contact ourselves (domain match)
```

# Active suppressions

[YOUR_FIRM_DOMAIN]   # internal — never contact ourselves
