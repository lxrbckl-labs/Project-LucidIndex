CREATE TABLE "forum_post_views" (
	"post_id" uuid NOT NULL,
	"viewer_user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_views_post_id_viewer_user_id_pk" PRIMARY KEY("post_id","viewer_user_id")
);
--> statement-breakpoint
ALTER TABLE "forum_post_views" ADD CONSTRAINT "forum_post_views_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_views" ADD CONSTRAINT "forum_post_views_viewer_user_id_forum_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."forum_users"("id") ON DELETE restrict ON UPDATE no action;