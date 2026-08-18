/**
 * POST /api/articles/by-ids — public.
 *
 * Returns card data for a set of article ids. Used by the client "starred
 * articles" views, which hold only ids in localStorage and need the cards to
 * render. Public (stars are a guest preference); the response exposes only the
 * same fields already shown on public dashboard tiles.
 *
 * Body: `{ ids: string[] }`  →  `{ ok: true, articles: Card[] }`
 */

import { NextResponse } from 'next/server'
import { loadArticlesByIds } from '@/app/starred/loader'

// DB-backed — must execute per-request.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const { ids } = body as { ids?: unknown }
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    const articles = await loadArticlesByIds(ids as string[])
    return NextResponse.json({ ok: true, articles })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
