// What each Claude call cost, from the token counts in its response, added to today's total.
// Anthropic has no API for the remaining prepaid balance (and the cost report needs an org admin
// key), so the page shows this running sum and subtracts it from a balance the owner types in.
import { hasStore, addSpend } from "./store.js";

// USD per million tokens (platform.claude.com pricing). Cache writes are 1.25x input, reads 0.1x.
const PRICE = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, longIn: 0.50, longOut: 2.50 }, // long = prompt over 100K tokens
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

export function costOf(message) {
  const model = String(message.model || "");
  const price = PRICE[model] || PRICE[Object.keys(PRICE).find(k => model.startsWith(k))];
  if (!price) return 0;
  const u = message.usage || {};
  const fresh = u.input_tokens || 0, write = u.cache_creation_input_tokens || 0, read = u.cache_read_input_tokens || 0;
  const long = price.longIn && fresh + write + read > 100_000;
  const inRate = long ? price.longIn : price.in, outRate = long ? price.longOut : price.out;
  return (fresh * inRate + write * inRate * 1.25 + read * inRate * 0.1 + (u.output_tokens || 0) * outRate) / 1e6;
}

export const kstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export async function recordUsage(message) {
  try {
    const usd = costOf(message);
    if (usd > 0 && hasStore()) await addSpend(kstDay(), usd);
  } catch (err) {
    console.warn("usage:", err.message);
  }
}
