---
name: icp-research
description: How to research a [YOUR_FIRM] sales prospect end-to-end — pull profile, pull company, surface recent signals, score ICP fit, write a dossier. Use when given a raw lead (name + company, LinkedIn URL, or email) and you need to produce a structured dossier the Composer can write against. Invoked by the Prospector loop on every state=new prospect.
cowork:
  category: research
  icon: SearchSparkle
---

# ICP Research

Use this skill when you need to take a raw prospect (name + company, or a LinkedIn URL, or just an email address) and produce a structured dossier the Composer can write a message against.

## Files in this skill

- `icp-definition.md` — who [YOUR_FIRM] sells to. The scoring baseline. Read every run.
- `disqualifiers.md` — hard reasons to drop a prospect immediately.
- `single-command-audit.md` — the end-to-end research procedure. Execute it for each prospect.

## The procedure

1. Read `icp-definition.md` and `disqualifiers.md`. Hold both in mind while researching.
2. Execute the procedure in `single-command-audit.md` against the prospect. It pulls profile + company + recent signals via web search + M365 search.
3. Score ICP fit on 1–10 based on `icp-definition.md`. Justify in one sentence.
4. Apply `disqualifiers.md`. Any hit → score 0, mark `disqualified`.
5. Write the dossier into the prospect MD file using the structure in `prospect-files/SKILL.md`.

## Quality bar

- Every Recent Activity bullet must cite a URL or a tool call. No invented signals.
- The Hook field must be one specific signal, not a category. "Posted about agent eval frameworks on Nov 14" is good. "Interested in AI" is not.
- If search returns nothing useful in the last 30 days, write "No recent signals" and lower the ICP score by 1 — recency matters for cold outreach.

## Tools used

- `mcp__core__web_search` — public web search for company funding, hiring, posts
- `mcp__core__web_fetch` — fetch LinkedIn profile, company landing page
- `SearchM365` with `sources=["email"]` — find prior touches in Outlook
- `SearchM365` with `sources=["files"]` — find existing [YOUR_FIRM] intel in SharePoint
- `ReadFileContent` / `GetDriveItem` — read the prospect MD file from OneDrive
