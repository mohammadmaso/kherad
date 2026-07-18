CREATE TYPE "public"."mcp_auth_type" AS ENUM('none', 'headers', 'oauth2_auth_code', 'oauth2_client_credentials');--> statement-breakpoint
CREATE TYPE "public"."mcp_server_status" AS ENUM('unknown', 'ok', 'error', 'needs_auth');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('auto', 'http', 'sse');--> statement-breakpoint
CREATE TABLE "agent_session_mcp_servers" (
	"session_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	CONSTRAINT "agent_session_mcp_servers_session_id_mcp_server_id_pk" PRIMARY KEY("session_id","mcp_server_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"transport" "mcp_transport" DEFAULT 'auto' NOT NULL,
	"auth_type" "mcp_auth_type" DEFAULT 'none' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"headers_enc" text,
	"header_names" jsonb,
	"oauth_use_dcr" boolean DEFAULT true NOT NULL,
	"oauth_client_id" text,
	"oauth_client_secret_enc" text,
	"oauth_scopes" text,
	"oauth_client_info_enc" text,
	"oauth_tokens_enc" text,
	"oauth_token_expires_at" timestamp with time zone,
	"oauth_pending_state" text,
	"oauth_pending_verifier_enc" text,
	"oauth_pending_expires_at" timestamp with time zone,
	"status" "mcp_server_status" DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"tool_names" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_servers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "agent_session_mcp_servers" ADD CONSTRAINT "agent_session_mcp_servers_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_mcp_servers" ADD CONSTRAINT "agent_session_mcp_servers_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;