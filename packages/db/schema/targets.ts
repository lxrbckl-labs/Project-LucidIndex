import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { agentTokens, promptTemplates } from './agent.js'

/**
 * What an agent watches: a creator handle, a feed, a website, etc.
 *
 * `cadence` is a free-form text field so we can carry either a named preset
 * (e.g. `daily`) or a cron expression — interpretation lives in the cron
 * sidecar's scheduler. `high_water_mark` is opaque jsonb (whatever the agent
 * chose to remember about its last successful pass; LucidIndex doesn't
 * inspect it).
 *
 * `last_run_status` is constrained via CHECK (not enum) for the same
 * future-proofing reason as `cron_runs.status`.
 *
 * `slug` — URL-safe identifier used in creator pages (`/c/<slug>`).
 * Added in Phase 6 #71 as a nullable column (migration `0003_target_slug`).
 * Lazy backfill: the get-or-set helper in the creator-page loader generates
 * the slug on first access and persists it, so existing rows are silently
 * migrated on their first page visit. The unique index on `slug` is used
 * for creator-page lookups.
 *
 * Trade-off: a nullable slug means we can't enforce NOT NULL at the DB
 * level without a backfill migration. We chose lazy over eager because
 * (a) no production data yet, and (b) the get-or-set pattern is
 * self-healing if the backfill is interrupted (e.g. in test teardowns).
 * Phase 7 can add a NOT NULL migration once all rows are filled.
 */
export const targets = pgTable(
  'targets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    label: text('label').notNull(),
    urlOrHandle: text('url_or_handle').notNull(),
    /**
     * URL-safe slug for creator pages. Nullable — generated lazily on
     * first access via `getOrSetTargetSlug()` in the creator-page loader.
     * Unique so `/c/<slug>` lookups resolve to exactly one creator.
     */
    slug: text('slug').unique(),
    cadence: text('cadence').notNull(),
    promptTemplateId: uuid('prompt_template_id')
      .notNull()
      .references(() => promptTemplates.id),
    active: boolean('active').notNull().default(true),
    highWaterMark: jsonb('high_water_mark'),
    lastRunStatus: text('last_run_status'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunFailureReason: text('last_run_failure_reason'),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }).notNull(),
    /**
     * #51 — pause/unpause HWM hard-reset (Round 6).
     *
     * Set to `true` by the targets PATCH/active endpoint when `active`
     * transitions from `false` → `true`. The cron sidecar's `hwm_reset` job
     * then clears `high_water_mark` and resets this flag back to `false` on
     * its next sweep, so the next agent run starts fresh from "now."
     *
     * Why a column flag instead of comparing `updated_at` to a remembered
     * last-sweep time: this is idempotent + self-healing. If the cron tick
     * is missed for any reason (sidecar restart, DB blip), the pending flag
     * survives and the next tick still processes it — no clock state to
     * reconcile.
     */
    hwmResetPending: boolean('hwm_reset_pending').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    check(
      'targets_last_run_status_check',
      sql`${t.lastRunStatus} is null or ${t.lastRunStatus} in ('succeeded', 'failed')`,
    ),
  ],
)

/**
 * The scheduler's working queue. Each row is a unit of work — the
 * scheduler enqueues, an agent claims via `mcp-store` (sets `claimed_by` +
 * `locked_until`), and acks on completion (sets `acked_at`).
 *
 * Per NO DELETIONS: acked rows are kept (soft archive only). The dead-lock
 * reaper finds rows where `acked_at IS NULL AND locked_until < now()` and
 * resets `claimed_by` / `locked_until` to put them back in play — a partial
 * index over `(locked_until)` filtered to `acked_at IS NULL` keeps that
 * query cheap as the table grows.
 */
export const queue = pgTable(
  'queue',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    targetId: uuid('target_id')
      .notNull()
      .references(() => targets.id),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().default(sql`now()`),
    claimedBy: uuid('claimed_by').references(() => agentTokens.id),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    priority: integer('priority').notNull().default(0),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
  },
  (t) => [
    index('queue_locked_until_unacked_idx').on(t.lockedUntil).where(sql`${t.ackedAt} is null`),
  ],
)

/**
 * Append-only log of every queue-item ack from an agent. One row per
 * completed (or failed) run. `articles_count` is 0 on failed runs.
 */
export const runLog = pgTable(
  'run_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    targetId: uuid('target_id')
      .notNull()
      .references(() => targets.id),
    queueItemId: uuid('queue_item_id')
      .notNull()
      .references(() => queue.id),
    agentTokenId: uuid('agent_token_id')
      .notNull()
      .references(() => agentTokens.id),
    status: text('status').notNull(),
    failureReason: text('failure_reason'),
    articlesCount: integer('articles_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('run_log_status_check', sql`${t.status} in ('succeeded', 'failed')`)],
)
