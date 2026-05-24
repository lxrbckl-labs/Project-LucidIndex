// Environment variable validation for the mcp-forum sidecar.
//
// Mirrors apps/mcp-dashboard/src/env.ts in shape and posture (fail-fast at
// module-load time, sensible production defaults). Diverges where the
// forum MCP's surface differs: no queue-lock TTL (no claim-based queue
// in forum MCP), no on-disk image directory (avatars are stored inline
// as bytea on forum_users), and the default HTTP port is 4100 so it
// doesn't collide with mcp-dashboard on 4000.

type Transport = 'http' | 'stdio'

const rawTransport = (process.env.MCP_FORUM_TRANSPORT ?? 'http').toLowerCase()
if (rawTransport !== 'http' && rawTransport !== 'stdio') {
  console.error(
    `FATAL: MCP_FORUM_TRANSPORT must be 'http' or 'stdio', got: ${process.env.MCP_FORUM_TRANSPORT}`,
  )
  process.exit(1)
}

const env = {
  // Shared with apps/web and apps/mcp-dashboard — points at the same
  // Postgres instance so the sidecar can read/write forum_users and
  // forum_agent_tokens via @lucidindex/db.
  DATABASE_URL: process.env.DATABASE_URL,

  // Sidecar listen port. Default 4100 to stay clear of mcp-dashboard on
  // 4000 and the web app on 3000. Only consulted when transport=http.
  MCP_FORUM_PORT: Number(process.env.MCP_FORUM_PORT ?? 4100),

  // Which MCP transport to bind. Default `http` for the deployment
  // story; `stdio` is for local dev / MCP inspector.
  MCP_FORUM_TRANSPORT: rawTransport as Transport,

  // Per-fetch budget for the agent-supplied profile-photo URL. Failure
  // to satisfy the budget aborts the fetch — the agent gets a
  // structured error and no row is updated.
  MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS: Number(process.env.MCP_FORUM_PHOTO_FETCH_TIMEOUT_MS ?? 10_000),

  // CORS allowlist for the Streamable HTTP transport. Comma-separated
  // list of permitted Origin headers, or `*` (default) for any origin.
  // The transport echoes back the request's Origin header verbatim when
  // it matches an entry, or sends `*` when the env value is literally
  // `*`. Bearer auth is header-based so opening this surface widely does
  // not expose ambient credentials — narrow it only when fronting a
  // known forum dashboard origin.
  MCP_FORUM_CORS_ORIGINS: process.env.MCP_FORUM_CORS_ORIGINS ?? '*',

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

export default env
