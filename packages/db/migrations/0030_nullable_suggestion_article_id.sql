-- 0030 — `topic_badge_suggestions.article_id` becomes nullable (P2 / audit
-- round 3).
--
-- Background: when an unknown topic badge first appears, the dashboard MCP's
-- `write_articles` upserts a row into `topic_badge_suggestions` so the
-- curation inbox sees it. Until this migration the `article_id` was
-- NOT NULL, so if EVERY article in a batch that introduced a given unknown
-- badge was deduped, no suggestion row could be created — the badge sighting
-- was lost.
--
-- This migration relaxes the constraint so write_articles can upsert with
-- `article_id = NULL` when there is no genuinely-inserted article to
-- attribute the sighting to. Existing rows are unaffected (they keep their
-- non-NULL article_id).
--
-- The FK constraint remains in place (article_id, when set, must point at a
-- real articles row). Dropping NOT NULL does not alter the FK.

ALTER TABLE "topic_badge_suggestions"
  ALTER COLUMN "article_id" DROP NOT NULL;
