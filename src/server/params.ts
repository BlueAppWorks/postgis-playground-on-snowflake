import "server-only";
import type { PoolClient } from "pg";
import type { Control, Step, TraceEntry } from "@/lessons/types";
import { getCommon } from "./sqlfiles";
import { runSql } from "./db";
import { lngLatToTile } from "@/lib/tiles";
import { getRegion, regionParams } from "./region";

// Every value coming from the browser is validated against the step's control definitions
// and then sent as a bind parameter. Identifiers ({{name}}) are only taken from static option lists.

export class ParamError extends Error {}

export type Resolved = { values: Record<string, unknown>; identifiers: Record<string, string> };

const num = (v: unknown, name: string, min: number, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ParamError(`${name} must be between ${min} and ${max}`);
  return n;
};
const int = (v: unknown, name: string, min = -2_147_483_648, max = 2_147_483_647) => {
  const n = num(v, name, min, max);
  if (!Number.isInteger(n)) throw new ParamError(`${name} must be an integer`);
  return n;
};

async function center(client: PoolClient, trace: TraceEntry[]) {
  try {
    const out = await runSql(client, "default: center of my places", getCommon("center"), {}, trace);
    const row = out.raw[0];
    if (row) return { lng: Number(row.lng), lat: Number(row.lat) };
  } catch {
    // geo schema not created yet
  }
  const a = getRegion().anchor;
  return { lng: a.lng, lat: a.lat };
}

async function options(client: PoolClient, query: string, trace: TraceEntry[]) {
  const out = await runSql(client, `options: ${query}`, getCommon(query), {}, trace);
  return out.raw.map((r) => ({ value: String(r.value), label: String(r.label) }));
}

async function resolveControl(c: Control, raw: Record<string, unknown>, client: PoolClient, trace: TraceEntry[], out: Resolved) {
  const v = out.values;
  switch (c.type) {
    case "slider":
      v[c.name] = num(raw[c.name] ?? c.default, c.label, c.min, c.max);
      return;
    case "select": {
      if (c.options) {
        const wanted = raw[c.name] ?? c.default ?? c.options[c.defaultIndex ?? 0]?.value;
        const opt = c.options.find((o) => o.value === String(wanted));
        if (!opt) throw new ParamError(`${c.label}: invalid choice`);
        if (c.identifier) out.identifiers[c.name] = opt.value;
        else v[c.name] = opt.value;
        // "$anchor_lng" style values refer to the sample region (e.g. the region's own city in Lesson 11)
        const rp = regionParams();
        for (const [k, val] of Object.entries(opt.params ?? {})) v[k] = typeof val === "string" && val.startsWith("$") ? rp[val.slice(1)] : val;
        return;
      }
      let value = raw[c.name];
      if (value === undefined || value === null || value === "") {
        const opts = await options(client, c.optionsQuery!, trace);
        const byDefault = c.default ? opts.find((o) => o.value === c.default) : undefined;
        value = (byDefault ?? opts[c.defaultIndex ?? 0] ?? opts[0])?.value;
        if (value === undefined) throw new ParamError(`${c.label}: nothing to choose from yet — load data in Lesson 2 first`);
      }
      v[c.name] = c.valueType === "int" ? int(value, c.label) : String(value).slice(0, 200);
      return;
    }
    case "mapClick": {
      let lng = raw[`${c.name}_lng`];
      let lat = raw[`${c.name}_lat`];
      if (lng === undefined || lat === undefined) ({ lng, lat } = await center(client, trace));
      v[`${c.name}_lng`] = num(lng, "longitude", -180, 180);
      v[`${c.name}_lat`] = num(lat, "latitude", -90, 90);
      return;
    }
    case "mapClickTile": {
      if (raw.z !== undefined) {
        const z = int(raw.z, "z", 0, 22);
        v.z = z;
        v.x = int(raw.x, "x", 0, 2 ** z - 1);
        v.y = int(raw.y, "y", 0, 2 ** z - 1);
      } else {
        const c0 = await center(client, trace);
        Object.assign(v, { z: 15, ...lngLatToTile(c0.lng, c0.lat, 15) });
      }
      return;
    }
    case "drawPolygon": {
      let wkt = raw[c.name];
      if (wkt === undefined || wkt === "") {
        const c0 = await center(client, trace);
        const d = 0.006;
        const ring = [
          [c0.lng - d, c0.lat - d],
          [c0.lng + d, c0.lat - d],
          [c0.lng + d, c0.lat + d],
          [c0.lng - d, c0.lat + d],
          [c0.lng - d, c0.lat - d],
        ];
        wkt = `POLYGON((${ring.map((p) => p.map((n) => n.toFixed(6)).join(" ")).join(", ")}))`;
      }
      if (typeof wkt !== "string" || wkt.length > 20_000 || !/^POLYGON\(\([-0-9. ,]+\)\)$/.test(wkt)) {
        throw new ParamError(`${c.label}: expected POLYGON((lng lat, ...)) text`);
      }
      v[c.name] = wkt;
      return;
    }
    case "placeOrder": {
      let ids = raw[c.name];
      if (!Array.isArray(ids) || ids.length === 0) {
        const out2 = await runSql(client, "default: place order", getCommon("place_order_default"), {}, trace);
        ids = out2.raw[0]?.ids as unknown[];
      }
      if (!Array.isArray(ids) || ids.length > 50) throw new ParamError(`${c.label}: expected a list of place ids`);
      v[c.name] = ids.map((id) => int(id, "place id"));
      return;
    }
    case "mapView": {
      if (raw.z !== undefined) {
        const z = int(raw.z, "z", 0, 22);
        const max = 2 ** z - 1;
        const vals = { z, x_min: int(raw.x_min, "x_min", 0, max), x_max: int(raw.x_max, "x_max", 0, max), y_min: int(raw.y_min, "y_min", 0, max), y_max: int(raw.y_max, "y_max", 0, max) };
        if ((vals.x_max - vals.x_min + 1) * (vals.y_max - vals.y_min + 1) > 200) throw new ParamError("Too many tiles in view — zoom in");
        Object.assign(v, vals);
      } else {
        const c0 = await center(client, trace);
        const t = lngLatToTile(c0.lng, c0.lat, 14);
        Object.assign(v, { z: 14, x_min: t.x - 2, x_max: t.x + 2, y_min: t.y - 1, y_max: t.y + 1 });
      }
      return;
    }
    case "mapZoom":
      v.z = int(raw.z ?? 15, "zoom", 0, 22);
      return;
    case "textList":
      return; // handled by the geocode action
  }
}

export async function resolveParams(step: Step, raw: Record<string, unknown>, client: PoolClient, trace: TraceEntry[]): Promise<Resolved> {
  const out: Resolved = { values: { ...regionParams() }, identifiers: {} };
  for (const c of step.controls ?? []) await resolveControl(c, raw, client, trace, out);
  if (step.animate) out.values[step.animate.param] = num(raw[step.animate.param] ?? 0, step.animate.param, 0, 1);
  return out;
}
