// mcp-dashboard sidecar — entrypoint.
//
// Real MCP server (Phase 3 #39+#40+#41). Boots either a Streamable HTTP
// transport (default) with bearer-token auth, or a stdio transport for
// process-local clients. Tool handlers gate behind the pre-admin guard so
// the system can't be operated until the founding admin is enrolled.
//
// Transport lifecycle differs between modes:
//   - stdio: one long-lived McpServer for the life of the process
//     (process-local clients hold a single session for the duration).
//   - HTTP: a fresh McpServer per request — see `transports/http.ts` for
//     the full justification (the SDK's stateless transport rejects
//     reuse, and the SDK's `Server.connect()` rejects an already-attached
//     server, so per-request construction is the only correct pattern
//     for stateless HTTP MCP).
//
// Deeper tool behavior lands in subsequent tickets — see TODO markers in
// each tool file:
//   TODO(#42): atomic claim-lock with FOR UPDATE SKIP LOCKED
//   TODO(#43): write_articles topic-badge validation + suggestion inbox
//   TODO(#44): Liquid template rendering at queue-pull time
//   TODO(#45): hero image fetch + sharp pipeline

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import env from './env.js'
import { logger } from './logger.js'
import { startTokenRevocationListener } from './token-revocation-listener.js'
import { registerTools } from './tools/index.js'
import { startHttpTransport } from './transports/http.js'
import { startStdioTransport } from './transports/stdio.js'

/**
 * Build a fully-configured `McpServer` (tools registered, capabilities
 * advertised). Pure synchronous — no I/O — so it's cheap to call per
 * request when the HTTP transport needs a fresh instance.
 */
function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'lucidindex-mcp-dashboard', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  registerTools(server)
  return server
}

async function main() {
  let shutdown: () => Promise<void>

  // Audit round 9: start the LISTEN/NOTIFY subscription on
  // `agent_token_revoked` BEFORE we accept traffic. The listener
  // evicts the matching token from the in-process verify cache the
  // moment apps/web fires the NOTIFY (typically <10ms), so revoke
  // takes effect within the round-trip instead of waiting up to 60s
  // for the cache TTL. Subscription holds a dedicated postgres-js
  // connection — see `token-revocation-listener.ts` for the rationale.
  // Only relevant on the HTTP transport (stdio has no shared cache
  // surface to invalidate across processes), but cheap to start in
  // either case.
  const tokenRevocationListener = await startTokenRevocationListener()

  if (env.MCP_DASHBOARD_TRANSPORT === 'stdio') {
    // stdio holds one long-lived server for the life of the process.
    const server = buildMcpServer()
    const handle = await startStdioTransport(server)
    shutdown = async () => {
      await handle.shutdown()
      await tokenRevocationListener.shutdown()
    }
  } else {
    logger.info('mcp_dashboard_starting', {
      port: env.MCP_DASHBOARD_PORT,
      node_env: env.NODE_ENV,
    })
    // HTTP builds a fresh server per request via the factory.
    const handle = await startHttpTransport(buildMcpServer)
    shutdown = async () => {
      await handle.shutdown()
      await tokenRevocationListener.shutdown()
    }
  }

  // Audit round 9: graceful SIGTERM. The transport's `shutdown()`
  // contract is: flip a `shuttingDown` flag so /healthz returns 503,
  // wait up to 30s for in-flight requests to drain, then close the
  // listener. Only after that do we exit. The previous implementation
  // called `process.exit(0)` inside `.finally(...)` immediately, which
  // race-killed in-flight tool calls — agents would see ECONNRESET on
  // a perfectly legitimate request just because the pod was rotating.
  //
  // Double-signal guard: a second SIGTERM/SIGINT during the drain is a
  // no-op (logged at warn). Operators who want to force-kill can send
  // SIGKILL; SIGINT/SIGTERM cannot subvert the drain budget once it's
  // started.
  let shuttingDown = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn('mcp_dashboard_shutdown_signal_during_drain', { signal })
      return
    }
    shuttingDown = true
    logger.info('mcp_dashboard_shutting_down', { signal })
    shutdown()
      .catch((err) => {
        logger.error('mcp_dashboard_shutdown_error', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

main().catch((err) => {
  logger.error('mcp_dashboard_fatal', {
    message: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
