// Place cards and photos live in Upstash Redis (Vercel Storage → Upstash for Redis).
// For local development, EATER_LOCAL_STORE=<file.json> keeps everything in a JSON file instead.
import fs from "node:fs/promises";
import path from "node:path";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LOCAL_FILE = process.env.EATER_LOCAL_STORE;

const PLACES = "eater:places";
const photoKey = id => `eater:photo:${id}`;

export const hasStore = () => Boolean((REDIS_URL && REDIS_TOKEN) || LOCAL_FILE);

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`redis ${command[0]} failed: ${body.error || res.status}`);
  return body.result;
}

async function readLocal() {
  try { return JSON.parse(await fs.readFile(LOCAL_FILE, "utf8")); } catch { return { places: {}, photos: {} }; }
}
async function writeLocal(db) {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(db));
}

export async function listPlaces() {
  if (!REDIS_URL && LOCAL_FILE) return Object.values((await readLocal()).places);
  const flat = (await redis(["HGETALL", PLACES])) || [];
  const out = [];
  for (let i = 1; i < flat.length; i += 2) {
    try { out.push(JSON.parse(flat[i])); } catch { /* skip a damaged row */ }
  }
  return out;
}

export async function getPlace(id) {
  if (!REDIS_URL && LOCAL_FILE) return (await readLocal()).places[id] || null;
  const raw = await redis(["HGET", PLACES, id]);
  return raw ? JSON.parse(raw) : null;
}

export async function putPlace(place) {
  if (!REDIS_URL && LOCAL_FILE) {
    const db = await readLocal();
    db.places[place.id] = place;
    return writeLocal(db);
  }
  await redis(["HSET", PLACES, place.id, JSON.stringify(place)]);
}

export async function deletePlace(id) {
  if (!REDIS_URL && LOCAL_FILE) {
    const db = await readLocal();
    delete db.places[id];
    return writeLocal(db);
  }
  await redis(["HDEL", PLACES, id]);
}

export async function putPhoto(id, dataUrl) {
  if (!REDIS_URL && LOCAL_FILE) {
    const db = await readLocal();
    db.photos[id] = dataUrl;
    return writeLocal(db);
  }
  await redis(["SET", photoKey(id), dataUrl]);
}

export async function getPhoto(id) {
  if (!REDIS_URL && LOCAL_FILE) return (await readLocal()).photos[id] || null;
  return redis(["GET", photoKey(id)]);
}

export async function deletePhoto(id) {
  if (!REDIS_URL && LOCAL_FILE) {
    const db = await readLocal();
    delete db.photos[id];
    return writeLocal(db);
  }
  await redis(["DEL", photoKey(id)]);
}
