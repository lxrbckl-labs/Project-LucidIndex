CREATE TABLE "forum_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "forum_invites" ADD CONSTRAINT "forum_invites_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_invites" ADD CONSTRAINT "forum_invites_redeemed_by_user_id_forum_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."forum_users"("id") ON DELETE set null ON UPDATE no action;