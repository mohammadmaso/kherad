CREATE TYPE "public"."agent_section_edit_status" AS ENUM('proposed', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."agent_session_mode" AS ENUM('create', 'edit');--> statement-breakpoint
CREATE TABLE "agent_section_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"section_id" text NOT NULL,
	"heading_text" text NOT NULL,
	"heading_level" integer NOT NULL,
	"order_index" integer NOT NULL,
	"base_markdown" text NOT NULL,
	"proposed_markdown" text NOT NULL,
	"base_html" text NOT NULL,
	"proposed_html" text NOT NULL,
	"status" "agent_section_edit_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "mode" "agent_session_mode" DEFAULT 'create' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "target_page_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "target_branch" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "target_snapshot_markdown" text;--> statement-breakpoint
ALTER TABLE "agent_section_edits" ADD CONSTRAINT "agent_section_edits_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_section_edits_session_idx" ON "agent_section_edits" USING btree ("session_id","section_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;