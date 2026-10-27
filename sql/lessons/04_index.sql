-- Lesson 4 — Make it fast: spatial indexes

-- name: sample_points
-- 50,000 random points around your places, with no index yet.
DROP TABLE IF EXISTS geo.sample_points;
CREATE TABLE geo.sample_points AS
SELECT g AS id,
       ST_SetSRID(ST_MakePoint(
         ST_XMin(b) + random() * (ST_XMax(b) - ST_XMin(b)),
         ST_YMin(b) + random() * (ST_YMax(b) - ST_YMin(b))), 4326) AS geom
FROM (SELECT ST_Expand(ST_Extent(geom), 0.01) AS b FROM geo.places) e,
     generate_series(1, 50000) AS g;
ANALYZE geo.sample_points;

-- name: sample_points_show
SELECT geom FROM geo.sample_points;

-- name: slow_plan
-- ST_Distance(...) < 300 has to compute the distance for every single row.
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM geo.sample_points
WHERE ST_Distance(geom::geography,
                  ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326)::geography) < 300;

-- name: slow_result
SELECT id, geom FROM geo.sample_points
WHERE ST_Distance(geom::geography,
                  ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326)::geography) < 300;

-- name: create_index
-- A GiST index on the geography expression the query uses.
CREATE INDEX IF NOT EXISTS sample_points_geog_gix
  ON geo.sample_points USING GIST ((geom::geography));
ANALYZE geo.sample_points;

-- name: fast_plan
-- ST_DWithin can use the index: "within 300 m" becomes "inside this box" first.
EXPLAIN (ANALYZE, COSTS OFF)
SELECT count(*) FROM geo.sample_points
WHERE ST_DWithin(geom::geography,
                 ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326)::geography, 300);

-- name: fast_result
SELECT id, geom FROM geo.sample_points
WHERE ST_DWithin(geom::geography,
                 ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326)::geography, 300);

-- name: index_view
-- What the index sees: step 1 keeps points inside the bounding box (&&),
-- step 2 checks the exact distance and drops the corners.
WITH c AS (SELECT ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326) AS geom),
circle AS (SELECT ST_Buffer(c.geom::geography, 300)::geometry AS g FROM c),
box AS (SELECT ST_Envelope(circle.g) AS g FROM circle)
SELECT 'box' AS role, 'step 1: bounding box' AS label, box.g AS geom FROM box
UNION ALL
SELECT 'circle', 'step 2: exact 300 m', circle.g FROM circle
UNION ALL
SELECT 'candidate (dropped)', NULL, p.geom
FROM geo.sample_points p, box, c
WHERE p.geom && box.g AND NOT ST_DWithin(p.geom::geography, c.geom::geography, 300)
UNION ALL
SELECT 'match', NULL, p.geom
FROM geo.sample_points p, c
WHERE ST_DWithin(p.geom::geography, c.geom::geography, 300);
