// `write_target_description` — set a one-time bio on a target.
//
// Write-once-when-null semantics: if the target already has a description
// (admin-curated or previously agent-written), the call is a no-op and
// returns `{ ok: true, written: false }` so the agent can detect that
// existing context is already on file. This protects admin curation from
// being overwritten by a later agent run.
//
// Length cap: 500 chars. Strict enough to keep the bio compact for the
// creator card UI, loose enough for "X is a software-engineering blog
// covering distributed systems and infrastructure, with a focus on
// operational realism over hype".
//
// Audit round 6 — optional `tx` handle: the three single-field writers
// can now run inside a caller-supplied transaction (used by
// `write_target_profile` for atomic three-field writes). When `tx` is
// absent we fall back to the module-level `db` so the standalone tool
// surface is unchanged.

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { type DrizzleHandle, ToolError } from './index.js'

const DESCRIPTION_MAX = 500

export const writeTargetDescriptionInputShape = {
  target_id: z.string().uuid(),
  description: z.string().min(1).max(DESCRIPTION_MAX),
}

const writeTargetDescriptionArgs = z.object(writeTargetDescriptionInputShape)

export type WriteTargetDescriptionArgs = z.infer<typeof writeTargetDescriptionArgs>

export type WriteTargetDescriptionResult = {
  ok: true
  written: boolean
}

export async function writeTargetDescription(
  args: WriteTargetDescriptionArgs,
  tx?: DrizzleHandle,
): Promise<WriteTargetDescriptionResult> {
  const handle: DrizzleHandle = tx ?? (db as unknown as DrizzleHandle)
  // Confirm the target exists at all.
  const exists = await handle
    .select({ id: targets.id })
    .from(targets)
    .where(eq(targets.id, args.target_id))
    .limit(1)
  if (exists.length === 0) {
    throw new ToolError('target_not_found', `No target with id=${args.target_id}.`)
  }

  // Conditional update — only writes when description is currently null.
  // If the row's description is already populated, the WHERE clause matches
  // zero rows and the agent gets `written: false` in the response.
  const updated = await handle
    .update(targets)
    .set({ description: args.description })
    .where(and(eq(targets.id, args.target_id), isNull(targets.description)))
    .returning({ id: targets.id })

  return { ok: true, written: updated.length > 0 }
}
