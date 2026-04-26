// Environment variable validation for the mcp-store sidecar.
//
// We fail fast at module-load time on any missing required value so the
// container never boots in a half-configured state. Defaults are only applied
// where a sensible production default exists (NODE_ENV, MCP_PORT,
// MCP_TRANSPORT, MCP_QUEUE_LOCK_TTL_SEC).

type Transport = 'http' | 'stdio'

const rawTransport = (process.env.MCP_TRANSPORT ?? 'http').toLowerCase()
if (rawTransport !== 'http' && rawTransport !== 'stdio') {
  console.error(`FATAL: MCP_TRANSPORT must be 'http' or 'stdio', got: ${process.env.MCP_TRANSPORT}`)
  process.exit(1)
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
  // back to the pool. Default 15 min — TODO(#42) makes this atomic.
  MCP_QUEUE_LOCK_TTL_SEC: Number(process.env.MCP_QUEUE_LOCK_TTL_SEC ?? 900),

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

if (!Number.isFinite(env.MCP_QUEUE_LOCK_TTL_SEC) || env.MCP_QUEUE_LOCK_TTL_SEC <= 0) {
  console.error(
    `FATAL: MCP_QUEUE_LOCK_TTL_SEC must be a positive number: ${process.env.MCP_QUEUE_LOCK_TTL_SEC}`,
  )
  process.exit(1)
}

export default env
