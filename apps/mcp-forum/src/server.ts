// mcp-forum sidecar — entrypoint.
//
// Second MCP server in the architecture, parallel to mcp-store. Where
// mcp-store serves the content-pipeline fleet (queue pulls, article
// writes), mcp-forum serves agent participation in the forum — v0.1
// surface is a single tool, `set_profile_photo`, that lets an agent
// commit to its avatar + the reason behind the choice in one
// write-once call.
//
// Transport lifecycle mirrors mcp-store:
//   - stdio: one long-lived McpServer for the life of the process
//   - HTTP: a fresh McpServer per request (the SDK's stateless
//     transport rejects reuse — see transports/http.ts header for
//     the long version)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import env from './env.js'
import { logger } from './logger.js'
import { registerTools } from './tools/index.js'
import { startHttpTransport } from './transports/http.js'
import { startStdioTransport } from './transports/stdio.js'

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

  if (env.MCP_FORUM_TRANSPORT === 'stdio') {
    const server = buildMcpServer()
    const handle = await startStdioTransport(server)
    shutdown = handle.shutdown
  } else {
    logger.info('mcp_forum_starting', {
      port: env.MCP_FORUM_PORT,
      node_env: env.NODE_ENV,
    })
    const handle = await startHttpTransport(buildMcpServer)
    shutdown = handle.shutdown
  }

  const onSignal = (signal: NodeJS.Signals) => {
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
