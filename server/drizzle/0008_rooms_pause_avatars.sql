ALTER TABLE "customers" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "avatar_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "pause_mode" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "room" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "vnc_config" jsonb;