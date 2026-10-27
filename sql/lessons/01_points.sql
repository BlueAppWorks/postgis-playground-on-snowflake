-- Lesson 1 — Your first point

-- name: office
-- ST_MakePoint(x, y): x = longitude, y = latitude. ST_SetSRID says "these are WGS 84 degrees".
INSERT INTO geo.my_points (label, geom)
VALUES (:anchor_name, ST_SetSRID(ST_MakePoint(:anchor_lng::float8, :anchor_lat::float8), 4326))
ON CONFLICT (label) DO NOTHING;

-- name: office_select
SELECT label, ST_X(geom) AS lng, ST_Y(geom) AS lat, label AS popup, geom
FROM geo.my_points
WHERE label = :anchor_name;

-- name: click_insert
INSERT INTO geo.my_points (geom)
VALUES (ST_SetSRID(ST_MakePoint(:click_lng::float8, :click_lat::float8), 4326))
RETURNING 'Point #' || id AS label,
          round(ST_X(geom)::numeric, 5) AS lng,
          round(ST_Y(geom)::numeric, 5) AS lat,
          geom;

-- name: all_points
SELECT coalesce(label, 'Point #' || id) AS label, geom FROM geo.my_points ORDER BY id;

-- name: formats
-- One point, four common encodings.
SELECT coalesce(label, 'Point #' || id) AS label,
       ST_AsText(geom)                  AS wkt,      -- Well-Known Text
       ST_AsEWKT(geom)                  AS ewkt,     -- WKT + SRID (PostGIS extension)
       ST_AsGeoJSON(geom)               AS geojson,  -- what web maps use
       encode(ST_AsEWKB(geom), 'hex')   AS ewkb_hex, -- how it is stored on disk
       geom
FROM geo.my_points
WHERE id = :point_id::int;

-- name: swapped
-- The classic mistake: passing (lat, lng) instead of (lng, lat).
SELECT 'Swapped: ST_MakePoint(lat, lng)' AS label,
       ST_X(g) AS x_is_now,
       ST_Y(g) AS y_is_now,
       ST_Y(g) BETWEEN -90 AND 90 AS is_a_possible_latitude,
       g AS geom
FROM (SELECT ST_SetSRID(ST_MakePoint(:click_lat::float8, :click_lng::float8), 4326) AS g) t;

-- name: swapped_geography
-- geometry accepts any numbers. geography checks that the point is on Earth.
SELECT ST_MakePoint(:click_lat::float8, :click_lng::float8)::geography AS geog;
