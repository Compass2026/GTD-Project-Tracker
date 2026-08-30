---
name: new-project
description: Capture a new project onto Tom's GTD board. Use whenever Tom describes new work to track — a project, task, to-do, follow-up, or idea ("add this to the board", "new project", "I need to...", "remind me to handle..."). Interviews Tom until the project has a clear next action, timeline, and owner, then inserts it into the gtd_projects table in Supabase.
---

# New Project Intake

You are Tom's AI Chief of Staff running project intake. The goal: every
project lands on the GTD board with a clear next action, a timeline, and a
responsible owner. Read `CLAUDE.md` at the repo root first if you haven't —
it has the schema, departments, and owner designations.

## Flow

1. **Listen.** Take whatever Tom gives you — a sentence, a voice-note brain
   dump, a forwarded email. Extract what you can before asking anything.

2. **Interview for every blank.** Tom's standing rule (2026-08-30): every
   field must come from Tom or be something you already genuinely know from
   what he said — never a silent default. If a field below is missing or
   ambiguous after step 1, ask about it, even when that feels tedious.
   Batch the questions (AskUserQuestion with up to 4 questions works well
   on mobile; two rounds is fine if there are more blanks than that).
   Propose your best guess as the first option so Tom can one-tap it, but
   the answer is his:
   - **Project Name** — short and action-oriented. Propose one; let Tom veto.
   - **Department** — never guess between plausible options; ask.
   - **Current Next Action** — the single concrete, physical, verb-first
     next step. If Tom gives a vague outcome ("get the website fixed"),
     ask what the very first action is ("Who do you call/email first?").
     Multi-step plans go in as a numbered list.
   - **Owner** — TOM, CLAUDE, CLAUDE+APPROVAL, DELEGATED (ask who → Notes),
     or WAITING (ask on what → Notes).
   - **Daily Focus** — Today / Tomorrow / This Week / Next Week /
     This Quarter / Waiting.
   - **Due Date** — ask whether there's a real deadline; only NULL when Tom
     says there isn't one.
   - **Status** — usually `Active` for new work; confirm when it might be
     `Waiting` or `Follow Up`.
   - **Time Block** — 5 min / 15 min / 30 min / 1 hour / 2 hours.
   - **Notes / Support Link** — optional; capture context Tom already gave
     (names, phone numbers, URLs, background) rather than asking for more.

   "Already genuinely know" means Tom's words settle it (he said "I'll call
   him tomorrow" → Owner TOM, Daily Focus Tomorrow) — not a plausible
   guess. When in doubt, it goes in the question batch.

3. **Confirm.** Show a compact summary card (name, department, next action,
   owner, focus/due date) and get a yes before writing.

4. **Insert** via the Supabase connector (`execute_sql`), project id
   `guhrfbmxrvqleyrdlses`. Column names contain spaces — double-quote them.
   Use canonical values only (see CLAUDE.md); Due Date format
   `YYYY-MM-DDTHH:MM`, Central time. Escape single quotes in text values.

   ```sql
   INSERT INTO gtd_projects
     ("Department", "Daily Focus", "Project Name", "Status", "Time Block",
      "Due Date", "Current Next Action", "Notes", "Support Link", "Owner")
   VALUES
     ('Logic Solar', 'This Week', 'Launch roofing landing page', 'Active',
      '30 min', '2026-09-04T17:00',
      '1. Call vendor to confirm hosting\n2. Send copy draft to Tom',
      'Context from Tom''s 8/30 voice note', NULL, 'CLAUDE+APPROVAL');
   ```

5. **Verify and report.** Select the row back by name to confirm it landed,
   then tell Tom it's live on the board (realtime sync means it's already
   visible — no refresh needed).

## Multiple projects

If Tom's brain dump contains several distinct projects, split them: list the
projects you see, confirm the split, then run the interview once covering
all of them (grouped questions), and insert one row per project.

## If a similar project already exists

Before inserting, quickly check for an existing active row with a similar
name (`SELECT "Project Name", "Status" FROM gtd_projects WHERE "Project Name" ILIKE '%<keyword>%' AND "Status" != 'Completed'`).
If there's a likely match, ask Tom: update that card or create a new one?
