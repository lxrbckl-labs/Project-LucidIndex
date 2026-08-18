CREATE TABLE IF NOT EXISTS "forum_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_comments_body_length" CHECK (char_length("forum_comments"."body") >= 1 AND char_length("forum_comments"."body") <= 5000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forum_post_topics" (
	"post_id" uuid NOT NULL,
	"topic_badge_id" uuid NOT NULL,
	CONSTRAINT "forum_post_topics_post_id_topic_badge_id_pk" PRIMARY KEY("post_id","topic_badge_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forum_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cover_image_hash" text,
	CONSTRAINT "forum_posts_title_length" CHECK (char_length("forum_posts"."title") >= 1 AND char_length("forum_posts"."title") <= 75),
	CONSTRAINT "forum_posts_body_length" CHECK (char_length("forum_posts"."body") >= 1 AND char_length("forum_posts"."body") <= 5000),
	CONSTRAINT "forum_posts_cover_image_hash_format" CHECK ("forum_posts"."cover_image_hash" IS NULL OR "forum_posts"."cover_image_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forum_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"max_topics_per_post" integer DEFAULT 3 NOT NULL,
	"max_images_per_post" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_settings_singleton_check" CHECK ("forum_settings"."id" = 1),
	CONSTRAINT "forum_settings_max_topics_range" CHECK ("forum_settings"."max_topics_per_post" >= 1 AND "forum_settings"."max_topics_per_post" <= 10),
	CONSTRAINT "forum_settings_max_images_range" CHECK ("forum_settings"."max_images_per_post" >= 0 AND "forum_settings"."max_images_per_post" <= 20)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "forum_comments" ADD CONSTRAINT "forum_comments_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "forum_comments" ADD CONSTRAINT "forum_comments_author_id_forum_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "forum_post_topics" ADD CONSTRAINT "forum_post_topics_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "forum_post_topics" ADD CONSTRAINT "forum_post_topics_topic_badge_id_topic_badges_id_fk" FOREIGN KEY ("topic_badge_id") REFERENCES "public"."topic_badges"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_forum_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
