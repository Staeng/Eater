// Whitelist and bound every field a client may store on a place card.
import { CATEGORIES } from "./prompt.js";

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const url = v => {
  try {
    const u = new URL(String(v || "").trim());
    return /^https?:$/.test(u.protocol) ? u.href.slice(0, 600) : "";
  } catch { return ""; }
};

const FIELDS = {
  name: v => text(v, 60),
  link: url,
  reel: url,
  address: v => text(v, 120),
  city: v => text(v, 12),
  gu: v => text(v, 24),
  dong: v => text(v, 24),
  area: v => text(v, 16),
  category: v => (CATEGORIES.includes(v) ? v : "기타"),
  menus: v => (Array.isArray(v) ? v.map(m => text(m, 30)).filter(Boolean).slice(0, 6) : []),
  budget: v => { const n = Number(v); return v != null && Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 10_000_000) : null; },
  budgetLabel: v => text(v, 40),
  wantDate: v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
  wantWhen: v => text(v, 40),
  memo: v => text(v, 200),
  raw: v => text(v, 1000),
  photoKey: v => (typeof v === "string" && /^[a-f0-9]{24}$/.test(v) ? v : null),
  photoUrl: v => { const u = url(v); return u.startsWith("https://") ? u : null; },
  example: v => v === true,
};

// partial=true keeps only the keys the client sent (for PATCH)
export function cleanPlace(input, partial = false) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const [key, fn] of Object.entries(FIELDS)) {
    if (partial && !(key in src)) continue;
    out[key] = fn(src[key]);
  }
  return out;
}
