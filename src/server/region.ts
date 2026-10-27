import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Region } from "@/lessons/types";

// The sample region comes from data/seed/sample.json (built from config/region.json by `npm run seed:build`),
// so the offline data and the region's name and anchor point can never disagree.
export type Seed = {
  region: Region;
  places: { name: string; kind: string; seq: number; geojson: unknown }[];
  overpass: unknown;
};

const SEED_PATH = path.join(process.cwd(), "data/seed/sample.json");
let seed: Seed | null = null;

export function getSeed(): Seed {
  if (!seed) seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed;
  return seed;
}

export function getRegion(): Region {
  return getSeed().region;
}

// Parameters every lesson query may use: :region_name, :anchor_name, :anchor_lng, :anchor_lat
export function regionParams(): Record<string, unknown> {
  const r = getRegion();
  return { region_name: r.name, anchor_name: r.anchor.name, anchor_lng: r.anchor.lng, anchor_lat: r.anchor.lat };
}
