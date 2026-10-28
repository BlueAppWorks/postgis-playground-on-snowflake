-- ════════════════════════════════════════════════════════════════════════════
-- PostGIS Playground — Snowflake objects
-- Run in a Snowsight worksheet (or `snow sql -f snowflake/setup.sql`) as ACCOUNTADMIN,
-- one section at a time. The guide explains every statement:
--   docs/01-snowflake-postgres.md   (sections 1–3)
--   docs/02-external-access.md      (sections 4–7)
--   docs/00-before-you-start.md     (checklist, and how to verify everything before deploying)
-- Replace every <...> placeholder first.
-- ════════════════════════════════════════════════════════════════════════════

USE ROLE ACCOUNTADMIN;

-- A small database to hold the network rules and the secret.
CREATE DATABASE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN;
CREATE SCHEMA IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG;
USE SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG;

-- ── 1. Who may connect to Postgres (ingress) ───────────────────────────────
-- A Snowflake Postgres instance accepts no connections until a network policy allows them.
-- App Runtime runs on Snowpark Container Services; its outbound IP ranges are listed here:
SELECT value:ipv4_prefix::STRING AS cidr, value:expires::STRING AS expires
FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())));

-- Put those CIDRs in the rule, plus your own IP if you want to connect with psql
-- (https://checkip.amazonaws.com shows it). Rules for Postgres must be TYPE = IPV4, MODE = POSTGRES_INGRESS.
CREATE NETWORK RULE IF NOT EXISTS PG_INGRESS_RULE
  TYPE = IPV4
  MODE = POSTGRES_INGRESS
  VALUE_LIST = ('<egress-cidr-1>', '<egress-cidr-2>', '<your-ip>/32');

CREATE NETWORK POLICY IF NOT EXISTS POSTGIS_PLAYGROUND_PG_POLICY
  ALLOWED_NETWORK_RULE_LIST = ('POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE')
  COMMENT = 'Who may connect to the PostGIS Playground Postgres instance';

-- ── 2. The Postgres instance ───────────────────────────────────────────────
-- Use a new instance just for this app: changing the policy or passwords of a shared one breaks other apps.
-- BURST_S is the smallest size and is plenty for the lessons.
-- The result row shows the host and the passwords for "snowflake_admin" and "application".
-- They are shown ONLY ONCE — copy them now.
CREATE POSTGRES INSTANCE IF NOT EXISTS POSTGIS_PLAYGROUND_PG
  COMPUTE_FAMILY = 'BURST_S'
  STORAGE_SIZE_GB = 10
  AUTHENTICATION_AUTHORITY = POSTGRES
  POSTGRES_VERSION = 18
  NETWORK_POLICY = 'POSTGIS_PLAYGROUND_PG_POLICY'
  COMMENT = 'PostGIS Playground';

-- Wait until state = READY (a few minutes):
SHOW POSTGRES INSTANCES LIKE 'POSTGIS_PLAYGROUND_PG';

-- ── 3. Inside Postgres ─────────────────────────────────────────────────────
-- Connect with psql as snowflake_admin and run snowflake/postgres_setup.sql
-- (creates the database, the extensions, and grants for the "application" role).

-- ── 4. Where the app may connect to (egress) ───────────────────────────────
-- App Runtime has no outbound internet access by default. Allow exactly these hosts:
CREATE NETWORK RULE IF NOT EXISTS PG_EGRESS_RULE
  TYPE = HOST_PORT
  MODE = EGRESS
  VALUE_LIST = ('<instance-host>.postgres.snowflake.app:5432');   -- the "host" from step 2
-- If the host here differs from the instance's host, the app fails with "getaddrinfo ENOTFOUND".
-- '*.postgres.snowflake.app:5432' would survive a recreated instance, but allows every Postgres
-- instance on Snowflake (any account), so the exact host is the default.

CREATE NETWORK RULE IF NOT EXISTS OSM_EGRESS_RULE
  TYPE = HOST_PORT
  MODE = EGRESS
  VALUE_LIST = (
    'nominatim.openstreetmap.org:443',    -- geocoding (Lesson 2)
    'overpass-api.de:443',                -- OpenStreetMap data (Lesson 2)
    'overpass.private.coffee:443',        -- Overpass mirrors, used when the main server is busy
    'overpass.kumi.systems:443'
  );

-- ── 5. The Postgres password, stored as a Snowflake secret ─────────────────
-- The app runs as the "application" role, not as the admin.
CREATE SECRET IF NOT EXISTS PG_APP_CREDENTIALS
  TYPE = PASSWORD
  USERNAME = 'application'
  PASSWORD = '<application-password-from-step-2>';

-- ── 6. External access integration ────────────────────────────────────────
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS POSTGIS_PLAYGROUND_EAI
  ALLOWED_NETWORK_RULES = (POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE,
                           POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE)
  ENABLED = TRUE
  COMMENT = 'PostGIS Playground: Snowflake Postgres + OpenStreetMap APIs';

-- ── 7. Grants for the deploy role ──────────────────────────────────────────
-- Skip if you deploy as ACCOUNTADMIN. The deploy role is the one your Snowflake CLI connection uses
-- (`snow sql -q "SELECT CURRENT_ROLE()"`), which may differ from your Snowsight role.
-- Without these, the deploy fails with "Secret ... does not exist or not authorized".
GRANT USAGE ON INTEGRATION POSTGIS_PLAYGROUND_EAI TO ROLE <deploy_role>;
GRANT USAGE ON DATABASE POSTGIS_PLAYGROUND_ADMIN TO ROLE <deploy_role>;
GRANT USAGE ON SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG TO ROLE <deploy_role>;
GRANT READ, USAGE ON SECRET POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS TO ROLE <deploy_role>;
-- Where the app is created (not needed for your personal USER$ database):
GRANT USAGE ON DATABASE <APPS_DATABASE> TO ROLE <deploy_role>;
GRANT USAGE, CREATE APPLICATION SERVICE, CREATE ARTIFACT REPOSITORY, CREATE STAGE
  ON SCHEMA <APPS_DATABASE>.PUBLIC TO ROLE <deploy_role>;
GRANT USAGE ON WAREHOUSE <WAREHOUSE> TO ROLE <deploy_role>;

-- ── Re-running ─────────────────────────────────────────────────────────────
-- IF NOT EXISTS keeps an existing object unchanged. After recreating the instance (new host) or
-- resetting a password, update the objects explicitly:
-- ALTER NETWORK RULE PG_EGRESS_RULE SET VALUE_LIST = ('<new-host>:5432');
-- ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = '<new application password>';

-- ── Maintenance ────────────────────────────────────────────────────────────
-- The egress IP ranges change over time (see the "expires" column). Update the rule in place —
-- never CREATE OR REPLACE a policy that is attached to an instance (that detaches it):
-- ALTER NETWORK RULE PG_INGRESS_RULE SET VALUE_LIST = ('<new-cidr-1>', '<new-cidr-2>', '<your-ip>/32');

-- Pause the instance when you are not studying (compute is billed while it runs):
-- ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG SUSPEND;
-- ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG RESUME;
