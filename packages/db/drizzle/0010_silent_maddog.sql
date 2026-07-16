CREATE TABLE "bundle_remote_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"url" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"token_enc" text,
	"last_pushed_at" timestamp with time zone,
	"last_pushed_oid" text,
	"last_pulled_at" timestamp with time zone,
	"last_pulled_oid" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bundle_remote_settings" ADD CONSTRAINT "bundle_remote_settings_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_remote_settings_bundle_idx" ON "bundle_remote_settings" USING btree ("bundle_id");