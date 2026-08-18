// #72 — Retention purge.
//
// Schedule: daily at 03:00 (cron expression `0 3 * * *`).
//
// Two-phase sweep:
//
//   1. ROLL OFF DASHBOARD AT 6 DAYS
//      UPDATE articles SET dashboard_visible = false
//      WHERE dashboard_visible = true AND created_at < now() - interval '6 days'
//
//      The article still exists, is still searchable, and the share-link still
//      works — it just no longer appears on the / dashboard. This is a one-way
//      flip per the v0.1 spec: once an article rolls off, it stays off (it
//      doesn't get re-promoted to the dashboard if its created_at gets older).
//
//   2. DELETE AT 6 MONTHS (EXCEPT STARRED)
//      For each article older than 6 months with starred=false:
//        a. Delete the hero image files from disk (<MCP_IMAGE_DIR>/<hash>.webp
//           and <hash>.jpg). Missing files are graceful — see file-ops.ts.
//        b. DELETE the article row.
//      Starred articles persist indefinitely, regardless of age.
//
// HARD-RULE EXCEPTION (DOCUMENTED):
//   Project-Sardaukar's "NO DELETIONS" rule applies to agent actions on
//   behalf of human work. Retention-driven deletion of article rows + hero
//   image files is a DESIGNED system behavior per the v0.1 spec
//   (`[[Backend]]` § Retention). This is the one place v0.1 actually deletes
//   data. The behavior is bounded (only articles older than 6 months,
//   starred articles excluded) and scheduled (single daily tick), so it
//   cannot run away.
//
// Sequencing note (sequential, not single transaction):
//   We deliberately run the dashboard-roll-off and the 6-month delete as
//   TWO sequential statements rather than one big transaction. A single
//   transaction would be tidier, but a long-held lock on the entire
//   articles table is undesirable on a daily-growth dataset, and the two
//   phases are semantically independent — a partial failure (e.g. the
//   delete phase fails after the roll-off succeeds) is acceptable: the
//   roll-off is committed, and the next tick will retry the delete phase.
//
// Hero image deletion failures DO NOT block the DB delete. We log the
// failure count in the cron_runs details payload so an operator can spot
// orphaned image files; the article row is still removed (the source of
// truth is the DB row, not the disk file).

import { join, resolve } from 'node:path'
import { db } from '@lucidindex/db/client'
import { and, eq, inArray, sql } from '@lucidindex/db/query'
import { articles } from '@lucidindex/db/schema'
import env from '../env.js'
import { deleteFileIfExists } from '../lib/file-ops.js'
import { type JobDetails, runJob } from '../lib/run-job.js'

export async function runRetentionPurge(): Promise<void> {
  await runJob('retention_purge', async (): Promise<JobDetails> => {
    // Phase 1: roll off dashboard at 6 days.
    const rolledOff = await db
      .update(articles)
      .set({ dashboardVisible: false })
      .where(
        and(
          eq(articles.dashboardVisible, true),
          sql`${articles.createdAt} < now() - interval '6 days'`,
        ),
      )
      .returning({ id: articles.id })

    // Phase 2: delete unstarred articles older than 6 months.
    //
    // SELECT first so we have the hero_image_hash values to clean up on
    // disk. We could combine into a single DELETE ... RETURNING, but
    // splitting keeps the disk cleanup outside the (small) DELETE
    // transaction window, which avoids holding a row-level lock during
    // potentially-slow filesystem unlinks.
    const toDelete = await db
      .select({ id: articles.id, heroImageHash: articles.heroImageHash })
      .from(articles)
      .where(
        and(eq(articles.starred, false), sql`${articles.createdAt} < now() - interval '6 months'`),
      )

    let imageFilesDeleted = 0
    let imageDeleteErrors = 0
    const errorSamples: string[] = []

    if (toDelete.length > 0) {
      const imageDir = resolve(env.MCP_IMAGE_DIR)
      for (const article of toDelete) {
        if (!article.heroImageHash) continue
        // Each hash is stored as both .webp and .jpg (image-pipeline.ts).
        for (const ext of ['webp', 'jpg'] as const) {
          const path = join(imageDir, `${article.heroImageHash}.${ext}`)
          const result = await deleteFileIfExists(path)
          if (result.deleted) {
            imageFilesDeleted += 1
          } else if (result.reason && result.reason !== 'enoent') {
            // Non-missing failures (permissions, I/O, etc.) — count and
            // sample the first few for the cron_runs details payload.
            // Don't include the full path (could leak install layout to
            // logs / audit-trail consumers); the hash alone is enough to
            // grep for.
            imageDeleteErrors += 1
            if (errorSamples.length < 5) {
              errorSamples.push(`${article.heroImageHash}.${ext}: ${result.reason}`)
            }
          }
        }
      }

      // Now delete the DB rows. Done as a single statement (id IN (...))
      // — drizzle's inArray handles parameter binding safely.
      const ids = toDelete.map((a) => a.id)
      await db.delete(articles).where(inArray(articles.id, ids))
    }

    return {
      rolled_off: rolledOff.length,
      deleted: toDelete.length,
      image_files_deleted: imageFilesDeleted,
      image_delete_errors: imageDeleteErrors,
      ...(errorSamples.length > 0 ? { errors: errorSamples } : {}),
    }
  })
}
