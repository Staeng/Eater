// Re-run the Naver + CatchTable lookup for a card that is already saved.
import { checkPass } from "../lib/auth.js";
import { cleanPlace } from "../lib/clean.js";
import { enrichPlace } from "../lib/enrich.js";
import { hasStore, getPlace, putPlace } from "../lib/store.js";

export default async function handler(req, res) {
  if (!checkPass(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!hasStore()) return res.status(503).json({ error: "no_store" });
  const id = String((req.query && req.query.id) || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return res.status(400).json({ error: "bad_id" });

  try {
    const current = await getPlace(id);
    if (!current) return res.status(404).json({ error: "not_found" });
    const draft = JSON.parse(JSON.stringify(current));
    // links already on the card count as written in the memo
    await enrichPlace(draft, [current.raw, current.link].filter(Boolean).join("\n"));
    if (!draft.link && draft.naverLink) draft.link = draft.naverLink;
    const next = { ...current, ...cleanPlace(draft, true), id, createdAt: current.createdAt };
    await putPlace(next);
    return res.status(200).json({ place: next });
  } catch (err) {
    console.error("enrich:", err);
    return res.status(500).json({ error: "failed" });
  }
}
