"use client";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lesson, RunResponse, Step } from "@/lessons/types";
import { previewSql } from "@/lib/sqlPreview";
import { fillRegion, regionValues } from "@/lib/region";
import { useShell } from "./ShellContext";
import { ControlView, previewValues, useOptions, type Values } from "./Controls";
import { PlanBox, ResultTable } from "./Results";

// Lessons whose steps change data that option lists or "my places" depend on.
const CHANGES_DATA = new Set([0, 1, 2]);

type Props = {
  lesson: Lesson;
  step: Step;
  sql: Record<string, string>;
  active: boolean;
  onFocus: () => void;
  onDone: () => void;
};

export const StepCard = forwardRef<HTMLElement, Props>(function StepCard({ lesson, step, sql, active, onFocus, onDone }, ref) {
  const { map, run, pushTrace, dataChanged, allowConsole, region } = useShell();
  const t = (s: string) => fillRegion(s, region);
  const options = useOptions(step.controls);
  const [values, setValues] = useState<Values>({});
  const [resolved, setResolved] = useState<Values>({});
  const [result, setResult] = useState<RunResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tryOpen, setTryOpen] = useState(false);
  const [trySql, setTrySql] = useState("");
  const [tryResult, setTryResult] = useState<RunResponse | null>(null);
  const reqId = useRef(0);
  const hasRun = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const preview = useMemo(
    () => ({ ...regionValues(region), ...resolved, ...previewValues(step.controls, values, options, region) }),
    [region, resolved, step.controls, values, options],
  );
  const sqlText = useMemo(() => step.blocks.map((b) => previewSql(sql[b.sql] ?? "", preview)).join(";\n\n") + ";", [step.blocks, sql, preview]);
  const layerKey = (block: string) => `${lesson.id}:${step.id}:${block}`;

  const liveValues = useCallback((): Values => {
    const v: Values = { ...values };
    for (const c of step.controls ?? []) {
      if (c.type === "mapView" && map) Object.assign(v, map.viewTiles());
      if (c.type === "mapZoom" && map) v.z = map.zoom();
    }
    return v;
  }, [values, step.controls, map]);

  const draw = useCallback(
    async (r: RunResponse, only?: string) => {
      if (!map) return;
      let dropped = 0;
      const keys: string[] = [];
      for (const [i, block] of step.blocks.entries()) {
        if (!block.render || (only && block.sql !== only)) continue;
        const res = r.results.find((x) => x.name === block.sql);
        if (!res || res.error) continue;
        dropped += (await map.render(layerKey(block.sql), lesson.id, { ...block.render, layer: t(block.render.layer) }, res.features, i)).dropped;
        keys.push(layerKey(block.sql));
      }
      if (!only) map.emphasize([...step.blocks.filter((b) => b.render).map((b) => layerKey(b.sql)), "persistent:places"]);
      setNotice(dropped ? `${dropped} shape(s) not drawn: latitude outside ±90° is not a place on Earth.` : null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, step, lesson.id],
  );

  const execute = useCallback(
    async (opts: { action?: "seed"; quiet?: boolean; patch?: Values } = {}) => {
      const id = ++reqId.current;
      setRunning(true);
      const params = { ...liveValues(), ...(opts.patch ?? {}) };
      const r = await run({ lesson: lesson.id, step: step.id, params, action: opts.action });
      if (id !== reqId.current) return; // a newer run started meanwhile
      hasRun.current = true;
      pushTrace(r.trace);
      setResult(r);
      setResolved(r.params);
      await draw(r);
      if (step.enableTiles && r.ok) await map?.enablePgTiles();
      if (step.animate && r.ok) await play();
      setRunning(false);
      if (CHANGES_DATA.has(lesson.id) && r.ok) dataChanged();
      if (!opts.quiet && r.ok) onDone();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveValues, run, lesson.id, step, pushTrace, draw, map, dataChanged, onDone],
  );

  const play = async () => {
    const a = step.animate!;
    for (let i = 1; i <= a.frames; i++) {
      await new Promise((r) => setTimeout(r, a.intervalMs));
      const r = await run({ lesson: lesson.id, step: step.id, params: { [a.param]: i / a.frames }, onlyBlocks: [a.block] });
      pushTrace(r.trace);
      if (!r.ok) break;
      await draw(r, a.block);
    }
  };

  const change = (patch: Values, runNow = false) => {
    setValues((v) => ({ ...v, ...patch }));
    if (!step.autoRun && !runNow) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => execute({ quiet: true, patch }), runNow ? 0 : 250);
  };

  // Lesson 12: re-run when the map moves
  useEffect(() => {
    if (!step.rerunOnMapMove || !map) return;
    let t: ReturnType<typeof setTimeout>;
    const off = map.onMoveEnd(() => {
      if (!hasRun.current || map.group !== lesson.id) return;
      clearTimeout(t);
      t = setTimeout(() => execute({ quiet: true }), 300);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [step.rerunOnMapMove, map, execute, lesson.id]);

  const runTry = async () => {
    const r = (await (await fetch("/api/sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: trySql }) })).json()) as RunResponse;
    pushTrace(r.trace ?? []);
    setTryResult(r);
    if (r.ok && r.results[0]?.features && map) {
      await map.render(`${lesson.id}:${step.id}:try`, lesson.id, { layer: `Try it (${step.id})`, color: "#6250d6", animate: "fade", fit: "data" }, r.results[0].features);
    }
  };

  const status = running ? "running" : result ? (result.ok ? "done" : "failed") : "todo";

  return (
    <article
      ref={ref}
      className={`step ${active ? "active" : ""} ${status}`}
      onMouseEnter={() => map?.emphasize([...step.blocks.filter((b) => b.render).map((b) => layerKey(b.sql)), "persistent:places"])}
      onFocus={onFocus}
      onClick={onFocus}
      tabIndex={-1}
    >
      <header>
        <span className="step-id">{step.id}</span>
        <h3>{t(step.title)}</h3>
        <span className={`dot ${status}`} aria-label={status} />
      </header>
      <p className="goal">{t(step.goal)}</p>

      {step.controls && step.controls.length > 0 && (
        <div className="controls">
          {step.controls.map((c) => (
            <ControlView key={c.name + c.type} control={c} values={values} options={options} onChange={change} />
          ))}
        </div>
      )}

      <div className="sql-box">
        <pre className="sql">{sqlText}</pre>
        <button className="copy ghost" onClick={() => navigator.clipboard.writeText(sqlText)}>
          Copy
        </button>
      </div>

      <div className="actions">
        <button className="primary" disabled={running} onClick={() => execute()}>
          {running ? "Running…" : t(step.runLabel ?? "Run")}
        </button>
        {step.altAction && (
          <button disabled={running} onClick={() => execute({ action: step.altAction!.action })}>
            {t(step.altAction.label)}
          </button>
        )}
        {allowConsole && (
          <button
            className="ghost"
            onClick={() => {
              setTrySql(sqlText);
              setTryOpen(!tryOpen);
            }}
          >
            {tryOpen ? "Close Try it" : "Try it ✎"}
          </button>
        )}
      </div>

      {result?.messages?.length ? (
        <ul className="messages">
          {result.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {result?.error && <div className="err">{result.error}</div>}
      {notice && <div className="note">{notice}</div>}

      {result &&
        result.results.map((r) => (
          <div key={r.name} className="block-result">
            {r.expectedError && r.error ? (
              <div className="note">
                <strong>Expected error:</strong> {r.error}
              </div>
            ) : r.error ? null : r.plan ? (
              <PlanBox lines={r.plan} executionMs={r.executionMs} />
            ) : step.blocks.find((b) => b.sql === r.name)?.hideTable ? (
              <div className="muted small">
                {r.name}: {r.rowCount} rows drawn on the map
              </div>
            ) : (
              <ResultTable result={r} collapsed={!active} />
            )}
          </div>
        ))}

      {result?.ok && (
        <details className="explain" open={active}>
          <summary>What just happened</summary>
          <p>{t(step.explain)}</p>
        </details>
      )}

      {step.snowflakeSql && (
        <div className="snowflake">
          <div className="snowflake-head">
            Run in Snowflake (not in this app)
            <button className="ghost" onClick={() => navigator.clipboard.writeText(step.snowflakeSql!)}>
              Copy
            </button>
          </div>
          <pre className="sql">{step.snowflakeSql}</pre>
        </div>
      )}

      {tryOpen && (
        <div className="try">
          <textarea value={trySql} onChange={(e) => setTrySql(e.target.value)} spellCheck={false} rows={Math.min(16, trySql.split("\n").length + 1)} />
          <div className="actions">
            <button className="primary" onClick={runTry}>
              Run my SQL
            </button>
            <span className="muted small">Any geometry column in the result is drawn on the map.</span>
          </div>
          {tryResult?.error && <div className="err">{tryResult.error}</div>}
          {tryResult?.ok && (tryResult.results[0]?.plan ? <PlanBox lines={tryResult.results[0].plan} /> : <ResultTable result={tryResult.results[0]} />)}
        </div>
      )}
    </article>
  );
});
