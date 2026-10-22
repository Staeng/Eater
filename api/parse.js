import { checkPass } from "../lib/auth.js";
import { SYSTEM, OUTPUT_SCHEMA, buildUserText, resolveToday } from "../lib/prompt.js";
import { askClaude, readJson, Anthropic } from "../lib/claude.js";
import { enrichPlace } from "../lib/enrich.js";

const IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const JSON_HINT = '{"places":[{"name":"","link":"","reel":"","address":"","city":"","gu":"","dong":"","menus":[],"category":"","wantDate":null,"wantWhen":"","memo":""}]}';

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
    message = await askClaude({ system: SYSTEM, content, schema: OUTPUT_SCHEMA, jsonHint: JSON_HINT });
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

  await Promise.all(places.map(p => enrichPlace(p, memo).catch(err => console.warn("enrich:", err.message))));
  return res.status(200).json({ places, model: message.model });
}
