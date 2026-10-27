"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Lesson } from "@/lessons/types";
import { StepCard } from "./StepCard";
import { useShell } from "./ShellContext";
import { fillRegion } from "@/lib/region";

const LEVEL_LABEL = { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced" } as const;

export function LessonPanel({ lessonId }: { lessonId: number }) {
  const { map, status, region } = useShell();
  const [data, setData] = useState<{ lesson: Lesson; sql: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setData(null);
    setActive(0);
    fetch(`/api/lessons/${lessonId}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)));
    scroller.current?.scrollTo({ top: 0 });
  }, [lessonId]);

  const focusStep = (i: number) => {
    if (!data || i < 0 || i >= data.lesson.steps.length) return;
    setActive(i);
    cards.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ↑ ↓ move between steps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusStep(active + 1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        focusStep(active - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <div className="lesson err">{error}</div>;
  if (!data) return <div className="lesson muted">Loading…</div>;
  const { lesson, sql } = data;
  const needsData = lesson.id >= 3 && status?.connected && !(status.ready && (status.places ?? 0) > 0 && (status.poi ?? 0) > 0);

  return (
    <div className="lesson" ref={scroller}>
      <div className="lesson-head">
        <div className="lesson-kicker">
          Lesson {lesson.id} · <span className={`level level-${lesson.level}`}>{LEVEL_LABEL[lesson.level]}</span>
        </div>
        <h2>{fillRegion(lesson.title, region)}</h2>
        <p>{fillRegion(lesson.summary, region)}</p>
        <div className="progress" aria-label="Steps">
          {lesson.steps.map((s, i) => (
            <button key={s.id} className={`pip ${i === active ? "active" : ""}`} onClick={() => focusStep(i)} title={`${s.id} ${fillRegion(s.title, region)}`}>
              {s.id}
            </button>
          ))}
        </div>
        {needsData && <div className="note">This lesson uses your places and OpenStreetMap data. Do Lesson 2 first, or press “Quick start” at the top.</div>}
        {lesson.id === 12 && map?.usingFallback && <div className="note">The basemap could not be loaded, so the map is already drawn from PostGIS tiles.</div>}
      </div>
      {lesson.steps.map((step, i) => (
        <StepCard
          key={`${lesson.id}-${step.id}`}
          ref={(el) => {
            cards.current[i] = el;
          }}
          lesson={lesson}
          step={step}
          sql={sql}
          active={i === active}
          onFocus={() => setActive(i)}
          onDone={() => focusStep(Math.min(i + 1, lesson.steps.length - 1))}
        />
      ))}
      <div className="lesson-foot">
        {lesson.id < 13 ? <Link href={`/lesson/${lesson.id + 1}`}>Next lesson →</Link> : <span className="muted">That&apos;s all 14 lessons.</span>}
      </div>
    </div>
  );
}
