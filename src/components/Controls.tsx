"use client";
import { useEffect, useState } from "react";
import type { Control, Region } from "@/lessons/types";
import { fillRegion, regionValues } from "@/lib/region";
import { useShell } from "./ShellContext";

export type Option = { value: string; label: string };
export type Values = Record<string, unknown>;

// Option lists that come from SQL (places, categories, streets, parks) reload when data changes.
export function useOptions(controls: Control[] = []) {
  const { dataVersion } = useShell();
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const queries = [...new Set(controls.flatMap((c) => (c.type === "select" && c.optionsQuery ? [c.optionsQuery] : c.type === "placeOrder" ? ["places_options"] : [])))];
  const key = queries.join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(key.split(",").map((q) => fetch(`/api/options?name=${q}`).then((r) => r.json()).then((d) => [q, d.options ?? []] as const))).then((pairs) => {
      if (!cancelled) setOptions(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key, dataVersion]);
  return options;
}

// Parameter values as the server will resolve them — used to preview the SQL before running.
export function previewValues(controls: Control[] = [], values: Values, options: Record<string, Option[]>, region: Region | null = null): Values {
  const out: Values = {};
  const rv = regionValues(region);
  for (const c of controls) {
    if (c.type === "slider") out[c.name] = values[c.name] ?? c.default;
    if (c.type === "select") {
      if (c.options) {
        const opt = c.options.find((o) => o.value === (values[c.name] ?? c.default ?? c.options![0].value));
        if (opt) {
          out[c.name] = opt.value;
          for (const [k, v] of Object.entries(opt.params ?? {})) out[k] = typeof v === "string" && v.startsWith("$") ? rv[v.slice(1)] : v;
        }
      } else {
        const list = options[c.optionsQuery!] ?? [];
        const v = values[c.name] ?? (c.default && list.some((o) => o.value === c.default) ? c.default : list[c.defaultIndex ?? 0]?.value);
        if (v !== undefined) out[c.name] = c.valueType === "int" ? Number(v) : v;
      }
    }
    if (c.type === "mapClick" && values[`${c.name}_lng`] !== undefined) {
      out[`${c.name}_lng`] = values[`${c.name}_lng`];
      out[`${c.name}_lat`] = values[`${c.name}_lat`];
    }
    if (c.type === "mapClickTile" && values.z !== undefined) Object.assign(out, { z: values.z, x: values.x, y: values.y });
    if (c.type === "drawPolygon" && values[c.name]) out[c.name] = values[c.name];
    if (c.type === "placeOrder") out[c.name] = values[c.name] ?? (options.places_options ?? []).map((o) => Number(o.value));
  }
  return out;
}

const fmt = (n: unknown) => (typeof n === "number" ? n.toFixed(5) : String(n));

export function ControlView({
  control: c,
  values,
  options,
  onChange,
}: {
  control: Control;
  values: Values;
  options: Record<string, Option[]>;
  onChange: (patch: Values, runNow?: boolean) => void;
}) {
  const { map, region } = useShell();
  const [picking, setPicking] = useState(false);

  useEffect(() => () => {
    if (picking) map?.cancelPick();
  }, [picking, map]);

  switch (c.type) {
    case "slider": {
      const v = Number(values[c.name] ?? c.default);
      return (
        <label className="control">
          <span>{c.label}</span>
          <input type="range" min={c.min} max={c.max} step={c.step} value={v} onChange={(e) => onChange({ [c.name]: Number(e.target.value) })} />
          <output>
            {v}
            {c.unit ? ` ${c.unit}` : ""}
          </output>
        </label>
      );
    }
    case "select": {
      const list: Option[] = c.options ?? options[c.optionsQuery!] ?? [];
      const current = String(values[c.name] ?? (c.default && list.some((o) => o.value === c.default) ? c.default : list[c.defaultIndex ?? 0]?.value ?? ""));
      return (
        <label className="control">
          <span>{c.label}</span>
          <select value={current} onChange={(e) => onChange({ [c.name]: e.target.value })}>
            {list.length === 0 && <option value="">(no data yet)</option>}
            {list.map((o) => (
              <option key={o.value} value={o.value}>
                {fillRegion(o.label, region)}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case "mapClick": {
      const lng = values[`${c.name}_lng`];
      const lat = values[`${c.name}_lat`];
      return (
        <div className="control">
          <span>{c.label}</span>
          <button
            className={picking ? "active" : ""}
            onClick={() => {
              setPicking(true);
              map?.startPick("point", (v) => {
                setPicking(false);
                const p = v as { lng: number; lat: number };
                onChange({ [`${c.name}_lng`]: Number(p.lng.toFixed(6)), [`${c.name}_lat`]: Number(p.lat.toFixed(6)) }, true);
              });
            }}
          >
            {picking ? "Click on the map…" : "⌖ Pick on map"}
          </button>
          <output className="muted">{lng !== undefined ? `${fmt(lng)}, ${fmt(lat)}` : "default: center of my places"}</output>
        </div>
      );
    }
    case "mapClickTile":
      return (
        <div className="control">
          <span>{c.label}</span>
          <button
            className={picking ? "active" : ""}
            onClick={() => {
              setPicking(true);
              map?.startPick("tile", (v) => {
                setPicking(false);
                onChange(v as Values, true);
              });
            }}
          >
            {picking ? "Click on the map…" : "⌖ Pick a tile"}
          </button>
          <output className="muted">{values.z !== undefined ? `${values.z}/${values.x}/${values.y}` : "default: zoom 15 at the center"}</output>
        </div>
      );
    case "drawPolygon": {
      const wkt = values[c.name] as string | undefined;
      return (
        <div className="control">
          <span>{c.label}</span>
          {!picking ? (
            <button
              onClick={() => {
                setPicking(true);
                map?.startDraw((w) => {
                  setPicking(false);
                  onChange({ [c.name]: w }, true);
                });
              }}
            >
              ✎ Draw on map
            </button>
          ) : (
            <span className="draw-actions">
              <button className="active" onClick={() => map?.finishDraw()}>
                Finish
              </button>
              <button
                className="ghost"
                onClick={() => {
                  map?.cancelPick();
                  setPicking(false);
                }}
              >
                Cancel
              </button>
            </span>
          )}
          <output className="muted">
            {picking ? "Click to add corners, double-click to finish" : wkt ? `${wkt.split(",").length - 1} corners` : "default: a square at the center"}
          </output>
        </div>
      );
    }
    case "placeOrder": {
      const list = options.places_options ?? [];
      const ids = (values[c.name] as number[] | undefined) ?? list.map((o) => Number(o.value));
      const name = (id: number) => list.find((o) => Number(o.value) === id)?.label ?? `#${id}`;
      const move = (i: number, d: number) => {
        const next = [...ids];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        onChange({ [c.name]: next });
      };
      return (
        <div className="control column">
          <span>{c.label}</span>
          <ol className="order">
            {ids.map((id, i) => (
              <li key={id}>
                <span>{name(id)}</span>
                <button className="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button className="ghost" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case "textList": {
      const rows = (values[c.name] as { name: string; kind: string }[] | undefined) ?? [{ name: "", kind: "home" }];
      const set = (i: number, patch: Partial<{ name: string; kind: string }>) => onChange({ [c.name]: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
      return (
        <div className="control column">
          <span>{c.label}</span>
          {rows.map((r, i) => (
            <div className="text-row" key={i}>
              <input value={r.name} placeholder={i === 0 ? "e.g. Golden Gate Park, San Francisco" : "Another place"} onChange={(e) => set(i, { name: e.target.value })} />
              <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value })}>
                <option value="home">home</option>
                <option value="work">work</option>
                <option value="station">station</option>
                <option value="favorite">favorite</option>
              </select>
            </div>
          ))}
          {rows.length < c.max && (
            <button className="ghost" onClick={() => onChange({ [c.name]: [...rows, { name: "", kind: "favorite" }] })}>
              + Add a place
            </button>
          )}
        </div>
      );
    }
    case "mapView":
      return <div className="control column muted">Uses the tiles currently in view — pan or zoom the map.</div>;
    case "mapZoom":
      return <div className="control column muted">Uses the current map zoom — zoom in and out.</div>;
  }
}
