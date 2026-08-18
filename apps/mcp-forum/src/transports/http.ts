// Streamable HTTP transport with bearer-token auth.
//
// Mirrors apps/mcp-dashboard/src/transports/http.ts. Same per-request
// transport + server construction (the SDK's stateless transport
// rejects reuse, and `Server.connect()` rejects an already-attached
// server, so per-request is the only correct shape for stateless HTTP
// MCP). Read that file's header for the longer justification of the
// per-request lifecycle.
//
// The differences here are scoped:
//   - Health route name ("mcp-forum")
//   - Auth context shape (forum_user_id + username, not agent_token_id)
//   - WWW-Authenticate realm ("lucidindex-mcp-forum")
//   - Env prefix MCP_FORUM_* (vs MCP_DASHBOARD_*)
//   - Default port 4100 (vs 4000)
// Everything else — CORS, request-id ALS plumbing, 413 payload cap,
// real DB-probing /healthz, SIGTERM drain with in-flight counter,
// per-request lifecycle, cleanup in finally — is identical so
// operators can grok both sidecars the same way.

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
 * Factory that constructs a fully-configured `McpServer` (tools
 * registered, capabilities advertised) ready to connect to a
 * transport. Called once per incoming HTTP request.
 */
export type McpServerFactory = () => McpServer

/**
 * Body size cap. 5 MiB — generous for a JSON-RPC tool call carrying a
 * long post body or reason string, bounded so a malformed client
 * can't OOM the sidecar. The photo bytes never travel through here;
 * agents pass a URL, the server fetches it directly.
 */
const MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Static CORS headers (methods, headers, max-age). The Allow-Origin
 * value is resolved per-request from `MCP_FORUM_CORS_ORIGINS` — see
 * `resolveCorsHeaders(req)` below.
 *
 * Why the surface is open by default:
 *   - The MCP surface is a structured tool API, not a cookie-bearing
 *     human-facing site — there's no ambient credential to protect.
 *   - Bearer auth is a header (`Authorization`), not a cookie, so CORS
 *     credential rules don't apply.
 *   - Agents may run in browsers (forum scratchpads, devtools) that
 *     need to call this endpoint from arbitrary origins.
 *
 * `MCP_FORUM_CORS_ORIGINS` lets deployments narrow that surface to a
 * known forum dashboard origin without code changes. Comma-separated
 * list, or `*` (default) for any origin.
 */
const STATIC_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
} as const

/**
 * Parsed allowlist from `MCP_FORUM_CORS_ORIGINS`. `null` means
 * wide-open `*`; otherwise a Set of exact-match Origin strings.
 */
const CORS_ORIGIN_ALLOWLIST: Set<string> | null = (() => {
  const raw = env.MCP_FORUM_CORS_ORIGINS.trim()
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
 * future env knob (`MCP_FORUM_SHUTDOWN_DRAIN_MS`), but the baseline
 * matches operator expectations.
 */
const SHUTDOWN_DRAIN_MS = 30_000

/**
 * Poll interval the drain loop uses while watching the in-flight
 * counter. 50ms keeps the latency overhead negligible while bounding
 * the worst case of "all requests finish but we sleep through the
 * drop to zero" to half a tick.
 */
const SHUTDOWN_DRAIN_POLL_MS = 50

/**
 * Boot a Streamable HTTP MCP server on env.MCP_FORUM_PORT. The caller
 * passes a `createServer` factory that builds a fresh `McpServer` per
 * request — the factory must register tools and capabilities on the
 * server before returning it.
 *
 * Returns an object with a `shutdown` hook (so the entrypoint can
 * wire SIGTERM cleanup of the listening node:http server). The
 * shutdown sequence:
 *   1. Flip `shuttingDown` — `/healthz` immediately starts returning
 *      503 `{ status: 'shutting_down' }` so any upstream load
 *      balancer drains us from rotation on the next probe.
 *   2. Wait up to SHUTDOWN_DRAIN_MS for the per-request in-flight
 *      counter to reach zero (new requests are still accepted during
 *      the drain — Kubernetes documents this as the correct behavior).
 *   3. Close the listener and resolve.
 *   4. The entrypoint then calls `process.exit(0)`.
 */
export async function startHttpTransport(createMcpServer: McpServerFactory): Promise<{
  shutdown: () => Promise<void>
}> {
  /**
   * Shutdown coordination state. `shuttingDown` flips on first
   * SIGTERM and is consumed by the /healthz handler to flip the
   * response to 503. `inFlight` is incremented at the top of every
   * MCP request and decremented in `finally`, so the drain loop can
   * wait for the counter to reach zero before tearing the listener
   * down.
   */
  let shuttingDown = false
  let inFlight = 0

  const httpServer = createHttpServer(async (req, res) => {
    // CORS preflight — applies to BOTH /mcp and /healthz (and any
    // other sibling paths). Browsers issue an OPTIONS before any
    // non-simple POST (anything carrying an `Authorization` header
    // qualifies), so we have to answer this BEFORE the auth
    // middleware, otherwise the browser sees a 401 on the preflight
    // and never sends the real POST.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, resolveCorsHeaders(req))
      res.end()
      return
    }

    // Health check — bypass auth + MCP entirely. Useful for
    // docker-compose healthchecks and operator probes.
    //
    // Real DB-probe (no longer an unconditional 200) — runs `SELECT
    // 1` with a 1s timeout via SET LOCAL statement_timeout. Success
    // → 200 `{status:'ok'}`. Failure (timeout, connection refused,
    // etc.) → 503 `{status:'unhealthy', reason:'db_unreachable'}`.
    // The compose healthcheck is wired to this endpoint so a failing
    // DB correctly flips the container's health status.
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
      const headers = { 'Content-Type': 'application/json', ...resolveCorsHeaders(req) }
      // Once SIGTERM has flipped `shuttingDown`, fail the probe
      // immediately so the upstream LB / orchestrator stops sending
      // us new traffic. We skip the DB ping in this state — the
      // only signal the operator needs is "this pod is going away".
      // Stable JSON shape so dashboards can distinguish
      // "shutting_down" from "db_unreachable".
      if (shuttingDown) {
        res.writeHead(503, headers)
        res.end(JSON.stringify({ status: 'shutting_down', service: 'mcp-forum' }))
        return
      }
      const healthOk = await checkDbHealth()
      if (healthOk) {
        res.writeHead(200, headers)
        res.end(JSON.stringify({ status: 'ok', service: 'mcp-forum' }))
      } else {
        res.writeHead(503, headers)
        res.end(
          JSON.stringify({ status: 'unhealthy', reason: 'db_unreachable', service: 'mcp-forum' }),
        )
      }
      return
    }

    // Mint a request id and wrap the handler in `withRequestId(...)`
    // so every downstream log line gets correlated back to this
    // request. The id also flows through to tools that need to
    // surface it in their own logs.
    const requestId = randomUUID()
    // Increment the in-flight counter at the top and decrement in
    // `finally`, so the SIGTERM drain loop can wait for every active
    // request to land before closing the listener. Counter is
    // captured here (rather than inside handleMcpRequest) so even a
    // synchronous throw from withRequestId doesn't leak the count.
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
   * indirection over the original logic.
   */
  async function handleMcpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> {
    // Pre-parse the request body for POST/PUT/DELETE so the SDK
    // doesn't race the auth middleware on stream consumption. A body
    // exceeding the MAX_BODY_BYTES cap is surfaced as a proper 413
    // with a stable JSON shape (NOT the generic 500 the error path
    // would otherwise produce).
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
    logAuthSucceeded(authResult.context.forumAgentTokenId, authResult.context.forumUserId)

    // Attach the AuthInfo to the IncomingMessage. The SDK's transport
    // reads `req.auth` and forwards it as `extra.authInfo` to the
    // tool handler.
    const authInfo: AuthInfo = {
      // The SDK requires `token` and `clientId` to be set; `token` is
      // the raw bearer (we never log it), `clientId` mirrors our
      // internal id.
      token: extractBearer(req.headers.authorization) ?? '',
      clientId: authResult.context.forumAgentTokenId,
      scopes: [],
      extra: {
        forumAgentTokenId: authResult.context.forumAgentTokenId,
        forumUserId: authResult.context.forumUserId,
        tokenLabel: authResult.context.tokenLabel,
        username: authResult.context.username,
        isAgent: authResult.context.isAgent,
        // Plumb the request id into the auth context extra so tool
        // handlers (via `runWithGuards`) can include it in their own
        // log lines. The AsyncLocalStorage-backed `getRequestId()`
        // in logger.ts is the primary path; this explicit copy is a
        // belt-and-suspenders that lets callbacks running outside
        // the ALS context (rare) still surface it.
        requestId,
      } satisfies AuthContext & Record<string, unknown>,
    }
    ;(req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo

    // Build a fresh server + transport pair for this single request,
    // hand off, and tear both down in `finally`. See the file header
    // for why a fresh server is required.
    //
    // CORS headers must be set BEFORE we hand off to the SDK
    // transport, since `transport.handleRequest` writes the response
    // and we can't amend headers after `writeHead`. Setting headers
    // via `setHeader` (rather than `writeHead`) means they're
    // applied to whatever status the SDK chooses.
    for (const [k, v] of Object.entries(resolveCorsHeaders(req))) {
      res.setHeader(k, v)
    }
    const requestServer = createMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await requestServer.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      logger.error('mcp_forum_http_handler_error', {
        message: err instanceof Error ? err.message : String(err),
      })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...resolveCorsHeaders(req) })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    } finally {
      // Always release the per-request transport + server even if
      // the handler threw — leaks compound under load.
      // `transport.close()` also clears the server's internal
      // `_transport` slot; closing the server itself releases any
      // retained handler state.
      try {
        await transport.close()
      } catch (closeErr) {
        logger.error('mcp_forum_http_transport_close_error', {
          message: closeErr instanceof Error ? closeErr.message : String(closeErr),
        })
      }
      try {
        await requestServer.close()
      } catch (closeErr) {
        logger.error('mcp_forum_http_server_close_error', {
          message: closeErr instanceof Error ? closeErr.message : String(closeErr),
        })
      }
    }
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(env.MCP_FORUM_PORT, '0.0.0.0', () => {
      logger.info('mcp_forum_http_listening', { port: env.MCP_FORUM_PORT })
      resolve()
    })
  })

  return {
    shutdown: async () => {
      // Graceful drain. Flip the flag first so /healthz starts
      // returning 503 — the LB observes the failure on its next
      // probe and stops sending new traffic. Then poll the
      // in-flight counter until it hits zero or we run out of
      // budget. Either way, close the listener and resolve. The
      // caller (entrypoint) is responsible for `process.exit(0)`
      // and is expected to call this exactly once.
      shuttingDown = true
      logger.info('mcp_forum_shutdown_drain_started', {
        in_flight: inFlight,
        drain_ms: SHUTDOWN_DRAIN_MS,
      })
      const deadline = Date.now() + SHUTDOWN_DRAIN_MS
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, SHUTDOWN_DRAIN_POLL_MS).unref())
      }
      if (inFlight > 0) {
        logger.warn('mcp_forum_shutdown_drain_timeout', {
          in_flight: inFlight,
          drain_ms: SHUTDOWN_DRAIN_MS,
        })
      } else {
        logger.info('mcp_forum_shutdown_drain_complete')
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

/**
 * Run a `SELECT 1` against the DB with a hard 1s cancellation
 * budget. Returns true on success, false on timeout or query
 * failure. Errors are swallowed (logged at warn) — the caller turns
 * the boolean into a 200 / 503 response.
 *
 * Cancellation mechanism: `SET LOCAL statement_timeout = '1000ms'`
 * inside a `BEGIN`/`COMMIT` block. `SET LOCAL` scopes the timeout to
 * the surrounding transaction (no effect on other pool users), and
 * Postgres aborts the running query the moment the wall clock
 * crosses the timeout — releasing the backend connection back to the
 * pool along with it. This is the connection-leak-safe variant from
 * mcp-dashboard's audit round 9 fix.
 *
 * The outer `setTimeout` race is kept as a belt-and-suspenders so
 * the /healthz response never blocks longer than the budget even in
 * the pathological case where the driver itself hangs.
 */
const DB_HEALTH_TIMEOUT_MS = 1000
async function checkDbHealth(): Promise<boolean> {
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
    'WWW-Authenticate': 'Bearer realm="lucidindex-mcp-forum"',
    ...resolveCorsHeaders(req),
  })
  res.end(JSON.stringify({ error: 'unauthorized', reason }))
}

/**
 * Sentinel error thrown by `readJsonBody` when the request body
 * exceeds `MAX_BODY_BYTES`. The handler converts this into a clean
 * HTTP 413 response with a stable JSON shape, rather than letting it
 * fall into the generic 500 path.
 */
class PayloadTooLargeError extends Error {
  constructor() {
    super('request body too large')
    this.name = 'PayloadTooLargeError'
  }
}

/**
 * Read the request body and parse as JSON. Returns undefined for
 * GETs and empty bodies. The SDK accepts a pre-parsed body via the
 * third argument to handleRequest, which avoids stream consumption
 * order races.
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
