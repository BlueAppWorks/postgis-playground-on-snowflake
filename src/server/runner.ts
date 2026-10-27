import "server-only";
import type { BlockResult, Lesson, RunResponse, Step, TraceEntry } from "@/lessons/types";
import { runSql, substituteIdentifiers, toFeatureCollection, withClient } from "./db";
import { getSql } from "./sqlfiles";
import { ParamError, resolveParams } from "./params";
import { geocodePlaces, loadSeed, osmImport } from "./osm";

function friendly(e: unknown): string {
  const msg = (e as Error).message ?? String(e);
  if (/relation "geo\.\w+" does not exist|schema "geo" does not exist/.test(msg)) return `${msg} — run Lesson 0 first (or use "Quick start").`;
  if (/function pgr_|extension "pgrouting"/.test(msg)) return `${msg} — pgRouting must be enabled by an admin. See docs/01-snowflake-postgres.md.`;
  if (/function h3_|extension "h3/.test(msg)) return `${msg} — the h3 extension must be enabled by an admin. See docs/01-snowflake-postgres.md.`;
  if (/road_edges|road_nodes/.test(msg)) return `${msg} — build the street graph in step 8.2 first.`;
  return msg;
}

export async function runStep(
  lesson: Lesson,
  step: Step,
  raw: Record<string, unknown>,
  opts: { action?: "seed"; onlyBlocks?: string[] } = {},
): Promise<RunResponse> {
  const trace: TraceEntry[] = [];
  const results: BlockResult[] = [];
  let messages: string[] = [];
  let params: Record<string, unknown> = {};
  try {
    return await withClient(async (client) => {
      const action = opts.action ?? (opts.onlyBlocks ? undefined : step.action);
      if (action === "seed") messages = await loadSeed(client, trace);
      if (action === "geocode") {
        const list = Array.isArray(raw.places) ? (raw.places as { name: string; kind: string }[]).slice(0, 5) : [];
        if (!list.some((p) => p?.name?.trim())) throw new ParamError("Enter at least one place name.");
        messages = await geocodePlaces(client, list, trace);
      }

      const resolved = await resolveParams(step, raw, client, trace);
      params = { ...resolved.values, ...resolved.identifiers };
      if (action === "osmImport") await osmImport(client, Number(resolved.values.radius), trace);

      for (const block of step.blocks) {
        if (opts.onlyBlocks && !opts.onlyBlocks.includes(block.sql)) continue;
        const sql = substituteIdentifiers(getSql(lesson.sqlFile, block.sql), resolved.identifiers);
        try {
          const out = await runSql(client, `${step.id} ${block.sql}`, sql, resolved.values, trace);
          const result: BlockResult = {
            name: block.sql,
            columns: out.columns,
            rows: out.rows,
            rowCount: out.rowCount,
            truncated: out.truncated,
          };
          if (block.plan) {
            result.plan = out.raw.map((r) => String(Object.values(r)[0]));
            const m = result.plan.join("\n").match(/Execution Time: ([\d.]+) ms/);
            if (m) result.executionMs = Number(m[1]);
          }
          if (block.render) result.features = toFeatureCollection(out);
          results.push(result);
        } catch (e) {
          results.push({ name: block.sql, columns: [], rows: [], rowCount: 0, truncated: false, error: friendly(e), expectedError: block.mayError });
          if (!block.mayError) break;
        }
      }
      const failed = results.find((r) => r.error && !r.expectedError);
      return { ok: !failed, results, params, trace, messages, error: failed?.error };
    });
  } catch (e) {
    return { ok: false, results, params, trace, messages, error: friendly(e) };
  }
}

// Runs any SQL typed by the learner ("Try it"). Disabled with ALLOW_SQL_CONSOLE=false.
export async function runConsole(sql: string): Promise<RunResponse> {
  const trace: TraceEntry[] = [];
  try {
    return await withClient(async (client) => {
      const out = await runSql(client, "Try it", sql, {}, trace);
      const result: BlockResult = {
        name: "try_it",
        columns: out.columns,
        rows: out.rows,
        rowCount: out.rowCount,
        truncated: out.truncated,
        features: toFeatureCollection(out),
      };
      if (/^\s*explain/i.test(sql)) result.plan = out.raw.map((r) => String(Object.values(r)[0]));
      return { ok: true, results: [result], params: {}, trace, messages: [] };
    });
  } catch (e) {
    return { ok: false, results: [], params: {}, trace, messages: [], error: friendly(e) };
  }
}
