CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"phone" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"device" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_outbox_status_idx" ON "sms_outbox" USING btree ("status","created_at");