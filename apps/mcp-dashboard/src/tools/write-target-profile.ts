// `write_target_profile` — one-call author profile setter (P2 / audit
// round 3).
//
// Combines `write_target_description` + `write_target_social_url` +
// `write_target_photo_url` into a single request so agents don't need
// three round-trips to flesh out a creator on first discovery.
//
// Semantics are inherited from the three underlying tools: each field is
// WRITE-ONCE-WHEN-NULL — if a target already has a non-null description
// / social_url / photo_url, that field stays untouched and its `written`
// flag comes back false. So calling this tool repeatedly with the same
// payload is idempotent.
//
// The three existing one-shot tools (`write_target_description`,
// `write_target_social_url`, `write_target_photo_url`) stay registered.
// Agents already in the field with those tools shouldn't break; this is
// purely a convenience over the top.
//
// Audit round 6 — atomicity + partial-success accounting:
// ------------------------------------------------------
// Previously the three writes ran sequentially against the module-level
// `db`. If the second call failed mid-way (e.g. `invalid_photo_url` on
// the third), the first call had already committed and the caller had
// no way to learn that `description` landed but the rest didn't.
//
// Now we wrap the three writes in a single `db.transaction(...)` and
// thread the tx handle through each per-field writer. Two things happen:
//
//   1. Atomic commit. All three writes ride the same Postgres txn, so
//      a parallel reader never observes a half-written profile.
//   2. Per-field try/catch accumulator. We catch ToolError (URL parse
//      failures, target_not_found) on each field individually and
//      record the outcome into `written` before moving on. The caller
//      always gets a `written` entry per field they passed:
//        - true   → write actually applied (was null).
//        - false  → either already populated OR the per-field write
//                   threw a ToolError (the txn captures that field's
//                   savepoint error but lets siblings proceed).
//
// target_not_found bubbles from the FIRST writer that runs — but the
// txn rollback ensures no partial state lands. Don't add a pre-check;
// rely on the writer's existing FK lookup. A pre-check would be a
// second round-trip for every call (one to validate, three to write)
// and would still race the actual UPDATE — the FK lookup inside each
// writer is the only authoritative check, and the surrounding
// transaction guarantees the missing-target error rolls back any
// sibling writes that may already have committed at the SQL level
// inside the txn.

import { db } from '@lucidindex/db/client'
import { z } from 'zod'
import { type DrizzleHandle, ToolError } from './index.js'
import {
  writeTargetDescription,
  writeTargetDescriptionInputShape,
} from './write-target-description.js'
import { writeTargetPhotoUrl, writeTargetPhotoUrlInputShape } from './write-target-photo-url.js'
import { writeTargetSocialUrl, writeTargetSocialUrlInputShape } from './write-target-social-url.js'

export const writeTargetProfileInputShape = {
  target_id: z.string().uuid(),
  description: writeTargetDescriptionInputShape.description.optional(),
  social_url: writeTargetSocialUrlInputShape.social_url.optional(),
  photo_url: writeTargetPhotoUrlInputShape.photo_url.optional(),
}

const writeTargetProfileArgs = z.object(writeTargetProfileInputShape)

export type WriteTargetProfileArgs = z.infer<typeof writeTargetProfileArgs>

export type WriteTargetProfileResult = {
  written: {
    description?: boolean
    social_url?: boolean
    photo_url?: boolean
  }
}

/**
 * Codes considered "field-local" — caught by the per-field accumulator
 * and recorded as `written.<field> = false` without rolling back the
 * sibling writes. Codes outside this set (notably `target_not_found`)
 * bubble out as a ToolError and the txn rolls back.
 */
const FIELD_LOCAL_ERROR_CODES = new Set(['invalid_social_url', 'invalid_photo_url'])

export async function writeTargetProfile(
  args: WriteTargetProfileArgs,
): Promise<WriteTargetProfileResult> {
  const written: WriteTargetProfileResult['written'] = {}

  // Single transaction wrapping all three writes so a parallel reader
  // never observes a half-written profile. Per-field URL parse failures
  // are caught and recorded as `written.<field> = false`; fundamental
  // errors (target_not_found) bubble out and roll back.
  await (db as unknown as { transaction: (...a: unknown[]) => Promise<void> }).transaction(
    async (tx: DrizzleHandle) => {
      if (args.description !== undefined) {
        try {
          const r = await writeTargetDescription(
            { target_id: args.target_id, description: args.description },
            tx,
          )
          written.description = r.written
        } catch (err) {
          if (err instanceof ToolError && FIELD_LOCAL_ERROR_CODES.has(err.code)) {
            written.description = false
          } else {
            throw err
          }
        }
      }
      if (args.social_url !== undefined) {
        try {
          const r = await writeTargetSocialUrl(
            { target_id: args.target_id, social_url: args.social_url },
            tx,
          )
          written.social_url = r.written
        } catch (err) {
          if (err instanceof ToolError && FIELD_LOCAL_ERROR_CODES.has(err.code)) {
            written.social_url = false
          } else {
            throw err
          }
        }
      }
      if (args.photo_url !== undefined) {
        try {
          const r = await writeTargetPhotoUrl(
            { target_id: args.target_id, photo_url: args.photo_url },
            tx,
          )
          written.photo_url = r.written
        } catch (err) {
          if (err instanceof ToolError && FIELD_LOCAL_ERROR_CODES.has(err.code)) {
            written.photo_url = false
          } else {
            throw err
          }
        }
      }
    },
  )

  return { written }
}
