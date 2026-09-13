import { z } from "zod";

export const hypothesesSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        rank: z.number().int().min(1),
        /** Free-form root cause in one line — not a closed taxonomy. */
        headline: z.string().min(1),
        suspect_deploy: z.string().nullable(),
        supporting_tool_names: z.array(z.string()),
        why: z.string(),
      }),
    )
    .min(1)
    .max(5),
});

export const recommendationSchema = z.object({
  winning_hypothesis_rank: z.number().int().min(1),
  confidence_0_100: z.number().int().min(0).max(100),
  evidence: z.array(
    z.object({
      tool: z.string(),
      display: z.string(),
      supports: z.boolean(),
    }),
  ),
  recommended_action: z.enum([
    "revert_pr",
    "disable_flag",
    "restart",
    "watch",
    "page_human",
  ]),
  action_target: z.string(),
  summary: z.string(),
});

export const postmortemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  timeline: z.array(z.object({ at: z.string(), event: z.string() })),
  root_cause: z.string(),
  impact: z.string(),
  resolution: z.string(),
  action_items: z.array(z.string()),
});

export type HypothesesOutput = z.infer<typeof hypothesesSchema>;
export type RecommendationOutput = z.infer<typeof recommendationSchema>;
export type PostmortemOutput = z.infer<typeof postmortemSchema>;
