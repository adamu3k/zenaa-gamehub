CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."online_payment_status" AS ENUM('pending', 'success', 'failed', 'expired');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'paystack';--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"customer_id" uuid,
	"contact_name" text,
	"contact_phone" text,
	"station_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"session_id" uuid,
	"note" text,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "online_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"reference" text NOT NULL,
	"purpose" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"email" text NOT NULL,
	"status" "online_payment_status" DEFAULT 'pending' NOT NULL,
	"initiated_by" uuid,
	"authorization_url" text,
	"payment_id" uuid,
	"channel" text,
	"provider_data" jsonb,
	"failure_reason" text,
	"last_checked_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "activation_code_hash" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "activation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "power_driver" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "power_config" jsonb;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "power_state" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "power_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "power_error" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_initiated_by_staff_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_station_start_idx" ON "bookings" USING btree ("station_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "online_payments_status_idx" ON "online_payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "online_payments_customer_idx" ON "online_payments" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_role_id_staff_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."staff_roles"("id") ON DELETE no action ON UPDATE no action;