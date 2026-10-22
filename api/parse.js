import Anthropic from "@anthropic-ai/sdk";
import { checkPass } from "../lib/auth.js";
import { SYSTEM, OUTPUT_SCHEMA, buildUserText, resolveToday } from "../lib/prompt.js";
import { naverMenuPhoto } from "../lib/naver.js";

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
  const jsonOnly = [...content, { type: "text", text: '\n\nJSON으로만 답해: {"places":[{"name":"","link":"","reel":"","address":"","city":"","gu":"","dong":"","menus":[],"category":"","wantDate":null,"wantWhen":"","memo":""}]}' }];
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

  // Attach a menu photo from Naver Place (via the memo's link, or a search by name + 동네).
  await Promise.all(places.map(async p => {
    const raw = typeof p.link === "string" ? p.link.trim() : "";
    const link = raw && memo.includes(raw) ? raw : "";
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!link && !name) return;
    const menus = Array.isArray(p.menus) ? p.menus.filter(m => typeof m === "string") : [];
    const info = await naverMenuPhoto({ link, name, where: [p.gu, p.dong].filter(v => typeof v === "string").join(" "), menus });
    if (!info) return;
    if (!name && info.name) p.name = info.name;
    if (!p.address && info.address) p.address = info.address;
    if (info.lat) { p.lat = info.lat; p.lng = info.lng; }
    p.placeId = info.placeId;
    if (info.link) p.naverLink = info.link;
    if (info.image) p.photoUrl = info.image;
    // memo's menus first, then the place's 대표 메뉴 (skipping near-duplicates like 곰탕 / 나주곰탕)
    const merged = [...menus];
    const same = (a, b) => { const x = a.replace(/\s/g, ""), y = b.replace(/\s/g, ""); return x.includes(y) || y.includes(x); };
    for (const m of [...(info.menus || []), info.menu].filter(Boolean)) if (!merged.some(x => same(x, m))) merged.push(m);
    p.menus = merged.slice(0, 4);
    // Naver's category wins, except that a generic 한식 doesn't undo a more specific pick
    if (info.category && !(info.category === "한식" && ["소고기", "돼지고기", "닭·오리", "해산물", "면요리"].includes(p.category))) p.category = info.category;
  }));

  return res.status(200).json({ places, model: message.model });
}
