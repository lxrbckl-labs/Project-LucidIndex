/**
 * Single-badge endpoint.
 *
 *   PATCH /api/settings/badges/:id → update name / color / displayOrder
 *
 * Per the v0.1 design (`topic_badges` has no `active` flag), there is no
 * delete endpoint — admins curate the list and live with what's there.
 * Surface the same friendly duplicate-name error as the create route.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { topicBadges } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

type PatchBody = {
  name?: unknown
  color?: unknown
  displayOrder?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PatchUpdate = {
  name?: string
  color?: string | null
  displayOrder?: number | null
}

function parsePatch(
  body: PatchBody,
): { ok: true; value: PatchUpdate } | { ok: false; error: string } {
  const update: PatchUpdate = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return { ok: false, error: 'Name must be a string.' }
    const name = body.name.trim()
    if (!name) return { ok: false, error: 'Name is required.' }
    if (name.length > 64) return { ok: false, error: 'Name must be 64 characters or fewer.' }
    update.name = name
  }

  if (body.color !== undefined) {
    if (body.color === null || body.color === '') {
      update.color = null
    } else {
      if (typeof body.color !== 'string') return { ok: false, error: 'Color must be a string.' }
      const c = body.color.trim()
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
        return { ok: false, error: 'Color must be a hex value like #112233 or #abc.' }
      }
      update.color = c
    }
  }

  if (body.displayOrder !== undefined) {
    if (body.displayOrder === null || body.displayOrder === '') {
      update.displayOrder = null
    } else {
      const n =
        typeof body.displayOrder === 'string' ? Number(body.displayOrder) : body.displayOrder
      if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
        return { ok: false, error: 'Display order must be an integer.' }
      }
      if (n < -2147483648 || n > 2147483647) {
        return { ok: false, error: 'Display order is out of range.' }
      }
      update.displayOrder = n
    }
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: 'No changes provided.' }
  }

  return { ok: true, value: update }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid badge id.' }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const parsed = parsePatch(body)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  try {
    const [updated] = await db
      .update(topicBadges)
      .set(parsed.value)
      .where(eq(topicBadges.id, id))
      .returning()
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'Badge not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, badge: updated })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { ok: false, error: 'A badge with that name already exists.' },
        { status: 409 },
      )
    }
    throw err
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === '23505'
}
