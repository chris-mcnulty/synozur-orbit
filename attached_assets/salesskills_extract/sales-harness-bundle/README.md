# Sales Harness for Copilot Cowork

A three-agent outbound sales loop built on Microsoft 365 Copilot Cowork: **Prospector → Composer → Cadence**. Every send goes through Outlook Drafts and waits for a human click. v1 never auto-sends.

This bundle is the genericized version of a working harness. Replace the `[YOUR_FIRM]`, `[YOUR_OUTLOOK_EMAIL]`, `[YOUR_DRIVE_ID]`, etc. placeholders with your details and you have a runnable harness.

---

## What the harness does

```
                  ┌──────────────────────────────────────────────┐
                  │            OneDrive prospects/               │
                  │       one .md file per lead, YAML frontmatter│
                  └──────────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
 ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
 │  PROSPECTOR  │              │   COMPOSER   │              │   CADENCE    │
 │              │              │              │              │              │
 │ state: new   │  ─────►      │ state:       │  ─────►      │ detects send,│
 │   ↓          │              │   researched │              │ detects reply│
 │ researched   │              │   ↓          │              │ queues       │
 │ disqualified │              │ draft_       │              │ templated    │
 │              │              │   pending_   │              │ follow-ups   │
 │ writes       │              │   approval   │              │ as drafts    │
 │ dossier into │              │              │              │              │
 │ MD file      │              │ writes draft │              │ stops cleanly│
 │              │              │ to MD AND    │              │              │
 │              │              │ Outlook      │              │              │
 └──────────────┘              └──────────────┘              └──────────────┘
        │                              │                              │
        ▼                              ▼                              ▼
 reads ICP, signals,         reads dossier + voice          reads sent items,
 prior touches               DNA, banned phrases            inbox, calendar
```

**The human stays in the loop.** The Composer creates an Outlook draft. You open Outlook, read it, and click Send. The "click Send" IS the approval. v1 has no auto-send path.

---

## The 10 skills

| Skill | Role |
|---|---|
| `prospector` | Top-of-loop researcher. Takes `state: new` lead → writes dossier → `state: researched`. |
| `icp-research` | ICP definition, disqualifiers, and the end-to-end research procedure. Consumed by Prospector. |
| `composer` | Drafts first-touch and reply messages in firm voice. Writes BOTH to the MD file AND to Outlook Drafts. |
| `outbound-voice` | Voice DNA, message templates, banned phrases. Source of truth for tone. **Must be populated before Composer runs** (ships with PLACEHOLDER). |
| `cadence` | Detects sends, detects replies, queues pre-approved follow-ups. Never auto-sends in v1. |
| `cadence-rules` | Timing windows, follow-up templates, stop conditions. Consumed by Cadence. |
| `compliance` | Banned-phrase scan, suppression-list lookup, CAN-SPAM, GDPR, send-cap checks. Runs on every draft. |
| `kill-switches` | Global pause, opt-out detection, send caps, reply-rate floor. Checked at every tick. |
| `prospect-files` | The MD file schema and state machine. The contract between all three agents. |
| `outlook-ops` | The Outlook MCP patterns. How agents draft, detect sends, detect replies. |

---

## Installation

### 1. Drop the skills folder into your Copilot Cowork personal skills directory

Copy everything under `skills/` into `/mnt/user-config/.claude/skills/` in your Copilot Cowork workspace. After the next session restart, the skills appear in your available-skills list.

```
/mnt/user-config/.claude/skills/
├── cadence/
├── cadence-rules/
├── compliance/
├── composer/
├── icp-research/
├── kill-switches/
├── outbound-voice/
├── outlook-ops/
├── prospect-files/
└── prospector/
```

### 2. Replace the placeholders

The bundle uses these tokens. Find-and-replace them with your values:

| Placeholder | What to put |
|---|---|
| `[YOUR_FIRM]` | Your firm's name (used in skill descriptions and voice instructions) |
| `[YOUR_TENANT]` | Your M365 tenant name (the part after "OneDrive - " in folder paths) |
| `[YOUR_FIRM_DOMAIN]` | Your firm's email domain (for the suppression list — never email yourselves) |
| `[YOUR_OUTLOOK_EMAIL]` | The operator's M365 sign-in address |
| `[YOUR_DRIVE_ID]` | Drive ID for the prospects folder (from `mcp__sharepoint_onedrive__GetDefaultDrive`) |
| `[YOUR_FOLDER_ITEM_ID]` | Item ID of `sales-harness/prospects` (from `GetDriveChildren`) |
| `[YOUR_DRAFTS_FOLDER_ID]` | Optional — `drafts` well-known name usually works |
| `[YOUR_SENT_FOLDER_ID]` | Optional — `sentitems` well-known name usually works |
| `[YOUR_INBOX_FOLDER_ID]` | Optional — `inbox` well-known name usually works |
| `[YOUR_DEFAULT_TIMEZONE]` | IANA timezone for unknown-locale prospects (e.g. `America/New_York`) |
| `[YOUR_PAIN_*]` and `[YOUR_INDUSTRY_*]` etc. | Fill in `skills/icp-research/icp-definition.md` and `disqualifiers.md` with your actual ICP |

The skills `prospect-files`, `outlook-ops`, `compliance`, and `cadence-rules` have a small number of these. The `icp-research/icp-definition.md` and `outbound-voice/voice-dna.md` have many — those two are the heaviest customization.

### 3. Create the OneDrive folder layout

Create this under your M365 OneDrive:

```
OneDrive - [YOUR_TENANT] /
  sales-harness/
    prospects/        ← one .md file per lead
    corpus/           ← real past outbound used to extract voice DNA
    sales-harness-config.md   ← live config (see sample below)
```

### 4. Extract your Voice DNA (mandatory)

The Composer will refuse to draft until `outbound-voice/voice-dna.md` is populated. Until then it stays as `PLACEHOLDER`.

To extract:

1. Save 20+ real outbound messages from your team that got replies as separate `.txt` files under `OneDrive/sales-harness/corpus/`. Strip recipient PII (keep first names only).
2. Open a fresh Copilot Cowork session.
3. Attach the corpus folder.
4. Paste the prompt from `outbound-voice/voice-dna-extract.md` into the chat.
5. Replace `voice-dna.md` with the model's output.
6. Have a teammate read the verification sample at the end. If they say "that doesn't sound like us," add 10 more messages and re-run.

Re-extract quarterly, or whenever your 30-day reply rate drops by ≥5 percentage points.

### 5. Configure the harness

Create `sales-harness-config.md` in your OneDrive sales-harness folder. Minimum contents:

```markdown
# Sales Harness Config

OUTLOOK_FROM: [YOUR_OUTLOOK_EMAIL]
PROSPECT_DIR_DRIVE_ID: [YOUR_DRIVE_ID]
PROSPECT_DIR_FOLDER_ID: [YOUR_FOLDER_ITEM_ID]

AGENTS_PAUSED: false
DAILY_SEND_CAP_EMAIL: 25
WEEKLY_SEND_CAP_PER_DOMAIN: 3
MIN_REPLY_RATE_PCT: 5
```

Tune the caps to your firm's deliverability comfort. The defaults are conservative for a single rep on a clean domain.

### 6. Seed your first prospect

Create a file under `/mnt/workspace/output/prospects/jane-smith.md` (in the session) or under `sales-harness/prospects/jane-smith.md` (in OneDrive). Use the schema in `skills/prospect-files/SKILL.md`. State: `new`.

### 7. Run the loop

In Copilot Cowork, three operator commands drive the harness:

| Command | What it does |
|---|---|
| `/run-prospector` (or `run prospector`) | Sweeps `state: new` leads, researches each, writes dossier, transitions to `researched` or `disqualified`. |
| `/run-composer` (or `run composer`) | Sweeps `state: researched` or `state: replied` leads, drafts first-touch or reply, writes to OneDrive AND Outlook Drafts, transitions to `draft_pending_approval`. |
| `/run-cadence` (or `run cadence`) | Sweeps everything in motion. Detects sends, detects replies, queues templated follow-ups, moves dead leads to `dormant`. |

You can register these as Copilot Cowork slash commands or just invoke the agents by name in chat ("run the prospector on all new leads").

---

## How to think about the harness

**The MD file is the prospect.** Not a CRM record, not a database row. A markdown file with YAML frontmatter. State lives in the frontmatter. History lives in the body sections. Everything else is a tool that reads or writes this file.

**The state machine is small.** `new → researched → draft_pending_approval → sent → awaiting_reply → replied / cadence_step_due / dormant`. Each agent handles a narrow slice of transitions.

**Drafts, not sends.** v1 never calls `SendDraftMessage`. The Composer creates the Outlook draft. The human reviews, clicks Send. Cadence detects the send by scanning sent-items, transitions the lead to `sent`. Auto-send is a future flag — turning it on means flipping a config value and rewiring the Cadence step-queueing branch.

**Voice is load-bearing.** A generic-AI-voice draft will be ignored. The Composer refuses to draft until you've extracted your firm's voice DNA from real past messages. This is the highest-leverage part of the install.

**Kill switches are hard stops.** Send caps, reply-rate floors, opt-out detection, and the global `AGENTS_PAUSED` flag halt all three agents. They are not warnings.

---

## Customization checklist

- [ ] Drop skills into `/mnt/user-config/.claude/skills/`
- [ ] Replace placeholders in all SKILL.md and reference files
- [ ] Fill in `icp-research/icp-definition.md` with your actual ICP, pains, and signals
- [ ] Fill in `icp-research/disqualifiers.md` with your exclusion list
- [ ] Create OneDrive `sales-harness/` folder tree
- [ ] Write `sales-harness-config.md`
- [ ] Add your firm's domain to `compliance/suppression-list.md` (never email yourselves)
- [ ] Extract Voice DNA from real past messages → `outbound-voice/voice-dna.md`
- [ ] Add at least one cadence template (start with `outbound-email-v1.md`)
- [ ] Seed first prospect file
- [ ] Run the loop

---

## Versioning notes

This is v1. Things that are intentionally NOT in v1:

- **Auto-send.** Every send is a human click.
- **CRM sync.** The MD files are the system of record.
- **Multi-channel.** Email only. Teams DMs and LinkedIn are future.
- **Reply LLM-classification at the boundary.** Cadence does a coarse keyword-based classification; richer classification is a future flag.
- **Cross-rep coordination.** v1 assumes one operator. The folder layout supports multi-rep but the per-rep send caps are not yet sharded.

If you make changes you think should fold back upstream, the structure makes it easy: each skill is self-contained, references only its sibling skills by name, and has no hidden runtime dependencies beyond the M365 tools.

---

## Credits

Adapted from a Claude Cowork sales harness ("awtup") originally built for a single boutique advisory firm. Rebuilt for M365 Copilot Cowork using native Outlook, SharePoint, and SearchM365 MCPs in place of helper scripts and bridges.
