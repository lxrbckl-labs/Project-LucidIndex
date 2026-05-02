/**
 * seed-citations — idempotent additive script.
 *
 * 1. Inserts ~10 realistic comparison sources (ON CONFLICT DO NOTHING on name)
 *    if the table is empty (or just ensures they exist via the conflict clause).
 * 2. For every article with citations = '[]'::jsonb, generates 2–5 plausible
 *    citations using @faker-js/faker and updates the row.
 * 3. Logs a summary at the end.
 *
 * Run: `pnpm db:seed-citations` from repo root.
 */

import { faker } from '@faker-js/faker'
import { eq, sql } from 'drizzle-orm'
import { db } from './client.js'
import { articles, comparisonSources } from './schema/index.js'

const SOURCES = [
  {
    name: 'Wikipedia',
    baseUrl: 'https://en.wikipedia.org',
    urlPattern: 'https://en.wikipedia.org/wiki/{slug}',
  },
  {
    name: 'Associated Press',
    baseUrl: 'https://apnews.com',
    urlPattern: 'https://apnews.com/article/{slug}',
  },
  {
    name: 'Reuters',
    baseUrl: 'https://www.reuters.com',
    urlPattern: 'https://www.reuters.com/world/{slug}',
  },
  {
    name: 'BBC News',
    baseUrl: 'https://www.bbc.com',
    urlPattern: 'https://www.bbc.com/news/{slug}',
  },
  {
    name: 'The New York Times',
    baseUrl: 'https://www.nytimes.com',
    urlPattern: 'https://www.nytimes.com/{year}/{month}/{slug}',
  },
  {
    name: 'The Guardian',
    baseUrl: 'https://www.theguardian.com',
    urlPattern: 'https://www.theguardian.com/world/{year}/{month}/{slug}',
  },
  { name: 'ArXiv', baseUrl: 'https://arxiv.org', urlPattern: 'https://arxiv.org/abs/{id}' },
  {
    name: 'Nature',
    baseUrl: 'https://www.nature.com',
    urlPattern: 'https://www.nature.com/articles/{slug}',
  },
  {
    name: 'Stack Overflow',
    baseUrl: 'https://stackoverflow.com',
    urlPattern: 'https://stackoverflow.com/questions/{id}',
  },
  { name: 'GitHub', baseUrl: 'https://github.com', urlPattern: 'https://github.com/{org}/{repo}' },
] as const

type CitationObj = {
  url: string
  title: string
  source_name: string
  accessed_at: string
  image_url: string
}

/**
 * Deterministic integer hash of a string — djb2 variant.
 * Returns a positive integer suitable for use as a picsum.photos seed.
 */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0 // keep as uint32
  }
  return h
}

function makeCitationUrl(source: (typeof SOURCES)[number]): string {
  const slug = faker.lorem.slug(3)
  const year = faker.date.between({ from: '2023-01-01', to: '2025-12-31' }).getFullYear()
  const month = String(faker.number.int({ min: 1, max: 12 })).padStart(2, '0')
  const id = faker.string.alphanumeric(8)
  const org = faker.internet.username().toLowerCase()
  const repo = faker.lorem.word()
  return source.urlPattern
    .replace('{slug}', slug)
    .replace('{year}', String(year))
    .replace('{month}', month)
    .replace('{id}', id)
    .replace('{org}', org)
    .replace('{repo}', repo)
}

function makeCitation(source: (typeof SOURCES)[number]): CitationObj {
  const url = makeCitationUrl(source)
  const seed = hashString(url)
  return {
    url,
    title: faker.lorem.sentence({ min: 5, max: 12 }),
    source_name: source.name,
    accessed_at: faker.date
      .between({ from: '2024-01-01', to: '2025-12-31' })
      .toISOString()
      .slice(0, 10),
    image_url: `https://picsum.photos/seed/${seed}/400/240`,
  }
}

async function seedComparisonSources(): Promise<number> {
  const values = SOURCES.map((s) => ({
    name: s.name,
    baseUrl: s.baseUrl,
    isActive: true,
  }))

  const inserted = await db
    .insert(comparisonSources)
    .values(values)
    .onConflictDoNothing({ target: comparisonSources.name })
    .returning({ id: comparisonSources.id })

  return inserted.length
}

async function seedArticleCitations(): Promise<number> {
  // Reseed all articles (overwrite any existing citations so image_url is added
  // even to rows that were previously seeded without it).
  await db.update(articles).set({ citations: sql`'[]'::jsonb` })

  const rows = await db.select({ id: articles.id }).from(articles)

  if (rows.length === 0) return 0

  // Build citations for each article.
  let updated = 0
  for (const row of rows) {
    const count = faker.number.int({ min: 2, max: 5 })
    const shuffled = faker.helpers.shuffle([...SOURCES])
    const picks = shuffled.slice(0, count)
    const citations: CitationObj[] = picks.map((s) => makeCitation(s))

    await db
      .update(articles)
      .set({ citations: sql`${JSON.stringify(citations)}::jsonb` })
      .where(eq(articles.id, row.id))

    updated++
  }
  return updated
}

async function run() {
  console.log('[seed-citations] Starting…')

  const sourcesInserted = await seedComparisonSources()
  console.log(
    `[seed-citations] comparison_sources: inserted ${sourcesInserted} new (existing skipped via ON CONFLICT)`,
  )

  const articlesUpdated = await seedArticleCitations()
  console.log(`[seed-citations] articles: updated citations on ${articlesUpdated} row(s)`)

  console.log('[seed-citations] Done.')
  process.exit(0)
}

run().catch((err) => {
  console.error('[seed-citations] Failed:', err)
  process.exit(1)
})
