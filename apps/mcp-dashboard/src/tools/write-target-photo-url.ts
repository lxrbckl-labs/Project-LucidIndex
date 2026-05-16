// `write_target_photo_url` — set a one-time photograph/avatar URL on a target.
//
// Mirror of `write_target_social_url`: write-once-when-null. The agent
// finds a representative author photo on the source page (or a primary
// social) and stores the absolute URL here. Rendered as the hero band
// of the creator profile tile on `/c/[slug]`.
//
// URL validation: must parse via the URL constructor and use http/https.
// Length cap: 500 chars (CDN URLs with cache-busters can be long).

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { ToolError } from './index.js'

const PHOTO_URL_MAX = 500

export const writeTargetPhotoUrlInputShape = {
  target_id: z.string().uuid(),
  photo_url: z.string().min(1).max(PHOTO_URL_MAX),
}

const writeTargetPhotoUrlArgs = z.object(writeTargetPhotoUrlInputShape)

export type WriteTargetPhotoUrlArgs = z.infer<typeof writeTargetPhotoUrlArgs>

export type WriteTargetPhotoUrlResult = {
  ok: true
  written: boolean
}

export async function writeTargetPhotoUrl(
  args: WriteTargetPhotoUrlArgs,
): Promise<WriteTargetPhotoUrlResult> {
  let parsed: URL
  try {
    parsed = new URL(args.photo_url)
  } catch {
    throw new ToolError('invalid_photo_url', 'photo_url must be a valid http(s) URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ToolError('invalid_photo_url', 'photo_url must use http or https.')
  }

  const exists = await db
    .select({ id: targets.id })
    .from(targets)
    .where(eq(targets.id, args.target_id))
    .limit(1)
  if (exists.length === 0) {
    throw new ToolError('target_not_found', `No target with id=${args.target_id}.`)
  }

  const updated = await db
    .update(targets)
    .set({ photoUrl: args.photo_url })
    .where(and(eq(targets.id, args.target_id), isNull(targets.photoUrl)))
    .returning({ id: targets.id })

  return { ok: true, written: updated.length > 0 }
}
