CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "embedding_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_embedding_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "page_embedding_chunks" ADD CONSTRAINT "page_embedding_chunks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_embedding_chunks_page_chunk_idx" ON "page_embedding_chunks" USING btree ("page_id","chunk_index");--> statement-breakpoint
CREATE INDEX "page_embedding_chunks_page_id_idx" ON "page_embedding_chunks" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "search_index_metadata_idx" ON "search_index" USING gin ("metadata");
