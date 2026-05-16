# `@lucidindex/cron`

The cron sidecar — LucidIndex's **scheduled-job runner**.

This Node service runs `node-cron` and registers every recurring job that
keeps the system honest: the scheduler that re-enqueues due targets, the
dead-lock reaper that releases stuck queue rows, the high-water-mark hard
reset on pause/unpause, and (from Phase 7 onward) retention pruning and
local/off-site backups. It runs as a separate container from the Next.js
web app and the mcp-dashboard sidecar, and shares the Postgres database via
[`@lucidindex/db`](../../packages/db).

No HTTP surface. The sidecar reads its configuration from `targets` /
`settings` and writes a `cron_runs` row per tick. The Phase 7 Settings →
System dashboard reads `cron_runs` to surface "last tick / status" per job.

## Status

Phase 4 complete (#48 + #49/#50/#51/#52). Four jobs run every minute, each
following the same `cron_runs` envelope (insert in-flight breadcrumb → run
job body → update with status/details). The shared envelope lives in
[`src/lib/run-job.ts`](src/lib/run-job.ts).

| Ticket | Job          | What it does                                                            |
| ------ | ------------ | ----------------------------------------------------------------------- |
| #48    | `heartbeat`  | Proves the sidecar is alive + DB-reachable (single combined insert)     |
| #49    | `scheduler`  | Sweep due `targets`, re-enqueue, collapse missed ticks                  |
| #50    | `reaper`     | Release `queue` rows whose `locked_until` has expired                   |
| #51    | `hwm_reset`  | Clear `high_water_mark` for targets that just unpaused                  |
| #52    | _(quality)_  | Every job tick writes a `cron_runs` row (pattern enforced by `runJob`) |

Phase 7 layers retention pruning and the local/off-site backup jobs on
top of the same scheduler.

## Jobs

### `heartbeat` (#48)

Every minute, the sidecar inserts a single row:

```
job          = 'heartbeat'
started_at   = <now>
completed_at = <now>
status       = 'succeeded'
details      = { "note": "scaffold heartbeat" }
```

If the insert fails (e.g. Postgres is unreachable), the sidecar logs a
structured error AND attempts a second `failed` row so the dashboard
surfaces the outage. The fallback insert is best-effort and swallowed if
it also fails.

### `scheduler` (#49)

Every minute, inside a single transaction:

1. Find every `targets` row where `active = true AND next_due_at <= now()`.
2. For each due target, check whether there's already an unacked queue
   row (`acked_at IS NULL`). If yes, COLLAPSE — skip the re-enqueue. If
   no, insert a fresh queue row.
3. Advance `targets.next_due_at` by one cadence interval anchored on
   `now` so backlogged targets don't stay perpetually overdue.

`details = { swept, enqueued, collapsed }`. Cadence parsing lives in
[`src/lib/cadence.ts`](src/lib/cadence.ts) — narrow allow-list of the
v0.1 presets.

### `reaper` (#50)

Every minute, release queue rows whose `locked_until` has passed:

```sql
UPDATE queue
   SET claimed_by = NULL, locked_until = NULL
 WHERE locked_until < now() AND acked_at IS NULL
```

`details = { reaped }`. Per **NO DELETIONS**, queue rows are never
deleted — the reaper only resets the lock fields so the next agent pull
can claim them.

### `hwm_reset` (#51)

Every minute, consume the pause/unpause hard-reset flag:

```sql
UPDATE targets
   SET high_water_mark = NULL, hwm_reset_pending = false
 WHERE hwm_reset_pending = true
```

The web app sets `hwm_reset_pending = true` in `setTargetActive` /
`updateTarget` when a target transitions `active = false → true`. The
flag is idempotent and self-healing — a missed cron tick (sidecar
restart, DB blip) is recovered on the next sweep without any clock
state to reconcile.

`details = { reset }`.

## Run locally

From the repo root:

```sh
# install once
pnpm install

# dev mode — tsx watch, hot reload on src/ changes
pnpm --filter @lucidindex/cron dev
```

After roughly 60 seconds, a heartbeat row should appear:

```sh
psql $DATABASE_URL -c "SELECT id, job, status, started_at FROM cron_runs ORDER BY started_at DESC LIMIT 5;"
```

## Run via docker-compose

```sh
docker compose up -d --build cron
docker compose logs -f cron
```

Same heartbeat behaviour — one row per minute in `cron_runs`.

## Environment variables

| Var             | Required | Default      | Notes                                                              |
| --------------- | -------- | ------------ | ------------------------------------------------------------------ |
| `DATABASE_URL`  | yes      | —            | Shared with `apps/web` and `apps/mcp-dashboard`. Same Postgres.        |
| `CRON_TIMEZONE` | no       | `UTC`        | Timezone for cron-expression evaluation (e.g. `America/New_York`). |
| `NODE_ENV`      | no       | `production` | Standard Node env flag.                                            |

## Logging

Structured JSON, one object per line, on stdout (`debug`/`info`/`warn`)
or stderr (`error`). See [`src/logger.ts`](src/logger.ts).

> **Never log secrets.** The DATABASE_URL connection string components
> (host, password) and any future agent-token material must never reach
> log fields. Reference rows by their database id (e.g. `cron_runs.id`)
> instead.

## Smoke test

The Phase 4 jobs can be exercised end-to-end against a throwaway
Postgres. From the repo root:

```sh
# 1. Boot Postgres + apply migrations + seed prompt templates.
docker run --rm -d --name li-cron-test -p 5456:5432 \
  -e POSTGRES_USER=lucidindex -e POSTGRES_PASSWORD=lucidindex_dev -e POSTGRES_DB=lucidindex \
  postgres:16-alpine
sleep 4
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5456/lucidindex pnpm db:migrate
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5456/lucidindex pnpm db:seed

# 2. Insert a past-due target, a future target, and an agent token.
docker exec li-cron-test psql -U lucidindex -d lucidindex -c "
  INSERT INTO admins (name) VALUES ('TestAdmin');
  INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, active)
    VALUES ('PastDue', 'https://example.com/a', 'hourly',
            (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
            now() - interval '1 minute', true);
  INSERT INTO targets (label, url_or_handle, cadence, prompt_template_id, next_due_at, active)
    VALUES ('Future', 'https://example.com/b', 'hourly',
            (SELECT id FROM prompt_templates WHERE slug = 'website' LIMIT 1),
            now() + interval '1 hour', true);
  INSERT INTO agent_tokens (label, token_hash) VALUES ('TestAgent', 'placeholder-hash');
"

# 3. Boot the sidecar in the background, wait one minute boundary.
DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5456/lucidindex \
  pnpm --filter @lucidindex/cron dev > /tmp/qa-cron.log 2>&1 &
CRON_PID=$!
sleep 75

# 4. Scheduler enqueued PastDue, NOT Future. PastDue.next_due_at advanced ~1h.
docker exec li-cron-test psql -U lucidindex -d lucidindex -c "
  SELECT t.label, q.id IS NOT NULL AS has_queue, t.next_due_at
    FROM targets t LEFT JOIN queue q ON q.target_id = t.id
   ORDER BY t.label;"

# 5. Reset PastDue to past again, wait one tick — expect collapse (1 queue row).
docker exec li-cron-test psql -U lucidindex -d lucidindex -c \
  "UPDATE targets SET next_due_at = now() - interval '1 minute' WHERE label = 'PastDue';"
sleep 70
docker exec li-cron-test psql -U lucidindex -d lucidindex -c "
  SELECT t.label, count(q.*) FROM targets t LEFT JOIN queue q ON q.target_id = t.id
  GROUP BY t.label;"
# expect: PastDue → 1 queue row (collapsed, not piled up)

# 6. Reaper: expire the lock, wait, verify cleared.
docker exec li-cron-test psql -U lucidindex -d lucidindex -c "
  UPDATE queue SET locked_until = now() - interval '1 hour',
                   claimed_by = (SELECT id FROM agent_tokens LIMIT 1)
   WHERE acked_at IS NULL;"
sleep 70
docker exec li-cron-test psql -U lucidindex -d lucidindex -c \
  "SELECT id, locked_until, claimed_by FROM queue;"
# expect: locked_until + claimed_by = NULL

# 7. HWM reset: pause, unpause (sets hwm_reset_pending), wait.
docker exec li-cron-test psql -U lucidindex -d lucidindex -c "
  UPDATE targets SET high_water_mark = '\"some-mark\"'::jsonb, active = false WHERE label = 'PastDue';
  UPDATE targets SET active = true, hwm_reset_pending = true WHERE label = 'PastDue';"
sleep 70
docker exec li-cron-test psql -U lucidindex -d lucidindex -c \
  "SELECT label, high_water_mark, hwm_reset_pending FROM targets;"
# expect: high_water_mark = NULL, hwm_reset_pending = false

# 8. cron_runs has rows for all four jobs.
docker exec li-cron-test psql -U lucidindex -d lucidindex -c \
  "SELECT job, status, details FROM cron_runs ORDER BY started_at DESC LIMIT 12;"

# 9. Cleanup.
kill $CRON_PID
sleep 2
docker stop li-cron-test
```
