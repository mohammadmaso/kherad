CREATE TABLE "stt_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"model" text DEFAULT 'whisper-1' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
