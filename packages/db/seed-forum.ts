/**
 * Forum-side demo seeder.
 *
 * Spins up a populated forum surface so /forum/create, the citation
 * `@`-dropdown, the user-mention dropdown, and the post view all have
 * realistic content to interact with from a freshly-migrated DB.
 *
 * What it inserts:
 *   - 5 emulated human authors (is_agent=false): iris, wren, kai,
 *     priya, marcus. The usernames satisfy the forum_users CHECK regex
 *     `^[a-z][a-z0-9_-]{2,19}$`.
 *   - 75 forum_posts round-robin-distributed across the 5 authors,
 *     mirrored from the 75-most-recent `articles` rows. The article
 *     `title` is clamped to 75 chars and `summary` is clamped to 5000
 *     chars (matches the forum_settings caps shipped in migration 0019).
 *     Topic associations bridge over via name lookup against
 *     `topic_badges` so the posts surface as topic-tagged in the
 *     composer's @-dropdown Posts section.
 *
 * Idempotency:
 *   - Runs ONLY when no human (`is_agent=false`) forum_users exist.
 *     A populated forum DB skips with a friendly reason. The agent-side
 *     `forum_users` (is_agent=true) created via `forum_agent_invites`
 *     redemption do NOT count toward this check — agents and humans
 *     coexist in the same table.
 *   - Operators who want to re-seed must clear out the human forum_users
 *     (and any posts/drafts/mentions that reference them) first.
 *
 * Dependency:
 *   - Requires `articles` to be populated. The forum posts are mirrored
 *     from article summaries, so an empty `articles` table is a hard
 *     fail with a friendly error pointing at `pnpm db:seed-demo`.
 *
 * Determinism:
 *   - Round-robin assignment is keyed by `ROW_NUMBER() OVER (ORDER BY
 *     created_at DESC)`, so the same article set always lands on the
 *     same author. No faker / no randomness — the article corpus is
 *     already deterministic (seed-demo uses faker seed 42).
 *
 * Run modes:
 *   - From the repo root: `pnpm db:seed-forum`
 *   - After: `pnpm db:seed-demo` (which populates articles + topic_badges
 *     this seeder depends on).
 */

import { sql } from 'drizzle-orm'
import { db } from './client.js'

const AUTHORS = ['iris', 'wren', 'kai', 'priya', 'marcus'] as const
const POST_COUNT = 75

type SeedResult =
  | { skipped: true; reason: string }
  | {
      skipped: false
      inserted: {
        forumUsers: number
        forumPosts: number
        forumPostTopics: number
      }
    }

export async function seedForum(): Promise<SeedResult> {
  // Idempotency guard — refuse on a forum that already has human users.
  const humanCountRows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM forum_users WHERE is_agent = false`,
  )
  const humanCount = Number(humanCountRows[0]?.count ?? '0')
  if (humanCount > 0) {
    return {
      skipped: true,
      reason: `forum_users already has ${humanCount} human user(s) — refusing to seed`,
    }
  }

  // Dependency guard — articles is the source corpus for post bodies.
  const articleCountRows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM articles`,
  )
  const articleCount = Number(articleCountRows[0]?.count ?? '0')
  if (articleCount === 0) {
    throw new Error('forum seed requires articles to be populated — run `pnpm db:seed-demo` first')
  }

  // Insert the five authors. ON CONFLICT shouldn't fire — the
  // idempotency guard above already proved no human users exist — but
  // the unique constraint on `username` makes this safe under a race.
  await db.execute(sql`
    INSERT INTO forum_users (username, is_agent) VALUES
      ('iris',   false),
      ('wren',   false),
      ('kai',    false),
      ('priya',  false),
      ('marcus', false)
    ON CONFLICT (username) DO NOTHING
  `)

  // Round-robin assign the 75 most-recent articles → forum_posts.
  // ROW_NUMBER drives both the LIMIT and the modulo-5 author pick.
  // The single CTE keeps the assignment deterministic across reruns.
  const postsResult = await db.execute<{ id: string }>(sql`
    WITH ranked AS (
      SELECT
        a.title,
        a.summary,
        a.created_at,
        ROW_NUMBER() OVER (ORDER BY a.created_at DESC) AS rn
      FROM articles a
      ORDER BY a.created_at DESC
      LIMIT ${POST_COUNT}
    ),
    authors AS (
      SELECT id, username,
             ROW_NUMBER() OVER (ORDER BY username) AS au_rn
      FROM forum_users
      WHERE username IN ('iris','wren','kai','priya','marcus')
    ),
    assigned AS (
      SELECT
        r.title,
        r.summary,
        r.created_at,
        a.id AS author_id
      FROM ranked r
      JOIN authors a ON a.au_rn = ((r.rn - 1) % 5) + 1
    )
    INSERT INTO forum_posts (author_id, title, body, created_at)
    SELECT
      author_id,
      SUBSTRING(title FROM 1 FOR 75),
      SUBSTRING(summary FROM 1 FOR 5000),
      created_at
    FROM assigned
    RETURNING id
  `)
  const forumPostsInserted = postsResult.length

  // Bridge each post's article-side topic_badges (text[]) over to
  // forum_post_topics (uuid FKs) via name lookup. Articles that
  // reference a badge name that doesn't exist in topic_badges silently
  // drop that association — matches the previous demo-author shape.
  const topicsResult = await db.execute<{ post_id: string; topic_badge_id: string }>(sql`
    INSERT INTO forum_post_topics (post_id, topic_badge_id)
    SELECT DISTINCT fp.id, tb.id
    FROM forum_posts fp
    JOIN articles a ON a.title = fp.title AND a.created_at = fp.created_at
    JOIN LATERAL unnest(a.topic_badges) AS tname(name) ON true
    JOIN topic_badges tb ON tb.name = tname.name
    WHERE fp.author_id IN (
      SELECT id FROM forum_users
      WHERE username IN ('iris','wren','kai','priya','marcus')
    )
    ON CONFLICT DO NOTHING
    RETURNING post_id, topic_badge_id
  `)

  return {
    skipped: false,
    inserted: {
      forumUsers: AUTHORS.length,
      forumPosts: forumPostsInserted,
      forumPostTopics: topicsResult.length,
    },
  }
}

// ----------------------- Direct-run entrypoint -----------------------

const isDirectRun = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    const url = new URL(`file://${entry}`).href
    return import.meta.url === url
  } catch {
    return false
  }
})()

if (isDirectRun) {
  seedForum()
    .then((result) => {
      if (result.skipped) {
        console.log(`[seed-forum] skipped: ${result.reason}`)
      } else {
        console.log('[seed-forum] summary:', JSON.stringify(result.inserted, null, 2))
      }
      process.exit(0)
    })
    .catch((err) => {
      console.error('[seed-forum] failed:', err)
      process.exit(1)
    })
}
