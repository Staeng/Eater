import { randomBytes } from "node:crypto";
import { checkPass } from "../lib/auth.js";
import { cleanPlace } from "../lib/clean.js";
import { hasStore, listPlaces, getPlace, putPlace, deletePlace, deletePhoto } from "../lib/store.js";

const validId = id => typeof id === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(id);

export default async function handler(req, res) {
  if (!checkPass(req, res)) return;
  if (!hasStore()) return res.status(503).json({ error: "no_store" });
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      return res.status(200).json({ places: await listPlaces() });
    }

    if (req.method === "POST") {
      const place = {
        ...cleanPlace(req.body),
        id: randomBytes(9).toString("base64url"),
        createdAt: new Date().toISOString(),
      };
      await putPlace(place);
      return res.status(201).json({ place });
    }

    const id = req.query.id;
    if (!validId(id)) return res.status(400).json({ error: "bad_id" });

    if (req.method === "PATCH") {
      const current = await getPlace(id);
      if (!current) return res.status(404).json({ error: "not_found" });
      const patch = cleanPlace(req.body, true);
      const next = { ...current, ...patch, id, createdAt: current.createdAt };
      await putPlace(next);
      if ("photoKey" in patch && current.photoKey && current.photoKey !== next.photoKey) {
        await deletePhoto(current.photoKey).catch(() => {});
      }
      return res.status(200).json({ place: next });
    }

    if (req.method === "DELETE") {
      const current = await getPlace(id);
      await deletePlace(id);
      if (current && current.photoKey) await deletePhoto(current.photoKey).catch(() => {});
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("places:", err);
    return res.status(500).json({ error: "store_failed" });
  }
}
