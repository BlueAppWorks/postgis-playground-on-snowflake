// MapLibre GL 6 runs its tile parsing in a Web Worker shipped as separate ES modules.
// Serve them as static files so the bundler does not have to resolve the worker.
// Runs before `npm run dev` and `npm run build` (see package.json).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const from = "node_modules/maplibre-gl/dist";
const to = "public/maplibre";
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) {
  if (/^maplibre-gl-(worker|shared)\.mjs$/.test(f)) copyFileSync(`${from}/${f}`, `${to}/${f}`);
}
