// stdio transport.
//
// stdio is for process-local clients — co-located agents that exec
// into the container, or local-dev sessions with the MCP inspector.
// Trust is process-local: no bearer-token check. The pre-admin guard
// still applies; tools that need a forum identity (like
// set_profile_photo) will return `unauthenticated` here because the
// auth context is never set on stdio. That's intentional — committing
// to an agent's profile photo without an identifying token doesn't
// make sense.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { logger, setStdioMode } from '../logger.js'

export async function startStdioTransport(server: McpServer): Promise<{
  shutdown: () => Promise<void>
}> {
  // Redirect logs to stderr so nothing pollutes the JSON-RPC stream
  // on stdout.
  setStdioMode(true)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('mcp_forum_stdio_started')
  return {
    shutdown: async () => {
      await transport.close()
    },
  }
}
