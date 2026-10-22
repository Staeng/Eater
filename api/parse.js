import Anthropic from "@anthropic-ai/sdk";
import { checkPass } from "../lib/auth.js";
import { SYSTEM, OUTPUT_SCHEMA, buildUserText, resolveToday } from "../lib/prompt.js";
import { naverPlace, isNaverLink } from "../lib/naver.js";

const MODEL = process.env.EATER_MODEL || "claude-opus-5-5";
const IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

let client;

function readJson(message) {
  const text = message.content.filter(b => b.type === "text").map(b => b.text).join("");
  try { return JSON.parse(text); } catch { /* tolerate a sentence around the JSON */ }
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
}

async function askClaude(content) {
  client ||= new Anthropic();
  const base = { model: MODEL, max_tokens: 16000, system: SYSTEM, messages: [{ role: "user", content }] };
  const format = { type: "json_schema", schema: OUTPUT_SCHEMA };
  const jsonOnly = [...content, { type: "text", text: '\n\nJSON으로만 답해: {"places":[{"name":"","link":"","reel":"","address":"","city":"","gu":"","dong":"","menus":[],"category":"","budget":null,"budgetLabel":"","wantDate":null,"wantWhen":"","memo":""}]}' }];
  // Preferred request first; each later one drops a feature in case this account or model rejects it.
  const attempts = [
    () => client.beta.messages.create({
      ...base,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format },
    }),
    () => client.messages.create({ ...base, output_config: { effort: "low", format } }),
    () => client.messages.create({ ...base, messages: [{ role: "user", content: jsonOnly }], output_config: { effort: "low" } }),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn("parse: request rejected, trying a simpler one:", err.message);
      lastError = err;
    }
  }
  throw lastError;
}

export default async function handler(req, res) {
  if (!checkPass(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "no_key" });

  const body = req.body || {};
  const memo = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  const image = typeof body.image === "string" && body.image.length < 2_000_000 ? body.image.match(IMAGE) : null;
  if (!memo && !image) return res.status(400).json({ error: "empty" });

  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image[1], data: image[2] } });
  content.push({ type: "text", text: buildUserText(memo, resolveToday(body.today)) });

  let message;
  try {
    message = await askClaude(content);
  } catch (err) {
    console.error("parse:", err);
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "bad_key" });
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited" });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream" });
    return res.status(500).json({ error: "failed" });
  }

  if (message.stop_reason === "refusal") return res.status(422).json({ error: "refused" });

  let parsed;
  try { parsed = readJson(message); } catch { parsed = null; }
  const places = parsed && Array.isArray(parsed.places) ? parsed.places.slice(0, 10) : null;
  if (!places) return res.status(502).json({ error: "bad_output" });

  // Fill in name and photo from the Naver place page when the memo had a Naver link.
  await Promise.all(places.map(async p => {
    const link = typeof p.link === "string" ? p.link.trim() : "";
    if (!link || !memo.includes(link) || !isNaverLink(link)) return;
    const info = await naverPlace(link);
    if (!info) return;
    if (!p.name && info.name) p.name = info.name;
    if (info.image) p.photoUrl = info.image;
  }));

  return res.status(200).json({ places, model: message.model });
}
