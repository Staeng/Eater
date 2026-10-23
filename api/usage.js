import { checkPass } from "../lib/auth.js";
import { hasStore, getSpend, setBalance } from "../lib/store.js";
import { kstDay } from "../lib/usage.js";
import { MODEL } from "../lib/claude.js";

// GET: today's Claude spend, the estimated balance and the model in use. POST { balance }: the
// balance shown in the Claude Console right now; later spend is subtracted from it.
export default async function handler(req, res) {
  if (!checkPass(req, res)) return;
  if (!hasStore()) return res.status(503).json({ error: "no_store" });
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "POST") {
      const usd = Number(req.body && req.body.balance);
      if (!Number.isFinite(usd) || usd < 0 || usd > 100000) return res.status(400).json({ error: "bad_balance" });
      const { total } = await getSpend(kstDay());
      await setBalance({ usd, totalAt: total, at: new Date().toISOString() });
    } else if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const { today, total, balance } = await getSpend(kstDay());
    const remaining = balance ? Math.max(0, balance.usd - (total - (balance.totalAt || 0))) : null;
    return res.status(200).json({ today, remaining, balanceAt: balance ? balance.at : null, model: MODEL });
  } catch (err) {
    console.error("usage:", err);
    return res.status(500).json({ error: "server_error" });
  }
}
