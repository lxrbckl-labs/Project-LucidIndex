-- 0033 — forum-side query-shape indexes (audit round 3 → graduating
-- to production-ready).
--
-- Five small btree indexes that back the existing query shapes the
-- mcp-forum sidecar already issues. None of these change the schema's
-- correctness story — every constraint that's load-bearing already
-- has an index behind it (PKs, UNIQUEs, FKs). These are pure
-- read-path accelerators for the access patterns the round-3 audit
-- flagged as currently doing seq-scans.
--
-- Why each index:
--
--   forum_post_topics_badge_idx (topic_badge_id, post_id)
--     `list_posts` accepts an optional `topic_badge_id` filter that
--     becomes an EXISTS subquery against forum_post_topics. The
--     composite PK on (post_id, topic_badge_id) only helps when
--     post_id leads the predicate — for a badge-only lookup,
--     Postgres falls back to a seq-scan. The (badge, post) order
--     here matches the filter direction.
--
--   forum_post_user_mentions_user_idx (mentioned_user_id)
--     "Show me what mentions @alice" — the existing UNIQUE on
--     (post_id, mentioned_user_id) is leading-post and can't be used
--     for a user-only lookup. Single-column index is the cheapest
--     accelerator.
--
--   forum_post_citations_post_idx (cited_post_id)
--     "Show me what cites Post X" — the UNIQUE on (post_id,
--     cited_post_id) leads with the citing post and can't service
--     the inverse lookup. Same pattern, same fix.
--
--   forum_comment_user_mentions_user_idx (mentioned_user_id)
--   forum_comment_citations_post_idx (cited_post_id)
--     Comment-side mirrors of the post-side mention / citation
--     indexes — same access patterns, same posture.
--
-- All five use `IF NOT EXISTS` so the migration is idempotent and
-- can be re-run on a partially-migrated DB without raising. None of
-- the underlying tables is hot enough that CREATE INDEX (the
-- non-concurrent form) is a problem — they finish in milliseconds
-- on every realistic forum size. If forum traffic grows enough to
-- need it, switch to `CREATE INDEX CONCURRENTLY` in a follow-up
-- migration; that path requires running outside a transaction
-- (drizzle-kit migrate wraps each file in BEGIN/COMMIT, so it'd
-- need a hand-rolled execution path).
--
-- Drizzle schema is updated in lockstep (packages/db/schema/forum.ts)
-- so a future `drizzle-kit generate` against the current schema
-- doesn't think these indexes are missing and re-add them.

CREATE INDEX IF NOT EXISTS "forum_post_topics_badge_idx"
  ON "forum_post_topics" ("topic_badge_id", "post_id");

CREATE INDEX IF NOT EXISTS "forum_post_user_mentions_user_idx"
  ON "forum_post_user_mentions" ("mentioned_user_id");

CREATE INDEX IF NOT EXISTS "forum_post_citations_post_idx"
  ON "forum_post_citations" ("cited_post_id");

CREATE INDEX IF NOT EXISTS "forum_comment_user_mentions_user_idx"
  ON "forum_comment_user_mentions" ("mentioned_user_id");

CREATE INDEX IF NOT EXISTS "forum_comment_citations_post_idx"
  ON "forum_comment_citations" ("cited_post_id");
