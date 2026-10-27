-- Lesson 10 — Grids and heatmaps

-- name: square_grid
-- Grid functions need a coordinate system in meters, so build the grid in Web Mercator (3857)
-- and transform each cell back to longitude/latitude for the map.
WITH ext AS (
  SELECT ST_Transform(ST_SetSRID(ST_Extent(geom)::geometry, 4326), 3857) AS e FROM geo.poi
)
SELECT g.i, g.j, ST_Transform(g.geom, 4326) AS geom
FROM ext, ST_SquareGrid(:size::float8, ext.e) AS g;

-- name: hex_counts
-- Join hexagons to points and count: a heatmap is just GROUP BY over a spatial join.
WITH ext AS (
  SELECT ST_Transform(ST_SetSRID(ST_Extent(geom)::geometry, 4326), 3857) AS e FROM geo.poi
), hex AS (
  SELECT h.geom FROM ext, ST_HexagonGrid(:size::float8, ext.e) AS h
)
SELECT count(p.id) AS poi_count, ST_Transform(hex.geom, 4326) AS geom
FROM hex
JOIN geo.poi p ON ST_Intersects(hex.geom, ST_Transform(p.geom, 3857))
GROUP BY hex.geom;

-- name: h3_setup
-- H3 is Uber's global hexagon index: every place on Earth has a cell id at each resolution.
-- The h3 and h3_postgis extensions are installed once by the database admin (snowflake/postgres_setup.sql).
SELECT extname, extversion FROM pg_extension WHERE extname IN ('h3', 'h3_postgis') ORDER BY extname;

-- name: h3_counts
SELECT h3_lat_lng_to_cell(geom, :resolution::int)::text AS cell,
       count(*) AS poi_count,
       h3_cell_to_boundary_geometry(h3_lat_lng_to_cell(geom, :resolution::int)) AS geom
FROM geo.poi
GROUP BY h3_lat_lng_to_cell(geom, :resolution::int);

-- name: compare
-- The five busiest cells by each method.
(WITH ext AS (
   SELECT ST_Transform(ST_SetSRID(ST_Extent(geom)::geometry, 4326), 3857) AS e FROM geo.poi
 ), hex AS (
   SELECT h.geom FROM ext, ST_HexagonGrid(:size::float8, ext.e) AS h
 )
 SELECT 'hexagon grid' AS role, count(p.id) AS poi_count,
        'grid: ' || count(p.id) AS label, ST_Transform(hex.geom, 4326) AS geom
 FROM hex JOIN geo.poi p ON ST_Intersects(hex.geom, ST_Transform(p.geom, 3857))
 GROUP BY hex.geom ORDER BY poi_count DESC LIMIT 5)
UNION ALL
(SELECT 'H3', count(*), 'H3: ' || count(*),
        h3_cell_to_boundary_geometry(h3_lat_lng_to_cell(geom, :resolution::int))
 FROM geo.poi
 GROUP BY h3_lat_lng_to_cell(geom, :resolution::int)
 ORDER BY count(*) DESC LIMIT 5);
