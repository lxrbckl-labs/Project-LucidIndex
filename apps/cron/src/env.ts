// Environment variable validation for the cron sidecar.
//
// We fail fast at module-load time on any missing required value so the
// container never boots in a half-configured state. Only `DATABASE_URL` is
// required today; everything else has a sane production default.
//
// `console.error` (instead of the structured logger) is intentional here:
// env validation runs at module-load time, before the logger is meaningful,
// and these are the last messages the operator sees before `process.exit(1)`.

const env = {
  // Shared with apps/web and apps/mcp-store — points at the same Postgres
  // instance so the sidecar can read targets / queue / settings and write
  // cron_runs via @lucidindex/db.
  DATABASE_URL: process.env.DATABASE_URL,

  // Timezone for cron expression evaluation. UTC is the right default for
  // server-side schedulers — operators flip to a local zone (e.g.
  // America/New_York) only when human-aligned schedules matter (e.g. a
  // nightly backup at "midnight local").
  CRON_TIMEZONE: process.env.CRON_TIMEZONE ?? 'UTC',

  NODE_ENV: process.env.NODE_ENV ?? 'production',
}

if (!env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set')
  process.exit(1)
}

export default env
