ALTER TABLE "articles" ADD COLUMN "sentiment" smallint;--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_sentiment_check" CHECK ("articles"."sentiment" is null or ("articles"."sentiment" >= -5 and "articles"."sentiment" <= 5));