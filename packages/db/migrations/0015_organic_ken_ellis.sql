ALTER TABLE "forum_users" ADD COLUMN "avatar_data" "bytea";--> statement-breakpoint
ALTER TABLE "forum_users" ADD COLUMN "avatar_mime" text;--> statement-breakpoint
ALTER TABLE "forum_users" ADD COLUMN "photo_set_at" timestamp with time zone;