# 4. Bonus: take your spatial data to Snowflake (Lesson 13)

PostGIS is excellent for an application's live data. Snowflake is where you join it with everything else at
scale. Snowflake has its own spatial types (`GEOGRAPHY`, `GEOMETRY`) and functions — most PostGIS skills transfer
directly.

Lesson 13 prepares a portable table in Postgres and shows the equivalent Snowflake SQL. Running that SQL needs
the data in Snowflake first; here are two ways to get it there.

## Option A: Data Mirroring (Snowflake Postgres → Snowflake)

Snowflake Postgres can continuously mirror Postgres tables into Snowflake. Mirror `geo.poi_export` and
`geo.places` (Lesson 13.1 creates `poi_export` with a primary key and a WKT text column, which mirrors cleanly).
Follow the current Snowflake documentation for Snowflake Postgres data mirroring; the steps depend on your account.

## Option B: pg_lake / Iceberg

With the `pg_lake` extension, Postgres can write Iceberg tables that Snowflake reads. This needs a storage
integration on the instance. See Snowflake's guide
[Build a Lakehouse with Snowflake Postgres and pg_lake](https://www.snowflake.com/en/developers/guides/build-a-lakehouse-with-snowflake-postgres-and-pg-lake/).

## Then, in Snowflake

```sql
-- Convert WKT text to GEOGRAPHY (adjust the source names to where your mirrored tables are)
CREATE OR REPLACE TABLE POI AS
SELECT ID, NAME, CATEGORY, TO_GEOGRAPHY(WKT) AS GEOG FROM MIRROR_DB.GEO.POI_EXPORT;

-- Lesson 5 / 13.2: points of interest within 500 m of each place
SELECT pl.NAME, COUNT(p.ID) AS POI_WITHIN_500M
FROM PLACES pl
LEFT JOIN POI p ON ST_DWITHIN(pl.GEOG, p.GEOG, 500)
GROUP BY pl.NAME;

-- Lesson 10: H3 heatmap
SELECT H3_POINT_TO_CELL_STRING(GEOG, 9) AS CELL, COUNT(*) AS POI_COUNT
FROM POI GROUP BY CELL ORDER BY POI_COUNT DESC;
```

## PostGIS → Snowflake cheat sheet

| PostGIS | Snowflake |
|---|---|
| `geography` | `GEOGRAPHY` (meters, on the sphere — the default choice) |
| `geometry` with an SRID | `GEOMETRY` |
| `ST_GeomFromText(wkt, 4326)` / `::geography` | `TO_GEOGRAPHY(wkt)` |
| `ST_DWithin(a, b, m)` on geography | `ST_DWITHIN(a, b, m)` |
| `ST_Distance(a::geography, b::geography)` | `ST_DISTANCE(a, b)` |
| `ST_Area(g::geography)` | `ST_AREA(g)` |
| `h3_lat_lng_to_cell(g, res)` | `H3_POINT_TO_CELL(g, res)` / `H3_POINT_TO_CELL_STRING` |
| `ST_AsGeoJSON(g)` | `ST_ASGEOJSON(g)` |

Function details differ in places (argument order, supported types); check the Snowflake documentation for
[geospatial functions](https://docs.snowflake.com/en/sql-reference/functions-geospatial) when you port a query.
