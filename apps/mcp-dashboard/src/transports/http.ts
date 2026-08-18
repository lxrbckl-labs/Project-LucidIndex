// Streamable HTTP transport with bearer-token auth.
//
// The MCP SDK ships a `StreamableHTTPServerTransport` that consumes Node's
// `IncomingMessage`/`ServerResponse` objects and handles the JSON-RPC dance
// internally. We mount it on a plain `node:http` server, do bearer-token
// auth before delegating, and pass the validated AuthContext through the
// SDK's `req.auth` (AuthInfo) channel — tool handlers read it back off
// `extra.authInfo.extra`.
//
// HARD RULE: do NOT delegate to @lucidindex/auth/session — that's
// iron-session for human web traffic. Bearer flow is its own simple lookup.
//
// Transport + server lifecycle (per-request):
// We build a FRESH `McpServer` AND a FRESH `StreamableHTTPServerTransport`
// for each incoming request, connect them together, handle the request,
// and tear both down in `finally`. This matches the SDK's official
// "stateless streamable HTTP" example (see
// `node_modules/@modelcontextprotocol/sdk/dist/esm/examples/server/simpleStatelessStreamableHttp.js`)
// and is the only correct way to do stateless HTTP MCP without forcing
// clients through an `initialize`/`Mcp-Session-Id` handshake:
//
//   - The SDK's stateless transport guards `_hasHandledRequest` and throws
//     `Stateless transport cannot be reused across requests` on the second
//     `handleRequest` call. The error surfaces inside Hono's
//     `getRequestListener` (which the SDK uses internally) and gets
//     swallowed back to an empty HTTP 500. So a single long-lived
//     transport silently 500s on every call after the first.
//   - The SDK's `Server.connect(transport)` throws if the server already
//     has a transport attached, so we cannot reuse one server with a
//     fresh transport per request either — we need a fresh server too.
//   - Stateful mode (with `sessionIdGenerator`) would avoid both of the
//     above but requires clients to first POST `initialize`, capture the
//     `Mcp-Session-Id` response header, and echo it on every subsequent
//     request. Our agent clients do not do this today (they POST
//     `tools/list` / `tools/call` directly), so stateful mode would
//     reject every request with 400 "Server not initialized".
//
// Per-request setup is cheap: `registerTools()` is a pure registration of
// handler closures (no DB calls, no I/O), and the McpServer constructor
// only allocates in-memory tables. The actual DB work happens inside the
// tool handlers, which is the same on either lifecycle model.

import { randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { db } from '@lucidindex/db/client'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { sql } from 'drizzle-orm'
import {
  type AuthContext,
  type AuthFailureReason,
  authenticateBearer,
  logAuthFailed,
  logAuthSucceeded,
} from '../auth.js'
import env from '../env.js'
import { logger, withRequestId } from '../logger.js'

/**
 * Factory that constructs a fully-configured `McpServer` (tools registered,
 * capabilities advertised) ready to connect to a transport. Called once
 * per incoming HTTP request.
 */
export type McpServerFactory = () => McpServer

/**
 * Body size cap. 5 MiB — generous for prompts + article bodies, bounded so
 * a malformed client can't OOM the sidecar. Exposed at module scope so the
 * 413 handler can surface the value to the client.
 */
const MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Static CORS headers (methods, headers, max-age). The Allow-Origin
 * value is resolved per-request from `MCP_DASHBOARD_CORS_ORIGINS` —
 * see `resolveCorsHeaders(req)` below.
 *
 * Why the surface is open by default:
 *   - The MCP surface is a structured tool API, not a cookie-bearing
 *     human-facing site — there's no ambient credential to protect.
 *   - Bearer auth is a header (`Authorization`), not a cookie, so CORS
 *     credential rules don't apply.
 *   - Agents may run in browsers (dashboards, scratchpads, devtools) that
 *     need to call this endpoint from arbitrary origins.
 *
 * Audit round 6 — `MCP_DASHBOARD_CORS_ORIGINS` lets deployments
 * narrow that surface to a known dashboard origin without code changes.
 * Comma-separated list, or `*` (default) for any origin.
 */
const STATIC_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
} as const

/**
 * Parsed allowlist from `MCP_DASHBOARD_CORS_ORIGINS`. `null` means
 * wide-open `*`; otherwise a Set of exact-match Origin strings.
 */
const CORS_ORIGIN_ALLOWLIST: Set<string> | null = (() => {
  const raw = env.MCP_DASHBOARD_CORS_ORIGINS.trim()
  if (raw === '' || raw === '*') return null
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
})()

/**
 * Resolve the CORS headers for a given request. When the env var is
 * `*` (default) we send `Access-Control-Allow-Origin: *`. When an
 * allowlist is configured we echo the request's Origin if it matches,
 * otherwise we omit the Allow-Origin header entirely (browser blocks
 * the request, which is the intended behavior).
 */
function resolveCorsHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = { ...STATIC_CORS_HEADERS }
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  if (CORS_ORIGIN_ALLOWLIST === null) {
    headers['Access-Control-Allow-Origin'] = '*'
  } else if (origin && CORS_ORIGIN_ALLOWLIST.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    // When we echo a specific origin, advertise Vary so caches don't
    // bleed one origin's response across another.
    headers.Vary = 'Origin'
  }
  return headers
}

/**
 * How long the graceful-shutdown drain waits for in-flight requests to
 * finish before forcibly closing the listener and exiting. 30s is the
 * default Kubernetes pre-stop grace plus a small safety margin —
 * deployments running behind a stricter LB can tighten this with a
 * future env knob (`MCP_DASHBOARD_SHUTDOWN_DRAIN_MS`), but the
 * baseline matches operator expectations.
 */
const SHUTDOWN_DRAIN_MS = 30_000

/**
 * Poll interval the drain loop uses while watching the in-flight
 * counter. 50ms keeps the latency overhead negligible (one event-loop
 * tick) while bounding the worst case of "all requests finish but we
 * sleep through the drop to zero" to half a tick.
 */
const SHUTDOWN_DRAIN_POLL_MS = 50

/**
 * Boot a Streamable HTTP MCP server on env.MCP_DASHBOARD_PORT. The caller passes a
 * `createServer` factory that builds a fresh `McpServer` per request — the
 * factory must register tools and capabilities on the server before
 * returning it.
 *
 * Returns an object with a `shutdown` hook (so the entrypoint can wire
 * SIGTERM cleanup of the listening node:http server). The shutdown
 * sequence (audit round 9):
 *   1. Flip `shuttingDown` — `/healthz` immediately starts returning
 *      503 `{ status: 'shutting_down' }` so any upstream load balancer
 *      drains us from rotation on the next probe.
 *   2. Wait up to SHUTDOWN_DRAIN_MS for the per-request in-flight
 *      counter to reach zero (new requests are still accepted during
 *      the drain — Kubernetes documents this as the correct behavior
 *      because the LB may take one extra probe to mark the pod down,
 *      and refusing in-window requests would surface as 502s to users).
 *   3. Close the listener (no new connections accepted) and resolve.
 *   4. The entrypoint then calls `process.exit(0)`.
 */
export async function startHttpTransport(createMcpServer: McpServerFactory): Promise<{
  shutdown: () => Promise<void>
}> {
  /**
   * Shutdown coordination state. `shuttingDown` flips on first SIGTERM
   * and is consumed by the /healthz handler to flip the response to
   * 503. `inFlight` is incremented at the top of every MCP request and
   * decremented in `finally`, so the drain loop can wait for the
   * counter to reach zero before tearing the listener down.
   */
  let shuttingDown = false
  let inFlight = 0

  const httpServer = createHttpServer(async (req, res) => {
    // CORS preflight — applies to BOTH /mcp and /healthz (and any other
    // sibling paths). Browsers issue an OPTIONS before any non-simple
    // POST (anything carrying an `Authorization` header qualifies), so
    // we have to answer this BEFORE the auth middleware, otherwise the
    // browser sees a 401 on the preflight and never sends the real POST.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, resolveCorsHeaders(req))
      res.end()
      return
    }

    // Health check — bypass auth + MCP entirely. Useful for docker-compose
    // healthchecks and operator probes.
    //
    // Audit round 6: previously returned 200 unconditionally, which meant
    // the container could be reachable but its DB connection broken and
    // docker-compose would still mark it healthy. We now run a `SELECT 1`
    // with a 1s timeout. Success → 200 `{status:'ok'}`. Failure (timeout,
    // connection refused, etc.) → 503 `{status:'unhealthy',
    // reason:'db_unreachable'}`. The compose healthcheck is wired to
    // this endpoint so a failing DB now correctly flips the container's
    // health status.
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
      const headers = { 'Content-Type': 'application/json', ...resolveCorsHeaders(req) }
      // Audit round 9: once SIGTERM has flipped `shuttingDown`, fail
      // the probe immediately so the upstream LB / orchestrator stops
      // sending us new traffic. We skip the DB ping in this state —
      // the only signal the operator needs is "this pod is going
      // away". Returning a stable JSON shape so dashboards can
      // distinguish "shutting_down" from "db_unreachable".
      if (shuttingDown) {
        res.writeHead(503, headers)
        res.end(JSON.stringify({ status: 'shutting_down' }))
        return
      }
      const healthOk = await checkDbHealth()
      if (healthOk) {
        res.writeHead(200, headers)
        res.end(JSON.stringify({ status: 'ok' }))
      } else {
        res.writeHead(503, headers)
        res.end(JSON.stringify({ status: 'unhealthy', reason: 'db_unreachable' }))
      }
      return
    }

    // P2 (audit round 3): mint a request id and wrap the handler in
    // `withRequestId(...)` so every downstream log line gets correlated
    // back to this request. The id also flows through to tools that
    // need to surface it in their own logs.
    const requestId = randomUUID()
    // Audit round 9 — increment the in-flight counter at the top and
    // decrement in `finally`, so the SIGTERM drain loop can wait for
    // every active request to land before closing the listener.
    // Counter is captured here (rather than inside handleMcpRequest)
    // so even a synchronous throw from withRequestId doesn't leak the
    // count.
    inFlight++
    try {
      await withRequestId(requestId, () => handleMcpRequest(req, res, requestId))
    } finally {
      inFlight--
    }
  })

  /**
   * Inner per-request handler. Split out from the `createHttpServer`
   * arrow so the `withRequestId(...)` wrapper above is the only
   * indirection over the original logic. Behavior is unchanged save
   * for the addition of `request_id` to the AuthInfo extra so tool
   * handlers can read it.
   */
  async function handleMcpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    // Pre-parse the request body for POST/PUT/DELETE so the SDK doesn't
    // race the auth middleware on stream consumption. A body exceeding
    // the MAX_BODY_BYTES cap is surfaced as a proper 413 with a stable
    // JSON shape (NOT the generic 500 the error path would otherwise
    // produce).
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        res.writeHead(413, { 'Content-Type': 'application/json', ...resolveCorsHeaders(req) })
        res.end(
          JSON.stringify({
            error: 'payload_too_large',
            limit_bytes: MAX_BODY_BYTES,
          }),
        )
        return
      }
      throw err
    }

    const authResult = await authenticateBearer(req.headers.authorization)
    if (!authResult.ok) {
      logAuthFailed(authResult.reason)
      respondAuthFailure(req, res, authResult.reason)
      return
    }
    logAuthSucceeded(authResult.context.agentTokenId)

    // Attach the AuthInfo to the IncomingMessage. The SDK's transport reads
    // `req.auth` and forwards it as `extra.authInfo` to the tool handler.
    // We use AuthInfo.extra to carry our agent_token row (the SDK's
    // first-class fields like clientId/scopes/token aren't a great fit for
    // bearer-only flows, but `extra` is documented for "any additional
    // data that needs to be attached").
    const authInfo: AuthInfo = {
      // The SDK requires `token` and `clientId` to be set; `token` is the
      // raw bearer (we never log it), `clientId` mirrors our internal id.
      token: extractBearer(req.headers.authorization) ?? '',
      clientId: authResult.context.agentTokenId,
      scopes: [],
      extra: {
        agentTokenId: authResult.context.agentTokenId,
        agentTokenLabel: authResult.context.agentTokenLabel,
        // P2 (audit round 3): plumb the request id into the auth context
        // extra so tool handlers (via `runWithGuards`) can include it in
        // their own log lines. The `AsyncLocalStorage`-backed `getRequestId()`
        // in logger.ts is the primary path; this explicit copy is a
        // belt-and-suspenders that lets callbacks running outside the
        // ALS context (rare) still surface it.
        requestId,
      } satisfies AuthContext & Record<string, unknown>,
    }
    ;(req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo

    // Build a fresh server + transport pair for this single request, hand
    // off, and tear both down in `finally`. See the file header for why a
    // fresh server is required (the SDK's `Server.connect()` rejects an
    // already-connected server, and the stateless transport rejects
    // reuse).
    //
    // CORS headers must be set BEFORE we hand off to the SDK transport,
    // since `transport.handleRequest` writes the response and we can't
    // amend headers after `writeHead`. Setting headers via `setHeader`
    // (rather than `writeHead`) means they're applied to whatever status
    // the SDK chooses.
    for (const [k, v] of Object.entries(resolveCorsHeaders(req))) {
      res.setHeader(k, v)
    }
    const requestServer = createMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await requestServer.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      logger.error('mcp_dashboard_http_handler_error', {
        message: err instanceof Error ? err.message : String(err),
      })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...resolveCorsHeaders(req) })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    } finally {
      // Always release the per-request transport + server even if the
      // handler threw — leaks compound under load. `transport.close()`
      // also clears the server's internal `_transport` slot; closing the
      // server itself releases any retained handler state.
      try {
        await transport.close()
      } catch (closeErr) {
        logger.error('mcp_dashboard_http_transport_close_error', {
          message: closeErr instanceof Error ? closeErr.message : String(closeErr),
        })
      }
      try {
        await requestServer.close()
      } catch (closeErr) {
        logger.error('mcp_dashboard_http_server_close_error', {
          message: closeErr instanceof Error ? closeErr.message : String(closeErr),
        })
      }
    }
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(env.MCP_DASHBOARD_PORT, '0.0.0.0', () => {
      logger.info('mcp_dashboard_http_listening', { port: env.MCP_DASHBOARD_PORT })
      resolve()
    })
  })

  return {
    shutdown: async () => {
      // Audit round 9: graceful drain. Flip the flag first so
      // /healthz starts returning 503 — the LB observes the failure
      // on its next probe and stops sending new traffic. Then poll
      // the in-flight counter until it hits zero or we run out of
      // budget. Either way, close the listener and resolve. The
      // caller (entrypoint) is responsible for `process.exit(0)` and
      // is expected to call this exactly once.
      shuttingDown = true
      logger.info('mcp_dashboard_shutdown_drain_started', {
        in_flight: inFlight,
        drain_ms: SHUTDOWN_DRAIN_MS,
      })
      const deadline = Date.now() + SHUTDOWN_DRAIN_MS
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, SHUTDOWN_DRAIN_POLL_MS).unref())
      }
      if (inFlight > 0) {
        logger.warn('mcp_dashboard_shutdown_drain_timeout', {
          in_flight: inFlight,
          drain_ms: SHUTDOWN_DRAIN_MS,
        })
      } else {
        logger.info('mcp_dashboard_shutdown_drain_complete')
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

/**
 * Run a `SELECT 1` against the DB with a hard 1s cancellation budget.
 * Returns true on success, false on timeout or query failure. Errors
 * are swallowed (logged at warn) — the caller turns the boolean into
 * a 200 / 503 response.
 *
 * Audit round 6: replaces the previous unconditional `{ status: 'ok' }`
 * health response. The docker-compose healthcheck is wired here, so
 * this directly drives container restart behavior on a DB blip.
 *
 * Audit round 9 — connection-leak fix:
 * ------------------------------------
 * The previous implementation raced `db.execute(sql\`SELECT 1\`)`
 * against a `setTimeout`-driven rejection via `Promise.race`. On a
 * hung DB that pattern lets the outer Promise reject after 1s but the
 * underlying query keeps running on the pool — every healthcheck tick
 * (every 30s under docker-compose) pinned another connection until
 * the postgres-js pool (`max: 10`) was exhausted and every request
 * started failing with `CONNECT_TIMEOUT`.
 *
 * Cancellation mechanism: `SET LOCAL statement_timeout = '1000ms'`
 * inside a `BEGIN`/`COMMIT` block. `SET LOCAL` scopes the timeout to
 * the surrounding transaction (no effect on other pool users), and
 * Postgres aborts the running query the moment the wall clock crosses
 * the timeout — releasing the backend connection back to the pool
 * along with it. Picked over the AbortController route because
 * postgres-js 3.4 does not surface an abort signal on every query
 * shape, whereas `SET LOCAL` is universally supported and the
 * cancellation guarantee is Postgres-side (not driver-side), which
 * means even a wedged client library cannot starve the pool.
 *
 * The outer `setTimeout` race is kept as a belt-and-suspenders so the
 * /healthz response never blocks longer than the budget even in the
 * pathological case where the driver itself hangs before the SQL
 * round-trip completes (e.g. socket write stalled before the server
 * sees the BEGIN).
 */
const DB_HEALTH_TIMEOUT_MS = 1000
async function checkDbHealth(): Promise<boolean> {
  // We need access to the underlying postgres-js sql tag to run the
  // `BEGIN; SET LOCAL statement_timeout; SELECT 1; COMMIT;` sequence
  // as one transaction. drizzle's `db.transaction(...)` callback
  // hands back a Drizzle handle, not the raw postgres-js tag — but
  // any drizzle handle exposes `.execute()` which sends raw SQL on a
  // single connection scoped to the txn. That's enough for our needs.
  try {
    const overallDeadline = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('db_health_timeout_outer')),
        DB_HEALTH_TIMEOUT_MS + 250,
      ).unref()
    })
    await Promise.race([
      (
        db as unknown as {
          transaction: (
            cb: (tx: { execute: (s: unknown) => Promise<unknown> }) => Promise<unknown>,
          ) => Promise<unknown>
        }
      ).transaction(async (tx) => {
        // SET LOCAL is scoped to this transaction's connection only —
        // no spillover to other pool users. Postgres will raise
        // `canceling statement due to statement timeout` once the
        // budget is exceeded and release the connection back to the
        // pool. Any rejection here turns into `false` via the outer
        // catch.
        await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`)
        await tx.execute(sql`SELECT 1`)
      }),
      overallDeadline,
    ])
    return true
  } catch (err) {
    logger.warn('healthz_db_check_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

function extractBearer(auth: string | undefined): string | null {
  if (!auth) return null
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? (m[1]?.trim() ?? null) : null
}

function respondAuthFailure(req: IncomingMessage, res: ServerResponse, reason: AuthFailureReason) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer realm="lucidindex-mcp"',
    ...resolveCorsHeaders(req),
  })
  res.end(JSON.stringify({ error: 'unauthorized', reason }))
}

/**
 * Sentinel error thrown by `readJsonBody` when the request body exceeds
 * `MAX_BODY_BYTES`. The handler converts this into a clean HTTP 413
 * response with a stable JSON shape, rather than letting it fall into
 * the generic 500 path.
 */
class PayloadTooLargeError extends Error {
  constructor() {
    super('request body too large')
    this.name = 'PayloadTooLargeError'
  }
}

/**
 * Read the request body and parse as JSON. Returns undefined for GETs and
 * empty bodies. The SDK accepts a pre-parsed body via the third argument
 * to handleRequest, which avoids stream consumption order races.
 *
 * Throws `PayloadTooLargeError` if the body exceeds `MAX_BODY_BYTES`.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return undefined
  }
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (!contentLength) return undefined

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array)
    total += buf.length
    if (total > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError()
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    // Let the SDK surface a clean JSON-RPC parse error.
    return undefined
  }
}
