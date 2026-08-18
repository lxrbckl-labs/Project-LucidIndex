CREATE TABLE "forum_post_draft_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"image_hash" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"mime" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_draft_images_draft_seq_unique" UNIQUE("draft_id","sequence_number"),
	CONSTRAINT "forum_post_draft_images_image_hash_format" CHECK ("forum_post_draft_images"."image_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "forum_post_draft_images_sequence_number_check" CHECK ("forum_post_draft_images"."sequence_number" >= 1),
	CONSTRAINT "forum_post_draft_images_mime_check" CHECK ("forum_post_draft_images"."mime" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
CREATE TABLE "forum_post_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"topic_badge_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forum_settings" ALTER COLUMN "max_images_per_post" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "forum_post_draft_images" ADD CONSTRAINT "forum_post_draft_images_draft_id_forum_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."forum_post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_drafts" ADD CONSTRAINT "forum_post_drafts_author_id_forum_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."forum_users"("id") ON DELETE cascade ON UPDATE no action;