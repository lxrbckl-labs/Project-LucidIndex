/**
 * POST /api/settings/badges/suggestions/:id  body { action: 'approve' | 'reject' }
 *
 * Approve  → insert into `topic_badges` (using the suggestion's name) and
 *            mark the suggestion `resolved = true`. Both writes happen in
 *            a single transaction so a failed insert never strands a
 *            half-resolved suggestion.
 * Reject   → mark `resolved = true` with no badge insert. Idempotent —
 *            re-rejecting an already-resolved suggestion is a no-op 200.
 *
 * The "name already exists in topic_badges" race is handled by mapping
 * 23505 to a 409 with a friendly message; the suggestion is left
 * unresolved so the admin can re-decide (e.g. they may want to delete
 * one of the two duplicates, but per NO DELETIONS policy that's a future
 * conversation).
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { and, eq } from '@lucidindex/db/query'
import { topicBadgeSuggestions, topicBadges } from '@lucidindex/db/schema'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ResolveBody = { action?: unknown }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid suggestion id.' }, { status: 400 })
  }

  let body: ResolveBody
  try {
    body = (await request.json()) as ResolveBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { ok: false, error: "Action must be 'approve' or 'reject'." },
      { status: 400 },
    )
  }

  // Load the suggestion outside the txn so we can return a clean 404.
  const [suggestion] = await db
    .select()
    .from(topicBadgeSuggestions)
    .where(eq(topicBadgeSuggestions.id, id))
    .limit(1)

  if (!suggestion) {
    return NextResponse.json({ ok: false, error: 'Suggestion not found.' }, { status: 404 })
  }

  if (suggestion.resolved) {
    return NextResponse.json({ ok: true, alreadyResolved: true })
  }

  if (action === 'reject') {
    await db
      .update(topicBadgeSuggestions)
      .set({ resolved: true })
      .where(and(eq(topicBadgeSuggestions.id, id), eq(topicBadgeSuggestions.resolved, false)))
    return NextResponse.json({ ok: true, action: 'reject' })
  }

  // action === 'approve' — single transaction: insert badge AND mark resolved.
  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(topicBadges).values({ name: suggestion.name }).returning()
      await tx
        .update(topicBadgeSuggestions)
        .set({ resolved: true })
        .where(eq(topicBadgeSuggestions.id, id))
      return created
    })
    return NextResponse.json({ ok: true, action: 'approve', badge: result })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          ok: false,
          error: `A badge named "${suggestion.name}" already exists. Reject this suggestion if it's a duplicate.`,
        },
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
