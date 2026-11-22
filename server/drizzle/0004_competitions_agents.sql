CREATE TYPE "public"."entry_status" AS ENUM('registered', 'active', 'eliminated', 'winner', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."match_request_status" AS ENUM('open', 'matched', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'pending_confirmation', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tournament_format" AS ENUM('knockout', 'league', 'groups_knockout');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('draft', 'registration', 'live', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"scoring" text DEFAULT 'goals' NOT NULL,
	"allow_draws" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "match_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"customer_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"mode" text DEFAULT 'venue' NOT NULL,
	"skill" text DEFAULT 'any' NOT NULL,
	"preferred_at" timestamp with time zone,
	"note" text,
	"target_customer_id" uuid,
	"status" "match_request_status" DEFAULT 'open' NOT NULL,
	"opponent_id" uuid,
	"match_id" uuid,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"game_id" uuid NOT NULL,
	"tournament_id" uuid,
	"stage" text DEFAULT 'friendly' NOT NULL,
	"round" integer,
	"group_name" text,
	"bracket_slot" integer,
	"home_id" uuid,
	"away_id" uuid,
	"home_score" integer,
	"away_score" integer,
	"home_pens" integer,
	"away_pens" integer,
	"winner_id" uuid,
	"walkover" boolean DEFAULT false NOT NULL,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"reported_by" uuid,
	"recorded_by" uuid,
	"station_id" uuid,
	"match_request_id" uuid,
	"scheduled_at" timestamp with time zone,
	"played_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"seed" integer,
	"group_name" text,
	"status" "entry_status" DEFAULT 'registered' NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"paid_note" text,
	"final_place" integer,
	"prize_amount" bigint,
	"prize_paid_at" timestamp with time zone,
	"prize_paid_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"name" text NOT NULL,
	"game_id" uuid NOT NULL,
	"format" "tournament_format" NOT NULL,
	"status" "tournament_status" DEFAULT 'draft' NOT NULL,
	"max_players" integer DEFAULT 16 NOT NULL,
	"group_count" integer DEFAULT 1 NOT NULL,
	"advance_per_group" integer DEFAULT 2 NOT NULL,
	"double_round_robin" boolean DEFAULT false NOT NULL,
	"third_place_match" boolean DEFAULT false NOT NULL,
	"points_win" integer DEFAULT 3 NOT NULL,
	"points_draw" integer DEFAULT 1 NOT NULL,
	"entry_fee" bigint DEFAULT 0 NOT NULL,
	"prizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_registration" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"description" text,
	"rules" text,
	"champion_id" uuid,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "gamertag" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "psn_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "leaderboard_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "agent_token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "agent_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "agent_info" jsonb;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "screen_message" jsonb;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_requests" ADD CONSTRAINT "match_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_requests" ADD CONSTRAINT "match_requests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_requests" ADD CONSTRAINT "match_requests_target_customer_id_customers_id_fk" FOREIGN KEY ("target_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_requests" ADD CONSTRAINT "match_requests_opponent_id_customers_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_requests" ADD CONSTRAINT "match_requests_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_requests" ADD CONSTRAINT "match_requests_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_id_customers_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_id_customers_id_fk" FOREIGN KEY ("away_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_customers_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_reported_by_customers_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_champion_id_customers_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_requests_status_idx" ON "match_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "matches_played_idx" ON "matches" USING btree ("game_id","played_at");--> statement-breakpoint
CREATE INDEX "matches_tournament_idx" ON "matches" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "matches_home_idx" ON "matches" USING btree ("home_id");--> statement-breakpoint
CREATE INDEX "matches_away_idx" ON "matches" USING btree ("away_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_entries_unique" ON "tournament_entries" USING btree ("tournament_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_gamertag_idx" ON "customers" USING btree (lower("gamertag"));--> statement-breakpoint
INSERT INTO "games" ("name", "short_name", "scoring", "allow_draws", "sort_order") VALUES
  ('EA SPORTS FC', 'FC', 'goals', true, 1),
  ('eFootball', 'eFootball', 'goals', true, 2),
  ('Mortal Kombat', 'MK', 'rounds', false, 3),
  ('Tekken', 'Tekken', 'rounds', false, 4),
  ('NBA 2K', '2K', 'points', false, 5)
ON CONFLICT DO NOTHING;
