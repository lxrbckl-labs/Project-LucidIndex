// Structured JSON logging for the cron sidecar.
//
// One log line === one JSON object on stdout (or stderr for `error`). This
// matches the convention expected by container log aggregators (Docker,
// journald, Loki, etc.) — no parser needed, every field is queryable.
//
// Mirrors apps/mcp-store/src/logger.ts. The two sidecars are independent
// processes; the duplication is trivial and keeps each app self-contained.
// If a third consumer shows up we'll factor this into packages/shared.
//
// HARD RULE: never log secrets. DATABASE_URL components, agent tokens, env
// values — none of these belong in `fields`. Reference rows by their
// database id (e.g. cron_runs.id) instead.

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
