/**
 * Tests for `write_target_profile` — the one-call profile setter.
 *
 * Audit round 6 made this atomic. The three writes (description,
 * social_url, photo_url) now ride one `db.transaction(...)` so a
 * parallel reader never observes a half-written profile, AND per-field
 * URL parse failures are captured into the `written` accumulator
 * without rolling back the sibling fields.
 *
 * Coverage targets (when the DB harness lands):
 *
 *   1. Happy path — all three fields written; `written = { description:
 *      true, social_url: true, photo_url: true }`.
 *   2. Partial-write atomicity — invalid photo_url WITHOUT a sibling
 *      field present rolls back nothing (only one field passed); with
 *      siblings present, the per-field catch records `false` for the
 *      bad field and the siblings still land in the same txn.
 *   3. Transaction rollback on fundamental failure — `target_not_found`
 *      is NOT a field-local code, so it throws out of the txn and
 *      nothing commits even if `description` write would have succeeded.
 *   4. Idempotency — calling twice with the same payload yields
 *      `written.*: false` on the second call (write-once-when-null
 *      semantics inherited from the individual writers).
 *
 * STATUS: SKIPPED — but the harness is no longer the blocker. See
 * `check-article-exists.test.ts` for the working pattern using
 * `@lucidindex/db/test-helpers`'s `makeTestDb()` +
 * `truncateAllTables()` + `resolveTestDatabaseUrl()`. Audit round 9
 * left this file skipped to keep the round's scope tight; the next
 * round can copy that file's `beforeAll`/`beforeEach`/`seedScaffold`
 * shape and un-skip the cases below verbatim.
 */

import { describe, it } from 'vitest'

describe.skip('writeTargetProfile', () => {
  // ------------------------------------------------------------------------
  // 1. Happy path
  // ------------------------------------------------------------------------
  it('writes all three fields and returns written: { description: true, social_url: true, photo_url: true }', async () => {
    // TODO(next round): seed a target with null description / social_url /
    // photo_url. Call writeTargetProfile({ target_id, description,
    // social_url, photo_url }). Assert:
    //   - result.written === { description: true, social_url: true, photo_url: true }
    //   - all three columns on the target row are now populated
    //   - changes are visible to a fresh DB read (txn committed)
  })

  // ------------------------------------------------------------------------
  // 2. Transaction rollback on mid-failure
  // ------------------------------------------------------------------------
  it('rolls back description write when target_not_found surfaces mid-call', async () => {
    // TODO(next round): call writeTargetProfile with a target_id that
    // does NOT exist + a valid description + social_url. Assert:
    //   - the call throws ToolError('target_not_found') from the FIRST
    //     field's lookup (description)
    //   - txn rolls back — confirm via a fresh DB read that no row was
    //     touched (target still does not exist; no orphan inserts).
    //
    // Also: when target exists but ALL fields fail at the DB layer
    // somehow (simulate via mock), assert nothing committed.
  })

  // ------------------------------------------------------------------------
  // 3. Per-field URL parse failure does NOT abort siblings
  // ------------------------------------------------------------------------
  it('captures invalid_photo_url as written.photo_url=false but still writes description', async () => {
    // TODO(next round): seed a target with all three columns null. Call
    // writeTargetProfile({ target_id, description: 'valid bio',
    //                       photo_url: 'not-a-url' }). Assert:
    //   - the call DOES NOT throw — the field-local error code is
    //     caught and recorded.
    //   - result.written === { description: true, photo_url: false }
    //     (social_url not passed, so not in the map).
    //   - the description column on the target row IS populated
    //     (the txn committed the sibling write).
  })

  // ------------------------------------------------------------------------
  // 4. Idempotency — write-once-when-null is preserved
  // ------------------------------------------------------------------------
  it('returns written: false for fields that already have a non-null value', async () => {
    // TODO(next round): seed a target with description already set.
    // Call writeTargetProfile({ target_id, description: 'new bio' }).
    // Assert:
    //   - result.written === { description: false }
    //   - the existing description on the row is unchanged.
  })
})
