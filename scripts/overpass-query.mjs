// Overpass QL used by both the seed builder and the app (src/server/osm.ts mirrors this).
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// polys: array of "lat lon lat lon ..." strings (Overpass poly filter format)
export const OVERPASS_QL = (polys) => {
  const parts = polys.flatMap((p) => [
    `node["amenity"~"^(cafe|restaurant|fast_food|bar|pub|school|library|bank|pharmacy|hospital|post_office|fuel|parking|bicycle_parking|place_of_worship)$"](poly:"${p}");`,
    `node["shop"~"^(supermarket|convenience|bakery|coffee)$"](poly:"${p}");`,
    `node["railway"="station"](poly:"${p}");`,
    `way["leisure"~"^(park|garden|playground|pitch|nature_reserve|golf_course)$"](poly:"${p}");`,
    // Walkable network: streets, their link ramps, service roads, and paths (the routing graph in Lesson 8 needs them
    // to connect). Motorways are excluded; so are parking aisles and driveways, to keep the download small.
    `way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|service|footway|path|cycleway|steps)$"]["service"!~"^(parking_aisle|driveway)$"](poly:"${p}");`,
  ]);
  return `[out:json][timeout:90];\n(\n  ${parts.join("\n  ")}\n);\nout geom;`;
};
