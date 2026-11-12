# Reveille HubSpot surname investigation

## Finding

A read-only production query selected one Reveille Marketing Contact with a
HubSpot contact ID and a blank last name. The user checked that exact contact
in Reveille's HubSpot and confirmed that its last name is also blank there.
Personal identifiers are intentionally omitted from this report.

For this sample, the evidence establishes a source-data gap, not loss of an
available surname during import. Source verification was performed by the user,
not by an automated HubSpot API comparison. This finding does not establish
the cause for every Reveille contact.

## Code paths inspected

- `server/services/hubspot-service.ts`: full refresh requests `lastname` and
  maps it to `lastName`; existing nonempty names are preserved. Normal
  enrichment and single-contact sync also map `lastname`.
- `server/services/hubspot-integration.ts`: contact searches explicitly request
  both name fields. Legacy list readers extract `firstname.value` and
  `lastname.value`, and construct the combined display name from both.
- `server/routes/marketing-contacts.ts`: selected-contact import fetches
  `firstname` and `lastname` by HubSpot ID and forwards both fields.
- `server/routes/sales-outreach.ts`: outreach import forwards the combined
  contact name to `ensureContactForPerson`.
- `server/services/prospect-contact-service.ts`: that function splits the
  supplied name into first name and remaining name components; a single
  component produces a null surname. Existing names are filled only when
  missing, with the existing opt-out guard retained.

An enrichment shortcut in `hubspot-service.ts` copies an already-resolved
prospect HubSpot ID without fetching name fields. It can leave missing names
unfilled, but there is no evidence connecting that shortcut to this sample,
and it cannot supply a surname that is absent at the source.

## Scope and safety

No application defect was confirmed, so no application code fix or repair was
made. No contact records, HubSpot records, richer local names, or opt-outs were
changed. No surname was inferred from an email address.

Initially production access was unavailable; a later read-only production
query succeeded. The development database contained no matching Reveille
tenant. The available connector account could not be verified as Reveille's,
so it was not used to inspect unrelated contacts.

There were no executable changes requiring regression tests. Further sampling
would be needed before recommending a broader repair. Any future repair must
use verified source values, preserve richer data and consent, and be separately
authorized.
