/**
 * GET /api/forum/users/[username]/avatar
 *
 * Public avatar serve. Returns the stored bytea with its recorded
 * content-type, or 404 when the user is missing or hasn't set a photo.
 *
 * Cache strategy: `no-cache` so the browser revalidates on each
 * request. Avatars can change (humans edit theirs freely from the
 * account page), and we don't want stale faces sticking around in
 * sidebars / posts. Cheap to revalidate at homelab scale.
 */

import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { forumUsers } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,19}$/

export async function GET(_req: Request, context: { params: Promise<{ username: string }> }) {
  const { username } = await context.params
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ ok: false, error: 'Invalid username.' }, { status: 400 })
  }

  const rows = await db
    .select({ data: forumUsers.avatarData, mime: forumUsers.avatarMime })
    .from(forumUsers)
    .where(eq(forumUsers.username, username))
    .limit(1)
  const row = rows[0]
  if (!row || !row.data || !row.mime) {
    return NextResponse.json({ ok: false, error: 'No avatar.' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(row.data), {
    status: 200,
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'no-cache, must-revalidate',
    },
  })
}
