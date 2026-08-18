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
  // Shared with apps/web and apps/mcp-dashboard — points at the same Postgres
  // instance so the sidecar can read targets / queue / settings and write
  // cron_runs via @lucidindex/db.
  DATABASE_URL: process.env.DATABASE_URL,

  // Timezone for cron expression evaluation. UTC is the right default for
  // server-side schedulers — operators flip to a local zone (e.g.
  // America/New_York) only when human-aligned schedules matter (e.g. a
  // nightly backup at "midnight local").
  CRON_TIMEZONE: process.env.CRON_TIMEZONE ?? 'UTC',

  // Hero image directory — same env var apps/mcp-dashboard uses (image-pipeline
  // writes <hash>.webp + <hash>.jpg here). The retention-purge cron job
  // reads from it to delete hero image files alongside the DB row delete,
  // and the local-backup job snapshots it.
  MCP_IMAGE_DIR: process.env.MCP_IMAGE_DIR ?? 'data/images',

  // Local backup output directory (#75). pg_dump custom-format dumps and
  // image-tree tarballs land here; retention sweeps the same dir.
  BACKUP_DIR: process.env.BACKUP_DIR ?? 'data/backups',

  // Local backup retention window in days (#75). Files older than this in
  // BACKUP_DIR are pruned at the end of each local-backup tick.
  BACKUP_RETENTION_DAYS: Number(process.env.BACKUP_RETENTION_DAYS ?? '14'),

  // IRON_SESSION_PASSWORD — shared with apps/web. Required by off-site-
  // backup's credential decryption (#76). The cron sidecar derives the same
  // AES-256 key apps/web uses for the encrypted credentials blob in
  // settings.off_site_backup_credentials_encrypted. Kept optional at boot
  // so installs without off-site backup configured can still run cron;
  // the off_site_backup job validates it lazily and skips if missing.
  IRON_SESSION_PASSWORD: process.env.IRON_SESSION_PASSWORD,

  NODE_ENV: process.env.NODE_ENV ?? 'production',
}

if (!env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set')
  process.exit(1)
}

if (!Number.isFinite(env.BACKUP_RETENTION_DAYS) || env.BACKUP_RETENTION_DAYS <= 0) {
  console.error('FATAL: BACKUP_RETENTION_DAYS must be a positive number')
  process.exit(1)
}

export default env
