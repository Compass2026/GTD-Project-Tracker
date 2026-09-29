# Where Tom's GTD board lives (paste this into any repo's CLAUDE.md)

Sessions opened in client repos (Logic-Solar, lucas_construction,
showmeelectricalcrm, …) don't load the GTD-Project-Tracker `CLAUDE.md`, so
they don't know where the board is. Copy the block below into that repo's
`CLAUDE.md` — or paste it as a message into the session — and it can write
cards directly.

---

## Tom's GTD board

The board is **not** a spreadsheet, artifact, or Drive file. Any Drive file
named "Master Projects GTD" is an archived Feb–Apr 2026 export — ignore it.

- **Where:** Supabase project **Routine Tracker**, id `guhrfbmxrvqleyrdlses`,
  table `public.gtd_projects`. Write with the Supabase connector's
  `execute_sql`. Column names contain spaces — double-quote them.
- **Full schema, departments, owner rules, and intake flow:**
  `CLAUDE.md` and `.claude/skills/new-project/SKILL.md` in
  `Compass2026/GTD-Project-Tracker`. Read them before inserting.
- **Canonical values only:**
  - `"Daily Focus"`: Today · Tomorrow · This Week · Next Week · This Quarter · Waiting
  - `"Status"`: Active · Waiting · Follow Up · Completed
  - `"Time Block"`: 5 min · 15 min · 30 min · 1 hour · 2 hours
  - `"Owner"`: TOM · CLAUDE · CLAUDE+APPROVAL · DELEGATED · WAITING
  - `"Due Date"`: `YYYY-MM-DDTHH:MM` (Central time) or NULL
- **Every card needs** a Department, a verb-first `"Current Next Action"`,
  an Owner, and a Daily Focus. Ask Tom for any blank rather than guessing;
  confirm the summary before inserting.
- **Leave a paper trail:** dated one-line summary in `"Notes"`, deliverable
  link in `"Support Link"`. The board is shared memory across sessions.

```sql
INSERT INTO gtd_projects
  ("Department", "Daily Focus", "Project Name", "Status", "Time Block",
   "Due Date", "Current Next Action", "Notes", "Support Link", "Owner")
VALUES
  ('Logic Solar', 'This Week', 'Build Wichita hub pages', 'Active', '2 hours',
   '2026-09-12T17:00',
   '1. Create 4 prerendered sub-routes under /wichita\n2. Interlink from Kansas hub',
   '2026-09-04 (Claude): from the Website audit findings session.', NULL, 'CLAUDE');
```

For anything Chief-of-Staff shaped (check-ins, email, priorities), prefer
continuing the persistent session `session_015vinkkWp6y78tjmCtcWq87` over
starting a new one — sessions can't read each other's conversations.
