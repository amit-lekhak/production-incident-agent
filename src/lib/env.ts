import { z } from "zod";

const optionalNumber = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v == null || v === "") return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  GITHUB_REPO: z
    .string()
    .min(1, "GITHUB_REPO is required")
    .regex(/^[^/]+\/[^/]+$/, "GITHUB_REPO must be owner/repo"),
  GITHUB_DEPLOY_ENV: z.string().optional().default("production"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().optional().default("gemini-3.1-flash-lite"),
  LANGFUSE_SECRET_KEY: z.string().optional().default(""),
  LANGFUSE_PUBLIC_KEY: z.string().optional().default(""),
  LANGFUSE_HOST: z.string().optional().default("https://cloud.langfuse.com"),
  WATCHER_INTERVAL_MS: optionalNumber(5000),
  TICKER_INTERVAL_MS: optionalNumber(3000),
  LATENCY_P95_THRESHOLD_MS: optionalNumber(2000),
  ERROR_RATE_THRESHOLD: optionalNumber(0.05),
  DIAGNOSIS_MAX_RETRIES: optionalNumber(2),
  VERIFY_SAMPLES: optionalNumber(3),
  VERIFY_INTERVAL_MS: optionalNumber(1000),
  VERIFY_TIMEOUT_MS: optionalNumber(15_000),
  EVAL_AGENT_TIMEOUT_MS: optionalNumber(90_000),
  METRIC_RETENTION_HOURS: optionalNumber(6),
  DIAGNOSIS_MIN_CONFIDENCE: optionalNumber(60),
  AUTO_DIAGNOSE: z.string().optional().default("true"),
  PAGE_WEBHOOK_URL: z.string().optional().default(""),
  WATCHER_MIN_SAMPLES: optionalNumber(2),
  NODE_ENV: z.string().optional().default("development"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export function hasGeminiKey(env: AppEnv = getEnv()): boolean {
  return Boolean(env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function hasLangfuse(env: AppEnv = getEnv()): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}
