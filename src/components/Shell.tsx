"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LESSONS } from "@/lessons";
import type { Region, RunResponse, TraceEntry } from "@/lessons/types";
import { ShellContext, type ShellApi, type Status } from "./ShellContext";
import { MapController } from "./map/controller";
import { LayerPanel } from "./LayerPanel";
import { TraceBar } from "./TraceBar";

const LEVEL_LABEL = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" } as const;

export function Shell({ basemap, allowConsole, region, children }: { basemap: string; allowConsole: boolean; region: Region; children: ReactNode }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapController | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [split, setSplit] = useState(50);
  const [busy, setBusy] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const lessonId = Number(pathname.match(/\/lesson\/(\d+)/)?.[1] ?? 0);

  useEffect(() => {
    if (!mapEl.current) return;
    const c = new MapController(mapEl.current, basemap, [region.anchor.lng, region.anchor.lat]);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map: MapController }).__map = c;
    setMap(c);
    return () => c.map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  useEffect(() => {
    setPresent(new URLSearchParams(window.location.search).has("present"));
    try {
      const saved = Number(localStorage.getItem("split"));
      if (saved >= 25 && saved <= 75) setSplit(saved);
    } catch {
      // storage unavailable
    }
  }, []);

  const refreshStatus = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false, ready: false }));
  }, []);
  useEffect(refreshStatus, [refreshStatus]);

  const pushTrace = useCallback((entries: TraceEntry[]) => {
    if (entries.length) setTrace((t) => [...entries.slice().reverse(), ...t].slice(0, 300));
  }, []);

  const run = useCallback<ShellApi["run"]>(async (body) => {
    const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as RunResponse;
  }, []);

  // My places stay on the map in every lesson (layer group -1).
  const refreshPlaces = useCallback(async () => {
    if (!map) return;
    const r = await run({ lesson: 2, step: "2.1", onlyBlocks: ["places"] });
    const fc = r.results[0]?.features;
    if (r.ok && fc) await map.render("persistent:places", -1, { layer: "My places", color: "#2a78d6", radius: 8, animate: "none", fit: "none" }, fc);
    map.showGroup(lessonId);
  }, [map, run, lessonId]);

  const dataChanged = useCallback(() => {
    setDataVersion((v) => v + 1);
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.ready) refreshPlaces();
  }, [status?.ready, dataVersion, refreshPlaces]);

  useEffect(() => {
    map?.showGroup(lessonId);
  }, [map, lessonId]);

  // ← → switch lessons (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" && lessonId < LESSONS.length - 1) router.push(`/lesson/${lessonId + 1}${window.location.search}`);
      if (e.key === "ArrowLeft" && lessonId > 0) router.push(`/lesson/${lessonId - 1}${window.location.search}`);
      if (e.key === "Escape") map?.cancelPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lessonId, router, map]);

  const quickstart = async () => {
    setBusy(`Setting up and loading the ${region.name} sample…`);
    const r = (await (await fetch("/api/quickstart", { method: "POST" })).json()) as RunResponse;
    pushTrace(r.trace ?? []);
    setBusy(r.ok ? null : `Quick start failed: ${r.error}`);
    dataChanged();
  };

  const reset = async () => {
    if (!window.confirm("Drop the geo schema and everything the lessons created?")) return;
    const r = await (await fetch("/api/reset", { method: "POST" })).json();
    pushTrace(r.trace ?? []);
    for (const l of LESSONS) map?.removeGroup(l.id);
    map?.remove("persistent:places");
    dataChanged();
  };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setSplit(Math.min(75, Math.max(25, (ev.clientX / window.innerWidth) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSplit((s) => {
        try {
          localStorage.setItem("split", String(Math.round(s)));
        } catch {
          // storage unavailable
        }
        map?.map.resize();
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  useEffect(() => {
    map?.map.resize();
  }, [split, map]);

  const api = useMemo<ShellApi>(
    () => ({ map, status, dataVersion, refreshStatus, dataChanged, pushTrace, run, allowConsole, region }),
    [map, status, dataVersion, refreshStatus, dataChanged, pushTrace, run, allowConsole, region],
  );

  const go = (id: number) => router.push(`/lesson/${id}${typeof window !== "undefined" ? window.location.search : ""}`);

  return (
    <ShellContext.Provider value={api}>
      <div className={`app ${present ? "present" : ""}`} style={{ ["--split" as string]: `${split}%` }}>
        <header className="topbar">
          <div className="brand">
            <strong>PostGIS Playground</strong>
            <span className="muted">on Snowflake Postgres</span>
          </div>
          <nav className="tabs" aria-label="Lessons">
            {LESSONS.map((l) => (
              <button
                key={l.id}
                className={`tab level-${l.level} ${l.id === lessonId ? "active" : ""}`}
                onClick={() => go(l.id)}
                title={`${l.id}. ${l.title} (${LEVEL_LABEL[l.level]})`}
                aria-current={l.id === lessonId ? "page" : undefined}
              >
                {l.id}
              </button>
            ))}
          </nav>
          <div className="pager">
            <button disabled={lessonId === 0} onClick={() => go(lessonId - 1)}>
              ◀ Prev
            </button>
            <button disabled={lessonId === LESSONS.length - 1} onClick={() => go(lessonId + 1)}>
              Next ▶
            </button>
          </div>
          <StatusChip status={status} regionName={region.name} onQuickstart={quickstart} onReset={reset} />
        </header>
        {busy && (
          <div className="banner" role="status">
            {busy} {!busy.endsWith("…") && <button onClick={() => setBusy(null)}>Dismiss</button>}
          </div>
        )}
        <main className="workspace">
          <section className="map-pane">
            <div ref={mapEl} className="map" />
            <LayerPanel />
          </section>
          <div className="divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" title="Drag to resize" />
          <section className="lesson-pane">{children}</section>
        </main>
        <TraceBar entries={trace} onClear={() => setTrace([])} />
      </div>
    </ShellContext.Provider>
  );
}

function StatusChip({ status, regionName, onQuickstart, onReset }: { status: Status | null; regionName: string; onQuickstart: () => void; onReset: () => void }) {
  if (!status) return <div className="status muted">Connecting…</div>;
  if (!status.connected)
    return (
      <div className="status error" title={status.error}>
        ● {status.hint ?? "Postgres not reachable — see docs/02-external-access.md"}
      </div>
    );
  return (
    <div className="status">
      <span className={status.ready ? "ok" : "warn"}>●</span>{" "}
      {status.ready ? `${status.places} places · ${status.poi} POI · ${status.roads} roads` : "Empty database"}
      <button onClick={onQuickstart} title={`Run Lesson 0 and load the ${regionName} sample`}>
        Quick start
      </button>
      <button onClick={onReset} className="ghost">
        Reset
      </button>
    </div>
  );
}
