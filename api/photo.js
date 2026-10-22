import { randomBytes } from "node:crypto";
import { checkPass } from "../lib/auth.js";
import { hasStore, putPhoto, getPhoto } from "../lib/store.js";

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_CHARS = 900_000; // ~650KB image; the page sends ~150KB JPEGs

export default async function handler(req, res) {
  if (!hasStore()) return res.status(503).json({ error: "no_store" });

  try {
    // <img> tags can't send the passcode, so reads are open; ids are 96-bit random.
    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (!/^[a-f0-9]{24}$/.test(id)) return res.status(400).end();
      const stored = await getPhoto(id);
      const m = stored && stored.match(DATA_URL);
      if (!m) return res.status(404).end();
      res.setHeader("Content-Type", m[1]);
      // browser-only cache: a shared CDN copy would outlive the card when it is deleted
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      return res.status(200).send(Buffer.from(m[2], "base64"));
    }

    if (req.method === "POST") {
      if (!checkPass(req, res)) return;
      const data = req.body && req.body.data;
      if (typeof data !== "string" || data.length > MAX_CHARS || !DATA_URL.test(data)) {
        return res.status(400).json({ error: "bad_image" });
      }
      const id = randomBytes(12).toString("hex");
      await putPhoto(id, data);
      return res.status(201).json({ key: id });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("photo:", err);
    return res.status(500).json({ error: "store_failed" });
  }
}
