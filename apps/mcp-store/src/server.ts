// mcp-store sidecar — entrypoint.
//
// Real MCP server (Phase 3 #39+#40+#41). Boots either a Streamable HTTP
// transport (default) with bearer-token auth, or a stdio transport for
// process-local clients. Tool handlers gate behind the pre-admin guard so
// the system can't be operated until the founding admin is enrolled.
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

async function main() {
  // Build the MCP server and register all tools BEFORE binding a transport.
  // The SDK locks the tool table when `connect()` runs the first time.
  const server = new McpServer(
    { name: 'lucidindex-mcp-store', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  registerTools(server)

  let shutdown: () => Promise<void>

  if (env.MCP_TRANSPORT === 'stdio') {
    const handle = await startStdioTransport(server)
    shutdown = handle.shutdown
  } else {
    logger.info('mcp_store_starting', { port: env.MCP_PORT, node_env: env.NODE_ENV })
    const handle = await startHttpTransport(server)
    shutdown = handle.shutdown
  }

  const onSignal = (signal: NodeJS.Signals) => {
    logger.info('mcp_store_shutting_down', { signal })
    shutdown()
      .catch((err) => {
        logger.error('mcp_store_shutdown_error', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

main().catch((err) => {
  logger.error('mcp_store_fatal', { message: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
