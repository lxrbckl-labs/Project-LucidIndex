-- Backfill display_order for any badges with NULL (or duplicate) so the
-- new NOT NULL constraint passes and drag-reorder has a stable starting state.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY display_order ASC NULLS LAST, created_at ASC) AS new_order
  FROM topic_badges
)
UPDATE topic_badges tb
SET display_order = o.new_order
FROM ordered o
WHERE tb.id = o.id;
--> statement-breakpoint
ALTER TABLE "topic_badges" ALTER COLUMN "display_order" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "topic_badges" ALTER COLUMN "display_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_badges" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;
