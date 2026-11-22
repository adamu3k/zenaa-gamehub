CREATE TABLE "social_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'custom' NOT NULL,
	"template" text DEFAULT 'news' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"news_url" text,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "social_media" ADD CONSTRAINT "social_media_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_media_created_idx" ON "social_media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "social_posts_status_idx" ON "social_posts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_news_url_idx" ON "social_posts" USING btree ("news_url");