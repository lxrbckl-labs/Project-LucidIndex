CREATE TABLE "forum_post_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"cited_post_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_citations_post_seq_unique" UNIQUE("post_id","sequence_number"),
	CONSTRAINT "forum_post_citations_post_cited_unique" UNIQUE("post_id","cited_post_id"),
	CONSTRAINT "forum_post_citations_sequence_number_check" CHECK ("forum_post_citations"."sequence_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "forum_post_draft_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"cited_post_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_post_draft_citations_draft_seq_unique" UNIQUE("draft_id","sequence_number"),
	CONSTRAINT "forum_post_draft_citations_draft_cited_unique" UNIQUE("draft_id","cited_post_id"),
	CONSTRAINT "forum_post_draft_citations_sequence_number_check" CHECK ("forum_post_draft_citations"."sequence_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "forum_post_citations" ADD CONSTRAINT "forum_post_citations_post_id_forum_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_citations" ADD CONSTRAINT "forum_post_citations_cited_post_id_forum_posts_id_fk" FOREIGN KEY ("cited_post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_draft_citations" ADD CONSTRAINT "forum_post_draft_citations_draft_id_forum_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."forum_post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_post_draft_citations" ADD CONSTRAINT "forum_post_draft_citations_cited_post_id_forum_posts_id_fk" FOREIGN KEY ("cited_post_id") REFERENCES "public"."forum_posts"("id") ON DELETE restrict ON UPDATE no action;