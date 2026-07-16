CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."bundle_mode" AS ENUM('raw', 'llm_compiled');--> statement-breakpoint
CREATE TYPE "public"."indexer_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mr_scope" AS ENUM('wiki', 'okf');--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"provider" "ai_provider" DEFAULT 'anthropic' NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"indexer_model" text DEFAULT 'claude-opus-4-8' NOT NULL,
	"chat_model" text DEFAULT 'claude-sonnet-5' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"triggered_by_id" uuid NOT NULL,
	"status" "indexer_run_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"mr_id" uuid,
	"stats" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "mode" "bundle_mode" DEFAULT 'raw' NOT NULL;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD COLUMN "scope" "mr_scope" DEFAULT 'wiki' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexer_runs" ADD CONSTRAINT "indexer_runs_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexer_runs" ADD CONSTRAINT "indexer_runs_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexer_runs" ADD CONSTRAINT "indexer_runs_mr_id_merge_requests_id_fk" FOREIGN KEY ("mr_id") REFERENCES "public"."merge_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_threads_bundle_user_idx" ON "chat_threads" USING btree ("bundle_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "indexer_runs_bundle_idx" ON "indexer_runs" USING btree ("bundle_id","started_at");