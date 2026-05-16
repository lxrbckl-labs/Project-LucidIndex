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

  if (env.MCP_DASHBOARD_TRANSPORT === 'stdio') {
    // stdio holds one long-lived server for the life of the process.
    const server = buildMcpServer()
    const handle = await startStdioTransport(server)
    shutdown = handle.shutdown
  } else {
    logger.info('mcp_dashboard_starting', {
      port: env.MCP_DASHBOARD_PORT,
      node_env: env.NODE_ENV,
    })
    // HTTP builds a fresh server per request via the factory.
    const handle = await startHttpTransport(buildMcpServer)
    shutdown = handle.shutdown
  }

  const onSignal = (signal: NodeJS.Signals) => {
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
