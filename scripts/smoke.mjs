// Runs every lesson step once with default parameters against a running app.
// Usage: node scripts/smoke.mjs [baseUrl] [--with-apis]
//   --with-apis also calls Nominatim and Overpass (steps 2.1 and 2.3) — be gentle with those services.
const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const withApis = process.argv.includes("--with-apis");

const post = async (path, body) => (await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })).json();
const features = (r) => r.results.reduce((n, b) => n + (b.features?.features?.length ?? 0), 0);

let failed = 0;
const report = (label, r, ms) => {
  const errors = r.results?.filter((b) => b.error && !b.expectedError) ?? [];
  const ok = r.ok && errors.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(34)} ${String(ms).padStart(6)} ms  features=${features(r)}${ok ? "" : `  ${r.error ?? errors[0]?.error}`}`);
};

let t = Date.now();
const qs = await post("/api/quickstart");
report("quickstart (lesson 0 + sample)", qs, Date.now() - t);

for (let id = 0; id <= 13; id++) {
  const { lesson } = await (await fetch(`${base}/api/lessons/${id}`)).json();
  for (const step of lesson.steps) {
    if ((step.action === "geocode" || step.action === "osmImport") && !withApis) continue;
    const params = step.action === "geocode" ? { places: [{ name: "Golden Gate Park, San Francisco", kind: "favorite" }, { name: "Ferry Building, San Francisco", kind: "work" }] } : {};
    t = Date.now();
    const r = await post("/api/run", { lesson: id, step: step.id, params });
    report(`${step.id} ${step.title}`, r, Date.now() - t);
    if (step.animate) {
      t = Date.now();
      const f = await post("/api/run", { lesson: id, step: step.id, params: { [step.animate.param]: 0.5 }, onlyBlocks: [step.animate.block] });
      report(`${step.id} (animation frame)`, f, Date.now() - t);
    }
  }
}

if (withApis) {
  // restore the sample after the API test replaced the places
  const again = await post("/api/quickstart");
  report("quickstart (restore sample)", again, 0);
}
t = Date.now();
// the zoom-15 tile containing the sample region's anchor point
const { anchor } = JSON.parse(await (await import("node:fs/promises")).readFile("data/seed/sample.json", "utf8")).region;
const [z, lng, lat] = [15, anchor.lng, anchor.lat];
const x = Math.floor(((lng + 180) / 360) * 2 ** z);
const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const tile = await fetch(`${base}/api/tiles/${z}/${x}/${y}`);
console.log(`${tile.status === 200 ? "ok  " : "FAIL"} tile ${z}/${x}/${y} → HTTP ${tile.status}, ${(await tile.arrayBuffer()).byteLength} bytes, ${Date.now() - t} ms`);
if (tile.status !== 200) failed++;

// the basemap style, fetched through the app's proxy (needs tiles.openfreemap.org in OSM_EGRESS_RULE)
const style = await fetch(`${base}/api/basemap/styles/positron`);
console.log(`${style.ok ? "ok  " : "FAIL"} basemap style via /api/basemap → HTTP ${style.status}`);
if (!style.ok) failed++;

console.log(failed ? `\n${failed} failure(s)` : "\nall passed");
process.exit(failed ? 1 : 0);
