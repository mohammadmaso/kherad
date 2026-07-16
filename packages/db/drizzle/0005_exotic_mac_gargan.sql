ALTER TABLE "bundles" ADD COLUMN "remote_url" text;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "remote_branch" text;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "remote_token_enc" text;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "remote_last_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "remote_last_pushed_oid" text;