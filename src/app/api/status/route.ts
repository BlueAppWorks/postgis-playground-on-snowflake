import { NextResponse } from "next/server";
import { runSql, withClient } from "@/server/db";
import { getCommon } from "@/server/sqlfiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    return NextResponse.json({ connected: false, ready: false, error: (e as Error).message });
  }
}
