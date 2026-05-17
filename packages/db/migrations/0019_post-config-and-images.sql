CREATE TABLE "forum_post_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"image_hash" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"mime" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_images_post_seq_unique" UNIQUE("post_id","sequence_number"),
	CONSTRAINT "forum_post_images_image_hash_format" CHECK ("forum_post_images"."image_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "forum_post_images_sequence_number_check" CHECK ("forum_post_images"."sequence_number" >= 1),
	CONSTRAINT "forum_post_images_mime_check" CHECK ("forum_post_images"."mime" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
ALTER TABLE "forum_posts" DROP CONSTRAINT IF EXISTS "forum_posts_title_length";--> statement-breakpoint
ALTER TABLE "forum_posts" DROP CONSTRAINT IF EXISTS "forum_posts_body_length";--> statement-breakpoint
ALTER TABLE "forum_settings" ADD COLUMN "max_title_chars" integer DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "forum_settings" ADD COLUMN "max_body_chars" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "forum_post_images" ADD CONSTRAINT "forum_post_images_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_images" ADD CONSTRAINT "forum_post_images_uploaded_by_user_id_forum_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_settings" ADD CONSTRAINT "forum_settings_max_title_chars_range" CHECK ("forum_settings"."max_title_chars" >= 1 AND "forum_settings"."max_title_chars" <= 500);--> statement-breakpoint
ALTER TABLE "forum_settings" ADD CONSTRAINT "forum_settings_max_body_chars_range" CHECK ("forum_settings"."max_body_chars" >= 1 AND "forum_settings"."max_body_chars" <= 100000);--> statement-breakpoint
INSERT INTO forum_settings (id, max_topics_per_post, max_images_per_post, max_title_chars, max_body_chars)
VALUES (1, 3, 3, 75, 5000)
ON CONFLICT (id) DO NOTHING;