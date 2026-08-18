// Integration-test helpers (audit round 9).
//
// Provides a `makeTestDb()` factory that connects to a separate
// Postgres database (`DATABASE_URL_TEST`, falling back to
// `DATABASE_URL` with `?database=lucidindex_test` appended) and a
// `truncateAllTables(db)` helper that resets every user table to
// pristine state between tests.
//
// Why a separate DB: the live dev DB has fixtures (seeded targets,
// admin accounts, demo content) that tests would either corrupt or
// have to work around. A throwaway DB lets tests assume "nothing
// here except what I just seeded", which is the simplest mental
// model for fixture-heavy integration tests.
//
// How to provision the test DB (one-time):
//
//   docker compose up -d postgres
//   docker compose exec postgres psql -U lucidindex -d postgres \
//     -c "CREATE DATABASE lucidindex_test;"
//   DATABASE_URL=postgres://lucidindex:lucidindex_dev@localhost:5432/lucidindex_test \
//     pnpm --filter @lucidindex/db db:migrate
//
// Or, in CI, point DATABASE_URL_TEST at whatever ephemeral instance
// the runner provisions and rerun the second command on every job.
//
// Truncation strategy: `TRUNCATE table1, table2, ... RESTART IDENTITY
// CASCADE`. One statement is faster than N rounds, RESTART IDENTITY
// resets serial sequences so primary key collisions don't accumulate
// across the suite, and CASCADE handles any FK that points into a
// truncated table.

import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

/** Drizzle-typed handle the helpers return. Same shape as
 *  `@lucidindex/db/client`'s exported `db`. */
export type TestDb = PostgresJsDatabase<typeof schema>

/**
 * Compute the connection string for the test DB.
 *
 *   1. If DATABASE_URL_TEST is set, use it verbatim — this is the
 *      production CI path.
 *   2. Else if DATABASE_URL is set, replace its database name with
 *      `lucidindex_test` and use that. This is the local-dev
 *      convenience path so you don't have to set two vars.
 *   3. Else throw — there's no sensible default.
 *
 * The URL is parsed via `URL` so the rest of the connection params
 * (user, password, host, port, query string) survive the rewrite.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL_TEST
  if (explicit && explicit.trim() !== '') return explicit
  const base = process.env.DATABASE_URL
  if (!base || base.trim() === '') {
    throw new Error(
      'Neither DATABASE_URL_TEST nor DATABASE_URL is set — integration tests need at least one.',
    )
  }
  // Rewrite the pathname (`/lucidindex` → `/lucidindex_test`). URL
  // construction is forgiving about trailing slashes; we strip the
  // leading `/` then prepend it back so the result is well-formed.
  const url = new URL(base)
  url.pathname = '/lucidindex_test'
  return url.toString()
}

/**
 * Construct a fresh Drizzle client against the test database. The
 * caller owns the lifecycle — call `await db.$client.end()` in
 * afterAll to release sockets.
 *
 * Pool size is intentionally tiny (`max: 3`) — integration tests
 * run sequentially within a file by default (vitest's default
 * concurrency is per-FILE not per-test) and the test database
 * doesn't need to handle parallel suites.
 */
export function makeTestDb(): TestDb {
  const url = resolveTestDatabaseUrl()
  const client = postgres(url, { max: 3, idle_timeout: 5, max_lifetime: 60 })
  return drizzle(client, { schema })
}

/**
 * Truncate every user table the test suite cares about. Ordering
 * doesn't matter because we issue a single `TRUNCATE ... CASCADE`
 * — Postgres handles the FK graph internally.
 *
 * Keep this list in sync with new tables. Forget one and tests will
 * start leaking state across files; the symptom is usually a unique
 * constraint violation in a test that worked in isolation.
 */
export async function truncateAllTables(db: TestDb): Promise<void> {
  // The list is alphabetical so adds are easy to spot in diffs. Don't
  // include `drizzle.__drizzle_migrations` — that table tracks the
  // migration state and truncating it would force every test to
  // re-run migrations.
  await db.execute(sql`
    TRUNCATE TABLE
      admins,
      agent_tokens,
      articles,
      auth_events,
      comparison_sources,
      credentials,
      cron_runs,
      dashboard_agent_invites,
      forum_agent_invites,
      forum_agent_tokens,
      forum_comment_citations,
      forum_comment_user_mentions,
      forum_comments,
      forum_credentials,
      forum_invites,
      forum_post_citations,
      forum_post_draft_citations,
      forum_post_draft_images,
      forum_post_draft_user_mentions,
      forum_post_drafts,
      forum_post_edits,
      forum_post_images,
      forum_post_stars,
      forum_post_topics,
      forum_post_user_mentions,
      forum_post_views,
      forum_posts,
      forum_settings,
      forum_users,
      notifications,
      prompt_templates,
      queue,
      recovery_codes,
      run_log,
      settings,
      targets,
      topic_badge_suggestions,
      topic_badges
    RESTART IDENTITY CASCADE
  `)
}
