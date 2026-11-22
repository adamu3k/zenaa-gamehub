CREATE TYPE "public"."billing_type" AS ENUM('prepaid', 'postpaid');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('session', 'extension', 'sale', 'deposit', 'withdrawal', 'refund');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'bank_transfer', 'mobile_money', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."plan_kind" AS ENUM('time_rate', 'package');--> statement-breakpoint
CREATE TYPE "public"."session_event_type" AS ENUM('start', 'pause', 'resume', 'extend', 'end', 'warning', 'system_pause');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('running', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'manager', 'cashier');--> statement-breakpoint
CREATE TYPE "public"."station_platform" AS ENUM('ps5', 'ps4', 'xbox_series', 'xbox_one', 'nintendo_switch', 'pc', 'vr', 'racing_sim', 'other');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('active', 'maintenance', 'offline', 'archived');--> statement-breakpoint
CREATE TYPE "public"."wallet_tx_type" AS ENUM('deposit', 'withdrawal', 'charge', 'refund', 'adjustment', 'bonus');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"tier_id" uuid,
	"balance" bigint DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_number_unique" UNIQUE("number"),
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "membership_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"spend_per_point" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_tiers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" bigint NOT NULL,
	"session_id" uuid,
	"customer_id" uuid,
	"staff_id" uuid,
	"shift_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "pricing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"category_id" uuid,
	"rate_per_hour" bigint NOT NULL,
	"billing_unit_minutes" integer DEFAULT 1 NOT NULL,
	"minimum_minutes" integer DEFAULT 0 NOT NULL,
	"grace_minutes" integer DEFAULT 0 NOT NULL,
	"package_minutes" integer,
	"package_price" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"type" "session_event_type" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"seconds_added" integer,
	"amount" bigint,
	"staff_id" uuid,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"station_id" uuid NOT NULL,
	"customer_id" uuid,
	"plan_id" uuid NOT NULL,
	"rate" jsonb NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"billing_type" "billing_type" NOT NULL,
	"status" "session_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_resumed_at" timestamp with time zone,
	"accumulated_seconds" integer DEFAULT 0 NOT NULL,
	"allotted_seconds" integer,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"billed_minutes" integer DEFAULT 0 NOT NULL,
	"gross_amount" bigint DEFAULT 0 NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint DEFAULT 0 NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"group_id" uuid,
	"note" text,
	"started_by" uuid,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_float" bigint DEFAULT 0 NOT NULL,
	"expected_cash" bigint,
	"counted_cash" bigint,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"permissions" jsonb DEFAULT '{"grant":[],"revoke":[]}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "station_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"platform" "station_platform" DEFAULT 'ps5' NOT NULL,
	"category_id" uuid,
	"status" "station_status" DEFAULT 'active' NOT NULL,
	"hourly_rate_override" bigint,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"session_id" uuid,
	"payment_id" uuid,
	"staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tier_id_membership_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD CONSTRAINT "pricing_plans_category_id_station_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."station_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_plan_id_pricing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pricing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_started_by_staff_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_ended_by_staff_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_category_id_station_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."station_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_staff_idx" ON "audit_logs" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_events_session_idx" ON "session_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_open_per_station" ON "sessions" USING btree ("station_id") WHERE status <> 'ended';--> statement-breakpoint
CREATE INDEX "sessions_started_at_idx" ON "sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sessions_customer_idx" ON "sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "wallet_tx_customer_idx" ON "wallet_transactions" USING btree ("customer_id","created_at");