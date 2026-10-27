-- Lesson 6 — What's nearest?

-- name: knn
-- <-> is the distance operator. ORDER BY ... <-> ... LIMIT n walks the spatial index
-- outward from the click instead of sorting every row.
WITH c AS (SELECT ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326) AS g)
SELECT n.rank,
       coalesce(n.name, n.category) AS place,
       round(ST_Distance(n.geom::geography, c.g::geography)) AS meters,
       '#' || n.rank || ' ' || coalesce(n.name, n.category) AS label,
       ST_MakeLine(c.g, n.geom) AS geom
FROM c
CROSS JOIN LATERAL (
  SELECT p.name, p.category, p.geom, row_number() OVER (ORDER BY p.geom <-> c.g) AS rank
  FROM geo.poi p
  WHERE p.category = :category
  ORDER BY p.geom <-> c.g
  LIMIT 5
) n
ORDER BY n.rank;

-- name: nearest_park
-- LATERAL runs the inner query once per outer row: "for each of my places, the nearest park".
SELECT pl.name || ' → ' || coalesce(a.name, 'park') AS label,
       round(ST_Distance(pl.geom::geography, a.geom::geography)) AS meters,
       ST_ShortestLine(pl.geom, a.geom) AS geom
FROM geo.places pl
CROSS JOIN LATERAL (
  SELECT name, geom FROM geo.areas
  WHERE category = 'park'
  ORDER BY geom <-> pl.geom
  LIMIT 1
) a;

-- name: nearest_park_areas
SELECT DISTINCT ON (a.id) coalesce(a.name, 'park') AS label, a.geom
FROM geo.places pl
CROSS JOIN LATERAL (
  SELECT id, name, geom FROM geo.areas WHERE category = 'park' ORDER BY geom <-> pl.geom LIMIT 1
) a;

-- name: degrees_vs_meters
-- geometry <-> measures in degrees; geography <-> measures in meters on the sphere.
-- One degree of longitude is shorter than one degree of latitude (except at the equator),
-- so the two rankings can disagree.
WITH c AS (SELECT ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326) AS g),
ranked AS (
  SELECT p.name, p.category, p.geom,
         row_number() OVER (ORDER BY p.geom <-> c.g) AS rank_by_degrees,
         row_number() OVER (ORDER BY p.geom::geography <-> c.g::geography) AS rank_by_meters,
         round(ST_Distance(p.geom::geography, c.g::geography)) AS meters
  FROM geo.poi p, c
)
SELECT rank_by_degrees, rank_by_meters, meters,
       coalesce(name, category) AS place,
       CASE WHEN rank_by_degrees = rank_by_meters THEN 'same rank' ELSE 'different rank' END AS role,
       '#' || rank_by_degrees || ' vs #' || rank_by_meters AS label,
       geom
FROM ranked
WHERE rank_by_degrees <= 12
ORDER BY rank_by_degrees;

-- name: voronoi
-- Voronoi cells: every location inside a cell is closer to that cell's point than to any other.
WITH pts AS (SELECT ST_Collect(geom) AS g FROM geo.poi WHERE category = :category),
env AS (SELECT ST_Expand(ST_Envelope(g), 0.003) AS e FROM pts),
cells AS (SELECT (ST_Dump(ST_VoronoiPolygons(pts.g, 0, env.e))).geom AS g FROM pts, env)
SELECT row_number() OVER () AS cell, ST_Intersection(cells.g, env.e) AS geom
FROM cells, env;

-- name: voronoi_points
SELECT coalesce(name, category) AS label, geom FROM geo.poi WHERE category = :category;
