-- Lesson 0 — Set up the lab

-- name: extension
-- PostGIS adds geometry types, spatial functions and spatial indexes to Postgres.
CREATE EXTENSION IF NOT EXISTS postgis;

-- name: version
SELECT postgis_lib_version() AS postgis,
       postgis_geos_version() AS geos,
       split_part(version(), ' on ', 1) AS postgres;

-- name: schema
-- Every table stores shapes in a typed geometry column: geometry(<shape>, <SRID>).
-- SRID 4326 = longitude/latitude in degrees (WGS 84), the same system GPS uses.
CREATE SCHEMA IF NOT EXISTS geo;

CREATE TABLE IF NOT EXISTS geo.my_points (      -- Lesson 1: points you create by hand
  id    serial PRIMARY KEY,
  label text UNIQUE,
  geom  geometry(Point, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS geo.places (         -- Lesson 2: your neighborhood
  id     serial PRIMARY KEY,
  name   text NOT NULL UNIQUE,
  kind   text NOT NULL DEFAULT 'favorite',
  seq    int  NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  geom   geometry(Point, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS geo.poi (            -- OpenStreetMap points of interest
  id       bigint PRIMARY KEY,                  -- OSM node id
  name     text,
  category text NOT NULL,
  tags     jsonb,
  geom     geometry(Point, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS geo.areas (          -- OpenStreetMap parks, gardens, ...
  id       bigint PRIMARY KEY,                  -- OSM way id
  name     text,
  category text,
  tags     jsonb,
  geom     geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS geo.roads (          -- OpenStreetMap streets
  id      bigint PRIMARY KEY,                   -- OSM way id
  name    text,
  highway text,
  tags    jsonb,
  nodes   bigint[],                             -- OSM node ids along the line (for routing)
  geom    geometry(LineString, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS geo.routes (         -- Lesson 8: computed routes
  id     serial PRIMARY KEY,
  label  text,
  meters numeric,
  geom   geometry(LineString, 4326)
);

CREATE TABLE IF NOT EXISTS geo.geo_cache (      -- cached responses from Nominatim / Overpass
  key        text PRIMARY KEY,
  response   jsonb,
  fetched_at timestamptz DEFAULT now()
);

-- Spatial (GiST) indexes. Lesson 4 shows what they do.
CREATE INDEX IF NOT EXISTS places_geom_gix ON geo.places USING GIST (geom);
CREATE INDEX IF NOT EXISTS poi_geom_gix    ON geo.poi    USING GIST (geom);
CREATE INDEX IF NOT EXISTS areas_geom_gix  ON geo.areas  USING GIST (geom);
CREATE INDEX IF NOT EXISTS roads_geom_gix  ON geo.roads  USING GIST (geom);

-- name: geometry_columns
-- PostGIS keeps a catalog of every geometry column.
SELECT f_table_name AS table_name, f_geometry_column AS column_name, type, srid
FROM geometry_columns
WHERE f_table_schema = 'geo'
ORDER BY table_name;

-- name: srs
-- spatial_ref_sys lists the coordinate systems PostGIS knows (thousands of them).
SELECT srid, auth_name || ':' || auth_srid AS code, split_part(srtext, '"', 2) AS name
FROM spatial_ref_sys
WHERE srid IN (4326, 3857, 32610)
ORDER BY srid;
