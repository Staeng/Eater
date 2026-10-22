import { timingSafeEqual, createHash } from "node:crypto";

// APP_PASSCODE gates every API call. Without it the app is open to anyone with the URL.
export function checkPass(req, res) {
  const want = process.env.APP_PASSCODE;
  if (!want) return true;
  const got = String(req.headers["x-eater-pass"] || "");
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(want).digest();
  if (timingSafeEqual(a, b)) return true;
  res.status(401).json({ error: "locked" });
  return false;
}
