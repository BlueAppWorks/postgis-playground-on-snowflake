// Builds data/seed/sample.json — the offline sample region — from config/region.json.
// Usage: npm run seed:build [path/to/region.json]   (default config/region.json; calls Nominatim once per place and Overpass once)
// Data (c) OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { OVERPASS_QL, OVERPASS_ENDPOINTS } from "./overpass-query.mjs";

const UA = process.env.OSM_USER_AGENT ?? "PostGIS-Playground/1.0 (seed builder)";
const KINDS = ["home", "work", "station", "favorite"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const configPath = process.argv[2] ?? "config/region.json";
const region = JSON.parse(await readFile(configPath, "utf8"));
if (!region.name || !Array.isArray(region.places) || region.places.length < 2 || region.places.length > 5) {
  throw new Error(`${configPath} needs a name and 2–5 places`);
}

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=geojson&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const fc = await res.json();
  if (!fc.features?.length) throw new Error(`Not found: "${q}" — make the query more specific (add the city and country)`);
  await sleep(1100); // Nominatim policy: at most one request per second
  return fc.features[0];
}

// 1) Places: use lng/lat when given, otherwise geocode the query
const places = [];
for (const [i, p] of region.places.entries()) {
  let geojson;
  let found = "given coordinates";
  if (typeof p.lng === "number" && typeof p.lat === "number") {
    geojson = { type: "Point", coordinates: [p.lng, p.lat] };
  } else {
    const f = await geocode(p.query ?? p.name);
    geojson = f.geometry;
    found = f.properties?.display_name;
  }
  places.push({ name: p.name, kind: KINDS.includes(p.kind) ? p.kind : "favorite", seq: i + 1, geojson });
  console.log(`${p.name} → ${geojson.coordinates.map((n) => n.toFixed(5)).join(", ")}  (${found})`);
}

// 2) Anchor: the point Lesson 1 starts with — given coordinates, else the place with the same name, else the first place
const anchorName = region.anchor?.name ?? places[0].name;
const [ax, ay] = (places.find((p) => p.name === anchorName) ?? places[0]).geojson.coordinates;
const anchor = { name: anchorName, lng: region.anchor?.lng ?? ax, lat: region.anchor?.lat ?? ay };

// Sanity check: everything should be one neighborhood, not a whole country
const lons = places.map((p) => p.geojson.coordinates[0]);
const lats = places.map((p) => p.geojson.coordinates[1]);
const spanKm = Math.max((Math.max(...lats) - Math.min(...lats)) * 111, (Math.max(...lons) - Math.min(...lons)) * 111 * Math.cos((lats[0] * Math.PI) / 180));
if (spanKm > 15) throw new Error(`The places are ${spanKm.toFixed(0)} km apart. Keep them within ~10 km so the download stays small.`);

// 3) OpenStreetMap data: bounding box of the places + radius
const pad = (region.radiusMeters ?? 1000) / 111_000;
const [s, w, n, e] = [Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad];
const poly = `${s} ${w} ${s} ${e} ${n} ${e} ${n} ${w}`;
let overpass;
for (const [i, endpoint] of OVERPASS_ENDPOINTS.entries()) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(OVERPASS_QL([poly])),
  });
  if (res.ok) {
    overpass = await res.json();
    break;
  }
  console.warn(`${endpoint}: HTTP ${res.status}, trying the next endpoint`);
  await sleep(2000 * (i + 1));
}
if (!overpass) throw new Error("All Overpass endpoints failed — try again in a few minutes");

await mkdir("data/seed", { recursive: true });
await writeFile(
  "data/seed/sample.json",
  JSON.stringify({
    attribution: "Data (c) OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright",
    generated_at: new Date().toISOString(),
    region: { name: region.name, anchor },
    places,
    overpass,
  }),
);
const count = (pred) => overpass.elements.filter(pred).length;
console.log(
  `\ndata/seed/sample.json: ${count((x) => x.type === "node")} points of interest, ` +
    `${count((x) => x.tags?.leisure)} parks/areas, ${count((x) => x.tags?.highway)} streets and paths`,
);
