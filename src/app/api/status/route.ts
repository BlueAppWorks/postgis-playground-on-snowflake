import { NextResponse } from "next/server";
import { runSql, withClient } from "@/server/db";
import { getCommon } from "@/server/sqlfiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The usual setup mistakes, by error, so the status chip can say what to fix.
function hint(e: Error & { code?: string }): string {
  if (e.code === "3D000") return "Database not set up — run scripts/postgres-setup.mjs (docs/01, step 1.3)";
  if (e.code === "28P01" || /authentication failed/i.test(e.message)) return "Wrong password — update the PG_APP_CREDENTIALS secret (docs/02)";
  if (e.code === "ENOTFOUND") return "Host not allowed — check PG_EGRESS_RULE and PGHOST (docs/02)";
  if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(`${e.code} ${e.message}`)) return "No route — check PG_INGRESS_RULE (docs/01)";
  if (/PGHOST|secret/i.test(e.message)) return "App settings incomplete — check app.yml (docs/03)";
  return "Postgres not reachable — see docs/02-external-access.md";
}

export async function GET() {
  try {
    const status = await withClient(async (client) => {
      const s = (await runSql(client, "status", getCommon("status"), {}, [])).raw[0];
      if (!s.ready) return { connected: true, ready: false, postgis: Boolean(s.postgis) };
      const c = (await runSql(client, "counts", getCommon("counts"), {}, [])).raw[0];
      return {
        connected: true,
        ready: true,
        postgis: Boolean(s.postgis),
        places: Number(c.places),
        poi: Number(c.poi),
        areas: Number(c.areas),
        roads: Number(c.roads),
        graph: Boolean(c.graph),
      };
    });
    return NextResponse.json(status);
  } catch (e) {
    // Shows up in `snow app events` / SYSTEM$GET_APPLICATION_SERVICE_LOGS — the first place to look.
    console.error("Postgres not reachable:", (e as Error).message, "→", hint(e as Error));
    return NextResponse.json({ connected: false, ready: false, error: (e as Error).message, hint: hint(e as Error) });
  }
}
