import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same-origin proxy for the OpenFreeMap basemap (style, tilejson, tiles, fonts, sprites).
// Browsers behind a strict proxy or CSP may not reach tiles.openfreemap.org; the app always can (OSM_EGRESS_RULE).
// MapLibre's transformRequest (components/map/controller.ts) rewrites https://tiles.openfreemap.org/... to here.
const UPSTREAM = "https://tiles.openfreemap.org/";
const PREFIX = "/api/basemap/";
const ALLOWED = /^(styles|planet|fonts|sprites|natural_earth)(\/|$)/;
const UA = process.env.OSM_USER_AGENT ?? "PostGIS-Playground/1.0 (Snowflake App Runtime learning app)";

export async function GET(req: NextRequest) {
  // Keep the path exactly as the browser encoded it (font stacks contain spaces and commas).
  const path = req.nextUrl.pathname.slice(PREFIX.length);
  if (!ALLOWED.test(path) || path.split("/").some((s) => s === ".." || s === ".")) {
    return new Response("Not a basemap path", { status: 400 });
  }
  try {
    const res = await fetch(UPSTREAM + path, { headers: { "User-Agent": UA } });
    // fetch has already decompressed the body, so Content-Encoding / Length are not passed on.
    const headers = new Headers({
      "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": res.headers.get("cache-control") ?? "public, max-age=86400",
    });
    return new Response(res.ok ? await res.arrayBuffer() : null, { status: res.status, headers });
  } catch (e) {
    console.error("Basemap not reachable:", (e as Error).message);
    return new Response((e as Error).message, { status: 502 });
  }
}
