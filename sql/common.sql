-- Shared SQL used by several lessons, the data import, and the tile endpoint.
-- Every block is shown in the SQL Trace when it runs.

-- name: status
SELECT
  to_regclass('geo.places') IS NOT NULL AS ready,
  (SELECT count(*) FROM pg_extension WHERE extname = 'postgis') > 0 AS postgis;

-- name: counts
SELECT
  (SELECT count(*) FROM geo.places) AS places,
  (SELECT count(*) FROM geo.poi) AS poi,
  (SELECT count(*) FROM geo.areas) AS areas,
  (SELECT count(*) FROM geo.roads) AS roads,
  to_regclass('geo.road_edges') IS NOT NULL AS graph;

-- ── options for select boxes ──

-- name: places_options
SELECT id AS value, name AS label FROM geo.places ORDER BY seq, id;

-- name: busy_places_options
-- My places, busiest first (most points of interest within 500 m).
SELECT pl.id AS value, pl.name AS label
FROM geo.places pl
ORDER BY (SELECT count(*) FROM geo.poi p WHERE ST_DWithin(p.geom::geography, pl.geom::geography, 500)) DESC, pl.seq;

-- name: my_points_options
SELECT id AS value, coalesce(label, 'Point #' || id) AS label FROM geo.my_points ORDER BY id DESC;

-- name: category_options
SELECT category AS value, category || ' (' || count(*) || ')' AS label
FROM geo.poi GROUP BY category ORDER BY count(*) DESC;

-- name: road_options
SELECT name AS value, name AS label
FROM geo.roads WHERE name IS NOT NULL
GROUP BY name ORDER BY sum(ST_Length(geom::geography)) DESC LIMIT 40;

-- name: park_options
SELECT id AS value, coalesce(name, 'Unnamed ' || category || ' #' || id) AS label
FROM geo.areas WHERE category = 'park'
ORDER BY ST_Area(geom::geography) DESC LIMIT 40;

-- ── defaults ──

-- name: center
SELECT ST_X(c) AS lng, ST_Y(c) AS lat
FROM (SELECT ST_Centroid(ST_Collect(geom)) AS c FROM geo.places) t
WHERE c IS NOT NULL;

-- name: place_order_default
SELECT coalesce(array_agg(id ORDER BY seq, id), '{}') AS ids FROM geo.places;

-- ── my places (Lesson 2) ──

-- name: clear_places
DELETE FROM geo.places;

-- name: insert_place
INSERT INTO geo.places (name, kind, seq, source, geom)
VALUES (:name, :kind, :seq::int, :source,
        ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326))
ON CONFLICT (name) DO UPDATE
  SET geom = EXCLUDED.geom, kind = EXCLUDED.kind, seq = EXCLUDED.seq, source = EXCLUDED.source
RETURNING id, name, kind, geom;

-- name: cache_get
SELECT response FROM geo.geo_cache WHERE key = :key;

-- name: cache_put
INSERT INTO geo.geo_cache (key, response) VALUES (:key, :response::jsonb)
ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response, fetched_at = now();

-- ── OpenStreetMap import (Lesson 2) ──

-- name: import_area
-- The area to download: buffers around my places, merged. If the places are close together,
-- use their convex hull so the road network between them is connected (Lesson 8 needs that).
WITH buffers AS (
  SELECT ST_Union(ST_Buffer(geom::geography, :radius::float8)::geometry) AS g FROM geo.places
), area AS (
  SELECT CASE WHEN ST_Area(ST_ConvexHull(g)::geography) <= 40e6 THEN ST_ConvexHull(g) ELSE g END AS g
  FROM buffers
), parts AS (
  SELECT (ST_Dump(ST_SimplifyPreserveTopology(g, 0.0005))).geom AS g FROM area
)
SELECT
  -- Overpass wants "lat lon lat lon ..." for its poly filter
  (SELECT string_agg(round(ST_Y(pt.geom)::numeric, 6) || ' ' || round(ST_X(pt.geom)::numeric, 6), ' ' ORDER BY pt.path)
     FROM ST_DumpPoints(ST_ExteriorRing(parts.g)) AS pt) AS overpass_poly,
  round((ST_Area(parts.g::geography) / 1e6)::numeric, 2) AS area_km2,
  'download area' AS label,
  parts.g AS geom
FROM parts;

-- name: clear_osm
TRUNCATE geo.poi, geo.areas, geo.roads, geo.routes;
DROP TABLE IF EXISTS geo.road_edges, geo.road_nodes, geo.sample_points;

-- name: import_poi
-- The osm parameter is the raw Overpass JSON. Nodes become points.
INSERT INTO geo.poi (id, name, category, tags, geom)
SELECT
  (e->>'id')::bigint,
  e->'tags'->>'name',
  CASE
    WHEN e->'tags'->>'railway' = 'station' THEN 'station'
    WHEN e->'tags' ? 'amenity' THEN e->'tags'->>'amenity'
    WHEN e->'tags' ? 'shop' THEN 'shop_' || (e->'tags'->>'shop')
    ELSE 'other'
  END,
  e->'tags',
  ST_SetSRID(ST_MakePoint((e->>'lon')::float8, (e->>'lat')::float8), 4326)
FROM jsonb_array_elements(:osm::jsonb -> 'elements') AS e
WHERE e->>'type' = 'node'
ON CONFLICT (id) DO NOTHING;

-- name: import_areas
-- Closed ways with a leisure tag become polygons: the way's points, in order, form the ring.
INSERT INTO geo.areas (id, name, category, tags, geom)
SELECT
  (e->>'id')::bigint,
  e->'tags'->>'name',
  e->'tags'->>'leisure',
  e->'tags',
  ST_Multi(ST_MakePolygon(ST_SetSRID(ST_MakeLine(ARRAY(
    SELECT ST_MakePoint((pt->>'lon')::float8, (pt->>'lat')::float8)
    FROM jsonb_array_elements(e->'geometry') WITH ORDINALITY AS t(pt, n)
    ORDER BY n
  )), 4326)))
FROM jsonb_array_elements(:osm::jsonb -> 'elements') AS e
WHERE e->>'type' = 'way'
  AND e->'tags' ? 'leisure'
  AND jsonb_array_length(e->'geometry') >= 4
  AND e->'geometry'->0 = e->'geometry'-> -1   -- first point = last point: the ring is closed
ON CONFLICT (id) DO NOTHING;

-- name: import_roads
-- Ways with a highway tag become lines. The OSM node ids are kept to build a routing graph (Lesson 8).
INSERT INTO geo.roads (id, name, highway, tags, nodes, geom)
SELECT
  (e->>'id')::bigint,
  e->'tags'->>'name',
  e->'tags'->>'highway',
  e->'tags',
  ARRAY(SELECT jsonb_array_elements_text(e->'nodes')::bigint),
  ST_SetSRID(ST_MakeLine(ARRAY(
    SELECT ST_MakePoint((pt->>'lon')::float8, (pt->>'lat')::float8)
    FROM jsonb_array_elements(e->'geometry') WITH ORDINALITY AS t(pt, n)
    ORDER BY n
  )), 4326)
FROM jsonb_array_elements(:osm::jsonb -> 'elements') AS e
WHERE e->>'type' = 'way'
  AND e->'tags' ? 'highway'
  AND jsonb_array_length(e->'geometry') >= 2
ON CONFLICT (id) DO NOTHING;

-- name: analyze_osm
ANALYZE geo.poi;
ANALYZE geo.areas;
ANALYZE geo.roads;

-- ── vector tiles (Lesson 12) ──

-- name: tile
-- One Mapbox Vector Tile with three layers. Lines and polygons are simplified to ~1 pixel
-- at this zoom, so a tile never carries more detail than the screen can show.
WITH b AS (
  SELECT ST_TileEnvelope(:z::int, :x::int, :y::int) AS env,
         ST_Transform(ST_TileEnvelope(:z::int, :x::int, :y::int), 4326) AS env4326,
         40075016.686 / (256 * 2 ^ :z::int) AS px
), roads AS (
  SELECT r.highway, r.name,
         ST_AsMVTGeom(ST_Simplify(ST_Transform(r.geom, 3857), b.px), b.env) AS geom
  FROM geo.roads r, b WHERE r.geom && b.env4326
), areas AS (
  SELECT a.category, a.name,
         ST_AsMVTGeom(ST_Simplify(ST_Transform(a.geom, 3857), b.px), b.env) AS geom
  FROM geo.areas a, b WHERE a.geom && b.env4326
), poi AS (
  SELECT p.category, p.name, ST_AsMVTGeom(ST_Transform(p.geom, 3857), b.env) AS geom
  FROM geo.poi p, b WHERE p.geom && b.env4326 AND :z::int >= 13
)
SELECT coalesce((SELECT ST_AsMVT(areas, 'areas') FROM areas), '')
    || coalesce((SELECT ST_AsMVT(roads, 'roads') FROM roads), '')
    || coalesce((SELECT ST_AsMVT(poi, 'poi') FROM poi), '') AS tile;
