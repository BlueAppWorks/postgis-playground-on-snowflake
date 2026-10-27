"use client";
import { useState } from "react";
import type { BlockResult } from "@/lessons/types";

export function ResultTable({ result, collapsed = false }: { result?: BlockResult; collapsed?: boolean }) {
  const [all, setAll] = useState(false);
  if (!result || !result.columns.length) {
    return result ? <div className="muted small">OK{result.rowCount ? ` — ${result.rowCount} rows affected` : ""}</div> : null;
  }
  const limit = collapsed ? 0 : all ? result.rows.length : 5;
  const rows = result.rows.slice(0, limit);
  return (
    <div className="result-table">
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={typeof v === "number" ? "num" : ""}>
                      {v === null ? <em className="muted">NULL</em> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
        {result.truncated ? " (first 500 shown)" : ""}
        {!collapsed && result.rows.length > 5 && (
          <button className="link" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : "Show all"}
          </button>
        )}
      </div>
    </div>
  );
}

export function PlanBox({ lines, executionMs }: { lines: string[]; executionMs?: number }) {
  const text = lines.join("\n");
  const scan = /Index (Only )?Scan|Bitmap Index Scan/.test(text) ? "index" : /Seq Scan/.test(text) ? "seq" : null;
  return (
    <div className="plan">
      <div className="plan-badges">
        {scan === "seq" && <span className="badge slow">Seq Scan — every row checked</span>}
        {scan === "index" && <span className="badge fast">Index used</span>}
        {executionMs !== undefined && <span className="badge">Execution {executionMs.toFixed(1)} ms</span>}
      </div>
      <pre>{text}</pre>
    </div>
  );
}
