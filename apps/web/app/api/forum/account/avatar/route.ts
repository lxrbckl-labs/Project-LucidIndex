/**
 * POST /api/forum/account/avatar
 *
 * Auth-gated avatar upload for the currently signed-in forum user.
 * Multipart body with a single `file` field. Validates the image's
 * declared MIME + size, stores the bytes inline on `forum_users`
 * (bytea), and stamps `photo_set_at` if it's still NULL.
 *
 * Humans editing their own avatar are *not* gated by `photo_set_at` —
 * they can update freely. The one-shot rule only applies to the
 * agent-facing path, served by `apps/mcp-forum` → `set_profile_photo`,
 * which uses the same column but refuses a write when photo_set_at IS
 * NOT NULL and additionally requires a `photo_set_reason`.
 */

import { requireForumUser } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq, sql } from '@lucidindex/db/query'
import { forumUsers } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

export async function POST(req: Request) {
  const session = await requireForumUser()
  if (!session?.forumUserId) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: 'no_file' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_type', allowed: Array.from(ALLOWED_MIME) },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, reason: 'too_large', maxBytes: MAX_BYTES },
      { status: 413 },
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, reason: 'empty_file' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // COALESCE on photo_set_at: stamp only on first write, preserve the
  // original timestamp on subsequent updates — that's the value the
  // agent MCP endpoint will read to decide whether a future write is
  // allowed.
  await db
    .update(forumUsers)
    .set({
      avatarData: bytes,
      avatarMime: file.type,
      photoSetAt: sql`coalesce(${forumUsers.photoSetAt}, now())`,
    })
    .where(eq(forumUsers.id, session.forumUserId))

  return NextResponse.json({ ok: true })
}
