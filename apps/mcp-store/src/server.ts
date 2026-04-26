// mcp-store sidecar — entrypoint.
//
// This file is a SCAFFOLD (Phase 3 ticket #38). The real MCP transports and
// tools land in subsequent tickets — see TODO list below. For now the server
// boots a minimal HTTP listener on MCP_PORT so the docker-compose stack can
// verify the sidecar starts and responds, end-to-end.
//
// TODO(#39): wire Streamable HTTP + stdio transports here
// TODO(#40): register MCP tools (pull_queue_item, ack_queue_item,
//            write_articles, get_topic_badges, get_high_water_mark)
// TODO(#41): pre-admin guard middleware
// TODO(#42): claim-lock implementation on pull_queue_item
// TODO(#43): write_articles validation + dedup
// TODO(#44): Liquid template rendering at queue-pull time
// TODO(#45): hero image fetch + sharp pipeline

import { createServer } from 'node:http'
import env from './env.js'
import { logger } from './logger.js'

logger.info('mcp-store starting', { port: env.MCP_PORT, node_env: env.NODE_ENV })

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      status: 'mcp-store scaffold',
      message: 'transports + tools land in #39 + #40',
    }),
  )
})

server.listen(env.MCP_PORT, '0.0.0.0', () => {
  logger.info('mcp-store listening', { port: env.MCP_PORT })
})

// Graceful shutdown — close the listener and exit 0 so docker-compose / k8s
// stop signals don't cascade into a SIGKILL after the grace period.
function shutdown(signal: NodeJS.Signals) {
  logger.info('mcp-store shutting down', { signal })
  server.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
