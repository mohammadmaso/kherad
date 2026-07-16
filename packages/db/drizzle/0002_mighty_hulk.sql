ALTER TYPE "public"."merge_request_status" ADD VALUE 'conflict' BEFORE 'merged';--> statement-breakpoint
CREATE TABLE "mr_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mr_id" uuid NOT NULL,
	"path" text NOT NULL,
	"marker_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mr_conflicts" ADD CONSTRAINT "mr_conflicts_mr_id_merge_requests_id_fk" FOREIGN KEY ("mr_id") REFERENCES "public"."merge_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mr_conflicts_mr_path_idx" ON "mr_conflicts" USING btree ("mr_id","path");