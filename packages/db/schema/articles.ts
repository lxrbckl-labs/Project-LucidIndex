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
 * One external citation attached to an article. Stored as a JSONB element
 * inside `articles.citations`. `source_name` mirrors a `comparison_sources.name`
 * value for display purposes (denormalized — the source may be renamed later
 * without breaking historical citations).
 */
export type ArticleCitation = {
  url: string
  title: string
  source_name: string
  accessed_at?: string
  image_url?: string | null
}

/**
 * Articles produced by agents via `mcp-dashboard` `write_articles`. The dashboard,
 * article page, and creator page all read from here.
 *
 * Round-7 surfaces baked into the columns:
 * - `hidden` / `hidden_at` — admin-driven hide-from-everywhere toggle.
 * - `dashboard_visible` — flipped to false by the 14-day retention purge so
 *   the article rolls off the dashboard but stays accessible via share-link.
 * - `tsvector` — generated column over `title || summary || agent_deep_dive`,
 *   indexed with GIN for FTS.
 *
 * Constraints:
 * - `(target_id, source_url)` unique — drives `mcp-dashboard`'s dedup at write time.
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
    /**
     * Bearish→bullish sentiment the agent assigns at write time.
     * -5 = strongly bearish, 0 = neutral, +5 = strongly bullish.
     * Aggregated per-author on /c/[slug] for a sentiment gauge.
     */
    sentiment: smallint('sentiment'),
    heroImageHash: text('hero_image_hash'),
    crossSource: jsonb('cross_source').notNull().default(sql`'[]'::jsonb`),
    citations: jsonb('citations').notNull().default(sql`'[]'::jsonb`),
    hidden: boolean('hidden').notNull().default(false),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    dashboardVisible: boolean('dashboard_visible').notNull().default(true),
    starred: boolean('starred').notNull().default(false),
    read: boolean('read').notNull().default(false),
    agentOpinion: text('agent_opinion'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    tsvector: tsvector('tsvector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(agent_deep_dive, ''))`,
    ),
  },
  (t) => [
    unique('articles_target_id_source_url_unique').on(t.targetId, t.sourceUrl),
    check('articles_significance_check', sql`${t.significance} in ('small', 'medium', 'large')`),
    check('articles_difficulty_check', sql`${t.difficulty} in ('easy', 'medium', 'hard')`),
    check(
      'articles_sentiment_check',
      sql`${t.sentiment} is null or (${t.sentiment} >= -5 and ${t.sentiment} <= 5)`,
    ),
    index('articles_tsvector_gin_idx').using('gin', t.tsvector),
    // Dedicated single-column index on source_url. The composite
    // `(target_id, source_url)` unique constraint can serve queries that
    // filter on target_id (or target_id + source_url), but not
    // `WHERE source_url = ?` on its own — Postgres can only use the leading
    // column. `check_article_exists` is cross-target so it needs this.
    index('articles_source_url_idx').on(t.sourceUrl),
  ],
)

/**
 * Curated list of topic badges. `name` is case-sensitive ("AI" not "ai").
 * `display_order` is for explicit badge-row ordering. `hidden` removes
 * the badge from the dashboard topic-filter without deleting it.
 */
export const topicBadges = pgTable('topic_badges', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  displayOrder: integer('display_order').notNull().default(0),
  hidden: boolean('hidden').notNull().default(false),
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
  // Nullable post-migration 0030. When EVERY article in a batch that
  // introduced an unknown badge was deduped, the suggestion is still
  // upserted with article_id = NULL so the curation inbox sees the
  // sighting. The FK is unchanged: when non-NULL, must point at a real
  // articles row.
  articleId: uuid('article_id').references(() => articles.id),
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
