# `@lucidindex/cron`

The cron sidecar — LucidIndex's **scheduled-job runner**.

This Node service runs `node-cron` and registers every recurring job that
keeps the system honest: the scheduler that re-enqueues due targets, the
dead-lock reaper that releases stuck queue rows, the high-water-mark hard
reset on pause/unpause, and (from Phase 7 onward) retention pruning and
local/off-site backups. It runs as a separate container from the Next.js
web app and the mcp-store sidecar, and shares the Postgres database via
[`@lucidindex/db`](../../packages/db).

No HTTP surface. The sidecar reads its configuration from `targets` /
`settings` and writes a `cron_runs` row per tick. The Phase 7 Settings →
System dashboard reads `cron_runs` to surface "last tick / status" per job.

## Status

Phase 4 scaffold (#48) — node-cron is wired in and a heartbeat job runs
every minute. Real jobs land in subsequent tickets:

| Ticket | Adds                                                                          |
| ------ | ----------------------------------------------------------------------------- |
| #48    | Sidecar scaffold + heartbeat job (this PR)                                    |
| #49    | Scheduler — sweep due `targets` and re-enqueue (collapse missed ticks)        |
| #50    | Dead-lock reaper — release `queue` rows whose `locked_until` has passed       |
| #51    | Pause/unpause HWM hard-reset                                                  |
| #52    | `cron_runs` writes for every job tick (pattern established by the heartbeat) |

Phase 7 layers retention pruning and the local/off-site backup jobs on
top of the same scheduler.

## Heartbeat job

Every minute, the sidecar inserts a row into `cron_runs`:

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

The heartbeat is the foundational deliverable for #48: it proves the
sidecar boots, can talk to Postgres, and writes `cron_runs` correctly.
The Phase 7 Settings → System dashboard will key off it to assert the
sidecar is alive.

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
| `DATABASE_URL`  | yes      | —            | Shared with `apps/web` and `apps/mcp-store`. Same Postgres.        |
| `CRON_TIMEZONE` | no       | `UTC`        | Timezone for cron-expression evaluation (e.g. `America/New_York`). |
| `NODE_ENV`      | no       | `production` | Standard Node env flag.                                            |

## Logging

Structured JSON, one object per line, on stdout (`debug`/`info`/`warn`)
or stderr (`error`). See [`src/logger.ts`](src/logger.ts).

> **Never log secrets.** The DATABASE_URL connection string components
> (host, password) and any future agent-token material must never reach
> log fields. Reference rows by their database id (e.g. `cron_runs.id`)
> instead.
