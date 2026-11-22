CREATE TYPE "public"."momo_request_status" AS ENUM('pending', 'confirmed', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "momo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"network" text NOT NULL,
	"code" text NOT NULL,
	"txn_id" text,
	"payer_phone" text,
	"status" "momo_request_status" DEFAULT 'pending' NOT NULL,
	"confirmed_via" text,
	"confirmed_by" uuid,
	"sms_id" uuid,
	"payment_id" uuid,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "momo_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "momo_requests_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "momo_sms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender" text NOT NULL,
	"body" text NOT NULL,
	"amount" bigint,
	"txn_id" text,
	"reference" text,
	"payer_name" text,
	"payer_phone" text,
	"status" text DEFAULT 'unmatched' NOT NULL,
	"request_id" uuid,
	"device" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'news' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image" text,
	"link_url" text,
	"link_label" text,
	"event_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"publish_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"tournament_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "ea_id" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "online_how_to" text;--> statement-breakpoint
ALTER TABLE "match_requests" ADD COLUMN "lobby_code" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "lobby_code" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "counted_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "counted_momo" bigint;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "bypass_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "bypass_by" uuid;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "bypass_reason" text;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "console_host" text;--> statement-breakpoint
ALTER TABLE "momo_requests" ADD CONSTRAINT "momo_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momo_requests" ADD CONSTRAINT "momo_requests_confirmed_by_staff_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momo_requests" ADD CONSTRAINT "momo_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "momo_requests_status_idx" ON "momo_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "momo_sms_txn_idx" ON "momo_sms" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "momo_sms_received_idx" ON "momo_sms" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_pin_hash_unique" UNIQUE("pin_hash");--> statement-breakpoint
UPDATE "games" SET "online_how_to" = 'Online Friendlies (no codes in FC): 1) Add each other as PSN friends (or EA ID friends for cross-play). 2) Online Friendlies → New Friendly Season → pick your opponent → they accept the invite. Ultimate Team: Play → Friendlies → Play a Friend.' WHERE "name" ILIKE '%FC%' AND "online_how_to" IS NULL;--> statement-breakpoint
UPDATE "games" SET "online_how_to" = 'Friend Match: the host goes to Friend Match → Create 1 vs 1 Match Room, sets a password, and puts the Room ID + password in the lobby code. The opponent: Friend Match → search Room ID → enter the password.' WHERE "name" ILIKE '%eFootball%' AND "online_how_to" IS NULL;
