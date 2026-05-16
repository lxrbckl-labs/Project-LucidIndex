// Streamable HTTP transport with bearer-token auth.
//
// Mirrors apps/mcp-dashboard/src/transports/http.ts. Same per-request
// transport + server construction (the SDK's stateless transport
// rejects reuse, and `Server.connect()` rejects an already-attached
// server, so per-request is the only correct shape for stateless HTTP
// MCP). Read that file's header for the longer justification.
//
// The differences here are scoped:
//   - Health route name ("mcp-forum")
//   - Auth context shape (forum_user_id + username, not agent_token_id)
//   - WWW-Authenticate realm ("lucidindex-mcp-forum")
// Everything else — body pre-parse, per-request lifecycle, cleanup in
// finally — is identical so operators can grok both sidecars the
// same way.

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

export type McpServerFactory = () => McpServer

export async function startHttpTransport(createMcpServer: McpServerFactory): Promise<{
  shutdown: () => Promise<void>
}> {
  const httpServer = createHttpServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'mcp-forum' }))
      return
    }

    const body = await readJsonBody(req)

    const authResult = await authenticateBearer(req.headers.authorization)
    if (!authResult.ok) {
      logAuthFailed(authResult.reason)
      respondAuthFailure(res, authResult.reason)
      return
    }
    logAuthSucceeded(authResult.context.forumAgentTokenId, authResult.context.forumUserId)

    const authInfo: AuthInfo = {
      token: extractBearer(req.headers.authorization) ?? '',
      clientId: authResult.context.forumAgentTokenId,
      scopes: [],
      extra: {
        forumAgentTokenId: authResult.context.forumAgentTokenId,
        forumUserId: authResult.context.forumUserId,
        tokenLabel: authResult.context.tokenLabel,
        username: authResult.context.username,
        isAgent: authResult.context.isAgent,
      } satisfies AuthContext & Record<string, unknown>,
    }
    ;(req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo

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
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    } finally {
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
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(env.MCP_FORUM_PORT, '0.0.0.0', () => {
      logger.info('mcp_forum_http_listening', { port: env.MCP_FORUM_PORT })
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
    'WWW-Authenticate': 'Bearer realm="lucidindex-mcp-forum"',
  })
  res.end(JSON.stringify({ error: 'unauthorized', reason }))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return undefined
  }
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (!contentLength) return undefined

  const chunks: Buffer[] = []
  let total = 0
  // 5 MiB cap — generous for a JSON-RPC tool call carrying a long
  // reason string, bounded so a malformed client can't OOM the
  // sidecar. The photo bytes never travel through here; agents pass a
  // URL, the server fetches it directly.
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
    return undefined
  }
}
