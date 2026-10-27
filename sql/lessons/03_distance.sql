-- Lesson 3 — How far is it?

-- name: distance_degrees
SELECT a.name || ' → ' || b.name AS pair,
       ST_Distance(a.geom, b.geom) AS distance,
       round(ST_Distance(a.geom, b.geom)::numeric, 5) || ' … in what unit?' AS label,
       ST_MakeLine(a.geom, b.geom) AS geom
FROM geo.places a, geo.places b
WHERE a.id = :place_a::int AND b.id = :place_b::int;

-- name: distance_meters
-- Casting to geography measures on the Earth's surface, in meters.
SELECT a.name || ' → ' || b.name AS pair,
       ST_Distance(a.geom::geography, b.geom::geography) AS distance_m,
       round(ST_Distance(a.geom::geography, b.geom::geography)) || ' m' AS label,
       ST_MakeLine(a.geom, b.geom) AS geom
FROM geo.places a, geo.places b
WHERE a.id = :place_a::int AND b.id = :place_b::int;

-- name: matrix
-- Every pair of places: a self join with a.id < b.id avoids duplicates and self-pairs.
SELECT a.name AS from_place,
       b.name AS to_place,
       round(ST_Distance(a.geom::geography, b.geom::geography)) AS meters,
       round(ST_Distance(a.geom::geography, b.geom::geography)) || ' m' AS label,
       ST_MakeLine(a.geom, b.geom) AS geom
FROM geo.places a
JOIN geo.places b ON a.id < b.id
ORDER BY meters;

-- name: global
WITH o AS (SELECT geom FROM geo.places ORDER BY seq LIMIT 1),
     d AS (SELECT ST_SetSRID(ST_MakePoint(:dest_lng::float8, :dest_lat::float8), 4326) AS geom)
-- A straight line on a flat (longitude/latitude) map, densified so we can measure it ...
SELECT 'geometry: straight on a flat map' AS kind,
       round(ST_Length(ST_Segmentize(ST_MakeLine(o.geom, d.geom), 0.5)::geography) / 1000) AS km,
       'flat-map line: ' || round(ST_Length(ST_Segmentize(ST_MakeLine(o.geom, d.geom), 0.5)::geography) / 1000) || ' km' AS label,
       ST_Segmentize(ST_MakeLine(o.geom, d.geom), 0.5) AS geom
FROM o, d
UNION ALL
-- ... versus the great circle: the shortest path on a sphere.
SELECT 'geography: great circle',
       round(ST_Distance(o.geom::geography, d.geom::geography) / 1000),
       'great circle: ' || round(ST_Distance(o.geom::geography, d.geom::geography) / 1000) || ' km',
       ST_Segmentize(ST_MakeLine(o.geom, d.geom)::geography, 50000)::geometry
FROM o, d;
