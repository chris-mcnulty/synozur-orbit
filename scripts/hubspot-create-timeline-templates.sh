#!/usr/bin/env bash
#
# Create the 5 HubSpot timeline event templates for marketing-email sync
# (Phase 2) and print the env-var lines to wire them into Orbit.
#
# These templates are APP-LEVEL objects in your HubSpot DEVELOPER account and
# are managed with the DEVELOPER API KEY (not the OAuth connection or a
# private-app token). Create them once; all tenants that authorize the Orbit
# app share the returned template ids. See docs/hubspot-email-phase0-setup.md.
#
# Usage:
#   APP_ID=2845139 DEV_KEY=xxxxxxxx ./scripts/hubspot-create-timeline-templates.sh
# or edit the two values below.
#
# Requires: curl, jq.

set -euo pipefail

APP_ID="${APP_ID:-REPLACE_WITH_APP_ID}"
DEV_KEY="${DEV_KEY:-REPLACE_WITH_DEVELOPER_API_KEY}"

if [[ "$APP_ID" == REPLACE_WITH_* || "$DEV_KEY" == REPLACE_WITH_* ]]; then
  echo "ERROR: set APP_ID and DEV_KEY (env vars or edit this script)." >&2
  echo "  APP_ID    = your app's numeric id (Developer account -> Apps -> your app)" >&2
  echo "  DEV_KEY   = your developer API key (Developer account -> Get HubSpot API key)" >&2
  exit 1
fi
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required." >&2; exit 1; }

BASE="https://api.hubapi.com/crm/v3/timeline/${APP_ID}/event-templates?hapikey=${DEV_KEY}"

# create <name> <headerTemplate> <detailTemplate> <tokens-json> -> prints template id
create () {
  local resp id
  resp=$(curl -s -X POST "$BASE" -H 'Content-Type: application/json' -d "{
    \"name\": \"$1\", \"objectType\": \"contacts\",
    \"headerTemplate\": \"$2\", \"detailTemplate\": \"$3\",
    \"tokens\": $4
  }")
  id=$(echo "$resp" | jq -r '.id // empty')
  if [[ -z "$id" ]]; then
    echo "ERROR creating template \"$1\": $resp" >&2
    exit 1
  fi
  echo "$id"
}

# Token sets match exactly what the code sends:
#   email_sent          -> server/services/hubspot-timeline.ts (pushSentEventsForSend)
#   open/click/bounce/unsub -> server/routes/marketing-delivery.ts (pushRecipientTimeline)
SENT=$(create "Marketing email sent" "Sent: {{subject}}" \
  "Campaign {{campaign}} · send {{sendId}}" \
  '[{"name":"subject","label":"Subject","type":"string"},{"name":"campaign","label":"Campaign","type":"string"},{"name":"sendId","label":"Send ID","type":"string"}]')

OPENED=$(create "Marketing email opened" "Opened: {{subject}}" \
  "Opened (unique). Send {{sendId}}" \
  '[{"name":"sendId","label":"Send ID","type":"string"},{"name":"openCount","label":"Open count","type":"number"}]')

CLICKED=$(create "Marketing email link clicked" "Clicked a link" \
  "Clicked {{url}} · send {{sendId}}" \
  '[{"name":"sendId","label":"Send ID","type":"string"},{"name":"clickCount","label":"Click count","type":"number"},{"name":"url","label":"URL","type":"string"}]')

BOUNCED=$(create "Marketing email bounced" "Bounced" \
  "Reason: {{reason}} · send {{sendId}}" \
  '[{"name":"sendId","label":"Send ID","type":"string"},{"name":"reason","label":"Reason","type":"string"}]')

UNSUB=$(create "Marketing email unsubscribed" "Unsubscribed" \
  "Unsubscribed via send {{sendId}}" \
  '[{"name":"sendId","label":"Send ID","type":"string"}]')

echo ""
echo "# Created 5 timeline event templates. Add these to your deploy config:"
echo "HUBSPOT_TLT_EMAIL_SENT=${SENT}"
echo "HUBSPOT_TLT_EMAIL_OPENED=${OPENED}"
echo "HUBSPOT_TLT_EMAIL_CLICKED=${CLICKED}"
echo "HUBSPOT_TLT_EMAIL_BOUNCED=${BOUNCED}"
echo "HUBSPOT_TLT_EMAIL_UNSUBSCRIBED=${UNSUB}"
