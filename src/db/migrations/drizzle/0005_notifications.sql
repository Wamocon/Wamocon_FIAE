CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"link_url" text,
	"context" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- FKs
ALTER TABLE "notifications"
	ADD CONSTRAINT "notifications_user_id_fkey"
	FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;

ALTER TABLE "notifications"
	ADD CONSTRAINT "notifications_actor_id_fkey"
	FOREIGN KEY ("actor_id") REFERENCES "profiles"("id") ON DELETE SET NULL;
