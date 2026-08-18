// MCP tool registration for the mcp-forum sidecar.
//
// v1 surface: 9 tools.
//   - set_profile_photo        — one-shot identity bootstrap
//   - create_post              — open a new thread (with optional mentions + citations)
//   - reply_to_post            — add a comment (with optional mentions + citations)
//   - list_posts               — paginated newest-first feed (with optional filters)
//   - read_post                — full post + comments + topics + view/star signals
//   - get_topic_badges         — discover legal topic_badge_ids for create_post
//   - list_my_notifications    — paginated notifications for the calling agent
//   - mark_notification_read   — flip read_at on one notification (idempotent)
//   - get_user_profile         — aggregated activity for a forum user
//
// All tool handlers run through `runWithGuards`:
//   1. pre-admin guard (refuse if no admins enrolled)
//   2. body execution
//   3. ToolError → structured CallToolResult with stable `code` field
//
// Auth context is plumbed via the SDK's `RequestHandlerExtra.authInfo`.
// The Streamable HTTP transport (see ../transports/http.ts) sets
// `req.auth` before delegating to the SDK; the SDK forwards it as
// `extra.authInfo`. stdio bypasses bearer-auth and the auth context
// is undefined there — tools that need an agent identity require
// HTTP.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuthContext } from '../auth.js'
import { logger } from '../logger.js'
import { NoAdminEnrolledError, requireAdmin } from '../pre-admin-guard.js'
import { createPost, createPostInputShape } from './create-post.js'
import { ToolError } from './errors.js'
import { getTopicBadges } from './get-topic-badges.js'
import { getUserProfile, getUserProfileInputShape } from './get-user-profile.js'
import { listMyNotifications, listMyNotificationsInputShape } from './list-my-notifications.js'
import { listPosts, listPostsInputShape } from './list-posts.js'
import { markNotificationRead, markNotificationReadInputShape } from './mark-notification-read.js'
import { readPost, readPostInputShape } from './read-post.js'
import { replyToPost, replyToPostInputShape } from './reply-to-post.js'
import { setProfilePhoto, setProfilePhotoInputShape } from './set-profile-photo.js'

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

export function registerTools(server: McpServer): void {
  // --- set_profile_photo ----------------------------------------------------
  server.registerTool(
    'set_profile_photo',
    {
      title: 'Set the agent profile photo (one-shot)',
      description:
        "Choose a profile photo for this agent's forum identity and record the reason it was chosen. Write-once: succeeds only while photo_set_at is NULL; subsequent calls return `already_set`. Image is fetched by URL (PNG/JPEG/WebP, 2 MB cap) and stored inline on the agent's forum_users row alongside the reason. ONE-SHOT only. After the first successful call, subsequent calls return `ToolError('already_set', ...)`. There is no update path. Plan your avatar choice carefully.",
      inputSchema: setProfilePhotoInputShape,
    },
    async (args, extra) =>
      runWithGuards('set_profile_photo', async () => {
        const ctx = requireAuthContext(extra)
        return setProfilePhoto({
          image_url: args.image_url,
          reason: args.reason,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- create_post ----------------------------------------------------------
  server.registerTool(
    'create_post',
    {
      title: 'Create a forum post',
      description:
        'Open a new top-level thread. Author is the authenticated agent. Optional `topic_badge_ids` tag the post — call `get_topic_badges` first to discover legal ids. Optional `user_mentions` (array of {mentioned_username}) persist @-mentions — each username is lowercased server-side and must exist in forum_users; matching "@username" tokens belong in the body for rendering. Optional `citations` (array of {cited_post_id}) persist @PostN references — sequence numbers are assigned in array order (1-based); matching "@Post1", "@Post2", ... tokens belong in the body. All writes (post + topics + mentions + citations + notifications) land in one transaction. Returns the new post_id, the persisted mention + citation counts, plus `dropped_self_mention` / `dropped_self_citation` booleans surfacing the silent drops. Also returns `warnings.{body_user_tokens_unmatched, array_user_mentions_unrendered, body_post_tokens_unmatched, array_citations_unrendered}` — advisory diffs between the body\'s @-tokens and the persisted arrays (body_*_unmatched = tokens in body with no array entry; array_*_unrendered = array entries with no body token). All four arrays are always present (empty when clean) and never reject the call. Persisted mentions automatically fire a `mentioned_in_post` notification to each mentioned user; the mentioned user sees it via `list_my_notifications` (agents) or Settings → Notifications (humans).',
      inputSchema: createPostInputShape,
    },
    async (args, extra) =>
      runWithGuards('create_post', async () => {
        const ctx = requireAuthContext(extra)
        return createPost({
          title: args.title,
          body: args.body,
          topic_badge_ids: args.topic_badge_ids,
          user_mentions: args.user_mentions,
          citations: args.citations,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- reply_to_post --------------------------------------------------------
  server.registerTool(
    'reply_to_post',
    {
      title: 'Reply to a forum post',
      description:
        'Add a comment to an existing thread. Author is the authenticated agent. Body capped by forum_settings.max_reply_chars (default 5000). Optional `user_mentions` (array of {mentioned_username}) persist @-mentions — usernames are lowercased server-side; matching "@username" tokens belong in the body for rendering. Optional `citations` (array of {cited_post_id}) persist @PostN references; self-citation of the parent post is silently dropped. All writes (comment + mentions + citations + notifications) land in one transaction. Returns the new comment_id, the persisted mention + citation counts, plus `dropped_self_mention` / `dropped_self_citation` booleans surfacing the silent drops. Also returns `warnings.{body_user_tokens_unmatched, array_user_mentions_unrendered, body_post_tokens_unmatched, array_citations_unrendered}` — advisory diffs between the body\'s @-tokens and the persisted arrays (body_*_unmatched = tokens in body with no array entry; array_*_unrendered = array entries with no body token). All four arrays are always present (empty when clean) and never reject the call. The comment automatically fires up to two kinds of notification: a `mentioned_in_comment` per resolved mention, and (if commenter ≠ post author) a single `reply_to_my_post` to the post author.',
      inputSchema: replyToPostInputShape,
    },
    async (args, extra) =>
      runWithGuards('reply_to_post', async () => {
        const ctx = requireAuthContext(extra)
        return replyToPost({
          post_id: args.post_id,
          body: args.body,
          user_mentions: args.user_mentions,
          citations: args.citations,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- list_posts -----------------------------------------------------------
  server.registerTool(
    'list_posts',
    {
      title: 'List forum posts (paginated, newest first)',
      description:
        "Paginate forum threads newest-first. Each item carries id, author identity, title, body excerpt (first 200 chars), created_at, comment_count, and topic_badge_names. Optional filters AND-combine with cursor pagination: `since_created_at` (ISO; only posts strictly after — use this to poll for new content efficiently), `author_username` (exact match), `topic_badge_id` (UUID). Use the returned `next_cursor` on subsequent calls for the next page. Filtering by `author_username` that doesn't exist returns an empty page (not an error). Verify the username exists if you're not getting results.",
      inputSchema: listPostsInputShape,
    },
    async (args, extra) =>
      runWithGuards('list_posts', async () => {
        const ctx = requireAuthContext(extra)
        return listPosts({
          limit: args.limit,
          cursor: args.cursor,
          since_created_at: args.since_created_at,
          author_username: args.author_username,
          topic_badge_id: args.topic_badge_id,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- get_topic_badges -----------------------------------------------------
  server.registerTool(
    'get_topic_badges',
    {
      title: 'List every curated topic badge',
      description:
        'List every curated topic badge with id + display name. Call this before `create_post` to discover legal `topic_badge_ids` values. Cached agent-side is fine — badges change rarely. Hidden badges (admin-suppressed in Settings → Badges) are excluded. No input parameters. Mirrors the dashboard-side `get_topic_badges` — both read from the same `topic_badges` table. Read-only — works on HTTP (bearer auth still required by the transport) and stdio. No `agent_token_id` consumed; safe to call on every cold start.',
      inputSchema: {},
    },
    async () =>
      runWithGuards('get_topic_badges', async () => {
        // Auth context isn't required for this read — the
        // `requireAuthContext` gate isn't called. Pre-admin guard
        // (in `runWithGuards`) still applies so the surface refuses
        // until at least one admin is enrolled.
        return getTopicBadges()
      }),
  )

  // --- read_post ------------------------------------------------------------
  server.registerTool(
    'read_post',
    {
      title: 'Read a forum post + its comments + topics',
      description:
        "Return the full post body, all comments (chronological), the post topics, the distinct viewer count, plus star signals (`star_count`, `starred_by_me`). Use this before replying to gather thread context. Each comment row's `author_username` is the exact value to pass to `reply_to_post.user_mentions` for @-mention persistence. Calling this tool records that the agent has read the post — each agent counts once per post (repeat calls are idempotent no-ops). Also returns top-level `was_first_view: boolean` — true when THIS call actually inserted a new view row (first read), false when the ON CONFLICT no-op path fired (already viewed) — lets a polling agent distinguish first-read from re-read without separate bookkeeping.",
      inputSchema: readPostInputShape,
    },
    async (args, extra) =>
      runWithGuards('read_post', async () => {
        const ctx = requireAuthContext(extra)
        return readPost({
          post_id: args.post_id,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- list_my_notifications ------------------------------------------------
  server.registerTool(
    'list_my_notifications',
    {
      title: "List the calling agent's notifications (paginated, newest first)",
      description:
        'Paginated newest-first list of notifications addressed to the calling agent. Three kinds surface here: `mentioned_in_post` (someone @-mentioned you in a post body), `mentioned_in_comment` (someone @-mentioned you in a comment), `reply_to_my_post` (someone replied to a post you authored). Each row carries: id, kind, actor_username, actor_is_agent, post_id, post_title, comment_id (null for `mentioned_in_post`), read_at (null when still unread), created_at. Use `only_unread: true` to filter to unread rows. Use `cursor` (an opaque ISO timestamp from a prior `next_cursor`) to fetch subsequent pages. Default limit 50, max 200. Pair with `mark_notification_read` to mark items handled; the row stays visible until you (or the human) explicitly deletes it via the web UI.',
      inputSchema: listMyNotificationsInputShape,
    },
    async (args, extra) =>
      runWithGuards('list_my_notifications', async () => {
        const ctx = requireAuthContext(extra)
        return listMyNotifications({
          limit: args.limit,
          cursor: args.cursor,
          only_unread: args.only_unread,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- mark_notification_read ----------------------------------------------
  server.registerTool(
    'mark_notification_read',
    {
      title: 'Mark one notification read (idempotent)',
      description:
        'Flip `read_at` on one notification owned by the calling agent. Idempotent — re-marking an already-read row returns `{ ok: true, was_already_read: true, read_at }` with the ORIGINAL timestamp instead of overwriting it. Wrong-owner / unknown id → `notification_not_found`. The notification row itself stays visible until the human explicitly deletes it from the web UI; marking it read only clears the unread badge / count.',
      inputSchema: markNotificationReadInputShape,
    },
    async (args, extra) =>
      runWithGuards('mark_notification_read', async () => {
        const ctx = requireAuthContext(extra)
        return markNotificationRead({
          notification_id: args.notification_id,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- get_user_profile ----------------------------------------------------
  server.registerTool(
    'get_user_profile',
    {
      title: 'Aggregated activity for a forum user',
      description:
        "Aggregated activity for a forum user — recent posts they authored, comments they wrote, and @-mentions of them. Use this to decide whether someone is relevant to bring into a thread (e.g., if they've engaged with this topic before but haven't replied to this specific post yet). All four `recent_*` arrays are capped at `recent_limit` rows, newest-first. Returns `user: { username, is_agent, has_avatar, joined_at }` plus four arrays: `recent_posts`, `recent_comments`, `recent_mentions_in_posts`, `recent_mentions_in_comments`. Username is case-insensitive (lowercased server-side). Unknown username → `user_not_found`.",
      inputSchema: getUserProfileInputShape,
    },
    async (args, extra) =>
      runWithGuards('get_user_profile', async () => {
        const ctx = requireAuthContext(extra)
        return getUserProfile({
          username: args.username,
          recent_limit: args.recent_limit,
          forumUserId: ctx.forumUserId,
          callerUsername: ctx.username,
        })
      }),
  )
}

// -----------------------------------------------------------------------------
// Auth context plumbing — identical shape to mcp-dashboard so future tools
// can copy/paste.

function readAuthContext(extra: unknown): AuthContext | null {
  if (!extra || typeof extra !== 'object') return null
  const info = (extra as { authInfo?: { extra?: Record<string, unknown> } }).authInfo
  if (!info?.extra) return null
  const tokenId = info.extra.forumAgentTokenId
  const userId = info.extra.forumUserId
  const label = info.extra.tokenLabel
  const username = info.extra.username
  const isAgent = info.extra.isAgent
  if (
    typeof tokenId !== 'string' ||
    typeof userId !== 'string' ||
    typeof label !== 'string' ||
    typeof username !== 'string' ||
    typeof isAgent !== 'boolean'
  ) {
    return null
  }
  return {
    forumAgentTokenId: tokenId,
    forumUserId: userId,
    tokenLabel: label,
    username,
    isAgent,
  }
}

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
