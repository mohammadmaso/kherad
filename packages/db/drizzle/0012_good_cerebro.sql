CREATE TABLE "ocr_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"model" text DEFAULT 'gpt-4o' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
