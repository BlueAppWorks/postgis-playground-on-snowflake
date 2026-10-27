import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TraceEntry } from "@/lessons/types";
import { runSql } from "./db";
import { getCommon } from "./sqlfiles";
import { getSeed } from "./region";
// The Overpass query is shared with scripts/build-seed.mjs.
import { OVERPASS_QL, OVERPASS_ENDPOINTS } from "../../scripts/overpass-query.mjs";

// OpenStreetMap services have usage policies: identify the app, stay under 1 request/second
// for Nominatim, cache results, and show "© OpenStreetMap contributors" on the map.
// https://operations.osmfoundation.org/policies/nominatim/
const UA = process.env.OSM_USER_AGENT ?? "PostGIS-Playground/1.0 (Snowflake App Runtime learning app)";
const NOMINATIM = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cached(client: PoolClient, key: string, trace: TraceEntry[], fetcher: () => Promise<unknown>) {
  const hit = await runSql(client, "cache lookup", getCommon("cache_get"), { key }, trace);
  if (hit.raw[0]) return { data: hit.raw[0].response, fromCache: true };
  const data = await fetcher();
  await runSql(client, "cache store", getCommon("cache_put"), { key, response: JSON.stringify(data) }, trace);
  return { data, fromCache: false };
}

function httpTrace(trace: TraceEntry[], label: string, sql: string, started: number, error?: string) {
  trace.push({ kind: "http", label, sql, ms: Date.now() - started, at: new Date().toISOString(), error });
}

export async function geocodePlaces(client: PoolClient, places: { name: string; kind: string }[], trace: TraceEntry[]) {
  const messages: string[] = [];
  await runSql(client, "remove old places", getCommon("clear_places"), {}, trace);
  let seq = 0;
  for (const p of places) {
    const name = p.name.trim().slice(0, 120);
    if (!name) continue;
    const url = `${NOMINATIM}/search?format=geojson&limit=1&q=${encodeURIComponent(name)}`;
    const { data, fromCache } = await cached(client, `nominatim:${name.toLowerCase()}`, trace, async () => {
      const started = Date.now();
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      httpTrace(trace, "Nominatim geocode", `GET ${url}`, started, res.ok ? undefined : `HTTP ${res.status}`);
      if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);
      await sleep(1000); // usage policy: at most one request per second
      return res.json();
    });
    if (fromCache) httpTrace(trace, "Nominatim (cached)", `GET ${url}`, Date.now());
    const feature = (data as { features?: { geometry: unknown; properties?: { display_name?: string } }[] }).features?.[0];
    if (!feature) {
      messages.push(`Not found: "${name}". Try a more specific name, e.g. add the city.`);
      continue;
    }
    seq += 1;
    await runSql(client, `insert ${name}`, getCommon("insert_place"), {
      name,
      kind: ["home", "work", "station", "favorite"].includes(p.kind) ? p.kind : "favorite",
      seq,
      source: "nominatim",
      geojson: JSON.stringify(feature.geometry),
    }, trace);
    messages.push(`${name} → ${feature.properties?.display_name ?? "found"}`);
  }
  return messages;
}

export async function importOverpassJson(client: PoolClient, osm: unknown, trace: TraceEntry[]) {
  const json = JSON.stringify(osm);
  await runSql(client, "clear old OSM data", getCommon("clear_osm"), {}, trace);
  await runSql(client, "import points of interest", getCommon("import_poi"), { osm: json }, trace);
  await runSql(client, "import areas", getCommon("import_areas"), { osm: json }, trace);
  await runSql(client, "import roads", getCommon("import_roads"), { osm: json }, trace);
  await runSql(client, "analyze", getCommon("analyze_osm"), {}, trace);
}

export async function osmImport(client: PoolClient, radius: number, trace: TraceEntry[]) {
  const area = await runSql(client, "download area", getCommon("import_area"), { radius }, trace);
  const polys = area.raw.map((r) => String(r.overpass_poly)).filter(Boolean);
  if (!polys.length) throw new Error("No places yet — run step 2.1 first.");
  const ql = OVERPASS_QL(polys);
  const key = "overpass:" + createHash("sha256").update(ql).digest("hex");
  const { data } = await cached(client, key, trace, async () => {
    let lastError = "";
    for (const [i, endpoint] of OVERPASS_ENDPOINTS.entries()) {
      const started = Date.now();
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(ql),
        });
        httpTrace(trace, "Overpass API", `POST ${endpoint}\n\n${ql}`, started, res.ok ? undefined : `HTTP ${res.status}`);
        if (res.ok) return res.json();
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = (e as Error).message;
        httpTrace(trace, "Overpass API", `POST ${endpoint}`, started, lastError);
      }
      await sleep(1500 * (i + 1));
    }
    throw new Error(`Overpass API is unavailable (${lastError}). Use the sample region in step 2.1, or try again later.`);
  });
  await importOverpassJson(client, data, trace);
}

export async function loadSeed(client: PoolClient, trace: TraceEntry[]) {
  const seed = getSeed();
  await runSql(client, "remove old places", getCommon("clear_places"), {}, trace);
  for (const p of seed.places) {
    await runSql(client, `insert ${p.name}`, getCommon("insert_place"), { name: p.name, kind: p.kind, seq: p.seq, source: "sample", geojson: JSON.stringify(p.geojson) }, trace);
  }
  await importOverpassJson(client, seed.overpass, trace);
  return [`Loaded the ${seed.region.name} sample: ${seed.places.length} places and its OpenStreetMap snapshot.`];
}
