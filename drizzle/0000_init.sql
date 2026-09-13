CREATE TABLE "actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"target" varchar(120) NOT NULL,
	"status" varchar(24) NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_faults" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"scenario" varchar(64) NOT NULL,
	"deploy_sha" varchar(40),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"injected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"metric" varchar(80) NOT NULL,
	"operator" varchar(8) NOT NULL,
	"threshold" double precision NOT NULL,
	"window_seconds" integer DEFAULT 60 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"sha" varchar(40) NOT NULL,
	"message" text NOT NULL,
	"author" varchar(120) NOT NULL,
	"files_changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"committed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_timings" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"query_name" varchar(120) NOT NULL,
	"duration_ms" integer NOT NULL,
	"rows" integer DEFAULT 1 NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"sha" varchar(40) NOT NULL,
	"version" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"summary" text,
	"deployed_at" timestamp with time zone NOT NULL,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "error_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"fingerprint" varchar(120) NOT NULL,
	"title" varchar(240) NOT NULL,
	"message" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"deploy_sha" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"key" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "hypotheses" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"cause_type" varchar(64) NOT NULL,
	"suspect_deploy" varchar(40),
	"supporting_tool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" integer NOT NULL,
	"alert_rule_id" integer,
	"title" varchar(240) NOT NULL,
	"status" varchar(40) NOT NULL,
	"severity" varchar(24) DEFAULT 'high' NOT NULL,
	"trigger_metric" varchar(80),
	"trigger_value" double precision,
	"suspect_deploy_sha" varchar(40),
	"langfuse_trace_id" varchar(80),
	"needs_human_reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"level" varchar(16) NOT NULL,
	"message" text NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"value" double precision NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postmortems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"summary" text NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"root_cause" text NOT NULL,
	"impact" text NOT NULL,
	"resolution" text NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postmortems_incident_id_unique" UNIQUE("incident_id")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"winning_hypothesis_id" integer,
	"confidence" integer NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_action" varchar(40) NOT NULL,
	"action_target" varchar(120) NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"recommendation_id" integer,
	"decision" varchar(32),
	"reviewer" varchar(80) DEFAULT 'oncall' NOT NULL,
	"note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" integer NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"root_span" varchar(120) NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" varchar(24) NOT NULL,
	"spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"traced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_faults" ADD CONSTRAINT "active_faults_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_timings" ADD CONSTRAINT "db_timings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_lines" ADD CONSTRAINT "log_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_winning_hypothesis_id_hypotheses_id_fk" FOREIGN KEY ("winning_hypothesis_id") REFERENCES "public"."hypotheses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commits_sha_idx" ON "commits" USING btree ("sha");--> statement-breakpoint
CREATE INDEX "db_timings_service_time_idx" ON "db_timings" USING btree ("service_id","sampled_at");--> statement-breakpoint
CREATE INDEX "deployments_service_idx" ON "deployments" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_sha_idx" ON "deployments" USING btree ("sha");--> statement-breakpoint
CREATE INDEX "error_events_service_idx" ON "error_events" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_service_key_idx" ON "feature_flags" USING btree ("service_id","key");--> statement-breakpoint
CREATE INDEX "incident_events_incident_idx" ON "incident_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_service_idx" ON "incidents" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "log_lines_service_time_idx" ON "log_lines" USING btree ("service_id","logged_at");--> statement-breakpoint
CREATE INDEX "metric_samples_name_time_idx" ON "metric_samples" USING btree ("name","sampled_at");--> statement-breakpoint
CREATE INDEX "metric_samples_service_time_idx" ON "metric_samples" USING btree ("service_id","sampled_at");--> statement-breakpoint
CREATE INDEX "traces_service_time_idx" ON "traces" USING btree ("service_id","traced_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_open_rule_uidx" ON "incidents" ("service_id","alert_rule_id") WHERE "alert_rule_id" IS NOT NULL AND "status" IN ('detected','investigating','awaiting_review','acting','verifying','needs_human');
