import { APICallError } from "ai";

export type ProviderErrorCode =
  | "auth"
  | "rpm"
  | "tpm"
  | "quota"
  | "context_overflow"
  | "timeout"
  | "transient"
  | "unknown";

export type ClassifiedError = {
  code: ProviderErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
  userMessage: string;
  raw: string;
};

export function isRetryableDiagnosisCode(code: ProviderErrorCode): boolean {
  return (
    code === "timeout" ||
    code === "transient" ||
    code === "rpm" ||
    code === "tpm"
  );
}

export function isHardFailCode(code: ProviderErrorCode): boolean {
  return code === "auth" || code === "quota";
}

function collectText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    parts.push(err.name);
  } else {
    parts.push(String(err));
  }
  if (APICallError.isInstance(err)) {
    if (err.responseBody) parts.push(err.responseBody);
    if (err.statusCode != null) parts.push(`status=${err.statusCode}`);
  }
  return parts.join("\n");
}

export function parseRetryAfterMs(
  message: string,
  headers?: Record<string, string> | undefined,
): number | null {
  if (headers) {
    const retryAfterMs = headers["retry-after-ms"];
    if (retryAfterMs) {
      const ms = parseFloat(retryAfterMs);
      if (!Number.isNaN(ms) && ms >= 0) return Math.ceil(ms);
    }
    const retryAfter = headers["retry-after"];
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!Number.isNaN(seconds) && seconds >= 0)
        return Math.ceil(seconds * 1000);
    }
  }
  const m = message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (m) return Math.ceil(Number(m[1]) * 1000) + 1000;
  return null;
}

function userMessageFor(
  code: ProviderErrorCode,
  retryAfterMs: number | null,
): string {
  const wait =
    retryAfterMs != null
      ? ` Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
      : "";
  switch (code) {
    case "auth":
      return "Gemini API key is invalid or expired. Check GEMINI_API_KEY.";
    case "rpm":
      return `Gemini request rate limit hit.${wait || " Try again shortly."}`;
    case "tpm":
      return `Gemini token rate limit hit.${wait || " Try again shortly."}`;
    case "quota":
      return "Gemini quota or billing limit reached.";
    case "context_overflow":
      return "Context too large for the model.";
    case "timeout":
      return "The model timed out. Please try again.";
    case "transient":
      return `The model is temporarily unavailable.${wait || " Please try again."}`;
    default:
      return "Something went wrong talking to the model.";
  }
}

export function classifyProviderError(err: unknown): ClassifiedError {
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  ) {
    return {
      code: "timeout",
      retryable: true,
      retryAfterMs: null,
      userMessage: userMessageFor("timeout", null),
      raw: String(err),
    };
  }

  const text = collectText(err);
  const statusCode = APICallError.isInstance(err) ? err.statusCode : undefined;
  const isRetryable = APICallError.isInstance(err)
    ? err.isRetryable
    : undefined;
  const headers = APICallError.isInstance(err)
    ? err.responseHeaders
    : undefined;
  const retryAfterMs = parseRetryAfterMs(text, headers);
  const lower = text.toLowerCase();
  const raw = text.slice(0, 2000);

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    /api[_-]?key[_-]?invalid|permission[_-]?denied|unauthenticated|invalid.?api.?key/i.test(
      text,
    )
  ) {
    return {
      code: "auth",
      retryable: false,
      retryAfterMs: null,
      userMessage: userMessageFor("auth", null),
      raw,
    };
  }

  if (/context.?length|maximum.?context|token.?count.*exceed/i.test(text)) {
    return {
      code: "context_overflow",
      retryable: false,
      retryAfterMs: null,
      userMessage: userMessageFor("context_overflow", null),
      raw,
    };
  }

  const is429 =
    statusCode === 429 ||
    /resource.?exhausted|rate[- ]?limit|too many requests/i.test(text);
  if (is429 || /quota/i.test(lower)) {
    const isTpm = /token_count|tokens?\s*per\s*min|tpm/i.test(text);
    const daily =
      /daily|billing|free_tier|exceeded your current quota/i.test(text) &&
      !/retry in/i.test(text) &&
      isRetryable === false;
    let code: ProviderErrorCode = isTpm ? "tpm" : daily ? "quota" : "rpm";
    const retryable = code === "rpm" || code === "tpm";
    const wait = retryAfterMs ?? (retryable ? 60_000 : null);
    return {
      code,
      retryable,
      retryAfterMs: retryable ? wait : null,
      userMessage: userMessageFor(code, retryable ? wait : null),
      raw,
    };
  }

  if (
    /aborterror|timed?\s*out|timeout|deadline.?exceeded/i.test(text) ||
    statusCode === 408
  ) {
    return {
      code: "timeout",
      retryable: true,
      retryAfterMs,
      userMessage: userMessageFor("timeout", retryAfterMs),
      raw,
    };
  }

  if (
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    /unavailable|overloaded|internal.?error|server.?error/i.test(text)
  ) {
    return {
      code: "transient",
      retryable: true,
      retryAfterMs,
      userMessage: userMessageFor("transient", retryAfterMs),
      raw,
    };
  }

  return {
    code: "unknown",
    retryable: Boolean(isRetryable),
    retryAfterMs,
    userMessage: userMessageFor("unknown", retryAfterMs),
    raw,
  };
}
