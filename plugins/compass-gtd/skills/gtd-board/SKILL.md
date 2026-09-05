---
name: gtd-board
description: Read, add, or update cards on Tom's GTD project board from any repo or session. Use whenever Tom says "add this to my board", "put this on the GTD board", "what's due", "mark that done", or describes new work to track — even if he doesn't name the board. The board is a Supabase table, not a spreadsheet or artifact.
---

# Tom's GTD board — read/write from anywhere

You are acting as Tom's Chief of Staff for this one job: get work onto or
off of his GTD board correctly. This skill is self-contained; you don't
need the GTD-Project-Tracker repo open.

## Where the board is (and isn't)

- **Is:** Supabase project **"Routine Tracker"**, project id
  `guhrfbmxrvqleyrdlses`, table `public.gtd_projects`. Read and write with
  the Supabase connector's `execute_sql` tool (load it via ToolSearch:
  `select:mcp__Supabase__execute_sql`).
- **Isn't:** any Google Sheet, Drive file, or artifact. A Drive file named
  "Master Projects GTD" is an archived Feb–Apr 2026 export — ignore it.
- The React board at the GTD-Project-Tracker repo subscribes to realtime
  changes, so a row you insert or update appears on Tom's screen
  immediately. No refresh, no export, no second step.
- If the Supabase connector isn't available in this session, stop and tell
  Tom — don't fall back to a file. He can enable the connector or hand the
  request to the Chief of Staff session.

## Schema

Column names contain spaces — **double-quote every column name in SQL**.

| Column | Values |
|---|---|
| `"Department"` | `Found It Marketing`, `Compass`, `Personal`, `Phone Calls`, or a Compass client: `Tech Allies`, `BHG Safety`, `House Plan Central`, `Logic Solar`, `Silverback Plumbing`, `Show Me Design+Build`, `Mad Hair Lab`, `Lucas Construction`, `Show Me Electrical`, `Ginger Huff Interiors` |
| `"Daily Focus"` | `Today`, `Tomorrow`, `This Week`, `Next Week`, `This Quarter`, `Waiting` |
| `"Project Name"` | Short, action-oriented. Prefix client work with the client in parens: `(Logic Solar) Build Wichita hub pages` |
| `"Status"` | `Active`, `Waiting`, `Follow Up`, `Completed` |
| `"Completed At"` | timestamptz — set to `now()` when marking Completed; NULL otherwise |
| `"Time Block"` | `5 min`, `15 min`, `30 min`, `1 hour`, `2 hours` |
| `"Due Date"` | text, `YYYY-MM-DDTHH:MM` in **Central time**, or NULL |
| `"Current Next Action"` | Verb-first, concrete. Numbered list (`1. …\n2. …`) for multi-step |
| `"Notes"` | Context, people, decisions. Dated one-liners: `2026-09-04 (Claude): …` |
| `"Support Link"` | URL to the doc/PR/asset, or NULL |
| `"Owner"` | `TOM`, `CLAUDE`, `CLAUDE+APPROVAL`, `DELEGATED`, `WAITING` |

Use these exact strings. Legacy rows contain off-list values (`ASAP`,
trailing spaces, `4-27`); never write new ones.

**Owner meanings:** TOM does it · CLAUDE executes and reports · CLAUDE+APPROVAL
drafts, Tom approves before it ships · DELEGATED to a person (name them in
Notes) · WAITING on something external (say what in Notes).

## Adding cards

1. **Extract** what you already genuinely know from what Tom said or from
   the work you just did (a finished audit, a plan you wrote).
2. **Ask for every blank.** Tom's standing rule: every field comes from him
   or from something you actually know — never a silent default. Batch the
   questions (AskUserQuestion, up to 4 at a time, propose your best guess
   as option one). Always settle: Department, Owner, Daily Focus, Due Date
   (ask if there's a real deadline; NULL only if he says no), Time Block,
   and a real verb-first next action ("Website stuff" is not one).
3. **Check for an existing card** before inserting:
   ```sql
   SELECT id, "Project Name", "Status", "Daily Focus"
   FROM gtd_projects
   WHERE "Project Name" ILIKE '%<keyword>%' AND btrim("Status") <> 'Completed';
   ```
   If there's a likely match, ask: update that card or create a new one?
4. **Confirm** a compact summary (name · department · next action · owner ·
   focus/due) and get a yes before writing.
5. **Insert.** Escape single quotes by doubling them.
   ```sql
   INSERT INTO gtd_projects
     ("Department", "Daily Focus", "Project Name", "Status", "Time Block",
      "Due Date", "Current Next Action", "Notes", "Support Link", "Owner")
   VALUES
     ('Logic Solar', 'This Week', '(Logic Solar) Build Wichita hub pages',
      'Active', '2 hours', '2026-09-12T17:00',
      '1. Create 4 prerendered sub-routes under /wichita\n2. Interlink from the Kansas hub and Wichita page',
      '2026-09-04 (Claude): from the site audit — one URL is competing for four intents.',
      'https://docs.google.com/document/d/…', 'CLAUDE');
   ```
6. **Verify and report.** `SELECT` the row back by name; tell Tom it's live.

Several projects in one brain dump → list the split, confirm it, run one
grouped interview, insert one row per project.

## Updating cards

- **Done?** Only when nothing is pending. Email sent but reply outstanding
  is **not** done — that's `"Status" = 'Follow Up'`, `"Daily Focus" = 'Waiting'`,
  and a Notes line saying what you're waiting on.
  ```sql
  UPDATE gtd_projects
  SET "Status" = 'Completed', "Completed At" = now()
  WHERE id = '<uuid>';
  ```
  Re-opening a card clears `"Completed At"`.
- **Progress note:** append, never overwrite.
  ```sql
  UPDATE gtd_projects
  SET "Notes" = COALESCE("Notes" || E'\n', '') || '2026-09-04 (Claude): PR #6 opened, awaiting Tom''s review.',
      "Current Next Action" = 'Tom: review and merge PR #6'
  WHERE id = '<uuid>';
  ```
- **Never delete rows** without Tom naming the exact project(s).

## Reading the board

Always read before answering questions about workload or what's due —
don't answer from memory.

```sql
-- Open cards for one client
SELECT "Project Name", "Daily Focus", "Status", "Owner", "Due Date", "Current Next Action"
FROM gtd_projects
WHERE "Department" = 'Logic Solar' AND btrim(COALESCE("Status",'')) <> 'Completed'
ORDER BY "Due Date" NULLS LAST;

-- Overdue (Central time; tolerate legacy date formats)
SELECT "Project Name", "Department", left("Due Date",10) AS due
FROM gtd_projects
WHERE btrim(COALESCE("Status",'')) <> 'Completed'
  AND "Due Date" ~ '^\d{4}-\d{2}-\d{2}'
  AND left("Due Date",10)::date < (now() AT TIME ZONE 'America/Chicago')::date
ORDER BY due;
```

## Paper trail

Any session that does real work MUST write it down: card fields updated, a
dated one-line summary in Notes, the deliverable filed in Google Drive under
**Compass Clients / <Client>** (folder id `1WGQBmSTB1oN6xyf7E3Pr2WG0HcOr-4S0`)
named `YYYY-MM-DD <Client> — <Deliverable>`, with the link in
`"Support Link"`. Sessions can't read each other's conversations; the board
and Drive are the shared memory.

For check-ins, email handling, priorities, or anything Chief-of-Staff
shaped beyond a card write, point Tom to the persistent Chief of Staff
session (`session_015vinkkWp6y78tjmCtcWq87`) rather than doing it here.
