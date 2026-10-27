-- Lesson 7 — Shapes and areas: polygons

-- name: park_areas
SELECT coalesce(name, 'park #' || id) AS name,
       round(ST_Area(geom::geography)) AS m2,
       round((ST_Area(geom::geography) / 10000)::numeric, 2) || ' ha' AS label,
       geom
FROM geo.areas
WHERE category = 'park'
ORDER BY m2 DESC;

-- name: where_am_i
-- Point-in-polygon: which areas contain the clicked point?
SELECT coalesce(a.name, a.category) AS area, a.category,
       'You are in: ' || coalesce(a.name, a.category) AS label,
       a.geom
FROM geo.areas a
WHERE ST_Contains(a.geom, ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326));

-- name: places_in_areas
SELECT pl.name AS place, coalesce(a.name, a.category, '(not in any area)') AS inside
FROM geo.places pl
LEFT JOIN geo.areas a ON ST_Contains(a.geom, pl.geom)
ORDER BY pl.seq;

-- name: drawn
SELECT 'your polygon' AS label,
       round(ST_Area(ST_GeomFromText(:drawn_wkt, 4326)::geography)) AS m2,
       ST_GeomFromText(:drawn_wkt, 4326) AS geom;

-- name: predicate
-- Spatial predicates answer yes/no questions about two shapes.
WITH drawn AS (SELECT ST_GeomFromText(:drawn_wkt, 4326) AS g),
features AS (
  SELECT 'area' AS layer, coalesce(name, category) AS name, geom FROM geo.areas
  UNION ALL SELECT 'road', coalesce(name, highway), geom FROM geo.roads
  UNION ALL SELECT 'poi', coalesce(name, category), geom FROM geo.poi
)
SELECT f.layer AS role, f.name, f.geom
FROM features f, drawn d
WHERE {{predicate}}(d.g, f.geom);

-- name: spatial_join
-- A spatial join: JOIN ... ON a spatial condition, then GROUP BY like any other join.
SELECT coalesce(a.name, 'park #' || a.id) AS park,
       count(p.id) AS poi_nearby,
       coalesce(a.name, 'park') || ': ' || count(p.id) AS label,
       a.geom
FROM geo.areas a
LEFT JOIN geo.poi p ON ST_DWithin(a.geom::geography, p.geom::geography, 150)
WHERE a.category = 'park'
GROUP BY a.id
ORDER BY poi_nearby DESC;
