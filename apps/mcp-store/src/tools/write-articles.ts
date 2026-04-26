// `write_articles` — insert article rows produced from a queue pull.
//
// STUB-quality implementation:
//   - Accepts any topic_badges[] without validation. TODO(#43) routes
//     unknown badges to topic_badge_suggestions.
//   - No dedup beyond the DB's UNIQUE(target_id, source_url) constraint.
//     Duplicates surface as a clean `duplicate_source_url` ToolError, not
//     a stack trace. TODO(#43) implements pre-insert dedup.
//   - hero_image_hash is left null. TODO(#45) does the fetch + sharp
//     pipeline and populates it.
//   - Slug is generated from title + date + a short random suffix. The
//     rich disambiguator-on-collision flow is Phase 6 #65 territory.
//
// The articles table requires a non-null run_log_id, but ack_queue_item
// won't run until after the agent finishes its pass. To bridge that gap we
// create an interim run_log row on the FIRST write_articles call for a
// queue item (status='succeeded' as a sentinel), and ack_queue_item then
// promotes the same row to its real terminal status with the final
// articles_count. See ack-queue-item.ts for the matching half.

import { randomBytes } from 'node:crypto'
import { db } from '@lucidindex/db/client'
import { articles, queue, runLog } from '@lucidindex/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ToolError } from './index.js'

const articleSchema = z.object({
  source_url: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  agent_deep_dive: z.string().optional(),
  topic_badges: z.array(z.string()).default([]),
  significance: z.enum(['small', 'medium', 'large']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  reasonableness_rating: z.number().int().min(0).max(10).optional(),
  source_published_at: z.string().datetime().optional(),
  source_published_at_estimated: z.boolean().optional(),
  cross_source: z.array(z.unknown()).optional(),
})

export const writeArticlesInputShape = {
  queue_item_id: z.string().uuid(),
  articles: z.array(articleSchema).min(1),
}

const writeArticlesArgs = z.object(writeArticlesInputShape)

export type WriteArticlesArgs = z.infer<typeof writeArticlesArgs> & {
  agentTokenId: string
}

export async function writeArticles(
  args: WriteArticlesArgs,
): Promise<{ accepted: number; ids: string[] }> {
  // Verify the queue row is currently claimed by this agent.
  const queueRows = await db
    .select({
      id: queue.id,
      targetId: queue.targetId,
      enqueuedAt: queue.enqueuedAt,
      claimedBy: queue.claimedBy,
      ackedAt: queue.ackedAt,
    })
    .from(queue)
    .where(eq(queue.id, args.queue_item_id))
    .limit(1)

  if (queueRows.length === 0) {
    throw new ToolError('queue_item_not_found', `Queue item ${args.queue_item_id} not found.`)
  }
  // biome-ignore lint/style/noNonNullAssertion: length-checked above
  const q = queueRows[0]!

  if (q.ackedAt !== null) {
    throw new ToolError('queue_item_already_acked', 'Queue item has already been acknowledged.')
  }
  if (q.claimedBy !== args.agentTokenId) {
    throw new ToolError(
      'queue_item_not_claimed_by_caller',
      'This queue item is claimed by a different agent.',
    )
  }

  // Find or create the interim run_log row. ack_queue_item will promote it.
  const existing = await db
    .select({ id: runLog.id })
    .from(runLog)
    .where(and(eq(runLog.queueItemId, q.id), eq(runLog.agentTokenId, args.agentTokenId)))
    .limit(1)

  let runLogId: string
  const now = new Date()
  if (existing.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length-checked above
    runLogId = existing[0]!.id
  } else {
    const inserted = await db
      .insert(runLog)
      .values({
        targetId: q.targetId,
        queueItemId: q.id,
        agentTokenId: args.agentTokenId,
        // Sentinel — ack_queue_item promotes this to its terminal value.
        status: 'succeeded',
        articlesCount: 0,
        startedAt: q.enqueuedAt,
        completedAt: now,
      })
      .returning({ id: runLog.id })
    // biome-ignore lint/style/noNonNullAssertion: just inserted one row
    runLogId = inserted[0]!.id
  }

  const acceptedIds: string[] = []

  for (const a of args.articles) {
    try {
      const slug = generateSlug(a.title)
      const inserted = await db
        .insert(articles)
        .values({
          targetId: q.targetId,
          agentTokenId: args.agentTokenId,
          runLogId,
          sourceUrl: a.source_url,
          slug,
          title: a.title,
          summary: a.summary,
          agentDeepDive: a.agent_deep_dive ?? null,
          // TODO(#43): validate against topic_badges; route unknowns to
          // topic_badge_suggestions instead of accepting raw.
          topicBadges: a.topic_badges,
          significance: a.significance,
          difficulty: a.difficulty,
          reasonablenessRating: a.reasonableness_rating ?? null,
          sourcePublishedAt: a.source_published_at ? new Date(a.source_published_at) : null,
          sourcePublishedAtEstimated: a.source_published_at_estimated ?? false,
          // TODO(#45): hero image fetch + sharp pipeline
          heroImageHash: null,
          // jsonb column — pass the array as-is; drizzle handles the cast.
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column
          crossSource: (a.cross_source ?? []) as any,
        })
        .returning({ id: articles.id })

      // biome-ignore lint/style/noNonNullAssertion: just inserted one row
      acceptedIds.push(inserted[0]!.id)
    } catch (err) {
      // The DB's UNIQUE(target_id, source_url) constraint surfaces as a
      // postgres error code 23505. Translate it to a clean ToolError so
      // callers can distinguish duplicates from real failures without
      // parsing stack traces.
      if (isUniqueViolation(err)) {
        throw new ToolError(
          'duplicate_source_url',
          `An article for source_url=${a.source_url} already exists for this target.`,
        )
      }
      throw err
    }
  }

  // Keep the run_log articles_count roughly in sync as we go (ack_queue_item
  // recomputes it definitively at finalization).
  await db
    .update(runLog)
    .set({ articlesCount: sql`${runLog.articlesCount} + ${acceptedIds.length}` })
    .where(eq(runLog.id, runLogId))

  return { accepted: acceptedIds.length, ids: acceptedIds }
}

/**
 * Slug = lowercase-kebab(title) + ISO date + 4-char random suffix. Random
 * suffix keeps slug uniqueness even if two articles land on the same day
 * with the same title — a rare but possible cross-target case. Phase 6 #65
 * will replace this with a smarter disambiguator.
 */
function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64)
  const date = new Date().toISOString().slice(0, 10)
  const suffix = randomBytes(3).toString('base64url').slice(0, 4)
  return `${base || 'article'}-${date}-${suffix}`
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === '23505'
}
