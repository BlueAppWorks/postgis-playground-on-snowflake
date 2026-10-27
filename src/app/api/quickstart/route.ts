import { NextResponse } from "next/server";
import { getLesson } from "@/lessons";
import { runStep } from "@/server/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Quick start": Lesson 0 (extension + tables) and the sample region in one click,
// so a presenter or learner can jump to any lesson.
export async function POST() {
  const setup = getLesson(0)!;
  const neighborhood = getLesson(2)!;
  const trace = [];
  for (const stepId of ["0.1", "0.2"]) {
    const r = await runStep(setup, setup.steps.find((s) => s.id === stepId)!, {});
    trace.push(...r.trace);
    if (!r.ok) return NextResponse.json({ ...r, trace });
  }
  const seed = await runStep(neighborhood, neighborhood.steps.find((s) => s.id === "2.1")!, {}, { action: "seed" });
  return NextResponse.json({ ...seed, trace: [...trace, ...seed.trace] });
}
