# Executive OS cutover

This app is a read-only validation archive. New work and routine completions belong in Executive OS at https://executive.compassmarketing.ai.

The shared legacy database is guhrfbmxrvqleyrdlses. Apply ops/executive_os_read_only.sql once, after Production import validation. It blocks writes to GTD/routine/profile tables, preserves SELECT access and all rows, and disables the old GTD promotion cron. Birthday and monthly-contact tables are not changed. Old cached clients are also blocked by database triggers.

Final comparison must match all frozen GTD cards, routine definitions and logs to the immutable Executive OS source ledger. The original app code remains in Git history. Keep this archive available during validation; do not delete data or retire the Supabase project.

Rollback, only if explicitly needed: restore the previous app commit, remove only executive_os_read_only triggers, restore previous application write grants, and reactivate the named cron job. Reconcile both systems before accepting further legacy changes.
