CREATE TABLE "forum_agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "forum_users" ADD COLUMN "photo_set_reason" text;--> statement-breakpoint
ALTER TABLE "forum_users" ADD COLUMN "is_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forum_agent_tokens" ADD CONSTRAINT "forum_agent_tokens_user_id_forum_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."forum_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_agent_tokens" ADD CONSTRAINT "forum_agent_tokens_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;