-- Lesson 5 — Within reach: buffers

-- name: circle
-- ST_Buffer on geography takes meters. Cast back to geometry to draw it.
SELECT name || ' + ' || :radius::int || ' m' AS label,
       round((ST_Area(ST_Buffer(geom::geography, :radius::float8)) / 1e6)::numeric, 3) AS km2,
       ST_Buffer(geom::geography, :radius::float8)::geometry AS geom
FROM geo.places
WHERE id = :place_id::int;

-- name: inside
SELECT p.name, p.category,
       round(ST_Distance(p.geom::geography, pl.geom::geography)) AS meters,
       p.geom
FROM geo.poi p
JOIN geo.places pl ON pl.id = :place_id::int
WHERE ST_DWithin(p.geom::geography, pl.geom::geography, :radius::float8)
ORDER BY meters;

-- name: inside_summary
SELECT p.category, count(*) AS poi
FROM geo.poi p
JOIN geo.places pl ON pl.id = :place_id::int
WHERE ST_DWithin(p.geom::geography, pl.geom::geography, :radius::float8)
GROUP BY p.category
ORDER BY poi DESC;

-- name: road_band
-- Buffer a line instead of a point: a band along the street.
WITH road AS (
  SELECT ST_Union(geom) AS g FROM geo.roads WHERE name = :road_name
), band AS (
  SELECT ST_Buffer(g::geography, :width::float8)::geometry AS g FROM road
)
SELECT 'band' AS role, :road_name || ' ± ' || :width::int || ' m' AS label, band.g AS geom FROM band
UNION ALL
SELECT p.category, NULL, p.geom
FROM geo.poi p, band
WHERE ST_Intersects(p.geom, band.g);

-- name: overlap
-- Two buffers, their intersection, and the union of everything walkable.
WITH a AS (SELECT name, ST_Buffer(geom::geography, :radius::float8)::geometry AS g FROM geo.places WHERE id = :place_a::int),
     b AS (SELECT name, ST_Buffer(geom::geography, :radius::float8)::geometry AS g FROM geo.places WHERE id = :place_b::int)
SELECT 'A' AS role, a.name AS label, NULL::numeric AS m2, a.g AS geom FROM a
UNION ALL
SELECT 'B', b.name, NULL, b.g FROM b
UNION ALL
SELECT 'both', 'reachable from both: ' || round(ST_Area(ST_Intersection(a.g, b.g)::geography)) || ' m²',
       round(ST_Area(ST_Intersection(a.g, b.g)::geography)),
       ST_Intersection(a.g, b.g)
FROM a, b
WHERE ST_Intersects(a.g, b.g);

-- name: union_all
SELECT 'everything within ' || :radius::int || ' m of my places' AS label,
       ST_Union(ST_Buffer(geom::geography, :radius::float8)::geometry) AS geom
FROM geo.places;
