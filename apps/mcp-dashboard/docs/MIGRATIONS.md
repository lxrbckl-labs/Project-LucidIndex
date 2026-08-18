# mcp-dashboard — migration runbook

Operator-facing notes for the migrations the dashboard sidecar depends
on. The migrations themselves live in `packages/db/migrations/`; this
file is the human runbook for the ones that need hand-holding.

## 0032 — `run_log_queue_item_agent_unique`

**What it does:** adds `UNIQUE (queue_item_id, agent_token_id)` to
`run_log` so a race in `write_articles` (concurrent calls from the
same agent on the same queue item) can no longer leave two run_log
rows for one logical run.

**Pre-flight check:** the migration opens with a `DO $$` block that
counts duplicate `(queue_item_id, agent_token_id)` pairs in `run_log`.
If any exist, you'll see a `NOTICE` line during the migration like:

```
NOTICE:  Migration 0032 cannot apply — 7 duplicate (queue_item_id, agent_token_id) pairs in run_log. Run the dedup query in apps/mcp-dashboard/docs/MIGRATIONS.md before retrying.
```

Postgres then raises a constraint-creation error and the migration
transaction rolls back. The schema is untouched.

### Dedup query

Run this against the same database, in a `BEGIN; ... ROLLBACK;` first
to verify what would be deleted, then in a real transaction:

```sql
-- Keep the most recently-inserted row (highest id, which is a
-- monotonic UUID-v7 in this schema), drop the older duplicate(s).
-- Adjust the `a.id < b.id` predicate if your `id` is not orderable;
-- the safe fallback is `a.created_at < b.created_at` (which keeps
-- the most recent row's metadata) — both keep ONE row per pair.
DELETE FROM run_log a
USING run_log b
WHERE a.id < b.id
  AND a.queue_item_id = b.queue_item_id
  AND a.agent_token_id = b.agent_token_id;
```

**What gets kept:** for each `(queue_item_id, agent_token_id)` pair
with N duplicates, the row with the LARGEST `id` survives. The other
N-1 rows are deleted. The expectation is that the newer row is more
likely to have been the "winning" write (the one whose `articles`
INSERT actually committed); the older row was the loser of the race
and its associated article inserts would have been rolled back by the
unique-on-(target_id, source_url) constraint.

**After dedup:** re-run the migration:

```bash
pnpm --filter @lucidindex/db db:migrate
```

The `DO $$` block will report 0 duplicates and the `ALTER TABLE` will
succeed.

### Why we don't auto-dedup in the migration

NO DELETIONS is a hard rule for this project. The migration surfaces
the problem and gives the operator a documented remedy; it does not
delete rows on its own.

## Snapshot gap for 0029–0031 (audit round 9)

Migrations 0029, 0030, 0031, 0032 were hand-authored. Only
`0028_snapshot.json` and `0032_snapshot.json` exist in
`packages/db/migrations/meta/`; the intermediate 0029, 0030, 0031
snapshots are NOT present.

**Why this is fine today:** drizzle-kit's `generate` diffs the
TypeScript schema against the LATEST snapshot only, and the latest
snapshot (`0032_snapshot.json`) matches the live schema. Running
`pnpm --filter @lucidindex/db exec drizzle-kit generate` reports
"No schema changes, nothing to migrate".

**Why the gap exists:** the round-9 audit ran `drizzle-kit generate`
once to bring the snapshot chain up to date. drizzle-kit emitted a
single combined SQL migration that overlapped work already done by
0029-0032 (drop NOT NULL on a column, add a column, add a UNIQUE
constraint). The SQL was discarded; only the snapshot file was kept
and renamed to `0032_snapshot.json` so future generate runs see no
drift. The `prevId` chain inside the snapshot still points back to
0028's id (not 0031's, which doesn't exist) — drizzle-kit does NOT
walk the prevId chain when diffing schema-to-snapshot, so this
mismatch is cosmetic.

**When this could bite:** if a future round needs to roll back to an
intermediate snapshot (e.g. to regenerate a slice of migrations from
0029 onward), there's no 0029, 0030, or 0031 snapshot to roll back
to. The fix is one-shot: drop the DB, replay 0000 → 0032 from clean,
let drizzle-kit emit a fresh snapshot chain.

**Don't try to hand-author 0029-0031 snapshots** — drizzle's snapshot
format is internal, and a malformed snapshot can corrupt future
diff output. The "drop + replay" path above is the safe remedy.
