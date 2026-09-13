ALTER TABLE "hypotheses" ADD COLUMN IF NOT EXISTS "headline" text;--> statement-breakpoint
UPDATE "hypotheses" SET "headline" = COALESCE(NULLIF(trim("headline"), ''), "why", "cause_type") WHERE "headline" IS NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ALTER COLUMN "headline" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ALTER COLUMN "cause_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "output_tokens" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"function_id" varchar(80) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_generations" ADD CONSTRAINT "llm_generations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generations_incident_idx" ON "llm_generations" USING btree ("incident_id");
