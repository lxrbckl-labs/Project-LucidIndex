/**
 * First-boot seeder.
 *
 * Today this inserts:
 *   1. The 7 starter prompt templates from `@lucidindex/templates`.
 *   2. A starter set of reputable comparison sources (10 production-default
 *      rows). Citation source_name values agents emit reference this table;
 *      shipping a seed list means agents have something to cite from the
 *      moment the DB comes up (without seeding, `get_comparison_sources`
 *      returns [] on fresh installs and agents skip the cross-source step).
 *
 * The script is idempotent — re-running it on a populated DB is a no-op,
 * because each insert is `ON CONFLICT (<unique>) DO NOTHING`.
 *
 * Run modes:
 *   - From the repo root: `pnpm db:seed`
 *   - From the Phase 4 cron sidecar's first-boot hook: it'll spawn this
 *     script (or import `seed()` directly) before kicking the scheduler.
 *
 * As more first-boot data lands (default settings row, default
 * topic_badges palette, etc.), add them here behind the same idempotency
 * guarantee. The whole script must be safe to run on a populated DB.
 */

import { STARTER_TEMPLATES } from '@lucidindex/templates'
import { db } from './client.js'
import { comparisonSources, promptTemplates } from './schema/index.js'

/**
 * Starter comparison sources — reputable outlets agents are likely to
 * cite. Curated for breadth (general news, business, science, tech) and
 * provenance (each is a primary outlet with a stable base URL — no
 * aggregators). Admins can soft-deactivate any of these via Settings →
 * Comparison sources without losing existing citation references.
 */
const STARTER_COMPARISON_SOURCES: ReadonlyArray<{
  name: string
  baseUrl: string
  notes: string
}> = [
  {
    name: 'Reuters',
    baseUrl: 'https://www.reuters.com',
    notes: 'International wire service — fast, terse, primary-source-heavy.',
  },
  {
    name: 'Associated Press',
    baseUrl: 'https://apnews.com',
    notes: 'International wire service — neutral framing, broad coverage.',
  },
  {
    name: 'The New York Times',
    baseUrl: 'https://www.nytimes.com',
    notes: 'US daily newspaper — broad coverage, investigative reporting.',
  },
  {
    name: 'The Washington Post',
    baseUrl: 'https://www.washingtonpost.com',
    notes: 'US daily newspaper — strong politics + national-security desk.',
  },
  {
    name: 'The Guardian',
    baseUrl: 'https://www.theguardian.com',
    notes: 'UK daily — international coverage, long-form features.',
  },
  {
    name: 'Bloomberg',
    baseUrl: 'https://www.bloomberg.com',
    notes: 'Business + markets primary source.',
  },
  {
    name: 'Financial Times',
    baseUrl: 'https://www.ft.com',
    notes: 'Business + global markets, UK-anchored.',
  },
  {
    name: 'The Atlantic',
    baseUrl: 'https://www.theatlantic.com',
    notes: 'US long-form essays + cultural / political analysis.',
  },
  {
    name: 'Nature',
    baseUrl: 'https://www.nature.com',
    notes: 'Peer-reviewed science journal — primary research citations.',
  },
  {
    name: 'IEEE Spectrum',
    baseUrl: 'https://spectrum.ieee.org',
    notes: 'Engineering + applied-tech reporting, IEEE-backed.',
  },
]

export async function seedComparisonSources(): Promise<number> {
  const values = STARTER_COMPARISON_SOURCES.map((s) => ({
    name: s.name,
    baseUrl: s.baseUrl,
    notes: s.notes,
    isActive: true,
  }))

  // RETURNING { id } gives us a count of newly-seeded rows — rows skipped
  // by ON CONFLICT DO NOTHING are absent. Same idempotency strategy as
  // the prompt-templates insert below.
  const inserted = await db
    .insert(comparisonSources)
    .values(values)
    .onConflictDoNothing({ target: comparisonSources.name })
    .returning({ id: comparisonSources.id })

  return inserted.length
}

export async function seed(): Promise<{
  promptTemplatesInserted: number
  comparisonSourcesInserted: number
}> {
  const values = STARTER_TEMPLATES.map((t) => ({
    slug: t.slug,
    body: t.body,
    crossSourceN: t.cross_source_n,
  }))

  // `RETURNING id` only includes the rows the insert actually wrote — rows
  // skipped by `ON CONFLICT DO NOTHING` are absent. That gives us a cheap
  // count of "newly seeded this run" without a follow-up SELECT.
  const inserted = await db
    .insert(promptTemplates)
    .values(values)
    .onConflictDoNothing({ target: promptTemplates.slug })
    .returning({ id: promptTemplates.id })

  const comparisonSourcesInserted = await seedComparisonSources()

  return {
    promptTemplatesInserted: inserted.length,
    comparisonSourcesInserted,
  }
}

// Allow direct execution: `pnpm db:seed` resolves to this file via
// `tsx packages/db/seed.ts`. When imported as a module, the side-effect
// block below is a no-op because `import.meta.url` won't match argv[1].
const isDirectRun = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  // Compare resolved file paths so symlinks / pnpm shims don't confuse us.
  try {
    const url = new URL(`file://${entry}`).href
    return import.meta.url === url
  } catch {
    return false
  }
})()

if (isDirectRun) {
  seed()
    .then(({ promptTemplatesInserted, comparisonSourcesInserted }) => {
      // Keep this terse — verbose logging is the orchestration layer's job.
      console.log(
        `[seed] prompt_templates: inserted ${promptTemplatesInserted} new (existing rows skipped via ON CONFLICT)`,
      )
      console.log(
        `[seed] comparison_sources: inserted ${comparisonSourcesInserted} new (existing rows skipped via ON CONFLICT)`,
      )
      // The drizzle `postgres-js` client doesn't auto-close — exit cleanly.
      process.exit(0)
    })
    .catch((err) => {
      console.error('[seed] failed:', err)
      process.exit(1)
    })
}
