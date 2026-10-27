-- Lesson 12 — Draw the map itself with SQL

-- name: tile_grid
-- Web maps are cut into 256-pixel tiles addressed by zoom/x/y.
-- ST_TileEnvelope returns the square (in Web Mercator) that a tile covers.
SELECT :z::int || '/' || x || '/' || y AS label,
       ST_Transform(ST_TileEnvelope(:z::int, x, y), 4326) AS geom
FROM generate_series(:x_min::int, :x_max::int) AS x,
     generate_series(:y_min::int, :y_max::int) AS y;

-- name: one_tile
-- Build one Mapbox Vector Tile. ST_AsMVTGeom clips each shape to the tile and converts it to
-- tile pixel coordinates; ST_AsMVT packs the rows into the binary format the map reads.
WITH b AS (
  SELECT ST_TileEnvelope(:z::int, :x::int, :y::int) AS env,
         ST_Transform(ST_TileEnvelope(:z::int, :x::int, :y::int), 4326) AS env4326
), roads AS (
  SELECT r.highway, ST_AsMVTGeom(ST_Transform(r.geom, 3857), b.env) AS geom
  FROM geo.roads r, b WHERE r.geom && b.env4326
), areas AS (
  SELECT a.category, ST_AsMVTGeom(ST_Transform(a.geom, 3857), b.env) AS geom
  FROM geo.areas a, b WHERE a.geom && b.env4326
), poi AS (
  SELECT p.category, ST_AsMVTGeom(ST_Transform(p.geom, 3857), b.env) AS geom
  FROM geo.poi p, b WHERE p.geom && b.env4326
)
SELECT :z::int || '/' || :x::int || '/' || :y::int AS label,
       (SELECT count(*) FROM roads) AS roads,
       (SELECT count(*) FROM areas) AS areas,
       (SELECT count(*) FROM poi) AS poi,
       length(coalesce((SELECT ST_AsMVT(roads, 'roads') FROM roads), '')
           || coalesce((SELECT ST_AsMVT(areas, 'areas') FROM areas), '')
           || coalesce((SELECT ST_AsMVT(poi, 'poi') FROM poi), '')) AS tile_bytes,
       b.env4326 AS geom
FROM b;

-- name: simplify_by_zoom
-- At zoom z one pixel is about 40,075 km / (256 × 2^z). Detail smaller than a pixel is invisible,
-- so the tile endpoint simplifies lines by one pixel before encoding them.
SELECT :z::int AS zoom,
       round((40075016.686 / (256 * 2 ^ :z::int))::numeric, 2) AS meters_per_pixel,
       sum(ST_NPoints(geom)) AS original_vertices,
       sum(ST_NPoints(ST_Simplify(ST_Transform(geom, 3857), 40075016.686 / (256 * 2 ^ :z::int)))) AS vertices_sent
FROM geo.roads;
