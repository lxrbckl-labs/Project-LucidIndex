CREATE TABLE "dashboard_agent_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_by_admin_id" uuid,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_token_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_agent_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "forum_agent_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"label" text NOT NULL,
	"agent_username" text NOT NULL,
	"created_by_admin_id" uuid,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_token_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_agent_invites_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "forum_agent_invites_agent_username_check" CHECK ("forum_agent_invites"."agent_username" ~ '^[a-z][a-z0-9_-]{2,19}$')
);
--> statement-breakpoint
ALTER TABLE "dashboard_agent_invites" ADD CONSTRAINT "dashboard_agent_invites_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_agent_invites" ADD CONSTRAINT "dashboard_agent_invites_redeemed_token_id_agent_tokens_id_fk" FOREIGN KEY ("redeemed_token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_agent_invites" ADD CONSTRAINT "forum_agent_invites_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_agent_invites" ADD CONSTRAINT "forum_agent_invites_redeemed_token_id_forum_agent_tokens_id_fk" FOREIGN KEY ("redeemed_token_id") REFERENCES "public"."forum_agent_tokens"("id") ON DELETE set null ON UPDATE no action;