/**
 * Server-only data helpers for the Settings → Forum → Posting panel and
 * the matching `/api/settings/posting` admin routes.
 *
 * The singleton row at `forum_settings.id = 1` is the source of truth
 * for the four admin-configurable post limits. Migration 0019 seeds it
 * on every fresh DB; this module also defends with a self-heal upsert
 * inside `getPostingSettings` so reads always return a row even if the
 * seed was somehow skipped.
 *
 * Validation lives here, not at the DB layer — the DB CHECK constraints
 * on `forum_settings` enforce hard ceilings (e.g. body up to 100000)
 * but the user-facing flow needs friendly error strings before the
 * UPDATE round-trip. `validateUpdate` does that work and returns either
 * the constrained input or a single error string the route surfaces in
 * a destructive Alert.
 *
 * The cleartext defaults (`DEFAULT_POSTING_SETTINGS`) are exported so
 * the panel can show the "Reset to defaults" button and the API route
 * can hard-reset via UPDATE without re-issuing literals.
 */

import { db } from '@lucidindex/db/client'
import { eq, sql } from '@lucidindex/db/query'
import { forumSettings } from '@lucidindex/db/schema'

/** The five admin-configurable post limits + the row's updatedAt timestamp. */
export type PostingSettings = {
  maxTopicsPerPost: number
  maxImagesPerPost: number
  maxTitleChars: number
  maxBodyChars: number
  maxReplyChars: number
  updatedAt: Date
}

/**
 * Canonical defaults. Matches the column defaults in the schema and the
 * seed in migration 0019 (plus the `max_reply_chars` default added in
 * migration 0025). Exported so the panel and the API route share one
 * source of truth — the "Reset to defaults" button writes these exact
 * values back, and the self-heal upsert in `getPostingSettings` uses
 * them if the row is missing.
 */
export const DEFAULT_POSTING_SETTINGS = {
  maxTopicsPerPost: 3,
  maxImagesPerPost: 3,
  maxTitleChars: 75,
  maxBodyChars: 10000,
  maxReplyChars: 5000,
} as const

/**
 * Hard CHECK ranges from the schema. Kept in sync with
 * `packages/db/schema/forum.ts`. Validation surfaces a friendly error
 * before the UPDATE round-trip; the DB CHECKs are the final guard.
 */
export const POSTING_LIMITS = {
  maxTopicsPerPost: { min: 1, max: 10 },
  maxImagesPerPost: { min: 0, max: 20 },
  maxTitleChars: { min: 1, max: 500 },
  maxBodyChars: { min: 1, max: 100_000 },
  maxReplyChars: { min: 1, max: 100_000 },
} as const

type Column = keyof typeof POSTING_LIMITS

/**
 * Read the singleton settings row. Self-heals via UPSERT if the row is
 * missing — defenders shouldn't have to think about whether migration
 * 0019's seed ran on this DB.
 */
export async function getPostingSettings(): Promise<PostingSettings> {
  const rows = await db
    .select({
      maxTopicsPerPost: forumSettings.maxTopicsPerPost,
      maxImagesPerPost: forumSettings.maxImagesPerPost,
      maxTitleChars: forumSettings.maxTitleChars,
      maxBodyChars: forumSettings.maxBodyChars,
      maxReplyChars: forumSettings.maxReplyChars,
      updatedAt: forumSettings.updatedAt,
    })
    .from(forumSettings)
    .where(eq(forumSettings.id, 1))
    .limit(1)

  const row = rows[0]
  if (row) return row

  // Row missing — INSERT defaults and return them. ON CONFLICT guards
  // against a race where two concurrent readers both try to seed.
  const inserted = await db
    .insert(forumSettings)
    .values({ id: 1, ...DEFAULT_POSTING_SETTINGS })
    .onConflictDoNothing({ target: forumSettings.id })
    .returning({
      maxTopicsPerPost: forumSettings.maxTopicsPerPost,
      maxImagesPerPost: forumSettings.maxImagesPerPost,
      maxTitleChars: forumSettings.maxTitleChars,
      maxBodyChars: forumSettings.maxBodyChars,
      maxReplyChars: forumSettings.maxReplyChars,
      updatedAt: forumSettings.updatedAt,
    })
  const seeded = inserted[0]
  if (seeded) return seeded

  // The other racer won — re-read the row they wrote.
  const reread = await db
    .select({
      maxTopicsPerPost: forumSettings.maxTopicsPerPost,
      maxImagesPerPost: forumSettings.maxImagesPerPost,
      maxTitleChars: forumSettings.maxTitleChars,
      maxBodyChars: forumSettings.maxBodyChars,
      maxReplyChars: forumSettings.maxReplyChars,
      updatedAt: forumSettings.updatedAt,
    })
    .from(forumSettings)
    .where(eq(forumSettings.id, 1))
    .limit(1)
  const final = reread[0]
  if (final) return final

  // Pathological — both INSERT and re-SELECT lost. Return the constants
  // so the panel still renders; the next admin Save will retry the UPSERT.
  return { ...DEFAULT_POSTING_SETTINGS, updatedAt: new Date() }
}

export type UpdateInput = Partial<{
  maxTopicsPerPost: number
  maxImagesPerPost: number
  maxTitleChars: number
  maxBodyChars: number
  maxReplyChars: number
}>

export type ValidateResult = { ok: true; clean: UpdateInput } | { ok: false; error: string }

const LABELS: Record<Column, string> = {
  maxTopicsPerPost: 'Topics per post',
  maxImagesPerPost: 'Images per post',
  maxTitleChars: 'Title length',
  maxBodyChars: 'Body length',
  maxReplyChars: 'Replies length',
}

/**
 * Validate a partial update against the hard CHECK ranges. Each value
 * must be an integer inside its [min, max] window. Returns the cleaned
 * input or a single friendly error string ready for an Alert.
 */
export function validateUpdate(input: UpdateInput): ValidateResult {
  const clean: UpdateInput = {}
  for (const key of Object.keys(POSTING_LIMITS) as Column[]) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, error: `${LABELS[key]} must be an integer.` }
    }
    const { min, max } = POSTING_LIMITS[key]
    if (value < min || value > max) {
      return { ok: false, error: `${LABELS[key]} must be between ${min} and ${max}.` }
    }
    clean[key] = value
  }
  return { ok: true, clean }
}

export type UpdateResult = { ok: true; row: PostingSettings } | { ok: false; error: string }

/**
 * Apply an admin-supplied partial update to the singleton row.
 * Validates first; on success runs an UPSERT (INSERT … ON CONFLICT DO
 * UPDATE) so a missing row is seeded with defaults overlaid by the
 * provided fields. Bumps `updated_at` to now.
 */
export async function updatePostingSettings(input: UpdateInput): Promise<UpdateResult> {
  const validated = validateUpdate(input)
  if (!validated.ok) return { ok: false, error: validated.error }

  const patch = validated.clean
  // Nothing to write — return the current row.
  if (Object.keys(patch).length === 0) {
    const current = await getPostingSettings()
    return { ok: true, row: current }
  }

  try {
    const rows = await db
      .insert(forumSettings)
      .values({
        id: 1,
        ...DEFAULT_POSTING_SETTINGS,
        ...patch,
      })
      .onConflictDoUpdate({
        target: forumSettings.id,
        set: { ...patch, updatedAt: sql`now()` },
      })
      .returning({
        maxTopicsPerPost: forumSettings.maxTopicsPerPost,
        maxImagesPerPost: forumSettings.maxImagesPerPost,
        maxTitleChars: forumSettings.maxTitleChars,
        maxBodyChars: forumSettings.maxBodyChars,
        maxReplyChars: forumSettings.maxReplyChars,
        updatedAt: forumSettings.updatedAt,
      })
    const row = rows[0]
    if (!row) return { ok: false, error: 'Update returned no row.' }
    return { ok: true, row }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.'
    return { ok: false, error: message }
  }
}

/**
 * Hard-reset every configurable field to `DEFAULT_POSTING_SETTINGS`.
 * Used by the panel's "Reset to defaults" button. UPSERTs through the
 * same path as `updatePostingSettings` so a missing row gets seeded
 * with the same values.
 */
export async function resetPostingSettings(): Promise<UpdateResult> {
  return updatePostingSettings({ ...DEFAULT_POSTING_SETTINGS })
}
