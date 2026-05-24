// MCP tool registration for the mcp-dashboard sidecar.
//
// All sixteen tools share the same wrapper: pre-admin guard fires first
// (returning `no_admin_enrolled` if the system isn't provisioned yet), then
// the tool body runs against the authenticated agent's context.
//
// Auth context is plumbed via the SDK's `RequestHandlerExtra.authInfo`
// surface. The Streamable HTTP transport sets `req.auth` before delegating
// to the SDK, which surfaces it as `extra.authInfo` inside tool callbacks.
// stdio bypasses bearer-auth so `extra.authInfo` is undefined there — tools
// that need an `agent_token_id` (ack_queue_item, write_articles,
// extend_queue_lock, list_my_recent_runs) require HTTP transport. The
// read-only tools (get_topic_badges, get_high_water_mark,
// get_comparison_sources, search_articles, check_article_exists,
// list_targets, get_queue_stats, write_target_description,
// write_target_social_url, write_target_photo_url, write_target_profile)
// work on either transport.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { AuthContext } from '../auth.js'
import { logger } from '../logger.js'
import { NoAdminEnrolledError, requireAdmin } from '../pre-admin-guard.js'
import { ackQueueItem, ackQueueItemInputShape } from './ack-queue-item.js'
import { checkArticleExists, checkArticleExistsInputShape } from './check-article-exists.js'
import { extendQueueLock, extendQueueLockInputShape } from './extend-queue-lock.js'
import { getComparisonSources } from './get-comparison-sources.js'
import { getHighWaterMark, getHighWaterMarkInputShape } from './get-high-water-mark.js'
import { getQueueStats } from './get-queue-stats.js'
import { getTopicBadges } from './get-topic-badges.js'
import { listMyRecentRuns, listMyRecentRunsInputShape } from './list-my-recent-runs.js'
import { listTargets } from './list-targets.js'
import { pullQueueItem } from './pull-queue-item.js'
import { searchArticles, searchArticlesInputShape } from './search-articles.js'
import { writeArticles, writeArticlesInputShape } from './write-articles.js'
import {
  writeTargetDescription,
  writeTargetDescriptionInputShape,
} from './write-target-description.js'
import { writeTargetPhotoUrl, writeTargetPhotoUrlInputShape } from './write-target-photo-url.js'
import { writeTargetProfile, writeTargetProfileInputShape } from './write-target-profile.js'
import { writeTargetSocialUrl, writeTargetSocialUrlInputShape } from './write-target-social-url.js'

/**
 * Drizzle-typed handle accepted by the per-field profile writers
 * (`write_target_description`, `write_target_social_url`,
 * `write_target_photo_url`). Lets callers pass either the module-level
 * `db` or a transaction handle yielded by
 * `db.transaction(async (tx) => ...)`. Used by `write_target_profile`
 * to wrap the three single-field writes into one atomic txn.
 */
// biome-ignore lint/suspicious/noExplicitAny: schema shape varies — accept any drizzle PG handle
export type DrizzleHandle = PostgresJsDatabase<any>

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
 * Register all sixteen MCP tools on the given server. The auth context
 * (the authenticated agent_token_id) is read inside each handler from the
 * SDK-provided `extra.authInfo.extra`.
 */
export function registerTools(server: McpServer): void {
  // --- pull_queue_item -------------------------------------------------------
  // No input schema → SDK callback receives just `extra`.
  //
  // Requires bearer auth: the claim row stores `claimed_by = agent_token_id`,
  // and subsequent `write_articles` / `ack_queue_item` calls verify the
  // caller owns that claim. A stdio pull would write NULL into
  // `queue.claimed_by` and every downstream HTTP write call would then
  // fail `queue_item_not_claimed_by_caller`. We reject the stdio attempt
  // up front with `stdio_pull_disabled` so the failure is surfaced where
  // the agent can react to it.
  server.registerTool(
    'pull_queue_item',
    {
      title: 'Pull next queue item',
      description:
        'Claim the next due queue row and return the rendered prompt + target metadata. Requires HTTP transport with bearer auth (so the claim is attributed to an agent). stdio cannot pull. Empty-queue return shape is `{ queue_item_id: null }` (NOT `null` itself). Includes `attempt_count` (post-increment) so you can back off / escalate on a row that the reaper has unstuck repeatedly. If the metadata read or template render fails, the claim is released before the error is returned so the row goes back into rotation immediately. You have until `lock_expires_at` (ISO) — call `extend_queue_lock` before then if you need more time.',
    },
    async (extra) =>
      runWithGuards('pull_queue_item', async () => {
        const ctx = readAuthContext(extra)
        if (!ctx) {
          throw new ToolError(
            'stdio_pull_disabled',
            'pull_queue_item requires HTTP transport with bearer auth — stdio is read-only for the queue mutations.',
          )
        }
        return pullQueueItem({ agentTokenId: ctx.agentTokenId }) as Promise<Record<string, unknown>>
      }),
  )

  // --- ack_queue_item --------------------------------------------------------
  server.registerTool(
    'ack_queue_item',
    {
      title: 'Acknowledge a queue item',
      description:
        "Mark a previously-pulled queue row as succeeded or failed. Updates target last-run status. Omitting `new_high_water_mark` leaves the target's hwm UNCHANGED. Returns `{ ok: true, persisted: { articles_count, high_water_mark } }` so you can verify what landed without a follow-up read.",
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
        'Insert one or more article rows produced from a queue pull. URLs are canonicalized server-side (tracking params, fragments, default ports, case, www, trailing slashes all collapse), so dedup is robust to cosmetic URL differences. Per-article savepoints + partial-success response: returns `{ accepted, results, failures }`. `results` carries one entry per accepted/deduped article ({ index, id, deduped, source_url }), `failures` carries any per-article rejects ({ index, source_url, code, message }) — one bad insert no longer rolls back its siblings. Prefer calling `check_article_exists` first — `write_articles` will silently dedup repeats, but you will have wasted a research cycle. Requires HTTP transport with bearer auth.',
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
      description: 'Return the curated topic-badge taxonomy (name, display_order).',
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
        'Push the queue item lock_expires_at out by another MCP_DASHBOARD_LOCK_TTL_MINUTES. Caller must hold the claim. Returns `{ ok: true, lock_expires_at }` — the new ISO expiry timestamp.',
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
        'Full-text search across articles. URLs in `source_url` results are stored in canonical form (tracking params, fragments, default ports, case, www, trailing slashes all collapsed). Default excludes suppressed articles (`hidden=true` OR `dashboard_visible=false`). Pass `include_suppressed: true` for dedup checks where you need to see admin-hidden AND retention-rolled-off articles. (`include_hidden` is a deprecated alias for `include_suppressed`.) Returns ranked hits with id, slug, title, summary, source_url, target_id, dates, AND BOTH `hidden` and `dashboard_visible` flags so you can see WHY a result came back.',
      inputSchema: searchArticlesInputShape,
    },
    async (args, _extra) => runWithGuards('search_articles', async () => searchArticles(args)),
  )

  // --- check_article_exists --------------------------------------------------
  server.registerTool(
    'check_article_exists',
    {
      title: 'Check if an article with this source URL already exists',
      description:
        "Returns `exists: true` if ANY target has already written about this source URL. URLs are canonicalized server-side (tracking params, fragments, default ports, case, www, trailing slashes all collapse), so `https://Example.com/a/` and `https://example.com/a?utm_source=x` resolve to the same row. Cross-target — if any agent has covered this URL, you should skip. Returns the existing article's id/title/target/hidden/dashboard_visible plus the `normalized` canonical form. Hidden + dashboard-invisible articles ARE returned so agents don't re-research suppressed content. On URL parse failure returns `{ exists: false, normalized, error: 'invalid_source_url' }` instead of throwing. Backed by a dedicated single-column index on `articles.source_url` (the composite `(target_id, source_url)` unique constraint can't service a source_url-only query). Call BEFORE researching to avoid duplicate work.",
      inputSchema: checkArticleExistsInputShape,
    },
    async (args, _extra) =>
      runWithGuards('check_article_exists', async () => checkArticleExists(args)),
  )

  // --- write_target_description ---------------------------------------------
  server.registerTool(
    'write_target_description',
    {
      title: 'Write a one-time target/creator description',
      description:
        '(Deprecated: use `write_target_profile` for new code.) Set a short bio for the target/creator. Write-once-when-null: returns { written: true } on first set, { written: false } on subsequent calls (admin curation is preserved). Max 500 chars.',
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
        "(Deprecated: use `write_target_profile` for new code.) Set the author's personal/social URL on a target. Write-once-when-null: returns { written: true } on first set, { written: false } afterward. Must be a valid http(s) URL.",
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
        "(Deprecated: use `write_target_profile` for new code.) Set the author's photograph/avatar URL on a target. Write-once-when-null: returns { written: true } on first set, { written: false } afterward. Must be a valid http(s) URL. Rendered as the hero band of the creator profile tile.",
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
        'Return every target on file with presence flags for description, social_url, and photo_url, PLUS scheduling/last-run state: `cadence`, `last_run_at`, `last_run_status`, `last_run_failure_reason`, `next_due_at`, and `active`. Use this to cross-reference whether an author is already covered (under any label) before writing redundant info, OR to see when a target is next due / why a previous run failed.',
    },
    async (_extra) => runWithGuards('list_targets', async () => listTargets()),
  )

  // --- get_queue_stats -------------------------------------------------------
  server.registerTool(
    'get_queue_stats',
    {
      title: 'Read aggregate queue counts',
      description:
        "Read-only snapshot of the queue health: `pending` (unacked, unclaimed), `claimed` (in-flight, lock still valid), `expired` (lock expired but reaper hasn't yet released), plus `oldest_pending_enqueued_at` (ISO timestamp of the oldest pending row, null if empty) and `next_due_at` (soonest active target's next_due_at, null if no active targets). Works on either transport — no auth needed.",
    },
    async (_extra) => runWithGuards('get_queue_stats', async () => getQueueStats()),
  )

  // --- list_my_recent_runs ---------------------------------------------------
  server.registerTool(
    'list_my_recent_runs',
    {
      title: "List the calling agent's recent runs",
      description:
        "Return run_log rows tied to the caller's `agent_token_id`, newest-first. Optional `target_id` filter; `limit` defaults to 50, max 200. Returns `{ runs: [{ id, target_id, target_label, queue_item_id, status, articles_count, failure_reason, started_at, completed_at }] }`. Requires HTTP transport with bearer auth (each token only sees its own history).",
      inputSchema: listMyRecentRunsInputShape,
    },
    async (args, extra) =>
      runWithGuards('list_my_recent_runs', async () => {
        const ctx = requireAuthContext(extra)
        return listMyRecentRuns({ ...args, agentTokenId: ctx.agentTokenId })
      }),
  )

  // --- write_target_profile --------------------------------------------------
  server.registerTool(
    'write_target_profile',
    {
      title: 'Write target description + social_url + photo_url in one call',
      description:
        'Convenience wrapper around `write_target_description`, `write_target_social_url`, and `write_target_photo_url`. Pass any subset; each field uses the same write-once-when-null semantics as the individual tools (admin curation is preserved). Returns `{ written: { description?, social_url?, photo_url? } }` with one entry per field you passed (true if the value was actually set on this call, false if a non-null value was already present). The three single-field tools stay available for older agents.',
      inputSchema: writeTargetProfileInputShape,
    },
    async (args, _extra) =>
      runWithGuards('write_target_profile', async () => writeTargetProfile(args)),
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
