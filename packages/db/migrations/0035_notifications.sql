-- 0035 — forum notifications.
--
-- A single notifications table that surfaces three flavors of "someone
-- pinged me" into both the web UI (Settings → Notifications) and the
-- mcp-forum tool surface (list_my_notifications / mark_notification_read).
--
-- kinds:
--   - mentioned_in_post     — actor @-mentioned recipient in a top-level post body
--   - mentioned_in_comment  — actor @-mentioned recipient in a comment on some post
--   - reply_to_my_post      — actor replied to a post the recipient authored
--
-- FK posture: every FK is ON DELETE CASCADE. A notification only makes
-- sense in the context of its (recipient, source post, source comment,
-- actor) tuple; if any one of those identities is ever hard-purged the
-- notification disappears with them. This is the ONE place in the forum
-- schema where ON DELETE CASCADE is correct — every other forum table
-- uses ON DELETE RESTRICT to anchor audit trails, but a notification is
-- ephemeral UX state (like forum_post_stars), not a historical record.
--
-- Uniqueness: we want to coalesce duplicate notifications produced by
-- the same logical event (e.g., an agent that edits a comment and
-- re-mentions the same user shouldn't double-notify). Postgres unique
-- indexes treat NULL as "not equal to anything" — so a straight
-- UNIQUE(recipient, kind, source_post, source_comment, actor) wouldn't
-- catch duplicates for mentioned_in_post (source_comment_id is always
-- NULL there). Two partial unique indexes — one for the kind that has
-- source_comment_id NULL, one for the kinds that have it populated —
-- give us correct uniqueness in both branches without a COALESCE
-- expression-index dance, and let each branch be served by a
-- query-shape-appropriate btree.
--
-- Indexes:
--   - (recipient_user_id, created_at DESC) — backs the paginated list
--     (newest-first cursor pagination keyed on created_at).
--   - partial (recipient_user_id) WHERE read_at IS NULL — backs the
--     fast unread count (sidebar badge, /api/forum/notifications
--     "give me the count" path).
--   - two partial unique indexes (see above) — split on whether
--     source_comment_id is NULL.

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "source_post_id" uuid NOT NULL,
  "source_comment_id" uuid,
  "actor_user_id" uuid NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_kind_check" CHECK (
    "kind" IN ('mentioned_in_post', 'mentioned_in_comment', 'reply_to_my_post')
  )
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_forum_users_id_fk"
  FOREIGN KEY ("recipient_user_id") REFERENCES "public"."forum_users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_post_id_forum_posts_id_fk"
  FOREIGN KEY ("source_post_id") REFERENCES "public"."forum_posts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_comment_id_forum_comments_id_fk"
  FOREIGN KEY ("source_comment_id") REFERENCES "public"."forum_comments"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_forum_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."forum_users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx"
  ON "notifications" ("recipient_user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx"
  ON "notifications" ("recipient_user_id") WHERE "read_at" IS NULL;
--> statement-breakpoint
-- Coalesce duplicates within the source_comment_id IS NULL branch
-- (mentioned_in_post only).
CREATE UNIQUE INDEX "notifications_dedupe_post_unique"
  ON "notifications" ("recipient_user_id", "kind", "source_post_id", "actor_user_id")
  WHERE "source_comment_id" IS NULL;
--> statement-breakpoint
-- Coalesce duplicates within the source_comment_id NOT NULL branch
-- (mentioned_in_comment + reply_to_my_post).
CREATE UNIQUE INDEX "notifications_dedupe_comment_unique"
  ON "notifications" ("recipient_user_id", "kind", "source_post_id", "source_comment_id", "actor_user_id")
  WHERE "source_comment_id" IS NOT NULL;
