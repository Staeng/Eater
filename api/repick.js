// "맛있어 보이는 사진으로 교체": pick another dish photo for a saved card. The current photo, the ones
// passed over before (photoSkip) and the ones already offered in this editing session (body.skip)
// are left out, and Claude picks the most appetizing of the rest. Nothing is saved here: the
// editor shows the photo and saves it, with the new skip list, only when 저장 is pressed.
import { checkPass } from "../lib/auth.js";
import { naverMenuPhoto, blogPhotos } from "../lib/naver.js";
import { pickDishPhoto, unseenPhotos } from "../lib/enrich.js";
import { hasStore, getPlace } from "../lib/store.js";

const isUrl = v => typeof v === "string" && v.length <= 1000 && /^https:\/\//.test(v);

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
  const offered = Array.isArray(req.body && req.body.skip) ? req.body.skip.filter(isUrl).slice(-40) : [];

  try {
    const current = await getPlace(id);
    if (!current) return res.status(404).json({ error: "not_found" });
    const link = current.placeId ? `https://map.naver.com/p/entry/place/${current.placeId}` : current.link || "";
    if (!link) return res.status(200).json({ result: "no_place" });

    const info = await naverMenuPhoto({ link, name: current.name || "", where: current.gu || "", menus: current.menus || [] });
    const seen = [...new Set([...(current.photoSkip || []), current.photoUrl, ...offered].filter(Boolean))];
    const menus = current.menus || [];
    const report = {};
    const photos = unseenPhotos(info && info.photos, seen);
    let url = photos.length ? await pickDishPhoto(photos, menus, "", report) : "";
    // the place's own photos are used up or none looks good: look at photos from blog reviews too
    let more = [];
    if (!url) {
      more = unseenPhotos(await blogPhotos(current.name || (info && info.name) || "", current.dong || current.gu || "", menus[0] || ""), seen);
      if (more.length) url = await pickDishPhoto(more, menus, "", report);
    }
    if (!url) return res.status(200).json({ result: photos.length || more.length ? "none" : "no_more", report });
    return res.status(200).json({ result: "changed", photoUrl: url, skip: seen.slice(-20), report });
  } catch (err) {
    console.error("repick:", err);
    return res.status(500).json({ error: "failed" });
  }
}
