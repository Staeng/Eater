// "맛있어 보이는 사진으로 교체": pick another dish photo for a saved card. The current photo and the
// ones passed over before (photoSkip) are left out, and Claude picks the most appetizing of the rest.
import { checkPass } from "../lib/auth.js";
import { naverMenuPhoto } from "../lib/naver.js";
import { pickDishPhoto, unseenPhotos } from "../lib/enrich.js";
import { hasStore, getPlace, putPlace } from "../lib/store.js";

export default async function handler(req, res) {
  if (!checkPass(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!hasStore()) return res.status(503).json({ error: "no_store" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "no_key" });
  const id = String((req.query && req.query.id) || "");
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return res.status(400).json({ error: "bad_id" });

  try {
    const current = await getPlace(id);
    if (!current) return res.status(404).json({ error: "not_found" });
    const link = current.placeId ? `https://map.naver.com/p/entry/place/${current.placeId}` : current.link || "";
    if (!link) return res.status(200).json({ place: current, result: "no_place" });

    const info = await naverMenuPhoto({ link, name: current.name || "", where: current.gu || "", menus: current.menus || [] });
    const seen = [...(current.photoSkip || []), current.photoUrl].filter(Boolean);
    const photos = unseenPhotos(info && info.photos, seen);
    if (!photos.length) return res.status(200).json({ place: current, result: "no_more" });

    const report = {};
    const url = await pickDishPhoto(photos, current.menus || [], "", report);
    if (!url) return res.status(200).json({ place: current, result: "none", report });

    const next = { ...current, photoUrl: url, photoKey: null, photoSkip: seen.slice(-20) };
    await putPlace(next);
    return res.status(200).json({ place: next, result: "changed", report });
  } catch (err) {
    console.error("repick:", err);
    return res.status(500).json({ error: "failed" });
  }
}
