/** Map GEMINI_API_KEY onto the env var the Google AI SDK reads. */
export function ensureGeminiKey() {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }
}

export function geminiModel() {
  return process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
}
