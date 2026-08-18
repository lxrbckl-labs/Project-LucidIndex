// `write_target_social_url` — set a one-time social URL on a target.
//
// Mirror of `write_target_description`: write-once-when-null. If the
// target already has a `social_url` (admin-curated or previously
// agent-written), the call is a no-op and returns
// `{ ok: true, written: false }` so the agent can detect existing
// context. Protects admin curation from being overwritten.
//
// URL validation: must parse via the URL constructor and use http/https.
// Length cap: 200 chars (anything longer is almost certainly a tracking-
// laden share-link, not the canonical author URL we want).
//
// Audit round 6 — optional `tx` handle for atomic three-field writes
// driven by `write_target_profile`.

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { type DrizzleHandle, ToolError } from './index.js'

const SOCIAL_URL_MAX = 200

export const writeTargetSocialUrlInputShape = {
  target_id: z.string().uuid(),
  social_url: z.string().min(1).max(SOCIAL_URL_MAX),
}

const writeTargetSocialUrlArgs = z.object(writeTargetSocialUrlInputShape)

export type WriteTargetSocialUrlArgs = z.infer<typeof writeTargetSocialUrlArgs>

export type WriteTargetSocialUrlResult = {
  ok: true
  written: boolean
}

export async function writeTargetSocialUrl(
  args: WriteTargetSocialUrlArgs,
  tx?: DrizzleHandle,
): Promise<WriteTargetSocialUrlResult> {
  // URL shape — accept http/https only. Reject mailto:, javascript:, etc.
  let parsed: URL
  try {
    parsed = new URL(args.social_url)
  } catch {
    throw new ToolError('invalid_social_url', 'social_url must be a valid http(s) URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ToolError('invalid_social_url', 'social_url must use http or https.')
  }

  const handle: DrizzleHandle = tx ?? (db as unknown as DrizzleHandle)
  const exists = await handle
    .select({ id: targets.id })
    .from(targets)
    .where(eq(targets.id, args.target_id))
    .limit(1)
  if (exists.length === 0) {
    throw new ToolError('target_not_found', `No target with id=${args.target_id}.`)
  }

  // Conditional update — only writes when social_url is currently null.
  // If already populated, WHERE matches zero rows → written:false.
  const updated = await handle
    .update(targets)
    .set({ socialUrl: args.social_url })
    .where(and(eq(targets.id, args.target_id), isNull(targets.socialUrl)))
    .returning({ id: targets.id })

  return { ok: true, written: updated.length > 0 }
}
