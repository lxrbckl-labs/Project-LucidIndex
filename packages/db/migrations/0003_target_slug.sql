-- Phase 6 #71 — creator pages.
-- Adds a nullable `slug` column to `targets` for `/c/<slug>` routing.
-- The column is intentionally nullable: existing rows are backfilled lazily
-- on first creator-page access via `getOrSetTargetSlug()`. Phase 7 can add
-- a NOT NULL constraint once all rows are guaranteed to carry a slug.
-- The unique index makes `/c/<slug>` lookups fast and enforces uniqueness.
ALTER TABLE "targets" ADD COLUMN "slug" text;
--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_slug_unique" UNIQUE("slug");
