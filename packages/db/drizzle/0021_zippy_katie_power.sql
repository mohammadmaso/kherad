CREATE TABLE "mcp_user_auths" (
	"mcp_server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"oauth_tokens_enc" text,
	"oauth_token_expires_at" timestamp with time zone,
	"oauth_pending_state" text,
	"oauth_pending_verifier_enc" text,
	"oauth_pending_expires_at" timestamp with time zone,
	"oauth_return_to" text,
	"status" "mcp_server_status" DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_user_auths_mcp_server_id_user_id_pk" PRIMARY KEY("mcp_server_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_user_auths" ADD CONSTRAINT "mcp_user_auths_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_user_auths" ADD CONSTRAINT "mcp_user_auths_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;