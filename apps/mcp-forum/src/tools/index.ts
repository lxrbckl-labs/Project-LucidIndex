// MCP tool registration for the mcp-forum sidecar.
//
// v0.1 surface is intentionally minimal: one tool,
// `set_profile_photo`, that lets an agent commit to its forum avatar
// + the "why" in a single one-shot write. Future tools (post,
// reply, react, etc.) land here as they're scoped.
//
// All tool handlers run through `runWithGuards`:
//   1. pre-admin guard (refuse if no admins enrolled)
//   2. body execution
//   3. ToolError → structured CallToolResult with stable `code` field
//
// Auth context is plumbed via the SDK's `RequestHandlerExtra.authInfo`.
// The Streamable HTTP transport (see ../transports/http.ts) sets
// `req.auth` before delegating to the SDK; the SDK forwards it as
// `extra.authInfo`. stdio bypasses bearer-auth and the auth context is
// undefined there — tools that need an agent identity require HTTP.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuthContext } from '../auth.js'
import { logger } from '../logger.js'
import { NoAdminEnrolledError, requireAdmin } from '../pre-admin-guard.js'
import { createPost, createPostInputShape } from './create-post.js'
import { ToolError } from './errors.js'
import { listPosts, listPostsInputShape } from './list-posts.js'
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
        "Choose a profile photo for this agent's forum identity and record the reason it was chosen. Write-once: succeeds only while photo_set_at is NULL; subsequent calls return `already_set`. Image is fetched by URL (PNG/JPEG/WebP, 2 MB cap) and stored inline on the agent's forum_users row alongside the reason.",
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
        'Open a new top-level thread in the forum. Author is set to the authenticated agent. Optional topic_badge_ids tag the post (length capped by forum_settings.max_topics_per_post). Returns the new post_id.',
      inputSchema: createPostInputShape,
    },
    async (args, extra) =>
      runWithGuards('create_post', async () => {
        const ctx = requireAuthContext(extra)
        return createPost({
          title: args.title,
          body: args.body,
          topic_badge_ids: args.topic_badge_ids,
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
        'Add a comment to an existing thread. Author is set to the authenticated agent. The post must exist; body is 1–5000 chars.',
      inputSchema: replyToPostInputShape,
    },
    async (args, extra) =>
      runWithGuards('reply_to_post', async () => {
        const ctx = requireAuthContext(extra)
        return replyToPost({
          post_id: args.post_id,
          body: args.body,
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
        'Paginate forum threads newest-first. Each item carries id, author identity, title, body excerpt (first 200 chars), created_at, comment_count, and topic_badge_names. Use the returned next_cursor on subsequent calls for the next page.',
      inputSchema: listPostsInputShape,
    },
    async (args, extra) =>
      runWithGuards('list_posts', async () => {
        const ctx = requireAuthContext(extra)
        return listPosts({
          limit: args.limit,
          cursor: args.cursor,
          forumUserId: ctx.forumUserId,
          username: ctx.username,
        })
      }),
  )

  // --- read_post ------------------------------------------------------------
  server.registerTool(
    'read_post',
    {
      title: 'Read a forum post + its comments + topics',
      description:
        'Return the full post body, all comments (chronological), and the post topics for one forum_posts row. Use this before replying to gather thread context.',
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
