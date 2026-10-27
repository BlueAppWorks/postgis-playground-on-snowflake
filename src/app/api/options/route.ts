import { NextResponse } from "next/server";
import { LESSONS } from "@/lessons";
import { runSql, withClient } from "@/server/db";
import { getCommon } from "@/server/sqlfiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set(
  LESSONS.flatMap((l) => l.steps.flatMap((s) => (s.controls ?? []).flatMap((c) => (c.type === "select" && c.optionsQuery ? [c.optionsQuery] : [])))),
);
ALLOWED.add("places_options");

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!ALLOWED.has(name)) return NextResponse.json({ error: "Unknown option list" }, { status: 400 });
  try {
    const options = await withClient(async (client) => {
      const out = await runSql(client, `options: ${name}`, getCommon(name), {}, []);
      return out.raw.map((r) => ({ value: String(r.value), label: String(r.label) }));
    });
    return NextResponse.json({ options });
  } catch {
    return NextResponse.json({ options: [] });
  }
}
