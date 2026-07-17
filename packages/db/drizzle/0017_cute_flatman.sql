CREATE TYPE "public"."agent_aggressiveness" AS ENUM('relaxed', 'balanced', 'aggressive');--> statement-breakpoint
CREATE TABLE "agent_session_skills" (
	"session_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "agent_session_skills_session_id_skill_id_pk" PRIMARY KEY("session_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill_role_defaults" (
	"skill_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	CONSTRAINT "skill_role_defaults_skill_id_role_key_pk" PRIMARY KEY("skill_id","role_key")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DROP INDEX "agent_sessions_type_idx";--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "aggressiveness" "agent_aggressiveness" DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_skills" ADD CONSTRAINT "agent_session_skills_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_skills" ADD CONSTRAINT "agent_session_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_role_defaults" ADD CONSTRAINT "skill_role_defaults_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP COLUMN "agent_type";--> statement-breakpoint
DROP TYPE "public"."agent_type";