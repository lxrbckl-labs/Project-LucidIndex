// Structured JSON logging for the mcp-store sidecar.
//
// One log line === one JSON object on stdout (or stderr for `error`). This
// matches the convention expected by container log aggregators (Docker,
// journald, Loki, etc.) — no parser needed, every field is queryable.
//
// HARD RULE: never log secrets. Token cleartext, session cookies, or env
// values should never reach `fields`. Reference rows by their database id
// (e.g. agent_tokens.id) instead of the secret value.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  const stream = level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
}
