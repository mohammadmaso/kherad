CREATE TYPE "public"."page_source" AS ENUM('raw', 'okf');--> statement-breakpoint
DROP INDEX "pages_bundle_path_idx";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "source" "page_source" DEFAULT 'raw' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_bundle_source_path_idx" ON "pages" USING btree ("bundle_id","source","path");