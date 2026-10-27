-- Lesson 9 — Summarize space

-- name: centroid
WITH c AS (SELECT ST_Centroid(ST_Collect(geom)) AS g FROM geo.places)
SELECT 'center' AS role, 'center of my places' AS label, c.g AS geom FROM c
UNION ALL
SELECT 'spoke', NULL, ST_MakeLine(p.geom, c.g) FROM geo.places p, c;

-- name: hulls
-- Convex hull = a rubber band around the points. Concave hull = shrink-wrap;
-- the ratio controls how tightly it hugs them (1 = convex, smaller = tighter).
WITH pts AS (SELECT ST_Collect(geom) AS g FROM geo.poi)
SELECT 'convex hull' AS role,
       'convex: ' || round((ST_Area(ST_ConvexHull(g)::geography) / 1e6)::numeric, 2) || ' km²' AS label,
       ST_ConvexHull(g) AS geom
FROM pts
UNION ALL
SELECT 'concave hull',
       'concave: ' || round((ST_Area(ST_ConcaveHull(g, :ratio::float8)::geography) / 1e6)::numeric, 2) || ' km²',
       ST_ConcaveHull(g, :ratio::float8)
FROM pts;

-- name: hull_points
SELECT geom FROM geo.poi;

-- name: dbscan
-- DBSCAN: points with at least "minpoints" neighbours within "eps" form a cluster.
-- eps is in the units of the geometry, so we project to Web Mercator (meters, roughly —
-- Lesson 11 explains the "roughly").
SELECT coalesce(name, category) AS name, category,
       ST_ClusterDBSCAN(ST_Transform(geom, 3857), eps => :eps::float8, minpoints => :minpoints::int) OVER () AS cluster,
       geom
FROM geo.poi;

-- name: dbscan_hulls
WITH c AS (
  SELECT ST_ClusterDBSCAN(ST_Transform(geom, 3857), eps => :eps::float8, minpoints => :minpoints::int) OVER () AS cluster, geom
  FROM geo.poi
)
SELECT cluster, count(*) AS points,
       'cluster ' || cluster || ' (' || count(*) || ')' AS label,
       ST_ConvexHull(ST_Collect(geom)) AS geom
FROM c
WHERE cluster IS NOT NULL
GROUP BY cluster
ORDER BY points DESC;

-- name: simplify
-- Merge all parks into one shape (ST_Union), then drop vertices that move it less than "tolerance" meters.
WITH parks AS (SELECT ST_Transform(ST_Union(geom), 3857) AS g FROM geo.areas WHERE category = 'park')
SELECT 'original' AS role, ST_NPoints(g) AS vertices, ST_NPoints(g) || ' vertices' AS label,
       ST_Transform(g, 4326) AS geom
FROM parks
UNION ALL
SELECT 'simplified', ST_NPoints(ST_Simplify(g, :tolerance::float8)),
       ST_NPoints(ST_Simplify(g, :tolerance::float8)) || ' vertices',
       ST_Transform(ST_Simplify(g, :tolerance::float8), 4326)
FROM parks;
