#!/usr/bin/env python3
"""Build a data-only, tenant-scoped recovery SQL file. Never connects to a database."""
import argparse
import collections
import base64
import json
import pathlib
import re
import uuid


def unescape_copy(value):
    if value == r"\N":
        return None
    escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}
    return re.sub(r"\\([0-7]{1,3}|.)", lambda m: chr(int(m[1], 8)) if m[1].isdigit() else escapes.get(m[1], m[1]), value)


def read_backup(path, tenant):
    result = collections.defaultdict(list)
    table = None
    with open(path, encoding="utf-8") as source:
        for line in source:
            if line.startswith("COPY public."):
                match = re.match(r"COPY public\.(\w+) \(([^)]+)\) FROM stdin;", line)
                table = match[1] if match and match[1] in {"prospects", "outreach_touches", "outreach_campaigns"} else None
                columns = match[2].split(", ") if table else []
            elif line.rstrip("\n") == r"\.":
                table = None
            elif table:
                values = [unescape_copy(value) for value in line.rstrip("\n").split("\t")]
                if len(values) != len(columns):
                    raise ValueError("Invalid COPY row")
                row = dict(zip(columns, values))
                if row.get("tenant_domain") == tenant:
                    result[table].append(row)
    return result


def build_sql(rows, tenant):
    if not re.fullmatch(r"[a-z0-9.-]+", tenant):
        raise ValueError("Invalid tenant")
    legacy = rows["prospects"]
    touches = rows["outreach_touches"]
    if not legacy:
        raise ValueError("No prospects in backup")
    ids = {p["id"] for p in legacy}
    if len(ids) != len(legacy) or any(t["prospect_id"] not in ids for t in touches):
        raise ValueError("Duplicate prospect IDs or orphaned touches")
    contacts = []
    memberships = []
    emails, linkedins, campaign_contacts = set(), set(), set()
    for p in legacy:
        contact_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"orbit-outreach-recovery:{tenant}:{p['id']}"))
        email = (p.get("email") or "").strip().lower() or None
        linkedin = (p.get("linkedin_url") or "").strip() or None
        if (email and email in emails) or (linkedin and linkedin in linkedins):
            raise ValueError("Duplicate identity requires manual reconciliation")
        emails.add(email)
        linkedins.add(linkedin)
        key = (p["campaign_id"], contact_id)
        if key in campaign_contacts:
            raise ValueError("Duplicate campaign membership")
        campaign_contacts.add(key)
        name = (p.get("name") or "").strip().split(maxsplit=1)
        contacts.append({
            "id": contact_id, "tenant_domain": tenant, "email": email,
            "first_name": name[0] if name else None, "last_name": name[1] if len(name) > 1 else None,
            "company": p.get("company_name"), "job_title": p.get("title"), "linkedin_url": linkedin,
            "hubspot_contact_id": p.get("hubspot_contact_id"), "hubspot_company_id": p.get("hubspot_company_id"),
            "source": "outreach", "source_prospect_id": p["id"], "lifecycle_stage": "lead",
            # No current consent evidence survives; don't enable marketing sends.
            "email_opt_out": True, "email_opt_out_source": "recovery_hold",
            "created_at": p["created_at"],
            "metadata": {"recovery": {"original_prospect_status": p["status"], "consent_review_required": True}},
        })
        membership = {k: p.get(k) for k in [
            "id", "campaign_id", "tenant_domain", "market_id", "source", "icp_score",
            "disqualified_reason", "research_dossier", "owner_user_id", "created_at",
        ]}
        for field in ["signals", "score_breakdown"]:
            membership[field] = json.loads(p[field]) if p.get(field) else None
        membership["contact_id"] = contact_id
        membership["status"] = "dormant" if p["status"] in {"awaiting_reply", "cadence_step_due"} else p["status"]
        membership["next_action_at"] = None
        memberships.append(membership)
    safe_touches = []
    for original in touches:
        touch = dict(original)
        if touch.get("compliance_flags"):
            touch["compliance_flags"] = json.loads(touch["compliance_flags"])
        if touch["status"] in {"approved", "draft_pending_approval"}:
            touch["status"] = "draft_pending_approval"
            touch["approved_by"] = None
            touch["outlook_draft_id"] = None
        safe_touches.append(touch)
    payload = json.dumps({"contacts": contacts, "prospects": memberships, "touches": safe_touches}, ensure_ascii=False)
    delimiter = "$orbit_recovery_payload$"
    if delimiter in payload:
        raise ValueError("Payload delimiter collision")
    contact_columns = ["id", "tenant_domain", "email", "first_name", "last_name", "company", "job_title",
                       "linkedin_url", "hubspot_contact_id", "hubspot_company_id", "source", "source_prospect_id",
                       "lifecycle_stage", "email_opt_out", "email_opt_out_source", "metadata", "created_at"]
    prospect_columns = list(memberships[0])
    touch_columns = list(safe_touches[0]) if safe_touches else []
    sql = f"""-- DATA RECOVERY ONLY. Run in the PRODUCTION Database SQL runner after reviewing.
-- Contains private contact data. Do not commit, publish, or share this file.
-- Tenant: {tenant}; prospects: {len(memberships)}; touches: {len(safe_touches)}.
-- No existing rows are updated or deleted. No persistent schema changes.
-- All changes are transactional. A failed check rolls back the entire recovery.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '10s';
LOCK TABLE marketing_contacts, prospects, outreach_touches IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE orbit_recovery_payload (data jsonb) ON COMMIT DROP;
INSERT INTO orbit_recovery_payload VALUES ({delimiter}{payload}{delimiter}::jsonb);
DO $recovery_checks$
BEGIN
  IF EXISTS (SELECT 1 FROM marketing_contacts WHERE tenant_domain = '{tenant}')
     OR EXISTS (SELECT 1 FROM prospects WHERE tenant_domain = '{tenant}')
     OR EXISTS (SELECT 1 FROM outreach_touches WHERE tenant_domain = '{tenant}') THEN
    RAISE EXCEPTION 'Recovery stopped: tenant already has contact, prospect, or touch rows. Reconcile first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM orbit_recovery_payload, jsonb_array_elements(data->'prospects') p
    LEFT JOIN outreach_campaigns c ON c.id = p->>'campaign_id' AND c.tenant_domain = '{tenant}'
    LEFT JOIN markets m ON m.id = p->>'market_id' AND m.tenant_domain = '{tenant}'
    WHERE c.id IS NULL OR m.id IS NULL OR c.status NOT IN ('draft', 'paused', 'archived')
  ) THEN
    RAISE EXCEPTION 'Recovery stopped: campaign/market missing, wrong tenant, or campaign is active.';
  END IF;
END $recovery_checks$;
"""
    for table, key, columns in [
        ("marketing_contacts", "contacts", contact_columns),
        ("prospects", "prospects", prospect_columns),
        ("outreach_touches", "touches", touch_columns),
    ]:
        if not columns:
            continue
        expressions = []
        for column in columns:
            if column in {"owner_user_id", "approved_by"}:
                expressions.append(f"(SELECT u.id FROM users u WHERE u.id = r.{column})")
            elif column == "voice_profile_id":
                expressions.append("(SELECT v.id FROM social_account_voice_profiles v WHERE v.id = r.voice_profile_id)")
            else:
                expressions.append(f"r.{column}")
        sql += f"""
INSERT INTO {table} ({', '.join(columns)})
SELECT {', '.join(expressions)}
FROM orbit_recovery_payload p,
LATERAL jsonb_array_elements(p.data->'{key}') item,
LATERAL jsonb_populate_record(NULL::{table}, item) r;
"""
    sql += f"""
DO $recovery_verify$
BEGIN
  IF (SELECT count(*) FROM marketing_contacts WHERE tenant_domain = '{tenant}') <> {len(contacts)}
     OR (SELECT count(*) FROM prospects WHERE tenant_domain = '{tenant}') <> {len(memberships)}
     OR (SELECT count(*) FROM outreach_touches WHERE tenant_domain = '{tenant}') <> {len(safe_touches)} THEN
    RAISE EXCEPTION 'Recovery count mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM prospects p
    LEFT JOIN marketing_contacts c ON c.id = p.contact_id AND c.tenant_domain = p.tenant_domain
    WHERE p.tenant_domain = '{tenant}' AND (c.id IS NULL OR p.next_action_at IS NOT NULL
      OR p.status IN ('awaiting_reply', 'cadence_step_due'))
  ) OR EXISTS (
    SELECT 1 FROM outreach_touches t
    LEFT JOIN prospects p ON p.id = t.prospect_id AND p.tenant_domain = t.tenant_domain
    WHERE t.tenant_domain = '{tenant}' AND (p.id IS NULL OR t.status = 'approved')
  ) THEN
    RAISE EXCEPTION 'Recovery linkage or send-hold check failed';
  END IF;
END $recovery_verify$;
SELECT 'Recovery ready' AS result,
  (SELECT count(*) FROM prospects WHERE tenant_domain = '{tenant}') AS prospects,
  (SELECT count(*) FROM outreach_touches WHERE tenant_domain = '{tenant}') AS touches;
COMMIT;
"""
    return sql, {"contacts": len(contacts), "prospects": len(memberships), "touches": len(safe_touches)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup")
    parser.add_argument("output")
    parser.add_argument("--tenant", required=True)
    args = parser.parse_args()
    sql, counts = build_sql(read_backup(args.backup, args.tenant), args.tenant)
    destination = pathlib.Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(sql, encoding="utf-8")
    destination.chmod(0o600)
    encoded = base64.b64encode(sql.encode("utf-8")).decode("ascii")
    report = destination.with_suffix(".html")
    report.write_text(f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sales Outreach recovery package</title>
<style>
body{{font:16px/1.6 system-ui,sans-serif;background:#f4f5f8;color:#202331;margin:0}}
main{{max-width:760px;margin:48px auto;padding:32px;background:white;border:1px solid #ddd;border-radius:12px}}
h1{{font-size:28px;line-height:1.2}}h2{{font-size:20px;margin-top:28px}}
button,a.download{{display:inline-block;border:0;padding:12px 18px;background:#602bc0;color:white;border-radius:6px;font:inherit;text-decoration:none;cursor:pointer;margin:6px 8px 6px 0}}
.warning{{background:#fff4d8;padding:14px;border-radius:6px}}code{{overflow-wrap:anywhere}}small{{color:#555}}
</style><main>
<h1>Sales Outreach recovery package</h1>
<p><strong>Prepared and dry-run validated. Not applied to production.</strong></p>
<p>Tenant: <code>{args.tenant}</code>. Source: August 19, 2026 backup.</p>
<ul><li>{counts['contacts']} contacts and {counts['prospects']} campaign prospects</li>
<li>{counts['touches']} outreach-history entries</li>
<li>Existing campaigns, other tenants, and newer unrelated data remain unchanged</li></ul>
<div class="warning"><strong>Private contact data:</strong> this package contains names, contact details, and message text.
Do not share it or upload it to a public website. The SQL is an older snapshot, not a reconstruction of post-backup changes.</div>
<h2>Apply through the production Database tool</h2>
<ol><li>Download the SQL or copy it using the controls below.</li>
<li>In Replit's Database tool, select <strong>Production</strong>, then open the SQL runner.</li>
<li>Review and run the entire SQL as one operation. Do not run individual sections.</li>
<li>Expected result: <strong>Recovery ready</strong>, with {counts['prospects']} prospects and {counts['touches']} touches.</li>
<li>Refresh Orbit's Sales Outreach campaign pages and review the recovered records.</li></ol>
<p>The transaction stops without committing if tenant data already exists, a campaign or market is missing,
a campaign is active, or verification fails. If an error occurs, run <code>ROLLBACK;</code> in the same SQL session.
Do not remove the checks to force it through.</p>
<button id="download">Download recovery SQL</button><button id="copy">Copy complete SQL</button>
<p id="result" role="status"></p>
<h2>Sending is held for review</h2>
<ul><li>Previously approved but unsent messages return to pending approval. Stale Outlook draft references are cleared.</li>
<li>Awaiting-reply and cadence-due prospects are restored as dormant, with no scheduled next action.</li>
<li>Sent history stays sent, with original IDs and timestamps preserved.</li>
<li>Restored contacts have an email opt-out hold marked <code>recovery_hold</code>. Review current consent before enabling email.</li>
<li>Campaign state is not changed. No automatic sending is enabled by this recovery.</li></ul>
<small>No publishing or app-code rollback is needed to apply this data-only recovery.</small>
</main><script>
const encoded="{encoded}";
const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
const sql=new TextDecoder().decode(bytes);
document.getElementById("download").onclick=()=>{{
const url=URL.createObjectURL(new Blob([bytes],{{type:"text/plain;charset=utf-8"}}));
const a=document.createElement("a");a.href=url;a.download="outreach-recovery.sql";a.click();
setTimeout(()=>URL.revokeObjectURL(url),1000);
}};
document.getElementById("copy").onclick=async()=>{{
try{{await navigator.clipboard.writeText(sql);document.getElementById("result").textContent="Complete SQL copied. Review and run it in the Production SQL runner."}}
catch(e){{document.getElementById("result").textContent="Clipboard access was blocked. Download the SQL file and copy its contents instead."}}
}};
</script></html>""", encoding="utf-8")
    report.chmod(0o600)
    print(json.dumps({"file": str(destination), **counts}))