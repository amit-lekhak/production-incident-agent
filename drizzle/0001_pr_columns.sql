ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "pr_number" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "pr_url" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "pr_head_sha" varchar(40);
