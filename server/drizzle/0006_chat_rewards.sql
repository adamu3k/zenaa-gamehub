CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"room" text NOT NULL,
	"customer_id" uuid,
	"staff_id" uuid,
	"body" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"reported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "reward_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"handle" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"platform" text,
	"url" text,
	"code" text,
	"bonus_amount" bigint DEFAULT 0 NOT NULL,
	"promo_code" text,
	"needs_approval" boolean DEFAULT true NOT NULL,
	"max_claims" integer,
	"claims_count" integer DEFAULT 0 NOT NULL,
	"valid_to" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "chat_muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "show_in_portal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_offer_id_reward_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."reward_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_claims" ADD CONSTRAINT "reward_claims_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_room_idx" ON "chat_messages" USING btree ("room","number");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_claims_once_idx" ON "reward_claims" USING btree ("offer_id","customer_id");--> statement-breakpoint
CREATE INDEX "reward_claims_status_idx" ON "reward_claims" USING btree ("status","created_at");