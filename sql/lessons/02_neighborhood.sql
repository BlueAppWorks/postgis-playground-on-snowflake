-- Lesson 2 — Bring in your neighborhood

-- name: places
SELECT seq, name, kind,
       round(ST_X(geom)::numeric, 5) AS lng,
       round(ST_Y(geom)::numeric, 5) AS lat,
       name AS label,
       geom
FROM geo.places
ORDER BY seq;

-- name: extent
-- ST_Extent aggregates a bounding box (box2d). ST_Expand adds padding in degrees.
SELECT 'bounding box + padding' AS label,
       round(ST_Distance(ST_SetSRID(ST_MakePoint(ST_XMin(b), ST_YMin(b)), 4326)::geography,
                         ST_SetSRID(ST_MakePoint(ST_XMax(b), ST_YMin(b)), 4326)::geography)) AS width_m,
       round(ST_Distance(ST_SetSRID(ST_MakePoint(ST_XMin(b), ST_YMin(b)), 4326)::geography,
                         ST_SetSRID(ST_MakePoint(ST_XMin(b), ST_YMax(b)), 4326)::geography)) AS height_m,
       ST_SetSRID(b::geometry, 4326) AS geom
FROM (SELECT ST_Expand(ST_Extent(geom), 0.005) AS b FROM geo.places) t;

-- name: roads
SELECT name, highway, geom FROM geo.roads;

-- name: areas
SELECT name, category, geom FROM geo.areas;

-- name: poi
SELECT name, category, geom FROM geo.poi;

-- name: counts
SELECT 'poi' AS table_name, count(*) AS rows FROM geo.poi
UNION ALL SELECT 'areas', count(*) FROM geo.areas
UNION ALL SELECT 'roads', count(*) FROM geo.roads;

-- name: bowtie
-- Real data is messy. Add one deliberately broken polygon (a "bow tie") next to your places.
WITH c AS (SELECT ST_Centroid(ST_Collect(geom)) AS p FROM geo.places)
INSERT INTO geo.areas (id, name, category, tags, geom)
SELECT -1, 'Demo bow-tie', 'demo', '{}',
       ST_Multi(ST_MakePolygon(ST_MakeLine(ARRAY[
         ST_Translate(p, -0.003, -0.002),
         ST_Translate(p,  0.003,  0.002),
         ST_Translate(p,  0.003, -0.002),
         ST_Translate(p, -0.003,  0.002),
         ST_Translate(p, -0.003, -0.002)])))
FROM c
ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom;

-- name: geometry_types
SELECT 'areas' AS table_name, GeometryType(geom) AS type, count(*) FROM geo.areas GROUP BY 2
UNION ALL SELECT 'roads', GeometryType(geom), count(*) FROM geo.roads GROUP BY 2
UNION ALL SELECT 'poi', GeometryType(geom), count(*) FROM geo.poi GROUP BY 2;

-- name: invalid
SELECT id, coalesce(name, category) AS label, ST_IsValidReason(geom) AS reason, geom
FROM geo.areas
WHERE NOT ST_IsValid(geom);

-- name: make_valid
-- ST_MakeValid repairs the shape; ST_CollectionExtract(…, 3) keeps only the polygon parts.
UPDATE geo.areas
SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
WHERE NOT ST_IsValid(geom)
RETURNING id, coalesce(name, category) AS label,
          ST_IsValid(geom) AS is_valid_now,
          ST_NumGeometries(geom) AS parts,
          geom;
