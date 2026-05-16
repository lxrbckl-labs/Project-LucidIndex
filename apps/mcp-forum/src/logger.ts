// Structured JSON logging for the mcp-forum sidecar.
//
// One log line === one JSON object on stdout (or stderr for `error`).
// Matches apps/mcp-dashboard/src/logger.ts so operators can grep both
// sidecars' output the same way. The `msg` prefixes differ
// (`mcp_forum_*` vs `mcp_dashboard_*`) so log routes can split on source.
//
// stdio caveat: when the transport is stdio, stdout is reserved for
// JSON-RPC and any stray write corrupts the protocol. In that mode
// every log level routes to stderr — flip via `setStdioMode(true)`
// from the stdio transport bootstrap.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let stdioMode = false

export function setStdioMode(on: boolean) {
  stdioMode = on
}

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  const stream = stdioMode || level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
}
