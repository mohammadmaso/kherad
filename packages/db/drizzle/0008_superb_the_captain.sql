CREATE TABLE "document_remote_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"url" text,
	"branch" text,
	"token_enc" text,
	"last_pushed_at" timestamp with time zone,
	"last_pushed_oid" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bundles" DROP COLUMN "remote_url";--> statement-breakpoint
ALTER TABLE "bundles" DROP COLUMN "remote_branch";--> statement-breakpoint
ALTER TABLE "bundles" DROP COLUMN "remote_token_enc";--> statement-breakpoint
ALTER TABLE "bundles" DROP COLUMN "remote_last_pushed_at";--> statement-breakpoint
ALTER TABLE "bundles" DROP COLUMN "remote_last_pushed_oid";