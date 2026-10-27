"use client";
import { useEffect, useState } from "react";
import { useShell } from "./ShellContext";
import type { LayerInfo } from "./map/controller";

// The legend: every layer drawn by a step, newest last. Toggle to compare steps.
export function LayerPanel() {
  const { map } = useShell();
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!map) return;
    const update = () => setLayers(map.layers().filter((l) => l.group === -1 || l.group === map.group));
    update();
    const off = map.subscribe(update);
    return () => {
      off();
    };
  }, [map]);
  if (!layers.length) return null;
  return (
    <div className="layer-panel">
      <button className="layer-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        Layers ({layers.length}) {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul>
          {layers.map((l) => (
            <li key={l.key}>
              <label>
                <input type="checkbox" checked={l.visible} onChange={(e) => map?.setVisible(l.key, e.target.checked)} />
                <span className="swatch" style={{ background: l.color }} />
                {l.key.includes(":") && !l.key.startsWith("persistent") ? <span className="muted">{l.key.split(":")[1]} </span> : null}
                {l.name} <span className="muted">({l.count})</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
