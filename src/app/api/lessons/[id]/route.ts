import { NextResponse } from "next/server";
import { getLesson } from "@/lessons";
import { getSql } from "@/server/sqlfiles";

export const dynamic = "force-dynamic";

// The lesson definition plus the exact SQL text of every block, for display in the browser.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const lesson = getLesson(Number(id));
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const sql: Record<string, string> = {};
  for (const step of lesson.steps) {
    for (const block of step.blocks) sql[block.sql] = getSql(lesson.sqlFile, block.sql);
  }
  return NextResponse.json({ lesson, sql });
}
