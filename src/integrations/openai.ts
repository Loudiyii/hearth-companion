import OpenAI from "openai";

let cached: OpenAI | null = null;

/** Lazy so route modules can be evaluated at build time without keys. Falls back to OpenRouter when only that key is set. */
export function getOpenAI(): OpenAI {
  if (!cached) {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openaiKey && !openrouterKey) throw new Error("OPENAI_API_KEY (or OPENROUTER_API_KEY) is not set");
    cached = openaiKey
      ? new OpenAI({ apiKey: openaiKey })
      : new OpenAI({ apiKey: openrouterKey, baseURL: "https://openrouter.ai/api/v1" });
  }
  return cached;
}
