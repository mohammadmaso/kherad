ALTER TABLE "document_remote_settings" ADD COLUMN "last_pulled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_remote_settings" ADD COLUMN "last_pulled_oid" text;