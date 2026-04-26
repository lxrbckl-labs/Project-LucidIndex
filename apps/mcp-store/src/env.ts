// Environment variable validation for the mcp-store sidecar.
//
// We fail fast at module-load time on any missing required value so the
// container never boots in a half-configured state. Defaults are only applied
// where a sensible production default exists (NODE_ENV, MCP_PORT,
// MCP_TRANSPORT, lock TTL, image limits).

type Transport = 'http' | 'stdio'

const rawTransport = (process.env.MCP_TRANSPORT ?? 'http').toLowerCase()
if (rawTransport !== 'http' && rawTransport !== 'stdio') {
  console.error(`FATAL: MCP_TRANSPORT must be 'http' or 'stdio', got: ${process.env.MCP_TRANSPORT}`)
  process.exit(1)
}

// Resolve the lock TTL: either MCP_LOCK_TTL_MINUTES (per #42 spec) or the
// legacy MCP_QUEUE_LOCK_TTL_SEC (kept so existing deployments don't break).
// Minutes wins if both are set. Default 15 minutes.
function resolveLockTtlSec(): number {
  const minutesRaw = process.env.MCP_LOCK_TTL_MINUTES
  const secondsRaw = process.env.MCP_QUEUE_LOCK_TTL_SEC
  if (minutesRaw !== undefined) {
    const n = Number(minutesRaw)
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`FATAL: MCP_LOCK_TTL_MINUTES must be a positive number: ${minutesRaw}`)
      process.exit(1)
    }
    return Math.round(n * 60)
  }
  if (secondsRaw !== undefined) {
    const n = Number(secondsRaw)
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`FATAL: MCP_QUEUE_LOCK_TTL_SEC must be a positive number: ${secondsRaw}`)
      process.exit(1)
    }
    return Math.round(n)
  }
  // Default: 15 minutes per #42.
  return 15 * 60
}

const env = {
  // Shared with apps/web — points at the same Postgres instance so the
  // sidecar can read/write the queue, articles, and audit tables via
  // @lucidindex/db.
  DATABASE_URL: process.env.DATABASE_URL,

  // Sidecar listen port. Default 4000 to stay clear of the web app on 3000.
  // Only consulted when MCP_TRANSPORT=http.
  MCP_PORT: Number(process.env.MCP_PORT ?? 4000),

  // Which MCP transport to bind. Default `http` (Streamable HTTP) for the
  // docker-compose deployment; `stdio` is for co-located agents that exec
  // into the container or local dev with the MCP inspector.
  MCP_TRANSPORT: rawTransport as Transport,

  // Queue claim-lock TTL in seconds. The agent has this long after
  // pull_queue_item to ack before the dead-lock reaper releases the row
  // back to the pool. Configurable via MCP_LOCK_TTL_MINUTES (preferred,
  // per #42) or the legacy MCP_QUEUE_LOCK_TTL_SEC.
  MCP_QUEUE_LOCK_TTL_SEC: resolveLockTtlSec(),

  // Where the hero-image pipeline writes resized WebP/JPEG outputs. Path
  // is resolved relative to the process cwd; production deployments mount
  // this as a docker volume so files survive container restarts.
  MCP_IMAGE_DIR: process.env.MCP_IMAGE_DIR ?? 'data/images',

  // Per-fetch budgets for the hero-image pipeline. Failure to satisfy
  // either budget aborts the fetch — the article still inserts, just
  // without a hero image (placeholder tile in the dashboard).
  MCP_IMAGE_FETCH_TIMEOUT_MS: Number(process.env.MCP_IMAGE_FETCH_TIMEOUT_MS ?? 10_000),
  MCP_IMAGE_MAX_BYTES: Number(process.env.MCP_IMAGE_MAX_BYTES ?? 25 * 1024 * 1024),

  // Resize target width. Anything wider than this is downscaled to fit
  // (preserving aspect ratio); narrower images are passed through
  // untouched. EXIF is stripped unconditionally.
  MCP_IMAGE_MAX_WIDTH: Number(process.env.MCP_IMAGE_MAX_WIDTH ?? 1600),

  NODE_ENV: process.env.NODE_ENV ?? 'production',
}

// `console.error` (instead of the structured logger) is intentional: env
// validation runs at module-load time, before the logger is meaningful, and
// these are the last messages the operator sees before `process.exit(1)`.
if (!env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set')
  process.exit(1)
}

if (
  env.MCP_TRANSPORT === 'http' &&
  (!Number.isFinite(env.MCP_PORT) || env.MCP_PORT <= 0 || env.MCP_PORT > 65535)
) {
  console.error(`FATAL: MCP_PORT is not a valid port number: ${process.env.MCP_PORT}`)
  process.exit(1)
}

if (!Number.isFinite(env.MCP_IMAGE_FETCH_TIMEOUT_MS) || env.MCP_IMAGE_FETCH_TIMEOUT_MS <= 0) {
  console.error(
    `FATAL: MCP_IMAGE_FETCH_TIMEOUT_MS must be a positive number: ${process.env.MCP_IMAGE_FETCH_TIMEOUT_MS}`,
  )
  process.exit(1)
}

if (!Number.isFinite(env.MCP_IMAGE_MAX_BYTES) || env.MCP_IMAGE_MAX_BYTES <= 0) {
  console.error(
    `FATAL: MCP_IMAGE_MAX_BYTES must be a positive number: ${process.env.MCP_IMAGE_MAX_BYTES}`,
  )
  process.exit(1)
}

if (!Number.isFinite(env.MCP_IMAGE_MAX_WIDTH) || env.MCP_IMAGE_MAX_WIDTH <= 0) {
  console.error(
    `FATAL: MCP_IMAGE_MAX_WIDTH must be a positive number: ${process.env.MCP_IMAGE_MAX_WIDTH}`,
  )
  process.exit(1)
}

export default env
