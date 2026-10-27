import { NextResponse } from "next/server";
import { runConsole } from "@/server/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (process.env.ALLOW_SQL_CONSOLE === "false") {
    return NextResponse.json({ ok: false, error: "The SQL console is disabled on this deployment (ALLOW_SQL_CONSOLE=false)." }, { status: 403 });
  }
  const { sql } = (await req.json().catch(() => ({}))) as { sql?: string };
  if (!sql?.trim() || sql.length > 20_000) return NextResponse.json({ ok: false, error: "Enter a SQL statement." }, { status: 400 });
  return NextResponse.json(await runConsole(sql));
}
