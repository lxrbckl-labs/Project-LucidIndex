CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"kind" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_events_kind_check" CHECK ("auth_events"."kind" in ('founding_claim', 'passkey_register', 'passkey_login', 'recovery_used', 'recovery_regenerated', 'admin_reset', 'failed_passkey_login', 'failed_founding_claim'))
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"body" text NOT NULL,
	"cross_source_n" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"strict_mode" boolean DEFAULT false NOT NULL,
	"new_article_badge_hours" integer DEFAULT 24 NOT NULL,
	"off_site_backup_remote" text,
	"off_site_backup_credentials_encrypted" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton_check" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"agent_token_id" uuid NOT NULL,
	"run_log_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"agent_deep_dive" text,
	"topic_badges" text[] NOT NULL,
	"significance" text NOT NULL,
	"difficulty" text NOT NULL,
	"reasonableness_rating" smallint,
	"source_published_at" timestamp with time zone,
	"source_published_at_estimated" boolean DEFAULT false NOT NULL,
	"hero_image_hash" text,
	"cross_source" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"dashboard_visible" boolean DEFAULT true NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsvector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(agent_deep_dive, ''))) STORED,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "articles_target_id_source_url_unique" UNIQUE("target_id","source_url"),
	CONSTRAINT "articles_significance_check" CHECK ("articles"."significance" in ('small', 'medium', 'large')),
	CONSTRAINT "articles_difficulty_check" CHECK ("articles"."difficulty" in ('easy', 'medium', 'hard'))
);
--> statement-breakpoint
CREATE TABLE "topic_badge_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"article_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"agent_token_id" uuid NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	CONSTRAINT "topic_badge_suggestions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "topic_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_badges_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" uuid,
	"locked_until" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"acked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"queue_item_id" uuid NOT NULL,
	"agent_token_id" uuid NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"articles_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_log_status_check" CHECK ("run_log"."status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"url_or_handle" text NOT NULL,
	"cadence" text NOT NULL,
	"prompt_template_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"high_water_mark" jsonb,
	"last_run_status" text,
	"last_run_at" timestamp with time zone,
	"last_run_failure_reason" text,
	"next_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "targets_last_run_status_check" CHECK ("targets"."last_run_status" is null or "targets"."last_run_status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_agent_token_id_agent_tokens_id_fk" FOREIGN KEY ("agent_token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_run_log_id_run_log_id_fk" FOREIGN KEY ("run_log_id") REFERENCES "public"."run_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_badge_suggestions" ADD CONSTRAINT "topic_badge_suggestions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_badge_suggestions" ADD CONSTRAINT "topic_badge_suggestions_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_badge_suggestions" ADD CONSTRAINT "topic_badge_suggestions_agent_token_id_agent_tokens_id_fk" FOREIGN KEY ("agent_token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue" ADD CONSTRAINT "queue_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue" ADD CONSTRAINT "queue_claimed_by_agent_tokens_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."agent_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_log" ADD CONSTRAINT "run_log_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_log" ADD CONSTRAINT "run_log_queue_item_id_queue_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_log" ADD CONSTRAINT "run_log_agent_token_id_agent_tokens_id_fk" FOREIGN KEY ("agent_token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_prompt_template_id_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_tsvector_gin_idx" ON "articles" USING gin ("tsvector");--> statement-breakpoint
CREATE INDEX "queue_locked_until_unacked_idx" ON "queue" USING btree ("locked_until") WHERE "queue"."acked_at" is null;