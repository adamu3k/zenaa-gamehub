CREATE TABLE "customer_time_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"seconds" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"session_id" uuid,
	"plan_name" text,
	"amount" bigint,
	"note" text,
	"staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "saved_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "from_saved_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "saved_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_time_log" ADD CONSTRAINT "customer_time_log_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_time_log" ADD CONSTRAINT "customer_time_log_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_time_log" ADD CONSTRAINT "customer_time_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_time_log_customer_idx" ON "customer_time_log" USING btree ("customer_id","created_at");