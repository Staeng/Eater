import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./usage.js";

// Sonnet judges dish photos and look-alike places much better than Haiku, at about 50원 a card
// instead of 4원; set EATER_MODEL (e.g. claude-haiku-5-5 or claude-opus-5-5) for another model.
export const MODEL = process.env.EATER_MODEL || "claude-sonnet-5-5";
export { Anthropic };

let client;

export function readJson(message) {
  const text = message.content.filter(b => b.type === "text").map(b => b.text).join("");
  try { return JSON.parse(text); } catch { /* tolerate a sentence around the JSON */ }
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
}

// One structured-output request. The preferred form goes first; each later one drops a feature
// (server-side fallbacks, then the JSON schema) in case this account or model rejects it.
// `effort` is how carefully the model thinks; `timeout` (ms) caps each request, without retries,
// so a slow answer still leaves the serverless function time to save the card.
export async function askClaude({ system, content, schema, jsonHint, effort = "low", timeout }) {
  client ||= new Anthropic();
  const base = { model: MODEL, max_tokens: 16000, system, messages: [{ role: "user", content }] };
  const format = { type: "json_schema", schema };
  const opts = timeout ? { timeout, maxRetries: 0 } : undefined;
  const attempts = [
    // server-side refusal fallbacks exist for Opus/Sonnet/Fable only, so Haiku skips this form
    !/haiku/.test(MODEL) && (() => client.beta.messages.create({
      ...base,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format },
    }, opts)),
    () => client.messages.create({ ...base, output_config: { effort, format } }, opts),
    () => client.messages.create({
      ...base,
      messages: [{ role: "user", content: [...content, { type: "text", text: `\n\nJSON으로만 답해: ${jsonHint}` }] }],
      output_config: { effort },
    }, opts),
  ].filter(Boolean);
  let lastError;
  for (const attempt of attempts) {
    try {
      const message = await attempt();
      await recordUsage(message);
      return message;
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn("claude: request rejected, trying a simpler one:", err.message);
      lastError = err;
    }
  }
  throw lastError;
}
