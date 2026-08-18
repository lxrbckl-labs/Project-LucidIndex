CREATE TABLE "forum_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"device_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "forum_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_users_username_unique" UNIQUE("username"),
	CONSTRAINT "forum_users_username_check" CHECK ("forum_users"."username" ~ '^[a-z][a-z0-9_-]{2,19}$')
);
--> statement-breakpoint
ALTER TABLE "forum_credentials" ADD CONSTRAINT "forum_credentials_user_id_forum_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."forum_users"("id") ON DELETE cascade ON UPDATE no action;