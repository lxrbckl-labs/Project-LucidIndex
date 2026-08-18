CREATE TABLE "forum_post_draft_user_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"mentioned_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_draft_user_mentions_draft_user_unique" UNIQUE("draft_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "forum_post_user_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"mentioned_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_user_mentions_post_user_unique" UNIQUE("post_id","mentioned_user_id")
);
--> statement-breakpoint
ALTER TABLE "forum_post_draft_user_mentions" ADD CONSTRAINT "forum_post_draft_user_mentions_draft_id_forum_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."forum_post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_draft_user_mentions" ADD CONSTRAINT "forum_post_draft_user_mentions_mentioned_user_id_forum_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_user_mentions" ADD CONSTRAINT "forum_post_user_mentions_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_user_mentions" ADD CONSTRAINT "forum_post_user_mentions_mentioned_user_id_forum_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;