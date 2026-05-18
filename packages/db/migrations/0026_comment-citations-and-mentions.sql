CREATE TABLE "forum_comment_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"cited_post_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_comment_citations_comment_seq_unique" UNIQUE("comment_id","sequence_number"),
	CONSTRAINT "forum_comment_citations_comment_cited_unique" UNIQUE("comment_id","cited_post_id"),
	CONSTRAINT "forum_comment_citations_sequence_number_check" CHECK ("forum_comment_citations"."sequence_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "forum_comment_user_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"mentioned_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_comment_user_mentions_comment_user_unique" UNIQUE("comment_id","mentioned_user_id")
);
--> statement-breakpoint
ALTER TABLE "forum_comment_citations" ADD CONSTRAINT "forum_comment_citations_comment_id_forum_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."forum_comments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comment_citations" ADD CONSTRAINT "forum_comment_citations_cited_post_id_forum_posts_id_fk" FOREIGN KEY ("cited_post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comment_user_mentions" ADD CONSTRAINT "forum_comment_user_mentions_comment_id_forum_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."forum_comments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_comment_user_mentions" ADD CONSTRAINT "forum_comment_user_mentions_mentioned_user_id_forum_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;