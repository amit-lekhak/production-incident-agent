/** In-request span collector for honest telemetry (cleared after each checkout). */

export type CheckoutSpan = {
  name: string;
  durationMs: number;
  status: string;
  attrs?: Record<string, unknown>;
};

let current: CheckoutSpan[] = [];

export function pushSpan(span: CheckoutSpan) {
  current.push(span);
}

export function takeSpans(): CheckoutSpan[] {
  const out = current;
  current = [];
  return out;
}
