"use client";
import { useState } from "react";
import type { RunResponse, TraceEntry } from "@/lessons/types";
import { inlineDollarParams } from "@/lib/sqlPreview";
import { useShell } from "./ShellContext";
import { ResultTable, PlanBox } from "./Results";

// Every statement the app sent to Postgres (and every HTTP call it made), newest first.
export function TraceBar({ entries, onClear }: { entries: TraceEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [explained, setExplained] = useState<{ at: string; res: RunResponse } | null>(null);
  const { allowConsole } = useShell();
  const last = entries[0];

  const explain = async (e: TraceEntry) => {
    const sql = `EXPLAIN (ANALYZE, COSTS OFF) ${inlineDollarParams(e.sql, e.params)}`;
    const res = (await (await fetch("/api/sql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql }) })).json()) as RunResponse;
    setExplained({ at: e.at + e.label, res });
  };

  return (
    <footer className={`trace ${open ? "open" : ""}`}>
      <div className="trace-head">
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          SQL Trace {open ? "▾" : "▴"} <span className="muted">({entries.length})</span>
        </button>
        {last && !open && (
          <code className="trace-last" title={last.sql}>
            {last.kind === "http" ? "HTTP " : ""}
            {last.sql.replace(/\s+/g, " ").slice(0, 160)}
          </code>
        )}
        {last && !open && <span className="muted">{last.ms} ms</span>}
        {open && (
          <button className="ghost" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <ol className="trace-list">
          {entries.map((e, i) => (
            <li key={i} className={e.error ? "error" : ""}>
              <div className="trace-meta">
                <span className={`kind ${e.kind}`}>{e.kind.toUpperCase()}</span>
                <strong>{e.label}</strong>
                <span className="muted">
                  {new Date(e.at).toLocaleTimeString()} · {e.ms} ms{e.rows !== undefined ? ` · ${e.rows} rows` : ""}
                </span>
                <button className="ghost" onClick={() => navigator.clipboard.writeText(inlineDollarParams(e.sql, e.params))}>
                  Copy
                </button>
                {allowConsole && e.kind === "sql" && /^\s*(--[^\n]*\n\s*)*(select|with)\b/i.test(e.sql) && (
                  <button className="ghost" onClick={() => explain(e)}>
                    EXPLAIN
                  </button>
                )}
              </div>
              <pre className="sql">{e.sql}</pre>
              {e.params && e.params.length > 0 && (
                <div className="params">
                  {e.params.map((p, j) => (
                    <span key={j}>
                      ${j + 1} = <code>{p}</code>
                    </span>
                  ))}
                </div>
              )}
              {e.error && <div className="err">{e.error}</div>}
              {explained?.at === e.at + e.label &&
                (explained.res.ok ? <PlanBox lines={explained.res.results[0]?.plan ?? []} /> : <div className="err">{explained.res.error}</div>)}
              {explained?.at === e.at + e.label && explained.res.ok && !explained.res.results[0]?.plan && <ResultTable result={explained.res.results[0]} />}
            </li>
          ))}
        </ol>
      )}
    </footer>
  );
}
