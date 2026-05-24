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
//
// Request-id correlation (ported from mcp-dashboard): every log line
// emitted inside an HTTP request includes a `request_id` field so a
// single tool call can be grepped end-to-end across the auth check,
// the tool body, and any downstream errors. The id is plumbed via
// `AsyncLocalStorage` (node:async_hooks) so callers don't have to
// thread it through every function. The HTTP transport wraps each
// request in `withRequestId(...)`; stdio doesn't set one (single
// long-lived session, request ids would be noise).
//
// HARD RULE: never log secrets. Token cleartext, session cookies, or
// env values should never reach `fields`. Reference rows by their
// database id (e.g. forum_agent_tokens.id) instead of the secret
// value.

import { AsyncLocalStorage } from 'node:async_hooks'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let stdioMode = false

export function setStdioMode(on: boolean) {
  stdioMode = on
}

/**
 * Per-request log context. Stored in AsyncLocalStorage so any code
 * path reached from `withRequestId(...)` picks up the active request
 * id without a parameter chain.
 */
type RequestContext = { requestId: string }

const requestContext = new AsyncLocalStorage<RequestContext>()

/**
 * Run `fn` inside an async context that tags every log line with
 * `request_id = requestId`. The HTTP transport calls this once per
 * incoming request; stdio doesn't.
 */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn)
}

/** Read the active request id if any (returns undefined outside withRequestId). */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId
}

function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const requestId = getRequestId()
  // Merge order: explicit `fields` win over request_id so callers can
  // override the value if they intentionally want to log under a
  // different id (rare).
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  }
  if (requestId !== undefined) {
    payload.request_id = requestId
  }
  for (const [k, v] of Object.entries(fields)) {
    payload[k] = v
  }
  const line = JSON.stringify(payload)
  // In stdio transport mode, all logs go to stderr to avoid corrupting
  // the JSON-RPC stream on stdout.
  const stream = stdioMode || level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
}
