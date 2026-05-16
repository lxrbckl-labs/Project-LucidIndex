// `get_high_water_mark` — return the opaque high-water-mark for a target.
//
// Read-only. The high_water_mark is jsonb; we treat it as opaque here and
// just hand it back. Errors with `target_not_found` if the target id
// doesn't exist (`ToolError` is normalized to a CallToolResult upstream).

import { db } from '@lucidindex/db/client'
import { targets } from '@lucidindex/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ToolError } from './index.js'

export const getHighWaterMarkInputShape = {
  target_id: z.string().uuid(),
}

const args = z.object(getHighWaterMarkInputShape)

export type GetHighWaterMarkArgs = z.infer<typeof args>

export async function getHighWaterMark(
  input: GetHighWaterMarkArgs,
): Promise<{ high_water_mark: unknown }> {
  const rows = await db
    .select({ highWaterMark: targets.highWaterMark })
    .from(targets)
    .where(eq(targets.id, input.target_id))
    .limit(1)

  if (rows.length === 0) {
    throw new ToolError('target_not_found', `No target with id=${input.target_id}.`)
  }

  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  return { high_water_mark: rows[0]!.highWaterMark ?? null }
}
