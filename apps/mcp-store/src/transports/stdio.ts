// stdio transport.
//
// stdio is for process-local clients — co-located agents that exec into
// the container, or local-dev sessions with the MCP inspector. Trust is
// process-local: no bearer-token check (an attacker who can write to our
// stdin already owns the process). The pre-admin guard still applies —
// agents must not run before the system is provisioned, regardless of
// transport.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { logger, setStdioMode } from '../logger.js'

/**
 * Boot the MCP server bound to stdio. The transport runs until the process
 * receives SIGTERM/SIGINT — there's no separate "listening" step.
 */
export async function startStdioTransport(server: McpServer): Promise<{
  shutdown: () => Promise<void>
}> {
  // Redirect logs to stderr immediately so nothing pollutes the JSON-RPC
  // stream on stdout.
  setStdioMode(true)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('mcp_stdio_started')
  return {
    shutdown: async () => {
      await transport.close()
    },
  }
}
