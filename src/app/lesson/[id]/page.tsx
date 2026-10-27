import { notFound } from "next/navigation";
import { getLesson } from "@/lessons";
import { LessonPanel } from "@/components/LessonPanel";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getLesson(Number(id))) notFound();
  return <LessonPanel lessonId={Number(id)} />;
}
