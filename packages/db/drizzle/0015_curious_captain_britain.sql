ALTER TYPE "public"."agent_type" ADD VALUE 'specialist';--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "role" text;