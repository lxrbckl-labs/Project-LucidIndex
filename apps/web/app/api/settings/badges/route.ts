/**
 * Curated topic-badge collection endpoints.
 *
 *   GET  /api/settings/badges  → list curated badges
 *   POST /api/settings/badges  → create a new badge { name }
 *
 * Both gated by `requireAdmin()` — no admin session, no access. Errors
 * are deliberately non-revealing: a duplicate name surfaces as a 409 with
 * a friendly message, not the raw Postgres CHECK / unique-constraint
 * payload.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { asc, sql } from '@lucidindex/db/query'
import { topicBadges } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

// Session-gated + DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

type CreateBody = {
  name?: unknown
}

function parseCreate(
  body: CreateBody,
): { ok: true; value: { name: string } } | { ok: false; error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, error: 'Name is required.' }
  if (name.length > 64) return { ok: false, error: 'Name must be 64 characters or fewer.' }
  return { ok: true, value: { name } }
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  const rows = await db
    .select()
    .from(topicBadges)
    .orderBy(asc(topicBadges.displayOrder), asc(topicBadges.createdAt))

  return NextResponse.json({ ok: true, badges: rows })
}

export async function POST(request: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  let body: CreateBody
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const parsed = parseCreate(body)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  try {
    const [created] = await db
      .insert(topicBadges)
      .values({
        name: parsed.value.name,
        displayOrder: sql`(SELECT COALESCE(MAX(display_order), -1) + 1 FROM topic_badges)`,
      })
      .returning()
    return NextResponse.json({ ok: true, badge: created }, { status: 201 })
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
  // postgres-js surfaces the SQLSTATE on `code`. 23505 = unique_violation.
  const code = (err as { code?: unknown }).code
  return code === '23505'
}
