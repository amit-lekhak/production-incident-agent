/** Relative and local clock formatting — never dump raw GMT/ISO strings in the UI. */

export function parseTimestamp(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  // Postgres ::text often looks like "2026-09-13 09:34:01.123+00"
  const normalized = value.includes("T")
    ? value
    : value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return d;
}

/** Absolute local clock time for tooltips (no forced GMT label). */
export function formatLocalTime(
  value: string | Date | null | undefined,
): string {
  const d = parseTimestamp(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Relative time like "12 minutes ago". */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  now = new Date(),
): string {
  const d = parseTimestamp(value);
  if (!d) return "—";
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (abs < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 48) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 14) return rtf.format(diffDay, "day");
  return formatLocalTime(d);
}

/** Prefix helper: "Opened 12 minutes ago". */
export function formatOpenedAgo(
  value: string | Date | null | undefined,
): string {
  const rel = formatRelativeTime(value);
  if (rel === "—") return "Opened —";
  if (rel === "now" || rel.includes("ago") || rel.includes("in ")) {
    return rel.startsWith("in ") ? `Opens ${rel}` : `Opened ${rel}`;
  }
  return `Opened ${rel}`;
}
