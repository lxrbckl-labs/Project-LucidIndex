/**
 * First-boot seeder.
 *
 * Today, this only inserts the 7 starter prompt templates from
 * `@lucidindex/templates`. The script is idempotent — re-running it on a
 * populated DB is a no-op, because the insert is `ON CONFLICT (slug) DO
 * NOTHING`.
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
import { promptTemplates } from './schema/index.js'

export async function seed(): Promise<{ promptTemplatesInserted: number }> {
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

  return { promptTemplatesInserted: inserted.length }
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
    .then(({ promptTemplatesInserted }) => {
      // Keep this terse — verbose logging is the orchestration layer's job.
      console.log(
        `[seed] prompt_templates: inserted ${promptTemplatesInserted} new (existing rows skipped via ON CONFLICT)`,
      )
      // The drizzle `postgres-js` client doesn't auto-close — exit cleanly.
      process.exit(0)
    })
    .catch((err) => {
      console.error('[seed] failed:', err)
      process.exit(1)
    })
}
