/**
 * Dev-only test emitter for the SSE article bus (#60).
 *
 *   POST /api/events/test  body: { ...ArticleNewPayload }
 *
 * Gated to non-production via `NODE_ENV !== 'production'`. Outside dev
 * this route always returns 404 — the live SSE channel in production
 * is meant to receive events from the agent / mcp-dashboard pipeline (a
 * future ticket; see the TODO in `lib/sse/article-bus.ts`).
 *
 * Why this exists:
 *   - Manual smoke for the masonry's fade-in animation without
 *     standing up the full agent.
 *   - The Phase 5 visual gate (`LUCIDINDEX_MOCK=1`) doesn't have a DB
 *     either, so there's no real `articles` table to insert into.
 *
 * No auth gate intentionally — the route is unreachable in production.
 * A dev server is single-admin-localhost-only, so adding the auth
 * check here would just make manual `curl` testing more painful.
 */

import { NextResponse } from 'next/server'
import { type ArticleNewPayload, publish } from '@/lib/sse/article-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

function parsePayload(body: unknown): ArticleNewPayload | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>

  const stringField = (k: string): string | null =>
    typeof b[k] === 'string' && (b[k] as string).length > 0 ? (b[k] as string) : null

  const id = stringField('id')
  const slug = stringField('slug')
  const title = stringField('title')
  const summary = stringField('summary')
  const heroImageUrl = stringField('heroImageUrl')
  const agentLabel = stringField('agentLabel')
  const publishedLabel = stringField('publishedLabel')

  if (!id || !slug || !title || !summary || !heroImageUrl || !agentLabel || !publishedLabel) {
    return null
  }

  const significance = b.significance
  if (significance !== 'small' && significance !== 'medium' && significance !== 'large') {
    return null
  }

  const topicBadges = Array.isArray(b.topicBadges)
    ? b.topicBadges.filter((x): x is string => typeof x === 'string')
    : []

  const readMinutes = typeof b.readMinutes === 'number' ? b.readMinutes : 0
  const publishedEstimated = b.publishedEstimated === true

  return {
    id,
    slug,
    title,
    summary,
    topicBadges,
    significance,
    publishedLabel,
    publishedEstimated,
    heroImageUrl,
    agentLabel,
    readMinutes,
  }
}

export async function POST(request: Request) {
  if (isProd()) {
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const payload = parsePayload(body)
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: 'Missing or invalid article fields.' },
      { status: 400 },
    )
  }

  publish({ type: 'article:new', payload })
  return NextResponse.json({ ok: true })
}
