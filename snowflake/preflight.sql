-- Pre-deploy check, run AS THE DEPLOY ROLE through the same Snowflake CLI connection that deploys:
--
--   snow sql -f snowflake/preflight.sql -D apps_db=<APPS_DATABASE> -D apps_schema=PUBLIC -D warehouse=<WAREHOUSE>
--
-- Secondary roles are switched off so the check sees only what the deploy role itself holds -
-- the role that will own the app and whose grants the running app uses.
-- Expected: every check says OK. Anything else: see docs/00-before-you-start.md section 0.6.

USE SECONDARY ROLES NONE;
USE WAREHOUSE <% warehouse %>;   -- fails here if the deploy role has no USAGE on the warehouse

SELECT CURRENT_ROLE() AS deploy_role;

-- 1. The integration and the secret are visible to this role (USAGE / READ granted, docs/02 section 2.3).
SHOW INTEGRATIONS LIKE 'POSTGIS_PLAYGROUND_EAI';
SELECT IFF(COUNT(*) = 1, 'OK', 'MISSING: GRANT USAGE ON INTEGRATION POSTGIS_PLAYGROUND_EAI TO ROLE ' || CURRENT_ROLE())
  AS eai_check FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

SHOW SECRETS LIKE 'PG_APP_CREDENTIALS' IN SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG;
SELECT IFF(COUNT(*) = 1, 'OK', 'MISSING: USAGE on POSTGIS_PLAYGROUND_ADMIN and .CONFIG, READ, USAGE on the secret, for ' || CURRENT_ROLE())
  AS secret_check FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- 2. If the app exists already, this role must own it (a redeploy needs OWNERSHIP of the service).
SHOW APPLICATION SERVICES LIKE 'POSTGIS_PLAYGROUND' IN SCHEMA <% apps_db %>.<% apps_schema %>;
SELECT CASE
         WHEN COUNT(*) = 0 THEN 'OK (first deploy)'
         WHEN MAX("owner") = CURRENT_ROLE() THEN 'OK (owned by ' || CURRENT_ROLE() || ')'
         ELSE 'WRONG ROLE: the app is owned by ' || MAX("owner") || ' - deploy with that role, not ' || CURRENT_ROLE()
       END AS owner_check FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

-- 3. The role can bind the app's endpoint (granted to PUBLIC on most accounts).
SHOW GRANTS TO ROLE PUBLIC;
SELECT IFF(COUNT(*) >= 1, 'OK (via PUBLIC)', 'CHECK: PUBLIC lacks BIND SERVICE ENDPOINT - an admin grants it to ' || CURRENT_ROLE() || ' (not to PUBLIC)')
  AS bind_check FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "privilege" = 'BIND SERVICE ENDPOINT';
