# Single-Command Audit — End-to-End Prospect Research

The Prospector runs this procedure on every `state: new` lead. It produces the dossier sections the Composer needs.

## Inputs

From the prospect MD file's frontmatter, expect at minimum:
- `name:` (full name)
- `company:` (company name)
- And one of: `email:`, `linkedin_url:`, or `domain:`

If only an email and domain are present, the audit still runs but the profile section will be thinner.

## Procedure

Run these steps in order. Stop at any step that triggers a disqualifier.

### 1. Profile pull

- If a LinkedIn URL is in the frontmatter, fetch via `mcp__core__web_fetch`. Extract: name, current title, current company, tenure in role, headline, about section, last 3 public posts (text + date + permalink).
- If no URL, run `mcp__core__web_search` for `"<name>" "<company>" site:linkedin.com` and use the top result.
- Capture: title, headcount band, role tenure.

### 2. Company pull

- `mcp__core__web_fetch` the company's main domain landing page. Extract: one-line positioning, headcount band if shown, industry self-description.
- `mcp__core__web_search` for `"<company>" funding OR acquisition OR launch` filtered to the last 30 days.
- `mcp__core__web_search` for `"<company>" hiring` filtered to the last 30 days if the role of interest is GTM/RevOps/AI.

### 3. Recent activity (the hook source)

This is the most important step — the message will lean on what you find here. Look for:

- Last 3 LinkedIn posts (already in step 1; extract date + topic)
- Podcast appearances in the last 60 days (`mcp__core__web_search "<name>" podcast`)
- Conference talks in the next 90 days
- Quoted in trade press in last 30 days
- Public blog posts or essays in last 30 days

For each, capture: one-sentence summary + URL + date.

### 4. Prior touches

- Run `SearchM365` with `sources=["email"]` and `from_user=<prospect email>` (or query=`<prospect email>` if from_user fails). Check both inbox and sent items.
- If anyone at [YOUR_FIRM] has emailed them in the last 12 months, note it in `## Prior Touches` and lower urgency — do NOT auto-disqualify, but flag for the Composer.

### 5. SharePoint check

- Run `SearchM365` with `sources=["files"]` and `query=<company name>`. Surface any existing [YOUR_FIRM] research, prior deck, prior proposal, or intel doc. Cite URLs in `## Prior Touches`.

### 6. Scoring

- Apply `icp-definition.md` rubric. Pick a 1–10 score. Write a one-sentence justification tying score to a specific signal.
- Apply `disqualifiers.md`. If any hit, score → 0 and mark disqualified.

### 7. Hook selection

- From step 3's activity, pick ONE signal. The one most relevant to [YOUR_FIRM]'s ICP pain (see `icp-definition.md`). Write it as a single sentence with a date and a URL. This is what the Composer will lead with.

## Time budget

Target 60–90 seconds per prospect. If a tool call hangs, time-box at 15s and move on with what you have. Note the gap in `## Notes`.

## Output

Write directly into the prospect MD file per `prospect-files/SKILL.md`. Update YAML frontmatter to `state: researched` (or `state: disqualified`) when done.
