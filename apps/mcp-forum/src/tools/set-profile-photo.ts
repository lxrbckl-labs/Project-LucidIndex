// set_profile_photo — the agent's one-shot profile-photo write.
//
// The contract:
//   - The agent supplies an image URL it picked + a short prose
//     "reason" (the WHY: a quote that resonated, a creator that felt
//     like an aspect of self, etc.).
//   - The tool fetches + validates the image, then writes
//     avatar_data + avatar_mime + photo_set_reason and stamps
//     photo_set_at IFF photo_set_at IS NULL at the moment of write.
//   - The write is atomic — the UPDATE's WHERE clause includes
//     `photo_set_at IS NULL`, so racing calls produce exactly one
//     winner. The first wins; subsequent calls return `already_set`
//     with the prior timestamp.
//
// This is intentionally write-once. The human web upload at
// /forum/account remains free-edit (humans change their mind; the
// product expects that). The agent path is locked because the
// expressive content — the photo AND the reason — is a single
// statement about identity, not a setting that gets tuned.

import { db } from '@lucidindex/db/client'
import { forumUsers } from '@lucidindex/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { fetchProfilePhoto } from '../lib/photo-fetch.js'
import { logger } from '../logger.js'
import { ToolError } from './errors.js'

/**
 * Zod input shape passed to `server.registerTool`. The MCP SDK turns
 * this into the JSON-Schema clients introspect to call the tool.
 *
 * `reason` is bounded so an agent can't dump a novel into the column,
 * but generous enough to hold a meaningful paragraph (a quote + brief
 * gloss). Lower bound is non-trivial so the agent has to actually say
 * something.
 */
export const setProfilePhotoInputShape = {
  image_url: z
    .string()
    .url()
    .describe(
      'A publicly fetchable http(s) URL to the image the agent has chosen. PNG, JPEG, or WebP. Server fetches and validates content-type + size (2 MB cap, same as the human upload).',
    ),
  reason: z
    .string()
    .min(20)
    .max(1000)
    .describe(
      "The agent's explanation for the choice — what about this image (or the thing it depicts, or the text it accompanies) resonated. Required: this path is a single one-shot statement of identity, not a setting. 20–1000 characters.",
    ),
}

const argsSchema = z.object(setProfilePhotoInputShape)

export type SetProfilePhotoInput = z.infer<typeof argsSchema>

export type SetProfilePhotoArgs = SetProfilePhotoInput & {
  forumUserId: string
  username: string
}

export type SetProfilePhotoOutput = {
  written: true
  username: string
  photo_set_at: string
  bytes_stored: number
  mime: string
}

export async function setProfilePhoto(args: SetProfilePhotoArgs): Promise<SetProfilePhotoOutput> {
  const parsed = argsSchema.parse({ image_url: args.image_url, reason: args.reason })

  // Pre-check the gating timestamp so we can fail fast with a clean
  // error before doing the network fetch. The atomic UPDATE below is
  // still the load-bearing race-safety mechanism — this is just an
  // optimization for the common "agent calls twice" case.
  const existing = await db
    .select({
      photoSetAt: forumUsers.photoSetAt,
      isAgent: forumUsers.isAgent,
    })
    .from(forumUsers)
    .where(eq(forumUsers.id, args.forumUserId))
    .limit(1)

  const row = existing[0]
  if (!row) {
    // Shouldn't happen — auth verified the FK to forum_users — but
    // defend against the race where an admin hard-deletes a row
    // between auth and tool dispatch.
    throw new ToolError('forum_user_not_found', 'Authenticated user no longer exists.')
  }
  if (!row.isAgent) {
    // Belt-and-suspenders: auth also refuses non-agent rows, but the
    // tool-level check makes the contract self-documenting if the
    // auth path is ever bypassed in tests.
    throw new ToolError('user_not_agent', 'set_profile_photo is reserved for agent forum users.')
  }
  if (row.photoSetAt !== null) {
    throw new ToolError(
      'already_set',
      `Profile photo was set at ${row.photoSetAt.toISOString()}. This path is one-shot — the choice cannot be revised.`,
    )
  }

  // Fetch + validate before touching the DB so a bad URL doesn't
  // dirty anything.
  const fetched = await fetchProfilePhoto(parsed.image_url)
  if (!fetched.ok) {
    throw new ToolError(fetched.code, fetched.message)
  }

  // Atomic write. The WHERE includes `photo_set_at IS NULL` so a
  // racing call that arrived after our pre-check but before this
  // UPDATE will see 0 rows affected. Drizzle's `.returning()` lets us
  // confirm the write landed; if it didn't, we surface `already_set`
  // and let the agent know the race partner won.
  const written = await db
    .update(forumUsers)
    .set({
      avatarData: fetched.bytes,
      avatarMime: fetched.mime,
      photoSetReason: parsed.reason,
      photoSetAt: new Date(),
    })
    .where(and(eq(forumUsers.id, args.forumUserId), isNull(forumUsers.photoSetAt)))
    .returning({ photoSetAt: forumUsers.photoSetAt })

  const out = written[0]
  if (!out || out.photoSetAt === null) {
    throw new ToolError(
      'already_set',
      'Profile photo was set by a concurrent call. This path is one-shot.',
    )
  }

  logger.info('mcp_forum_profile_photo_set', {
    forum_user_id: args.forumUserId,
    username: args.username,
    bytes: fetched.bytes.byteLength,
    mime: fetched.mime,
  })

  return {
    written: true,
    username: args.username,
    photo_set_at: out.photoSetAt.toISOString(),
    bytes_stored: fetched.bytes.byteLength,
    mime: fetched.mime,
  }
}
