import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.EATER_MODEL || "claude-opus-5-5";
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
export async function askClaude({ system, content, schema, jsonHint }) {
  client ||= new Anthropic();
  const base = { model: MODEL, max_tokens: 16000, system, messages: [{ role: "user", content }] };
  const format = { type: "json_schema", schema };
  const attempts = [
    () => client.beta.messages.create({
      ...base,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format },
    }),
    () => client.messages.create({ ...base, output_config: { effort: "low", format } }),
    () => client.messages.create({
      ...base,
      messages: [{ role: "user", content: [...content, { type: "text", text: `\n\nJSON으로만 답해: ${jsonHint}` }] }],
      output_config: { effort: "low" },
    }),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn("claude: request rejected, trying a simpler one:", err.message);
      lastError = err;
    }
  }
  throw lastError;
}
