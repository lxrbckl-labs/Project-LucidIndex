ALTER TABLE "forum_invites" DROP CONSTRAINT "forum_invites_created_by_admin_id_admins_id_fk";
--> statement-breakpoint
ALTER TABLE "forum_invites" ALTER COLUMN "created_by_admin_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "forum_invites" ADD CONSTRAINT "forum_invites_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;