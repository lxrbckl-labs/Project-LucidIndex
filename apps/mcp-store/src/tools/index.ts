// MCP tool registration for the mcp-store sidecar.
//
// All twelve tools share the same wrapper: pre-admin guard fires first
// (returning `no_admin_enrolled` if the system isn't provisioned yet), then
// the tool body runs against the authenticated agent's context.
//
// Auth context is plumbed via the SDK's `RequestHandlerExtra.authInfo`
// surface. The Streamable HTTP transport sets `req.auth` before delegating
// to the SDK, which surfaces it as `extra.authInfo` inside tool callbacks.
// stdio bypasses bearer-auth so `extra.authInfo` is undefined there — tools
// that need an `agent_token_id` (ack_queue_item, write_articles,
// extend_queue_lock) require HTTP transport. The read-only tools
// (get_topic_badges, get_high_water_mark, get_comparison_sources,
// search_articles, write_target_description) work on either transport.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuthContext } from '../auth.js'
import { logger } from '../logger.js'
import { NoAdminEnrolledError, requireAdmin } from '../pre-admin-guard.js'
import { ackQueueItem, ackQueueItemInputShape } from './ack-queue-item.js'
import { extendQueueLock, extendQueueLockInputShape } from './extend-queue-lock.js'
import { getComparisonSources } from './get-comparison-sources.js'
import { getHighWaterMark, getHighWaterMarkInputShape } from './get-high-water-mark.js'
import { getTopicBadges } from './get-topic-badges.js'
import { listTargets } from './list-targets.js'
import { pullQueueItem } from './pull-queue-item.js'
import { searchArticles, searchArticlesInputShape } from './search-articles.js'
import { writeArticles, writeArticlesInputShape } from './write-articles.js'
import {
  writeTargetDescription,
  writeTargetDescriptionInputShape,
} from './write-target-description.js'
import { writeTargetPhotoUrl, writeTargetPhotoUrlInputShape } from './write-target-photo-url.js'
import { writeTargetSocialUrl, writeTargetSocialUrlInputShape } from './write-target-social-url.js'

/**
 * Application-level errors raised by tool handlers. The wrapper turns these
 * into MCP `CallToolResult` payloads with `isError: true` and a stable
 * machine-readable `code` field that clients can branch on.
 */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

function toolErrorResult(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code, message }) }],
    structuredContent: { error: { code, message } },
  }
}

function toolOkResult<T extends Record<string, unknown>>(payload: T): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  }
}

async function runWithGuards<Out extends Record<string, unknown>>(
  name: string,
  fn: () => Promise<Out>,
): Promise<CallToolResult> {
  try {
    await requireAdmin()
    const out = await fn()
    return toolOkResult(out)
  } catch (err) {
    if (err instanceof NoAdminEnrolledError) {
      logger.warn('tool_blocked_pre_admin', { tool: name })
      return toolErrorResult(err.code, err.message)
    }
    if (err instanceof ToolError) {
      logger.warn('tool_error', { tool: name, code: err.code })
      return toolErrorResult(err.code, err.message)
    }
    const message = err instanceof Error ? err.message : String(err)
    logger.error('tool_unexpected_error', { tool: name, message })
    return toolErrorResult('internal_error', message)
  }
}

/**
 * Register all five MCP tools on the given server. The auth context (the
 * authenticated agent_token_id) is read inside each handler from the
 * SDK-provided `extra.authInfo.extra`.
 */
export function registerTools(server: McpServer): void {
  // --- pull_queue_item -------------------------------------------------------
  // No input schema → SDK callback receives just `extra`.
  server.registerTool(
    'pull_queue_item',
    {
      title: 'Pull next queue item',
      description:
        'Claim the next due queue row and return the rendered prompt + target metadata. Returns null if the queue is empty.',
    },
    async (extra) =>
      runWithGuards('pull_queue_item', async () => {
        // pull_queue_item does not strictly need the authenticated
        // agent_token_id for the stub (claim-locking with FOR UPDATE SKIP
        // LOCKED in #42 will). For now we record `claimed_by` from the auth
        // context if present, else null — stdio dev sessions can pull
        // without auth.
        const ctx = readAuthContext(extra)
        return pullQueueItem({ agentTokenId: ctx?.agentTokenId ?? null }) as Promise<
          Record<string, unknown>
        >
      }),
  )

  // --- ack_queue_item --------------------------------------------------------
  server.registerTool(
    'ack_queue_item',
    {
      title: 'Acknowledge a queue item',
      description:
        'Mark a previously-pulled queue row as succeeded or failed. Updates target high-water-mark and last-run status.',
      inputSchema: ackQueueItemInputShape,
    },
    async (args, extra) =>
      runWithGuards('ack_queue_item', async () => {
        const ctx = requireAuthContext(extra)
        return ackQueueItem({ ...args, agentTokenId: ctx.agentTokenId })
      }),
  )

  // --- write_articles --------------------------------------------------------
  server.registerTool(
    'write_articles',
    {
      title: 'Write articles for a queue item',
      description:
        'Insert one or more article rows produced from a queue pull. Returns the count and ids accepted.',
      inputSchema: writeArticlesInputShape,
    },
    async (args, extra) =>
      runWithGuards('write_articles', async () => {
        const ctx = requireAuthContext(extra)
        return writeArticles({ ...args, agentTokenId: ctx.agentTokenId })
      }),
  )

  // --- get_topic_badges ------------------------------------------------------
  server.registerTool(
    'get_topic_badges',
    {
      title: 'List topic badges',
      description: 'Return the curated topic-badge taxonomy (name, color, display_order).',
    },
    async (_extra) => runWithGuards('get_topic_badges', async () => getTopicBadges()),
  )

  // --- get_high_water_mark ---------------------------------------------------
  server.registerTool(
    'get_high_water_mark',
    {
      title: 'Read a target high-water-mark',
      description:
        'Return the opaque jsonb high-water-mark for the given target. Errors with `target_not_found` if the target does not exist.',
      inputSchema: getHighWaterMarkInputShape,
    },
    async (args, _extra) =>
      runWithGuards('get_high_water_mark', async () => getHighWaterMark(args)),
  )

  // --- get_comparison_sources -----------------------------------------------
  server.registerTool(
    'get_comparison_sources',
    {
      title: 'List comparison sources',
      description:
        'Return the active comparison-source taxonomy (name, base_url, notes). Citation source_name values must reference one of these.',
    },
    async (_extra) => runWithGuards('get_comparison_sources', async () => getComparisonSources()),
  )

  // --- extend_queue_lock -----------------------------------------------------
  server.registerTool(
    'extend_queue_lock',
    {
      title: 'Extend a queue-item lock',
      description:
        'Push the queue item lock_expires_at out by another MCP_QUEUE_LOCK_TTL_SEC. Caller must hold the claim.',
      inputSchema: extendQueueLockInputShape,
    },
    async (args, extra) =>
      runWithGuards('extend_queue_lock', async () => {
        const ctx = requireAuthContext(extra)
        return extendQueueLock({ ...args, agentTokenId: ctx.agentTokenId })
      }),
  )

  // --- search_articles -------------------------------------------------------
  server.registerTool(
    'search_articles',
    {
      title: 'Full-text search across articles',
      description:
        'Search the article corpus by free-text query. Useful for cross-target dedup (has someone else covered this story?). Returns ranked hits with id, slug, title, summary, source_url, target_id, dates.',
      inputSchema: searchArticlesInputShape,
    },
    async (args, _extra) => runWithGuards('search_articles', async () => searchArticles(args)),
  )

  // --- write_target_description ---------------------------------------------
  server.registerTool(
    'write_target_description',
    {
      title: 'Write a one-time target/creator description',
      description:
        'Set a short bio for the target/creator. Write-once-when-null: returns { written: true } on first set, { written: false } on subsequent calls (admin curation is preserved). Max 500 chars.',
      inputSchema: writeTargetDescriptionInputShape,
    },
    async (args, _extra) =>
      runWithGuards('write_target_description', async () => writeTargetDescription(args)),
  )

  // --- write_target_social_url ----------------------------------------------
  server.registerTool(
    'write_target_social_url',
    {
      title: 'Write a one-time author social URL',
      description:
        "Set the author's personal/social URL on a target. Write-once-when-null: returns { written: true } on first set, { written: false } afterward. Must be a valid http(s) URL.",
      inputSchema: writeTargetSocialUrlInputShape,
    },
    async (args, _extra) =>
      runWithGuards('write_target_social_url', async () => writeTargetSocialUrl(args)),
  )

  // --- write_target_photo_url -----------------------------------------------
  server.registerTool(
    'write_target_photo_url',
    {
      title: 'Write a one-time author photograph URL',
      description:
        "Set the author's photograph/avatar URL on a target. Write-once-when-null: returns { written: true } on first set, { written: false } afterward. Must be a valid http(s) URL. Rendered as the hero band of the creator profile tile.",
      inputSchema: writeTargetPhotoUrlInputShape,
    },
    async (args, _extra) =>
      runWithGuards('write_target_photo_url', async () => writeTargetPhotoUrl(args)),
  )

  // --- list_targets ----------------------------------------------------------
  server.registerTool(
    'list_targets',
    {
      title: 'List all targets',
      description:
        'Return every target on file with presence flags for description, social_url, and photo_url. Use this to cross-reference whether an author is already covered (under any label) before writing redundant info.',
    },
    async (_extra) => runWithGuards('list_targets', async () => listTargets()),
  )
}

// -----------------------------------------------------------------------------
// Auth context plumbing
// -----------------------------------------------------------------------------

/**
 * Read the auth context off the SDK's `extra.authInfo.extra`. Returns null
 * on stdio (where there is no auth) or if the HTTP middleware skipped
 * setting it for some reason.
 */
function readAuthContext(extra: unknown): AuthContext | null {
  if (!extra || typeof extra !== 'object') return null
  const info = (extra as { authInfo?: { extra?: Record<string, unknown> } }).authInfo
  if (!info?.extra) return null
  const id = info.extra.agentTokenId
  const label = info.extra.agentTokenLabel
  if (typeof id !== 'string' || typeof label !== 'string') return null
  return { agentTokenId: id, agentTokenLabel: label }
}

/**
 * Same as readAuthContext but throws `unauthenticated` if no context is
 * present. Tools that write rows tagged with `agent_token_id` use this so
 * they can't accidentally be called over stdio.
 */
function requireAuthContext(extra: unknown): AuthContext {
  const ctx = readAuthContext(extra)
  if (!ctx) {
    throw new ToolError(
      'unauthenticated',
      'This tool requires bearer-token auth. Use the Streamable HTTP transport.',
    )
  }
  return ctx
}
