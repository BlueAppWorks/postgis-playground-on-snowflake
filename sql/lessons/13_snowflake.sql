-- Lesson 13 — (Bonus) Take it to Snowflake

-- name: export_table
-- Snowflake reads Postgres data through Data Mirroring or pg_lake (Iceberg).
-- Plain columns (a WKT text column instead of geometry) are the most portable shape for that.
DROP TABLE IF EXISTS geo.poi_export;
CREATE TABLE geo.poi_export AS
SELECT id, name, category, ST_AsText(geom) AS wkt
FROM geo.poi;
ALTER TABLE geo.poi_export ADD PRIMARY KEY (id);

-- name: export_preview
SELECT id, name, category, wkt FROM geo.poi_export ORDER BY id LIMIT 20;

-- name: same_question
-- The question: how many points of interest are within 500 m of each of my places?
SELECT pl.name AS place, count(p.id) AS poi_within_500m
FROM geo.places pl
LEFT JOIN geo.poi p ON ST_DWithin(pl.geom::geography, p.geom::geography, 500)
GROUP BY pl.name
ORDER BY pl.name;

-- name: same_question_map
SELECT pl.name || ': ' || count(p.id) AS label,
       ST_Buffer(pl.geom::geography, 500)::geometry AS geom
FROM geo.places pl
LEFT JOIN geo.poi p ON ST_DWithin(pl.geom::geography, p.geom::geography, 500)
GROUP BY pl.name, pl.geom;
