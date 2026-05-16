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

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  type AuthContext,
  type AuthFailureReason,
  authenticateBearer,
  logAuthFailed,
  logAuthSucceeded,
} from '../auth.js'
import env from '../env.js'
import { logger } from '../logger.js'

/**
 * Factory that constructs a fully-configured `McpServer` (tools registered,
 * capabilities advertised) ready to connect to a transport. Called once
 * per incoming HTTP request.
 */
export type McpServerFactory = () => McpServer

/**
 * Boot a Streamable HTTP MCP server on env.MCP_DASHBOARD_PORT. The caller passes a
 * `createServer` factory that builds a fresh `McpServer` per request — the
 * factory must register tools and capabilities on the server before
 * returning it.
 *
 * Returns an object with a `shutdown` hook (so the entrypoint can wire
 * SIGTERM cleanup of the listening node:http server).
 */
export async function startHttpTransport(createMcpServer: McpServerFactory): Promise<{
  shutdown: () => Promise<void>
}> {
  const httpServer = createHttpServer(async (req, res) => {
    // Health check — bypass auth + MCP entirely. Useful for docker-compose
    // healthchecks and operator probes.
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    // Pre-parse the request body for POST/PUT/DELETE so the SDK doesn't
    // race the auth middleware on stream consumption.
    const body = await readJsonBody(req)

    const authResult = await authenticateBearer(req.headers.authorization)
    if (!authResult.ok) {
      logAuthFailed(authResult.reason)
      respondAuthFailure(res, authResult.reason)
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
      } satisfies AuthContext & Record<string, unknown>,
    }
    ;(req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo

    // Build a fresh server + transport pair for this single request, hand
    // off, and tear both down in `finally`. See the file header for why a
    // fresh server is required (the SDK's `Server.connect()` rejects an
    // already-connected server, and the stateless transport rejects
    // reuse).
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
        res.writeHead(500, { 'Content-Type': 'application/json' })
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
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(env.MCP_DASHBOARD_PORT, '0.0.0.0', () => {
      logger.info('mcp_dashboard_http_listening', { port: env.MCP_DASHBOARD_PORT })
      resolve()
    })
  })

  return {
    shutdown: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

function extractBearer(auth: string | undefined): string | null {
  if (!auth) return null
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? (m[1]?.trim() ?? null) : null
}

function respondAuthFailure(res: ServerResponse, reason: AuthFailureReason) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer realm="lucidindex-mcp"',
  })
  res.end(JSON.stringify({ error: 'unauthorized', reason }))
}

/**
 * Read the request body and parse as JSON. Returns undefined for GETs and
 * empty bodies. The SDK accepts a pre-parsed body via the third argument
 * to handleRequest, which avoids stream consumption order races.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return undefined
  }
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (!contentLength) return undefined

  const chunks: Buffer[] = []
  let total = 0
  // 5 MiB cap — generous for prompts + article bodies, bounded so a
  // malformed client can't OOM the sidecar.
  const MAX = 5 * 1024 * 1024
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array)
    total += buf.length
    if (total > MAX) {
      throw new Error('request body too large')
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
