CREATE TABLE "promo_package_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"bonus_amount" bigint DEFAULT 0 NOT NULL,
	"bonus_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"goal" text NOT NULL,
	"target" integer NOT NULL,
	"period" text NOT NULL,
	"bonus_amount" bigint DEFAULT 0 NOT NULL,
	"bonus_minutes" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"announce" boolean DEFAULT true NOT NULL,
	"message" text,
	"show_in_portal" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promo_package_awards" ADD CONSTRAINT "promo_package_awards_package_id_promo_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."promo_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_package_awards" ADD CONSTRAINT "promo_package_awards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_package_awards_once" ON "promo_package_awards" USING btree ("package_id","customer_id","period_key");--> statement-breakpoint
CREATE INDEX "promo_package_awards_customer_idx" ON "promo_package_awards" USING btree ("customer_id");