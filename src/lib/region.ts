import type { Region } from "@/lessons/types";

// Lesson text uses {region} and {anchor} so the same lessons work for any sample region.
export function fillRegion(text: string, region: Region | null): string {
  if (!region) return text;
  return text.replaceAll("{region}", region.name).replaceAll("{anchor}", region.anchor.name);
}

// Same values the server binds for :region_name, :anchor_name, :anchor_lng, :anchor_lat
export function regionValues(region: Region | null): Record<string, unknown> {
  if (!region) return {};
  return { region_name: region.name, anchor_name: region.anchor.name, anchor_lng: region.anchor.lng, anchor_lat: region.anchor.lat };
}
