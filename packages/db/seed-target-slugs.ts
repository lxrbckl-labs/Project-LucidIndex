/**
 * seed-target-slugs — idempotent backfill for `targets.slug`.
 *
 * For every target where `slug IS NULL OR slug = ''`, generates a
 * URL-safe slug from the target's `label`. If the naive slug already
 * exists in the DB (from a prior partial run), appends a 6-char random
 * hex suffix to avoid collisions on the unique index.
 *
 * Safe to run multiple times. On a fresh demo DB: ~68 rows updated,
 * 0 collisions. On a re-run: 0 rows touched.
 *
 * Usage:
 *   pnpm db:seed-target-slugs
 * or from repo root:
 *   pnpm --filter @lucidindex/db db:seed-target-slugs
 */

import { randomBytes } from 'node:crypto'
import { eq, isNull, or, sql } from 'drizzle-orm'
import { db } from './client.js'
import { targets } from './schema/index.js'

// ─── Slug helper ──────────────────────────────────────────────────────────────

/**
 * Build a URL-safe slug from an arbitrary label string.
 *
 *   - Lowercase
 *   - Strip diacritics (via NFD decomposition + strip combining marks)
 *   - Replace any run of non-alphanumeric chars with a single hyphen
 *   - Trim leading/trailing hyphens
 *   - Collapse repeated hyphens
 *   - Truncate to 80 chars max
 */
function slugifyLabel(label: string): string {
  const base = label
    .normalize('NFD')
    // Strip combining diacritical marks (e.g. é → e)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Strip curly + straight apostrophes before the punctuation pass
    .replace(/[''']/g, '')
    // Anything that isn't a-z / 0-9 collapses to a single hyphen
    .replace(/[^a-z0-9]+/g, '-')
    // Trim leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return base || 'creator'
}

function randomSuffix(): string {
  return randomBytes(3).toString('hex') // 6 hex chars
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[seed-target-slugs] Starting backfill…')

  // Load all targets that need a slug
  const pending = await db
    .select({ id: targets.id, label: targets.label })
    .from(targets)
    .where(or(isNull(targets.slug), eq(targets.slug, '')))

  if (pending.length === 0) {
    console.log('[seed-target-slugs] Nothing to do — all targets already have slugs.')
    return
  }

  console.log(`[seed-target-slugs] Found ${pending.length} targets without slugs.`)

  // Build the set of slugs that already exist (from rows that already have one)
  // so we can detect collisions upfront without extra round-trips per row.
  const existingRows = await db
    .select({ slug: targets.slug })
    .from(targets)
    .where(sql`slug IS NOT NULL AND slug != ''`)

  const usedSlugs = new Set(existingRows.map((r) => r.slug as string))

  let updated = 0
  let collisions = 0

  for (const row of pending) {
    let candidate = slugifyLabel(row.label)

    // Resolve collisions — append a random 6-hex suffix until unique
    while (usedSlugs.has(candidate)) {
      candidate = `${slugifyLabel(row.label)}-${randomSuffix()}`
      collisions++
    }

    usedSlugs.add(candidate)

    await db
      .update(targets)
      .set({ slug: candidate, updatedAt: new Date() })
      .where(eq(targets.id, row.id))

    updated++

    if (updated % 10 === 0) {
      process.stdout.write(`\r[seed-target-slugs] Updated ${updated}/${pending.length}…`)
    }
  }

  console.log(
    `\n[seed-target-slugs] Done. ${updated} targets updated, ${collisions} collision(s) resolved.`,
  )
}

main().catch((err) => {
  console.error('[seed-target-slugs] Fatal:', err)
  process.exit(1)
})
