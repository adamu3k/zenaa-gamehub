ALTER TYPE "public"."payment_kind" ADD VALUE 'cash_in';--> statement-breakpoint
ALTER TYPE "public"."payment_kind" ADD VALUE 'cash_out';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE 'payment';--> statement-breakpoint
ALTER TYPE "public"."session_event_type" ADD VALUE 'refund';--> statement-breakpoint
CREATE TABLE "happy_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"days" jsonb NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"discount_percent" integer NOT NULL,
	"category_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"percent_off" integer,
	"amount_off" bigint,
	"min_spend" bigint DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_of_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "happy_hour_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "promo_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "manual_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "refunded_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "on_tab" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD CONSTRAINT "happy_hours_category_id_station_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."station_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_happy_hour_id_happy_hours_id_fk" FOREIGN KEY ("happy_hour_id") REFERENCES "public"."happy_hours"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_staff_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_session_idx" ON "payments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "payments_shift_idx" ON "payments" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "payments_refund_of_idx" ON "payments" USING btree ("refund_of_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_staff" ON "shifts" USING btree ("staff_id") WHERE closed_at is null;