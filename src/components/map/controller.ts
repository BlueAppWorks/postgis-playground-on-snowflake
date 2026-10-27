"use client";
import * as maplibregl from "maplibre-gl";
import { type Map as MLMap, type StyleSpecification, type GeoJSONSource, type ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Render } from "@/lessons/types";
import { CATEGORICAL, OTHER, SEQUENTIAL, INK } from "@/lib/colors";
import { lngLatToTile } from "@/lib/tiles";

type Feature = FeatureCollection["features"][number];
type OpacityProp = "fill-opacity" | "line-opacity" | "circle-opacity";
type Coord = number[];

export type LayerInfo = { key: string; group: number; name: string; visible: boolean; color: string; count: number };

type Entry = {
  key: string;
  group: number;
  name: string;
  source: string;
  layers: { id: string; prop: OpacityProp; base: number }[];
  markers: maplibregl.Marker[];
  visible: boolean;
  color: string;
  count: number;
};

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eeede8" } }],
};

const POLY: ExpressionSpecification = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
const LINE: ExpressionSpecification = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const POINT: ExpressionSpecification = ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false];

// ── geometry helpers ──

function flatten(features: Feature[]): Feature[] {
  const out: Feature[] = [];
  for (const f of features) {
    const g = f.geometry as { type: string; geometries?: unknown[] };
    if (g?.type === "GeometryCollection") g.geometries?.forEach((geometry) => out.push({ ...f, geometry }));
    else out.push(f);
  }
  return out;
}

// Keep long lines continuous across the antimeridian (e.g. a California → Tokyo great circle).
function unwrap(coords: Coord[]): Coord[] {
  const out: Coord[] = [];
  for (const c of coords) {
    if (!out.length) {
      out.push([...c]);
      continue;
    }
    const prev = out[out.length - 1][0];
    let lng = c[0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push([lng, c[1]]);
  }
  return out;
}

function allCoords(g: { type: string; coordinates: unknown }): Coord[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates as Coord];
    case "LineString":
    case "MultiPoint":
      return g.coordinates as Coord[];
    case "Polygon":
    case "MultiLineString":
      return (g.coordinates as Coord[][]).flat();
    case "MultiPolygon":
      return (g.coordinates as Coord[][][]).flat(2);
    default:
      return [];
  }
}

function sanitize(features: Feature[]): { features: Feature[]; dropped: number } {
  let dropped = 0;
  const out: Feature[] = [];
  for (const f of flatten(features)) {
    const g = f.geometry as { type: string; coordinates: unknown };
    if (!g) continue;
    if (allCoords(g).some((c) => Math.abs(c[1]) > 90)) {
      dropped++; // e.g. the swapped lat/lng point in Lesson 1 — not a place on Earth
      continue;
    }
    if (g.type === "LineString") out.push({ ...f, geometry: { type: "LineString", coordinates: unwrap(g.coordinates as Coord[]) } });
    else if (g.type === "MultiLineString")
      out.push({ ...f, geometry: { type: "MultiLineString", coordinates: (g.coordinates as Coord[][]).map(unwrap) } });
    else out.push(f);
  }
  return { features: out, dropped };
}

function anchor(f: Feature): Coord | null {
  const g = f.geometry as { type: string; coordinates: unknown };
  if (g.type === "Point") return g.coordinates as Coord;
  if (g.type === "LineString") {
    // middle of the middle segment, so a two-point line is labelled halfway, not on its end point
    const c = g.coordinates as Coord[];
    const i = Math.max(0, Math.floor((c.length - 1) / 2));
    const j = Math.min(c.length - 1, i + 1);
    return [(c[i][0] + c[j][0]) / 2, (c[i][1] + c[j][1]) / 2];
  }
  if (g.type === "MultiLineString") {
    const c = (g.coordinates as Coord[][])[0] ?? [];
    return c[Math.floor(c.length / 2)] ?? null;
  }
  const pts = g.type === "Polygon" ? (g.coordinates as Coord[][])[0] : g.type === "MultiPolygon" ? (g.coordinates as Coord[][][])[0]?.[0] : null;
  if (!pts?.length) return null;
  const n = pts.length - 1 || 1;
  return [pts.slice(0, n).reduce((s, p) => s + p[0], 0) / n, pts.slice(0, n).reduce((s, p) => s + p[1], 0) / n];
}

function bbox(features: Feature[]): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  for (const f of features) {
    for (const c of allCoords(f.geometry as { type: string; coordinates: unknown })) {
      if (!b) b = [c[0], c[1], c[0], c[1]];
      else b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])];
    }
  }
  return b;
}

function truncateLines(features: Feature[], t: number): Feature[] {
  const cut = (c: Coord[]) => c.slice(0, Math.max(2, Math.ceil(c.length * t)));
  return features.map((f) => {
    const g = f.geometry as { type: string; coordinates: unknown };
    if (g.type === "LineString") return { ...f, geometry: { type: "LineString", coordinates: cut(g.coordinates as Coord[]) } };
    if (g.type === "MultiLineString") return { ...f, geometry: { type: "MultiLineString", coordinates: (g.coordinates as Coord[][]).map(cut) } };
    return f;
  });
}

// ── color by the job: identity (categorical) or magnitude (sequential) ──

function colorFor(r: Render, features: Feature[], fallback: string): { expr: string | ExpressionSpecification; swatch: string } {
  if (r.colorBy) {
    const col = r.colorBy;
    const seen: string[] = [];
    for (const f of features) {
      const v = f.properties[col];
      const k = v === null || v === undefined ? "" : String(v);
      if (k && !seen.includes(k)) seen.push(k);
    }
    const pairs: string[] = [];
    let slot = 0;
    for (const k of seen) {
      const c = r.palette?.[k] ?? (slot < CATEGORICAL.length ? CATEGORICAL[slot++] : OTHER);
      pairs.push(k, c);
    }
    if (!pairs.length) return { expr: OTHER, swatch: OTHER };
    return { expr: ["match", ["to-string", ["coalesce", ["get", col], ""]], ...pairs, OTHER] as unknown as ExpressionSpecification, swatch: pairs[1] };
  }
  if (r.fillBy) {
    const vals = features.map((f) => Number(f.properties[r.fillBy!])).filter(Number.isFinite);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (!vals.length || min === max) return { expr: SEQUENTIAL[4], swatch: SEQUENTIAL[4] };
    const stops = SEQUENTIAL.flatMap((c, i) => [min + ((max - min) * i) / (SEQUENTIAL.length - 1), c]);
    return { expr: ["interpolate", ["linear"], ["to-number", ["get", r.fillBy]], ...stops] as unknown as ExpressionSpecification, swatch: SEQUENTIAL[4] };
  }
  const c = r.color ?? fallback;
  return { expr: c, swatch: c };
}

export class MapController {
  map: MLMap;
  private entries = new Map<string, Entry>();
  private seq = 0;
  private ready: Promise<void>;
  private listeners = new Set<() => void>();
  private pick: null | { kind: "point" | "tile" | "polygon"; cb: (v: unknown) => void; vertices: Coord[] } = null;
  private moveListeners = new Set<() => void>();
  private currentGroup = -1;
  pgTiles = false;
  usingFallback = false;

  constructor(container: HTMLElement, styleUrl: string, center: [number, number]) {
    const useFallback = !styleUrl || styleUrl === "none";
    // Served from public/ (scripts/copy-maplibre-worker.mjs) so the bundler never has to resolve the worker.
    maplibregl.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker.mjs`);
    this.map = new maplibregl.Map({
      container,
      style: useFallback ? FALLBACK_STYLE : styleUrl,
      center,
      zoom: 13,
      attributionControl: { compact: false, customAttribution: "© OpenStreetMap contributors" },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    this.ready = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const fallback = () => {
        if (done || this.usingFallback) return;
        // The basemap could not be loaded (offline, blocked by policy, ...). Draw the map from PostGIS instead.
        this.usingFallback = true;
        this.map.setStyle(FALLBACK_STYLE);
        this.map.once("style.load", () => {
          finish();
          this.enablePgTiles();
        });
      };
      this.map.once("load", () => {
        finish();
        if (useFallback) this.enablePgTiles();
      });
      this.map.on("error", () => fallback());
      setTimeout(fallback, 8000);
    });

    this.map.on("click", (e) => this.onClick(e.lngLat));
    this.map.on("dblclick", (e) => {
      if (this.pick?.kind === "polygon") {
        e.preventDefault();
        this.finishDraw();
      }
    });
    this.map.on("moveend", () => this.moveListeners.forEach((fn) => fn()));
  }

  // ── subscriptions for the layer panel ──
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  layers(): LayerInfo[] {
    return [...this.entries.values()].map((e) => ({ key: e.key, group: e.group, name: e.name, visible: e.visible, color: e.color, count: e.count }));
  }

  onMoveEnd(fn: () => void) {
    this.moveListeners.add(fn);
    return () => this.moveListeners.delete(fn);
  }

  // ── rendering a query result ──
  async render(key: string, group: number, r: Render, fc: FeatureCollection | null | undefined, index = 0): Promise<{ dropped: number }> {
    await this.ready;
    this.remove(key);
    const { features, dropped } = sanitize(fc?.features ?? []);
    const id = `l${++this.seq}`;
    const animate = r.animate ?? "fade";
    const { expr: color, swatch } = colorFor(r, features, CATEGORICAL[index % CATEGORICAL.length]);
    const fillOpacity = r.opacity ?? 0.35;
    const initial = animate === "drop" || animate === "grow" ? [] : features;
    this.map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: initial } as GeoJSON.FeatureCollection });

    const dash = r.dashed ? { "line-dasharray": [2, 2] } : {};
    let width: number | ExpressionSpecification = 3;
    if (r.widthBy) {
      const vals = features.map((f) => Number(f.properties[r.widthBy!])).filter(Number.isFinite);
      const [min, max] = [Math.min(...vals), Math.max(...vals)];
      if (vals.length && min < max) width = ["interpolate", ["linear"], ["to-number", ["get", r.widthBy]], min, 6, max, 1.5];
    }
    const start = animate === "fade" ? 0 : 1;
    const layers: Entry["layers"] = [
      { id: `${id}-fill`, prop: "fill-opacity", base: fillOpacity },
      { id: `${id}-outline`, prop: "line-opacity", base: 0.9 },
      { id: `${id}-line`, prop: "line-opacity", base: 0.9 },
      { id: `${id}-circle`, prop: "circle-opacity", base: 0.9 },
    ];
    this.map.addLayer({ id: layers[0].id, type: "fill", source: id, filter: POLY, paint: { "fill-color": color, "fill-opacity": fillOpacity * start, "fill-opacity-transition": { duration: 700 } } });
    this.map.addLayer({ id: layers[1].id, type: "line", source: id, filter: POLY, paint: { "line-color": color, "line-width": 1.5, "line-opacity": 0.9 * start, "line-opacity-transition": { duration: 700 }, ...dash } });
    this.map.addLayer({ id: layers[2].id, type: "line", source: id, filter: LINE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": width, "line-opacity": 0.9 * start, "line-opacity-transition": { duration: 700 }, ...dash } });
    this.map.addLayer({
      id: layers[3].id,
      type: "circle",
      source: id,
      filter: POINT,
      paint: {
        "circle-color": color,
        "circle-radius": r.radius ?? 6,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": (r.radius ?? 6) >= 4 ? 1.5 : 0,
        "circle-opacity": 0.9 * start,
        "circle-stroke-opacity": 0.9 * start,
        "circle-opacity-transition": { duration: 700 },
      },
    });

    const entry: Entry = { key, group, name: r.layer, source: id, layers, markers: [], visible: true, color: swatch, count: features.length };
    this.entries.set(key, entry);

    // Labels come from the query's "label" column
    if (r.labels !== false) {
      for (const f of features.slice(0, 150)) {
        const text = f.properties.label;
        const at = anchor(f);
        if (text === null || text === undefined || text === "" || !at) continue;
        const el = document.createElement("div");
        el.className = "map-label";
        el.textContent = String(text);
        entry.markers.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -8] }).setLngLat(at as [number, number]).addTo(this.map));
      }
    }

    this.animateIn(entry, features, animate);
    this.fit(features, r.fit ?? "data");
    this.emit();
    return { dropped };
  }

  private animateIn(entry: Entry, features: Feature[], animate: string) {
    const src = this.map.getSource(entry.source) as GeoJSONSource | undefined;
    const set = (fs: Feature[]) => src?.setData({ type: "FeatureCollection", features: fs } as GeoJSON.FeatureCollection);
    if (animate === "fade") {
      requestAnimationFrame(() => {
        for (const l of entry.layers) this.setOpacity(l.id, l.prop, l.base);
      });
    } else if (animate === "drop") {
      const steps = Math.min(features.length, 20);
      for (let i = 1; i <= steps; i++) setTimeout(() => set(features.slice(0, Math.ceil((features.length * i) / steps))), i * 40);
    } else if (animate === "grow") {
      const frames = 24;
      for (let i = 1; i <= frames; i++) setTimeout(() => set(i === frames ? features : truncateLines(features, i / frames)), i * 35);
    }
  }

  private setOpacity(layerId: string, prop: OpacityProp, value: number) {
    if (!this.map.getLayer(layerId)) return;
    this.map.setPaintProperty(layerId, prop, value);
    if (prop === "circle-opacity") this.map.setPaintProperty(layerId, "circle-stroke-opacity", value);
  }

  private fit(features: Feature[], fit: string) {
    if (fit === "none") return;
    const b = bbox(features);
    if (!b) return;
    if (b[0] === b[2] && b[1] === b[3]) {
      this.map.easeTo({ center: [b[0], b[1]], zoom: Math.max(this.map.getZoom(), 14), duration: 700 });
      return;
    }
    this.map.fitBounds(b, { padding: 60, maxZoom: fit === "world" ? 3 : 16, duration: 800 });
  }

  // Older layers fade back so the newest step stands out.
  emphasize(activeKeys: string[]) {
    for (const e of this.entries.values()) {
      const k = activeKeys.length === 0 || activeKeys.includes(e.key) ? 1 : 0.35;
      for (const l of e.layers) this.setOpacity(l.id, l.prop, l.base * k);
      e.markers.forEach((m) => (m.getElement().style.opacity = k === 1 ? "1" : "0.45"));
    }
  }

  remove(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    e.markers.forEach((m) => m.remove());
    for (const l of e.layers) if (this.map.getLayer(l.id)) this.map.removeLayer(l.id);
    if (this.map.getSource(e.source)) this.map.removeSource(e.source);
    this.entries.delete(key);
    this.emit();
  }

  removeGroup(group: number) {
    for (const e of [...this.entries.values()]) if (e.group === group) this.remove(e.key);
  }

  setVisible(key: string, visible: boolean) {
    const e = this.entries.get(key);
    if (!e) return;
    e.visible = visible;
    for (const l of e.layers) if (this.map.getLayer(l.id)) this.map.setLayoutProperty(l.id, "visibility", visible ? "visible" : "none");
    e.markers.forEach((m) => (m.getElement().style.display = visible ? "" : "none"));
    this.emit();
  }

  // Show only the current lesson's layers (group -1 = always visible, e.g. my places).
  showGroup(group: number) {
    this.currentGroup = group;
    for (const e of this.entries.values()) this.setVisible(e.key, e.group === group || e.group === -1);
  }

  get group() {
    return this.currentGroup;
  }

  // ── input from the map ──
  startPick(kind: "point" | "tile", cb: (v: unknown) => void) {
    this.cancelPick();
    this.pick = { kind, cb, vertices: [] };
    this.map.getCanvas().style.cursor = "crosshair";
  }

  startDraw(cb: (wkt: string) => void) {
    this.cancelPick();
    this.pick = { kind: "polygon", cb: cb as (v: unknown) => void, vertices: [] };
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = "crosshair";
    this.drawPreview();
  }

  get picking() {
    return this.pick?.kind ?? null;
  }

  cancelPick() {
    this.pick = null;
    this.map.getCanvas().style.cursor = "";
    this.map.doubleClickZoom.enable();
    if (this.map.getLayer("draw-line")) this.map.removeLayer("draw-line");
    if (this.map.getLayer("draw-points")) this.map.removeLayer("draw-points");
    if (this.map.getSource("draw")) this.map.removeSource("draw");
  }

  finishDraw() {
    const p = this.pick;
    if (!p || p.kind !== "polygon" || p.vertices.length < 3) return;
    const ring = [...p.vertices, p.vertices[0]];
    const wkt = `POLYGON((${ring.map((c) => `${c[0].toFixed(6)} ${c[1].toFixed(6)}`).join(", ")}))`;
    this.cancelPick();
    p.cb(wkt);
  }

  private drawPreview() {
    const p = this.pick;
    if (!p) return;
    const coords = p.vertices.length >= 2 ? [...p.vertices, p.vertices[0]] : p.vertices;
    const data = {
      type: "FeatureCollection",
      features: [
        ...(coords.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : []),
        ...p.vertices.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })),
      ],
    } as GeoJSON.FeatureCollection;
    const src = this.map.getSource("draw") as GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      return;
    }
    this.map.addSource("draw", { type: "geojson", data });
    this.map.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": INK.primary, "line-width": 2, "line-dasharray": [2, 1] } });
    this.map.addLayer({ id: "draw-points", type: "circle", source: "draw", filter: POINT, paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": INK.primary, "circle-stroke-width": 2 } });
  }

  private onClick(ll: maplibregl.LngLat) {
    const p = this.pick;
    if (!p) return;
    const lng = ((((ll.lng + 180) % 360) + 360) % 360) - 180;
    if (p.kind === "polygon") {
      p.vertices.push([lng, ll.lat]);
      this.drawPreview();
      return;
    }
    this.cancelPick();
    if (p.kind === "point") p.cb({ lng, lat: ll.lat });
    else {
      const z = Math.min(22, Math.max(0, Math.floor(this.map.getZoom())));
      p.cb({ z, ...lngLatToTile(lng, ll.lat, z) });
    }
  }

  // ── view state for Lesson 12 ──
  viewTiles() {
    let z = Math.min(22, Math.max(0, Math.floor(this.map.getZoom())));
    const b = this.map.getBounds();
    for (;;) {
      const a = lngLatToTile(Math.max(-180, b.getWest()), Math.min(85, b.getNorth()), z);
      const c = lngLatToTile(Math.min(179.999, b.getEast()), Math.max(-85, b.getSouth()), z);
      if ((c.x - a.x + 1) * (c.y - a.y + 1) <= 200 || z === 0) return { z, x_min: a.x, x_max: c.x, y_min: a.y, y_max: c.y };
      z--;
    }
  }

  zoom() {
    return Math.round(this.map.getZoom());
  }

  async enablePgTiles() {
    await this.ready;
    if (this.pgTiles) return;
    this.pgTiles = true;
    const before = this.map.getStyle().layers.find((l) => l.id.startsWith("l"))?.id;
    this.map.addSource("pgtiles", { type: "vector", tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}`], minzoom: 10, maxzoom: 18 });
    this.map.addLayer({ id: "pg-areas", type: "fill", source: "pgtiles", "source-layer": "areas", paint: { "fill-color": "#cfe8c8", "fill-opacity": 0.8 } }, before);
    this.map.addLayer(
      {
        id: "pg-roads",
        type: "line",
        source: "pgtiles",
        "source-layer": "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "highway"], ["primary", "secondary"], "#e9b97a", "#ffffff"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 17, ["match", ["get", "highway"], ["primary", "secondary"], 8, 5]],
        },
      },
      before,
    );
    this.map.addLayer({ id: "pg-poi", type: "circle", source: "pgtiles", "source-layer": "poi", paint: { "circle-radius": 3, "circle-color": INK.muted } }, before);
  }
}

