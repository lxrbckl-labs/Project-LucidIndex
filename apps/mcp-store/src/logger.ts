// Structured JSON logging for the mcp-store sidecar.
//
// One log line === one JSON object on stdout (or stderr for `error`). This
// matches the convention expected by container log aggregators (Docker,
// journald, Loki, etc.) — no parser needed, every field is queryable.
//
// stdio-transport caveat: when MCP_TRANSPORT=stdio, stdout is reserved for
// the JSON-RPC stream and ANY stray write corrupts the protocol. In that
// mode we redirect every log level to stderr. Call `setStdioMode(true)`
// from the stdio transport bootstrap before any tool calls happen.
//
// HARD RULE: never log secrets. Token cleartext, session cookies, or env
// values should never reach `fields`. Reference rows by their database id
// (e.g. agent_tokens.id) instead of the secret value.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let stdioMode = false

export function setStdioMode(on: boolean) {
  stdioMode = on
}

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  // In stdio transport mode, all logs go to stderr to avoid corrupting the
  // JSON-RPC stream on stdout.
  const stream = stdioMode || level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
}
