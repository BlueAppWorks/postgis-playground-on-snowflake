import { NextResponse } from "next/server";
import { runSql, withClient } from "@/server/db";
import type { TraceEntry } from "@/lessons/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Drops everything the lessons created. Extensions stay installed.
export async function POST() {
  const trace: TraceEntry[] = [];
  try {
    await withClient((client) => runSql(client, "reset", "DROP SCHEMA IF EXISTS geo CASCADE", {}, trace));
    return NextResponse.json({ ok: true, trace });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, trace });
  }
}
