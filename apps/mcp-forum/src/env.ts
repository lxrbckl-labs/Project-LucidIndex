// Environment variable validation for the mcp-forum sidecar.
//
// Mirrors apps/mcp-store/src/env.ts in shape and posture (fail-fast at
// module-load time, sensible production defaults). Diverges where the
// forum MCP's surface differs: no queue-lock TTL (no claim-based queue
// in forum MCP), no on-disk image directory (avatars are stored inline
// as bytea on forum_users), and the default HTTP port is 4100 so it
// doesn't collide with mcp-store on 4000.

type Transport = 'http' | 'stdio'

const rawTransport = (process.env.MCP_FORUM_TRANSPORT ?? 'http').toLowerCase()
if (rawTransport !== 'http' && rawTransport !== 'stdio') {
  console.error(
    `FATAL: MCP_FORUM_TRANSPORT must be 'http' or 'stdio', got: ${process.env.MCP_FORUM_TRANSPORT}`,
  )
  process.exit(1)
}

const env = {
  // Shared with apps/web and apps/mcp-store — points at the same
  // Postgres instance so the sidecar can read/write forum_users and
  // forum_agent_tokens via @lucidindex/db.
  DATABASE_URL: process.env.DATABASE_URL,

  // Sidecar listen port. Default 4100 to stay clear of mcp-store on
  // 4000 and the web app on 3000. Only consulted when transport=http.
  MCP_FORUM_PORT: Number(process.env.MCP_FORUM_PORT ?? 4100),

  // Which MCP transport to bind. Default `http` for the deployment
  // story; `stdio` is for local dev / MCP inspector.
  MCP_FORUM_TRANSPORT: rawTransport as Transport,

  // Per-fetch budgets for the agent-supplied profile-photo URL. Failure
  // to satisfy either budget aborts the fetch — the agent gets a
  // structured error and no row is updated.
  MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS: Number(process.env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS ?? 10_000),
  // 2 MiB cap — matches the human web upload's MAX_BYTES so agent + human
  // paths produce avatars of comparable weight.
  MCP_FORUM_PHOTO_MAX_BYTES: Number(process.env.MCP_FORUM_PHOTO_MAX_BYTES ?? 2 * 1024 * 1024),

  NODE_ENV: process.env.NODE_ENV ?? 'production',
}

// `console.error` (instead of the structured logger) is intentional: env
// validation runs at module-load time, before the logger is meaningful,
// and these are the last messages the operator sees before exit(1).
if (!env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set')
  process.exit(1)
}

if (
  env.MCP_FORUM_TRANSPORT === 'http' &&
  (!Number.isFinite(env.MCP_FORUM_PORT) || env.MCP_FORUM_PORT <= 0 || env.MCP_FORUM_PORT > 65535)
) {
  console.error(`FATAL: MCP_FORUM_PORT is not a valid port number: ${process.env.MCP_FORUM_PORT}`)
  process.exit(1)
}

if (
  !Number.isFinite(env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS) ||
  env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS <= 0
) {
  console.error(
    `FATAL: MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS must be a positive number: ${process.env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS}`,
  )
  process.exit(1)
}

if (!Number.isFinite(env.MCP_FORUM_PHOTO_MAX_BYTES) || env.MCP_FORUM_PHOTO_MAX_BYTES <= 0) {
  console.error(
    `FATAL: MCP_FORUM_PHOTO_MAX_BYTES must be a positive number: ${process.env.MCP_FORUM_PHOTO_MAX_BYTES}`,
  )
  process.exit(1)
}

export default env
