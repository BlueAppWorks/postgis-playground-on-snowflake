import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { Pool, type PoolClient, type FieldDef } from "pg";
import { ewkbToGeoJSON, summarizeGeometry, type Geometry } from "./ewkb";
import type { TraceEntry } from "@/lessons/types";

// On App Runtime, the password secret from app.yml is mounted as files:
//   /secrets/<mount name>/username and /secrets/<mount name>/password
// Locally, PGUSER / PGPASSWORD environment variables are used instead.
const SECRET_DIR = process.env.PG_SECRET_DIR ?? "/secrets/pg";

function readSecret(file: string, envName: string): string | undefined {
  const path = `${SECRET_DIR}/${file}`;
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  return process.env[envName];
}

function sslOptions() {
  const ca = process.env.PGSSL_CA;
  if (!ca) return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, ca: ca.includes("BEGIN CERTIFICATE") ? ca : readFileSync(ca, "utf8") };
}

const g = globalThis as unknown as { __pgPool?: Pool };

export function getPool(): Pool {
  if (g.__pgPool) return g.__pgPool;
  if (!process.env.PGHOST) {
    throw new Error("PGHOST is not set. See docs/02-external-access.md (app.yml environment_variables).");
  }
  const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "postgis_playground",
    user: readSecret("username", "PGUSER"),
    // Read on every new connection so a rotated secret is picked up without a restart.
    password: async () => readSecret("password", "PGPASSWORD") ?? "",
    // Snowflake Postgres certificates are issued by a Snowflake CA, not a public one. Without PGSSL_CA
    // the connection is encrypted but the certificate is not verified (like libpq's sslmode=require).
    // Set PGSSL_CA to the CA certificate (PEM text or a file path) to verify it.
    ssl: sslOptions(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: "postgis-playground",
  });
  pool.on("connect", (client) => {
    client.query("SET statement_timeout = '30s'").catch(() => {});
  });
  g.__pgPool = pool;
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ── geometry type detection ──
// PostGIS types get their OIDs when the extension is created, so look them up lazily
// (and keep looking until Lesson 0 has installed PostGIS).
let geoOids: Set<number> | null = null;

async function geometryOids(client: PoolClient): Promise<Set<number>> {
  if (geoOids && geoOids.size > 0) return geoOids;
  const r = await client.query("SELECT oid FROM pg_type WHERE typname IN ('geometry', 'geography')");
  geoOids = new Set(r.rows.map((x) => Number(x.oid)));
  return geoOids;
}

// ── named parameters ──
// Lesson SQL uses :name placeholders (readable in the UI). They are converted to $1, $2 ...
// and always sent as bind parameters, never concatenated into the SQL text.
// Identifiers that cannot be bound (e.g. a function name) use {{name}} and must be whitelisted by the caller.
const NAMED = /(?<![:\w]):([a-zA-Z_]\w*)/g;

export function namedParams(sql: string): string[] {
  return [...new Set([...sql.matchAll(NAMED)].map((m) => m[1]))];
}

export function bindNamed(sql: string, values: Record<string, unknown>) {
  const order: string[] = [];
  const text = sql.replace(NAMED, (_m, name: string) => {
    if (!(name in values)) throw new Error(`Missing parameter :${name}`);
    let i = order.indexOf(name);
    if (i < 0) i = order.push(name) - 1;
    return `$${i + 1}`;
  });
  return { text, values: order.map((n) => values[n]), names: order };
}

export function substituteIdentifiers(sql: string, identifiers: Record<string, string>) {
  return sql.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const v = identifiers[name];
    if (!v) throw new Error(`Missing identifier {{${name}}}`);
    return v;
  });
}

// ── query execution with trace ──
export type QueryOutput = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  geometries: { columnIndex: number; values: (Geometry | null)[] } | null;
  raw: Record<string, unknown>[];
};

const MAX_TABLE_ROWS = 500;

function displayValue(v: unknown, isGeo: boolean): unknown {
  if (v === null || v === undefined) return null;
  if (isGeo && typeof v === "string") return summarizeGeometry(v);
  if (Buffer.isBuffer(v)) return `<bytea ${v.length} bytes>`;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function previewParam(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined) return "NULL";
  if (s.length <= 120) return s;
  return `${s.slice(0, 80)}… (${(s.length / 1024).toFixed(0)} KB)`;
}

export async function runSql(
  client: PoolClient,
  label: string,
  sql: string,
  params: Record<string, unknown>,
  trace: TraceEntry[],
): Promise<QueryOutput> {
  const started = Date.now();
  const bound = bindNamed(sql, params);
  const entry: TraceEntry = {
    kind: "sql",
    label,
    sql: bound.text.trim(),
    params: bound.values.map(previewParam),
    ms: 0,
    at: new Date().toISOString(),
  };
  trace.push(entry);
  try {
    // Without parameters, use the simple protocol so a block may contain several statements.
    const res = bound.values.length
      ? await client.query({ text: bound.text, values: bound.values })
      : await client.query(bound.text);
    const results = Array.isArray(res) ? res : [res];
    const last = [...results].reverse().find((r) => r.fields && r.fields.length > 0) ?? results[results.length - 1];
    entry.ms = Date.now() - started;
    entry.rows = last.rowCount ?? last.rows?.length ?? 0;
    return await shape(client, last.fields ?? [], last.rows ?? [], last.rowCount ?? 0);
  } catch (e) {
    entry.ms = Date.now() - started;
    entry.error = (e as Error).message;
    throw e;
  }
}

async function shape(client: PoolClient, fields: FieldDef[], rows: Record<string, unknown>[], rowCount: number): Promise<QueryOutput> {
  const oids = fields.length ? await geometryOids(client) : new Set<number>();
  const geoIdx = fields.findIndex((f) => oids.has(f.dataTypeID));
  const columns = fields.map((f) => f.name);
  const tableRows = rows.slice(0, MAX_TABLE_ROWS).map((r) =>
    fields.map((f, i) => displayValue(r[f.name], oids.has(fields[i].dataTypeID))),
  );
  let geometries: QueryOutput["geometries"] = null;
  if (geoIdx >= 0) {
    const name = fields[geoIdx].name;
    geometries = {
      columnIndex: geoIdx,
      values: rows.map((r) => (typeof r[name] === "string" ? ewkbToGeoJSON(r[name] as string) : null)),
    };
  }
  return {
    columns,
    rows: tableRows,
    rowCount: rowCount || rows.length,
    truncated: rows.length > MAX_TABLE_ROWS,
    geometries,
    raw: rows,
  };
}

// Builds a GeoJSON FeatureCollection from a query result: the first geometry column becomes
// the geometry, every other column becomes a property (so SQL controls labels and colors).
export function toFeatureCollection(out: QueryOutput) {
  if (!out.geometries) return null;
  const geoName = out.columns[out.geometries.columnIndex];
  const features = [];
  for (let i = 0; i < out.raw.length; i++) {
    const geometry = out.geometries.values[i];
    if (!geometry) continue;
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.raw[i])) {
      if (k === geoName) continue;
      properties[k] = typeof v === "object" && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v;
    }
    features.push({ type: "Feature" as const, geometry, properties });
  }
  return { type: "FeatureCollection" as const, features };
}
