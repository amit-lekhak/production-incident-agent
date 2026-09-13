ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "pr_number" integer;
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "pr_url" text;
ALTER TABLE "recommendations" ADD COLUMN IF NOT EXISTS "pr_head_sha" varchar(40);
