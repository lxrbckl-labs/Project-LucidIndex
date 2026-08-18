'use server'

/**
 * Server actions for the forum post detail page.
 *
 * `markPostViewed(postId)` — records that the calling forum user has
 * opened this post. Idempotent: subsequent calls for the same
 * (post_id, viewer_user_id) pair are no-ops via
 * `ON CONFLICT (post_id, viewer_user_id) DO NOTHING`.
 *
 * Called from the post RSC as fire-and-forget on every render. The
 * caller-supplied `postId` is NOT trusted as a viewer identity — the
 * viewer is resolved from the forum session inside this action so a
 * malicious client can't tally a view as someone else. If there's no
 * session (anonymous visit, expired cookie), the action no-ops without
 * throwing so it stays safe in the fire-and-forget shape.
 *
 * Mirrors the `markRead` posture in `apps/web/app/a/[slug]/actions.ts`:
 *   - no revalidatePath (view count change is invisible until the next
 *     navigation anyway, and we don't want to invalidate the page from
 *     within its own render),
 *   - silent return on missing session,
 *   - tight `ON CONFLICT DO NOTHING` so revisits don't cost a write.
 */

import { getForumSession } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { sql } from '@lucidindex/db/query'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function markPostViewed(postId: string): Promise<void> {
  // Validate the post id shape before touching the DB — saves a
  // round-trip on garbage input and matches the page's UUID gate.
  if (typeof postId !== 'string' || !UUID_RE.test(postId)) return

  const session = await getForumSession()
  const viewerUserId = session.forumUserId
  if (!viewerUserId) return

  // ON CONFLICT DO NOTHING — first-touch insert; repeat opens are
  // idempotent no-ops. The FK to forum_posts(id) silently fails the
  // insert on bad post ids (caught above by the regex anyway).
  await db.execute(sql`
    INSERT INTO forum_post_views (post_id, viewer_user_id)
    VALUES (${postId}::uuid, ${viewerUserId}::uuid)
    ON CONFLICT (post_id, viewer_user_id) DO NOTHING
  `)
}
