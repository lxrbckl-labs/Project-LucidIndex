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
import { ToolError } from './errors.js'
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
