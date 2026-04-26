// Environment variable validation for the mcp-store sidecar.
//
// We fail fast at module-load time on any missing required value so the
// container never boots in a half-configured state. Defaults are only applied
// where a sensible production default exists (NODE_ENV, MCP_PORT).

const env = {
  // Shared with apps/web — points at the same Postgres instance so the
  // sidecar can read/write the queue, articles, and audit tables via
  // @lucidindex/db.
  DATABASE_URL: process.env.DATABASE_URL,

  // Sidecar listen port. Default 4000 to stay clear of the web app on 3000.
  MCP_PORT: Number(process.env.MCP_PORT ?? 4000),

  NODE_ENV: process.env.NODE_ENV ?? 'production',
}

// `console.error` (instead of the structured logger) is intentional: env
// validation runs at module-load time, before the logger is meaningful, and
// these are the last messages the operator sees before `process.exit(1)`.
if (!env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set')
  process.exit(1)
}

if (!Number.isFinite(env.MCP_PORT) || env.MCP_PORT <= 0 || env.MCP_PORT > 65535) {
  console.error(`FATAL: MCP_PORT is not a valid port number: ${process.env.MCP_PORT}`)
  process.exit(1)
}

export default env
