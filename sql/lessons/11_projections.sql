-- Lesson 11 — Projections: why maps lie

-- name: utm_function
-- UTM splits the Earth into 60 zones, each 6° of longitude wide, with coordinates in meters.
-- Inside its own zone a UTM projection measures lengths and areas very accurately.
CREATE OR REPLACE FUNCTION geo.utm_srid(g geometry) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN ST_Y(ST_Centroid(g)) >= 0 THEN 32600 ELSE 32700 END
         + floor((ST_X(ST_Centroid(g)) + 180) / 6)::int + 1
$$;

-- name: area_compare
-- One park, four ways to measure its area.
SELECT coalesce(name, 'park #' || id) AS park,
       round(ST_Area(geom)::numeric, 8)                           AS square_degrees,
       round(ST_Area(ST_Transform(geom, 3857)))                   AS web_mercator_m2,
       round(ST_Area(ST_Transform(geom, geo.utm_srid(geom))))     AS utm_m2,
       geo.utm_srid(geom)                                         AS utm_srid,
       round(ST_Area(geom::geography))                            AS geography_m2,
       coalesce(name, 'park') AS label,
       geom
FROM geo.areas
WHERE id = :area_id::bigint;

-- name: squares
-- A "0.1° × 0.1°" square versus a real 10 km × 10 km square, built in the local UTM zone.
WITH c AS (SELECT ST_SetSRID(ST_MakePoint(:city_lng::float8, :city_lat::float8), 4326) AS p)
SELECT 'degrees' AS role,
       '0.1° × 0.1° = ' || round((ST_Area(ST_Expand(p, 0.05)::geography) / 1e6)::numeric, 1) || ' km²' AS label,
       ST_Expand(p, 0.05) AS geom
FROM c
UNION ALL
SELECT 'meters',
       '10 km × 10 km = ' || round((ST_Area(ST_Transform(ST_Expand(ST_Transform(p, geo.utm_srid(p)), 5000), 4326)::geography) / 1e6)::numeric, 1) || ' km²',
       ST_Transform(ST_Expand(ST_Transform(p, geo.utm_srid(p)), 5000), 4326)
FROM c;

-- name: world_circles
-- The same 500 km circle at different latitudes. On a Web Mercator map,
-- the circles near the poles look much bigger — the map, not the Earth, is stretched.
SELECT lat || '°' AS label,
       ST_Buffer(ST_SetSRID(ST_MakePoint(:lng::float8, lat::float8), 4326)::geography, 500000)::geometry AS geom
FROM unnest(ARRAY[0, 30, 60, 75]) AS lat;
