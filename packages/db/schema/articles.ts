import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { agentTokens } from './agent.js'
import { runLog, targets } from './targets.js'

/**
 * Postgres `tsvector` column type. drizzle-orm 0.45.x has no first-class
 * tsvector helper, so we use customType to keep it migration-friendly.
 *
 * The actual contents are populated by a `GENERATED ALWAYS AS ... STORED`
 * expression declared on the column below — never written by application code.
 */
const tsvector = customType<{ data: string; default: false; notNull: true }>({
  dataType() {
    return 'tsvector'
  },
})

/**
 * Articles produced by agents via `mcp-store` `write_articles`. The dashboard,
 * article page, and creator page all read from here.
 *
 * Round-7 surfaces baked into the columns:
 * - `hidden` / `hidden_at` — admin-driven hide-from-everywhere toggle.
 * - `dashboard_visible` — flipped to false by the 14-day retention purge so
 *   the article rolls off the dashboard but stays accessible via share-link.
 * - `source_published_at_estimated` — when true, the agent fell back to its
 *   own run time as the publish date and the UI prefixes with "~".
 * - `tsvector` — generated column over `title || summary || agent_deep_dive`,
 *   indexed with GIN for FTS.
 *
 * Constraints:
 * - `(target_id, source_url)` unique — drives `mcp-store`'s dedup at write time.
 * - `significance` and `difficulty` constrained via CHECK (not enum) to keep
 *   future additions to a one-line migration.
 */
export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    targetId: uuid('target_id')
      .notNull()
      .references(() => targets.id),
    agentTokenId: uuid('agent_token_id')
      .notNull()
      .references(() => agentTokens.id),
    runLogId: uuid('run_log_id')
      .notNull()
      .references(() => runLog.id),
    sourceUrl: text('source_url').notNull(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    agentDeepDive: text('agent_deep_dive'),
    topicBadges: text('topic_badges').array().notNull(),
    significance: text('significance').notNull(),
    difficulty: text('difficulty').notNull(),
    reasonablenessRating: smallint('reasonableness_rating'),
    sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
    sourcePublishedAtEstimated: boolean('source_published_at_estimated').notNull().default(false),
    heroImageHash: text('hero_image_hash'),
    crossSource: jsonb('cross_source').notNull().default(sql`'[]'::jsonb`),
    hidden: boolean('hidden').notNull().default(false),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    dashboardVisible: boolean('dashboard_visible').notNull().default(true),
    starred: boolean('starred').notNull().default(false),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    tsvector: tsvector('tsvector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(agent_deep_dive, ''))`,
    ),
  },
  (t) => [
    unique('articles_target_id_source_url_unique').on(t.targetId, t.sourceUrl),
    check('articles_significance_check', sql`${t.significance} in ('small', 'medium', 'large')`),
    check('articles_difficulty_check', sql`${t.difficulty} in ('easy', 'medium', 'hard')`),
    index('articles_tsvector_gin_idx').using('gin', t.tsvector),
  ],
)

/**
 * Curated list of topic badges. `name` is case-sensitive ("AI" not "ai").
 * `color` is reserved for any future visual treatment; v0.1 uses a single
 * style for all badges per `[[Visual Identity]]`. `display_order` is for
 * explicit badge-row ordering — null = creation order.
 */
export const topicBadges = pgTable('topic_badges', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  color: text('color'),
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
})

/**
 * Inbox of unknown badge names that agents wrote. Deduped by `name` — when
 * the same unknown badge appears again, `count` is incremented and
 * `last_seen_at` is bumped. Settings → Badges shows these for bulk
 * approve/reject (Round 7).
 */
export const topicBadgeSuggestions = pgTable('topic_badge_suggestions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id),
  agentTokenId: uuid('agent_token_id')
    .notNull()
    .references(() => agentTokens.id),
  count: integer('count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(sql`now()`),
  resolved: boolean('resolved').notNull().default(false),
})
