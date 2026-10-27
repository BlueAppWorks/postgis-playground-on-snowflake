import { NextResponse } from "next/server";
import { getLesson } from "@/lessons";
import { runStep } from "@/server/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    lesson?: number;
    step?: string;
    params?: Record<string, unknown>;
    action?: "seed";
    onlyBlocks?: string[];
  };
  const lesson = getLesson(Number(body.lesson));
  const step = lesson?.steps.find((s) => s.id === body.step);
  if (!lesson || !step) return NextResponse.json({ error: "Unknown lesson or step" }, { status: 400 });
  if (body.action && body.action !== step.altAction?.action) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const result = await runStep(lesson, step, body.params ?? {}, { action: body.action, onlyBlocks: body.onlyBlocks });
  return NextResponse.json(result);
}
