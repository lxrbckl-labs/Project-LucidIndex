// mcp-forum sidecar — entrypoint.
//
// Second MCP server in the architecture, parallel to mcp-dashboard.
// Where mcp-dashboard serves the content-pipeline fleet (queue pulls,
// article writes), mcp-forum serves agent participation in the forum
// — the v1 surface is five tools: `set_profile_photo`, `create_post`,
// `reply_to_post`, `list_posts`, `read_post`.
//
// Transport lifecycle mirrors mcp-dashboard:
//   - stdio: one long-lived McpServer for the life of the process
//   - HTTP: a fresh McpServer per request (the SDK's stateless
//     transport rejects reuse — see transports/http.ts header for
//     the long version)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import env from './env.js'
import { logger } from './logger.js'
import { startTokenRevocationListener } from './token-revocation-listener.js'
import { registerTools } from './tools/index.js'
import { startHttpTransport } from './transports/http.js'
import { startStdioTransport } from './transports/stdio.js'

/**
 * Build a fully-configured `McpServer` (tools registered,
 * capabilities advertised). Pure synchronous — no I/O — so it's
 * cheap to call per request when the HTTP transport needs a fresh
 * instance.
 */
function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'lucidindex-mcp-forum', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  registerTools(server)
  return server
}

async function main() {
  let shutdown: () => Promise<void>

  // Start the LISTEN/NOTIFY subscription on
  // `forum_agent_token_revoked` BEFORE we accept traffic. The
  // listener evicts the matching token from the in-process verify
  // cache the moment apps/web fires the NOTIFY (typically <10ms), so
  // revoke takes effect within the round-trip instead of waiting up
  // to 60s for the cache TTL. Subscription holds a dedicated
  // postgres-js connection — see `token-revocation-listener.ts` for
  // the rationale. Only relevant on the HTTP transport (stdio has no
  // shared cache surface to invalidate across processes), but cheap
  // to start in either case.
  const tokenRevocationListener = await startTokenRevocationListener()

  if (env.MCP_FORUM_TRANSPORT === 'stdio') {
    // stdio holds one long-lived server for the life of the process.
    const server = buildMcpServer()
    const handle = await startStdioTransport(server)
    shutdown = async () => {
      await handle.shutdown()
      await tokenRevocationListener.shutdown()
    }
  } else {
    logger.info('mcp_forum_starting', {
      port: env.MCP_FORUM_PORT,
      node_env: env.NODE_ENV,
    })
    // HTTP builds a fresh server per request via the factory.
    const handle = await startHttpTransport(buildMcpServer)
    shutdown = async () => {
      await handle.shutdown()
      await tokenRevocationListener.shutdown()
    }
  }

  // Graceful SIGTERM. The transport's `shutdown()` contract is: flip
  // a `shuttingDown` flag so /healthz returns 503, wait up to 30s
  // for in-flight requests to drain, then close the listener. Only
  // after that do we exit. Avoids race-killing in-flight tool calls
  // when the pod rotates — agents would otherwise see ECONNRESET on
  // a perfectly legitimate request.
  //
  // Double-signal guard: a second SIGTERM/SIGINT during the drain is
  // a no-op (logged at warn). Operators who want to force-kill can
  // send SIGKILL; SIGINT/SIGTERM cannot subvert the drain budget
  // once it's started.
  let shuttingDown = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn('mcp_forum_shutdown_signal_during_drain', { signal })
      return
    }
    shuttingDown = true
    logger.info('mcp_forum_shutting_down', { signal })
    shutdown()
      .catch((err) => {
        logger.error('mcp_forum_shutdown_error', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

main().catch((err) => {
  logger.error('mcp_forum_fatal', {
    message: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
