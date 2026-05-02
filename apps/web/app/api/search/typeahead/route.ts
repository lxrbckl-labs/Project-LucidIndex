/**
 * /api/search/typeahead — lightweight autocomplete endpoint.
 *
 *   GET ?q=<query>
 *
 * Returns up to 6 articles and up to 4 creators whose label/title matches
 * the query. Used by the TypeaheadSearch component in the TopNav to power
 * the spotlight-style dropdown. The full `/search` page endpoint is
 * unchanged.
 *
 * Response shape:
 *   {
 *     articles: TypeaheadArticle[],  // ≤ 6 results
 *     creators: TypeaheadCreator[]   // ≤ 4 results
 *   }
 *
 * Rules:
 *   - Empty / whitespace query → { articles: [], creators: [] } (no DB round-trip).
 *   - Queries shorter than 2 chars → { articles: [], creators: [] } (avoid noise).
 *   - Articles: dashboard_visible=true AND hidden=false, title ILIKE or FTS match.
 *   - Creators: active=true AND slug IS NOT NULL, label ILIKE match.
 *   - Both ordered sensibly (articles: newest first; creators: label asc).
 *
 * Auth: passkey-gated via `requireAdmin()`. 401 when missing.
 */

import { requireAdmin } from '@lucidindex/auth'
import { db } from '@lucidindex/db/client'
import { sql } from '@lucidindex/db/query'
import { NextResponse } from 'next/server'
import { mockArticles } from '@/app/_mock/articles'

export const dynamic = 'force-dynamic'

const ARTICLE_LIMIT = 6
const CREATOR_LIMIT = 4
const MIN_QUERY_LENGTH = 2
const MOCK_MODE = process.env.LUCIDINDEX_MOCK === '1'

export type TypeaheadArticle = {
  id: string
  slug: string
  title: string
  sourcePublishedAt: string | null
  creatorLabel: string | null
  heroImageHash: string | null
}

export type TypeaheadCreator = {
  id: string
  slug: string
  label: string
  sourceType: string
  articleCount: number
}

/**
 * @deprecated Use TypeaheadArticle instead. Kept for backwards compat
 * in case any consumer still reads the old `results` key — the API no
 * longer emits `results`, so this is informational only.
 */
export type TypeaheadResult = TypeaheadArticle

const EMPTY = { articles: [], creators: [] }

export async function GET(req: Request) {
  const session = await requireAdmin()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('q') ?? ''
  const query = raw.trim()

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(EMPTY)
  }

  if (MOCK_MODE) {
    const needle = query.toLowerCase()
    const articles: TypeaheadArticle[] = mockArticles
      .filter((a) => !a.hidden && a.dashboardVisible !== false)
      .filter((a) => a.title.toLowerCase().includes(needle))
      .slice(0, ARTICLE_LIMIT)
      .map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        sourcePublishedAt: a.publishedAt ?? null,
        creatorLabel: a.creatorLabel ?? null,
        // Mock heroImageUrl is a full URL like /i/<hash>; extract the hash.
        heroImageHash: a.heroImageUrl ? a.heroImageUrl.replace(/^\/i\//, '') : null,
      }))
    // No creator mock data — return empty creators in mock mode
    return NextResponse.json({ articles, creators: [] })
  }

  type ArticleRow = {
    id: string
    slug: string
    title: string
    source_published_at: string | null
    creator_label: string | null
    hero_image_hash: string | null
  }

  type CreatorRow = {
    id: string
    slug: string
    label: string
    source_type: string
    article_count: string
  }

  const [articleRows, creatorRows] = await Promise.all([
    db.execute<ArticleRow>(sql`
      SELECT
        a.id,
        a.slug,
        a.title,
        a.source_published_at::text AS source_published_at,
        t.label                     AS creator_label,
        a.hero_image_hash
      FROM articles a
      LEFT JOIN targets t ON t.id = a.target_id
      WHERE a.hidden            = false
        AND a.dashboard_visible = true
        AND (
          a.title ILIKE ${`%${query}%`}
          OR a.tsvector @@ plainto_tsquery('english', ${query})
        )
      ORDER BY a.source_published_at DESC NULLS LAST
      LIMIT ${ARTICLE_LIMIT}
    `),

    // source_type is the prompt_template slug (e.g. "newsletter", "youtube",
    // "blog") — the closest available proxy for the creator's source kind.
    db.execute<CreatorRow>(sql`
      SELECT
        t.id,
        t.slug,
        t.label,
        COALESCE(pt.slug, '') AS source_type,
        COUNT(a.id)::text     AS article_count
      FROM targets t
      LEFT JOIN prompt_templates pt ON pt.id = t.prompt_template_id
      LEFT JOIN articles a
        ON a.target_id = t.id
       AND a.hidden            = false
       AND a.dashboard_visible = true
      WHERE t.active = true
        AND t.slug   IS NOT NULL
        AND t.slug   != ''
        AND t.label  ILIKE ${`%${query}%`}
      GROUP BY t.id, t.slug, t.label, pt.slug
      ORDER BY t.label ASC
      LIMIT ${CREATOR_LIMIT}
    `),
  ])

  const articles: TypeaheadArticle[] = articleRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    sourcePublishedAt: r.source_published_at ?? null,
    creatorLabel: r.creator_label ?? null,
    heroImageHash: r.hero_image_hash ?? null,
  }))

  const creators: TypeaheadCreator[] = creatorRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    sourceType: r.source_type ?? '',
    articleCount: Number(r.article_count ?? 0),
  }))

  return NextResponse.json({ articles, creators })
}
