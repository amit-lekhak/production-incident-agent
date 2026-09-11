import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { sql } from "@/lib/db";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { ensureGeminiKey, geminiModel } from "./provider-config";
import { postmortemSchema, type PostmortemOutput } from "./schemas";

ensureGeminiKey();

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export async function writePostmortem(
  incidentId: string,
): Promise<PostmortemOutput> {
  const [incident] = await sql<
    {
      title: string;
      trigger_metric: string | null;
      suspect_deploy_sha: string | null;
    }[]
  >`
    SELECT title, trigger_metric, suspect_deploy_sha
    FROM incidents WHERE id = ${incidentId}::uuid
  `;
  const events = await sql<
    { kind: string; message: string; created_at: string }[]
  >`
    SELECT kind, message, created_at::text
    FROM incident_events WHERE incident_id = ${incidentId}::uuid
    ORDER BY created_at ASC
  `;
  const [rec] = await sql<
    {
      recommended_action: string;
      action_target: string;
      summary: string;
      confidence: number;
    }[]
  >`
    SELECT recommended_action, action_target, summary, confidence
    FROM recommendations WHERE incident_id = ${incidentId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;
  const [hyp] = await sql<{ cause_type: string; why: string }[]>`
    SELECT cause_type, why FROM hypotheses
    WHERE incident_id = ${incidentId}::uuid
    ORDER BY rank ASC LIMIT 1
  `;
  const [action] = await sql<
    { kind: string; target: string; status: string; result: unknown }[]
  >`
    SELECT kind, target, status, result FROM actions
    WHERE incident_id = ${incidentId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;

  const record = {
    incident,
    events,
    recommendation: rec,
    hypothesis: hyp,
    action,
  };

  let output: PostmortemOutput;
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  );

  if (hasKey) {
    const result = await generateText({
      model: google(geminiModel()),
      output: Output.object({ schema: postmortemSchema }),
      telemetry: {
        functionId: "postmortem-agent",
        metadata: { incidentId },
      },
      system: `You write postmortems ONLY from the provided incident record. Do not invent new investigation.`,
      prompt: `Write a postmortem from this record:\n${JSON.stringify(record, null, 2)}`,
    });
    if (!result.output) throw new Error("Postmortem agent returned nothing");
    output = result.output;
  } else {
    output = {
      title: `Postmortem: ${incident?.title ?? incidentId}`,
      summary: rec?.summary ?? "Incident resolved after approved action.",
      timeline: events.map((e) => ({
        at: e.created_at,
        event: `${e.kind}: ${e.message}`,
      })),
      root_cause: hyp?.why ?? "See incident record",
      impact: `Trigger ${incident?.trigger_metric ?? "n/a"}; deploy ${incident?.suspect_deploy_sha ?? "n/a"}`,
      resolution: `${action?.kind ?? rec?.recommended_action} ${action?.target ?? rec?.action_target} (${action?.status ?? "n/a"})`,
      action_items: [
        "Keep human approval before mutating deploys",
        "Add regression coverage for this fault class",
      ],
    };
  }

  await sql`
    INSERT INTO postmortems (
      incident_id, title, summary, timeline, root_cause, impact, resolution, action_items
    )
    VALUES (
      ${incidentId}::uuid,
      ${output.title},
      ${output.summary},
      ${jsonb(output.timeline)},
      ${output.root_cause},
      ${output.impact},
      ${output.resolution},
      ${jsonb(output.action_items)}
    )
    ON CONFLICT (incident_id) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      timeline = EXCLUDED.timeline,
      root_cause = EXCLUDED.root_cause,
      impact = EXCLUDED.impact,
      resolution = EXCLUDED.resolution,
      action_items = EXCLUDED.action_items
  `;

  await setIncidentStatus(incidentId, "resolved");
  await appendIncidentEvent({
    incidentId,
    kind: "resolved",
    message: "Postmortem written; incident resolved",
  });

  return output;
}
