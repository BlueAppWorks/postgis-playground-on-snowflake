-- Run as snowflake_admin (the admin credentials returned by CREATE POSTGRES INSTANCE).
-- See docs/01-snowflake-postgres.md for how to connect with psql.

-- 1) Connected to the default "postgres" database:
CREATE DATABASE postgis_playground;

-- 2) Connect to the new database (psql: \c postgis_playground), then:

-- Extensions are created by the admin once. The app runs as the less-privileged
-- "application" role and only uses them.
CREATE EXTENSION IF NOT EXISTS postgis;      -- Lessons 0-13
CREATE EXTENSION IF NOT EXISTS pgrouting;    -- Lesson 8
CREATE EXTENSION IF NOT EXISTS h3;           -- Lesson 10
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;  -- Lesson 10 (also installs postgis_raster)

-- Let the app create its own schema ("geo") and tables in this database.
GRANT CONNECT, CREATE ON DATABASE postgis_playground TO application;

-- Check
SELECT extname, extversion FROM pg_extension ORDER BY extname;
