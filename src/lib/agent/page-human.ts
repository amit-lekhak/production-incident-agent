/**
 * Optional webhook for page_human (Slack incoming webhook, PagerDuty Events API, etc.).
 * No OAuth — set PAGE_WEBHOOK_URL to a POST endpoint that accepts JSON.
 */
export async function pageHuman(input: {
  incidentId: string;
  title?: string;
  summary?: string;
  actionTarget?: string;
}): Promise<{ ok: boolean; delivered: boolean; detail: string }> {
  const url = process.env.PAGE_WEBHOOK_URL?.trim();
  if (!url) {
    return {
      ok: true,
      delivered: false,
      detail: "PAGE_WEBHOOK_URL unset — page noted locally only",
    };
  }

  const payload = {
    text: `Relay incident page: ${input.title ?? input.incidentId}`,
    incidentId: input.incidentId,
    title: input.title ?? null,
    summary: input.summary ?? null,
    target: input.actionTarget ?? "oncall",
    source: "relay-incident-agent",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        delivered: false,
        detail: `webhook HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { ok: true, delivered: true, detail: `webhook ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      delivered: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
