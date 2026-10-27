---
name: postgis-playground-region
description: Change the PostGIS Playground's sample region (the default map, the places in "Quick start", and Lesson 1's first point) from Menlo Park to the user's own city or neighborhood — edits config/region.json, downloads the OpenStreetMap data with npm run seed:build, checks it, and redeploys. Use when the user says "use my city", "change the map to Tokyo/London/…", "make the sample my neighborhood", "localize the demo", or "switch region".
tools:
  - bash
  - read
  - write
  - edit
---

# PostGIS Playground — switch the sample region

The sample region is what "Quick start" and "Use the sample instead" load, where the map opens, and the first
point in Lesson 1. It is defined in **one file**, `config/region.json`, and turned into an offline snapshot,
`data/seed/sample.json`, by `npm run seed:build`. No code changes are needed.

Tell the user first: **learners can already type their own places in Lesson 2** without any of this.
Changing the sample region is for a presenter or a workshop that should start in a particular city.

## 1. Ask for the region

- A short region name for the UI, e.g. `Shibuya`, `London King's Cross`.
- **2–5 places** within about 10 km of each other: stations, parks, landmarks, an office.
  Ask for public landmarks, **not home addresses** — the sample ships with the app and may be published.
- Which place is the "anchor" — the first point in Lesson 1 (default: the first place). Typically the office or a famous landmark.
- Mix kinds if possible (`work`, `station`, `favorite`, `home`): a station and a busy shopping street make the
  buffer, nearest-neighbour and heatmap lessons look good; a park makes the polygon lessons work.

## 2. Write config/region.json

Keep the existing structure:

```json
{
  "name": "Shibuya",
  "anchor": { "name": "Shibuya Station" },
  "radiusMeters": 800,
  "places": [
    { "name": "Shibuya Station", "kind": "station", "query": "Shibuya Station, Tokyo, Japan" },
    { "name": "Yoyogi Park", "kind": "favorite", "query": "Yoyogi Park, Tokyo, Japan" },
    { "name": "Shibuya Scramble Square", "kind": "work", "query": "Shibuya Scramble Square, Tokyo" }
  ]
}
```

- `query` is sent to OpenStreetMap Nominatim. Add city and country to make it unambiguous.
- Instead of `query`, a place may give `"lng"` and `"lat"` directly (useful when geocoding picks the wrong spot).
- `anchor.name` should match one of the places; its coordinates are taken from that place.
  (`anchor` may also give its own `lng`/`lat`. Without an anchor, the first place is used.)
- `radiusMeters`: 1000 for suburbs, **500–800 for dense city centers** (keeps the download and the app fast).
- `config/examples/` has a working example (Tokyo Marunouchi).

## 3. Download the data

```bash
npm install            # if node_modules is missing
npm run seed:build     # Nominatim once per place + one Overpass download
```

Set `OSM_USER_AGENT="PostGIS-Playground/1.0 (<user email>)"` in the command's environment if the user gave one.

**Check the printed geocoding results with the user** — each line shows the matched address. Nominatim
sometimes matches a shop or hotel with a similar name (e.g. "Nihonbashi" → a hotel next to the bridge).
If a match is wrong, make the `query` more specific or use `lng`/`lat`, and run again.

Errors:
- `Not found: "..."` → more specific query (add district, city, country) or give `lng`/`lat`.
- `The places are N km apart` → pick closer places; the lessons work at neighbourhood scale.
- `HTTP 502/504`, "trying the next endpoint" → the public Overpass servers are busy; the script tries mirrors.
  If all fail, wait a few minutes and retry. Do not loop rapidly — these are free community services.

Check the result size: `data/seed/sample.json` should be under ~10 MB. Larger → reduce `radiusMeters`.

## 4. Optional: try it locally

If the user has local access to Postgres (`.env.local` with PGHOST / PGUSER / PGPASSWORD and their IP in the ingress rule):

```bash
npm run dev     # then press Reset → Quick start in the app
node scripts/smoke.mjs http://localhost:3000
```

## 5. Redeploy

```bash
snow app deploy
```

Then, in the deployed app: **Reset** (drops the old sample data) → **Quick start** (loads the new region).
The map opens on the new anchor, Lesson 1.1 inserts the new anchor point, and Lesson 11's city list includes the new region.

## Notes

- Map data: © OpenStreetMap contributors, ODbL. If the repository with the new sample is published, keep
  `data/seed/README.md` and the attribution in the README.
- Commit `config/region.json` and `data/seed/sample.json` together so they never disagree.
