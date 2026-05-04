/**
 * Bulk reorder endpoint for curated topic badges.
 *
 *   POST /api/settings/badges/reorder { ids: string[] }
 *
 * Writes display_order = index across the supplied id list in a single
 * transaction so dashboard pulls always see a consistent order.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { eq } from '@lucidindex/db/query'
import { topicBadges } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ReorderBody = { ids?: unknown }

export async function POST(request: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  let body: ReorderBody
  try {
    body = (await request.json()) as ReorderBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'ids must be a non-empty array.' },
      { status: 400 },
    )
  }
  if (!body.ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
    return NextResponse.json({ ok: false, error: 'ids must be uuids.' }, { status: 400 })
  }
  if (new Set(body.ids).size !== body.ids.length) {
    return NextResponse.json({ ok: false, error: 'ids must be unique.' }, { status: 400 })
  }

  const ids = body.ids as string[]

  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as string
      await tx.update(topicBadges).set({ displayOrder: i }).where(eq(topicBadges.id, id))
    }
  })

  return NextResponse.json({ ok: true })
}
