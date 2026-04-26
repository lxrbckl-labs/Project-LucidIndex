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

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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
 * Boot a Streamable HTTP MCP server on env.MCP_PORT. Returns an object with
 * the listening node:http Server (so the entrypoint can wire SIGTERM
 * shutdown) and the SDK transport (so it can be closed cleanly).
 */
export async function startHttpTransport(server: McpServer): Promise<{
  shutdown: () => Promise<void>
}> {
  // Stateless mode: no session id generated. This sidecar is single-process
  // and tools are idempotent enough that we don't need session affinity. If
  // we add SSE streaming for long-running tasks, switch to stateful mode.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)

  const httpServer = createServer(async (req, res) => {
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

    try {
      await transport.handleRequest(req, res, body)
    } catch (err) {
      logger.error('mcp_http_handler_error', {
        message: err instanceof Error ? err.message : String(err),
      })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    }
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(env.MCP_PORT, '0.0.0.0', () => {
      logger.info('mcp_http_listening', { port: env.MCP_PORT })
      resolve()
    })
  })

  return {
    shutdown: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      await transport.close()
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
