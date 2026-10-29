"use client";
import { createContext, useContext } from "react";
import type { Region, RunResponse, TraceEntry } from "@/lessons/types";
import type { MapController } from "./map/controller";

export type Status = {
  connected: boolean;
  ready: boolean;
  postgis?: boolean;
  places?: number;
  poi?: number;
  areas?: number;
  roads?: number;
  graph?: boolean;
  error?: string;
  hint?: string;
};

export type ShellApi = {
  map: MapController | null;
  status: Status | null;
  dataVersion: number; // bumps when places/OSM data change, so option lists reload
  refreshStatus: () => void;
  dataChanged: () => void;
  pushTrace: (entries: TraceEntry[]) => void;
  run: (body: { lesson: number; step: string; params?: Record<string, unknown>; action?: "seed"; onlyBlocks?: string[] }) => Promise<RunResponse>;
  allowConsole: boolean;
  region: Region;
};

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <Shell>");
  return ctx;
}
