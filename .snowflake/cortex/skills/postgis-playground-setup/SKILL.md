---
name: postgis-playground-setup
description: Set up and deploy the PostGIS Playground learning app (postgis-playground-on-snowflake) on Snowflake App Runtime — creates a dedicated Snowflake Postgres instance, its network policy (POSTGRES_INGRESS), PostGIS/pgRouting/H3, the egress network rules, password secret and external access integration, fills in app.yml, and runs snow app deploy. Use when the user asks to "deploy this app", "deploy PostGIS Playground", "clone and deploy postgis-playground-on-snowflake", "set up the GIS learning app", "update / redeploy after pulling the latest version", or hits errors between the app and Postgres. Use this instead of the generic snowflake-apps skill for this repository.
tools:
  - snowflake_sql_execute
  - bash
  - read
  - write
  - edit
---

# PostGIS Playground — setup and deploy

Goal: the user ends with a running App Runtime URL showing a green status chip, without having to know
Snowflake networking. Work through the phases in order. **Confirm the plan with the user before creating
anything**, then report progress after each phase in one or two plain sentences.

This repository is already App Runtime-ready (`app.yml` version 2, standalone Next.js build, secret mount `PG`).
**Do not restructure it** — no new manifests, no changes to `next.config.ts`, `package.json` scripts or
`src/server/*` to "make it work". Every failure seen so far was a Snowflake object or a value, not the code;
the tables at the end map each error to its fix.

Reference: `docs/00-before-you-start.md` (checklist), `docs/01-*.md`, `docs/02-*.md`, `docs/03-deploy.md`,
`snowflake/setup.sql`.

## Two roles, two parts

| Part | Who | Role | What |
|---|---|---|---|
| **A. Setup** (once) | someone with ACCOUNTADMIN | `ACCOUNTADMIN` | Phases 1–4: ingress, instance, egress, secret, integration, grants to the deploy role, database |
| **B. Deploy** (every time) | the app's owner | the **deploy role** = the role of the Snowflake CLI connection | Phases 5–6, after the preflight check |

- Part A needs ACCOUNTADMIN; do not try to get by with another role (CREATE POSTGRES INSTANCE, network
  policies and integrations are account-level). If the user does not have it, Part A is a request to their
  admin (Phase 0.2), not something to work around.
- The deploy role **owns the app**. A redeploy needs OWNERSHIP of the existing service, so the same role must
  deploy every time. Never deploy once as ACCOUNTADMIN "to get it working" and later as another role — the later
  deploy fails with `Object does not exist, or operation cannot be performed`.
- The deploy role may be ACCOUNTADMIN on a personal trial account (then no grants are needed), but a dedicated
  role (e.g. `SYSADMIN` or an `APP_PUBLISHER` role) is better. Decide once, in Phase 0, and keep it.
- The SQL tool and the Snowflake CLI can run as different roles. Everything in Part B is checked through
  `snow sql`, which uses the same connection as `snow app deploy`.

## Ground rules

- **Passwords**: never print them in chat, never write them to any file (`app.yml`, `.env*`, SQL files, scripts).
  Never put `PGUSER` / `PGPASSWORD` in `app.yml` `environment_variables` — the app reads `/secrets/PG/`.
  Pass a password only through an environment variable of a single command, or directly into `CREATE SECRET`.
- **Dedicated instance**: create `POSTGIS_PLAYGROUND_PG`. Do not attach policies to, reset passwords of, or
  otherwise change an instance that already exists for another purpose — even if the user's account has one.
  Reuse an instance only if the user says it is theirs for this app *and* has both passwords.
- Never use `0.0.0.0/0`. Never `CREATE OR REPLACE` a network policy attached to an instance (it detaches it);
  use `ALTER NETWORK RULE ... SET VALUE_LIST`.
- `IF NOT EXISTS` keeps old values. After every `CREATE ... IF NOT EXISTS` of a rule or secret whose value you
  know, `DESCRIBE` it and `ALTER` it if it differs (a host from an earlier attempt is the classic case).
- Ask before anything that costs money or affects others: creating an instance, resetting passwords, deploying.
- Write every object name fully qualified (`POSTGIS_PLAYGROUND_ADMIN.CONFIG.<name>`). The SQL tool may run each
  call in a new session, so `USE SCHEMA` / `USE ROLE` from an earlier call cannot be relied on.
- Never grant anything to `PUBLIC` (not the integration, not the app). Share the app with named roles only (docs/03).
- Never write `CREATE APPLICATION SERVICE` / `SPECIFICATION` by hand — `snow app deploy` builds it from `app.yml`.
  If a deploy fails, fix the cause from the tables below and run `snow app deploy` again.
- Do not `CREATE OR REPLACE` the objects in Phases 1–3 on a re-run: it drops their grants and detaches the
  network policy. `IF NOT EXISTS`, then `DESCRIBE` and `ALTER`.
- Postgres setup runs **from the user's machine** (Phase 4, `scripts/postgres-setup.mjs` — it also creates the
  `postgis_playground` database). Do not write a stored procedure or notebook for it: the admin password would
  be passed as an argument and kept in the query history, and the setup needs no Snowflake-side code.

## Already deployed? Updating to a newer version

If `POSTGIS_PLAYGROUND_PG` and `POSTGIS_PLAYGROUND_EAI` already exist (the user deployed an earlier version and
pulled a newer one), do not start from Phase 1. New versions can need new values in existing objects, and
`IF NOT EXISTS` keeps the old ones. So:
1. `git pull` (or confirm the user did), then `git status`. Only `app.yml` should differ from the repository.
   Untracked or changed files anywhere else — typically code an agent added during an earlier attempt, e.g. an
   extra route under `src/app/api/` — are deployed too and can override the new version (`git pull` does not
   remove them). Show the list to the user and, with their consent, remove them: `git clean -n` lists untracked
   files, `git clean -f <path>` removes one, `git checkout -- <file>` restores a changed one. Keep `app.yml`.
   Then Phase 0.
2. Compare each rule with the SQL in Phases 1 and 3 of **this file** and `ALTER` the differences:
   `DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE;` (and `PG_EGRESS_RULE`, `PG_INGRESS_RULE`).
   Run the grants of Phase 3 again if the deploy role is not ACCOUNTADMIN (GRANTs are idempotent).
3. Phase 4 with `PG_APP_PASSWORD` only (the check) — or with both passwords; the script is idempotent.
   Wait for `Ready to deploy`.
4. Fill in `app.yml` only if it lost its values (e.g. the user re-cloned). **Always run the preflight** (end of
   Phase 5), then Phase 6.

## Phase 0 — Check the environment

1. Open the cloned folder itself as the workspace (the one containing `app.yml`). If it is not, `cd` into it
   for every command.
2. **Can this user do Part A?**
   `USE WAREHOUSE <wh>; SELECT ARRAY_CONTAINS('ACCOUNTADMIN'::VARIANT, PARSE_JSON(CURRENT_AVAILABLE_ROLES())) AS has_accountadmin;`
   (needs a warehouse — `SHOW WAREHOUSES;`, ask which)
   - `TRUE` → run Part A with `USE ROLE ACCOUNTADMIN;` in the same call as each statement.
   - `FALSE` → check whether an admin already did Part A: `SHOW POSTGRES INSTANCES LIKE 'POSTGIS_PLAYGROUND_PG';`
     and the preflight (Phase 5). If it passes, skip to Phase 5. If not, **stop**: tell the user that an
     ACCOUNTADMIN must do Part A once, and give them the request in `docs/00-before-you-start.md` §0.3 filled in
     with their deploy role, apps database and warehouse (the admin runs Phase 4 from their own machine). The admin can also open this repository in
     Cortex Code and ask "Do Part A of the postgis-playground-setup skill for deploy role <role>".
     Do not look for other roles or privileges to work around it.
3. **Deploy role** — the role of the Snowflake CLI connection: `snow sql -q "SELECT CURRENT_ROLE()"`.
   If `POSTGIS_PLAYGROUND` already exists (`SHOW APPLICATION SERVICES LIKE 'POSTGIS_PLAYGROUND' IN ACCOUNT;`),
   the deploy role must be its `owner`; if it is not, ask the user whether to switch the CLI connection to the
   owner role (simplest) — not to drop the app. Tell the user the deploy role in one sentence and keep it.
4. **CLI version**: `snow --version` and `snow app deploy --help`. If `--target` is not listed, the CLI is older
   than 3.26 and cannot read `app.yml` version 2. Offer: upgrade (`pip install --upgrade snowflake-cli`,
   `pipx upgrade snowflake-cli`, or the installer from github.com/snowflakedb/snowflake-cli/releases), **or**
   the fallback: `cp snowflake.yml.legacy-cli snowflake.yml` and fill in the same values (docs/03-deploy.md →
   "Older Snowflake CLI"). Do not edit `app.yml` for an old CLI.
5. Node.js 22+: `node --version`. **Windows PowerShell** often blocks `npm` (execution policy): use `npm.cmd`
   (`npm.cmd install`), or `cmd /c npm install`.
6. The user's public IP: `curl -s https://checkip.amazonaws.com` (Windows: `curl.exe -s ...`).

## Phase 1 — Ingress: who may connect to Postgres

```sql
USE ROLE ACCOUNTADMIN;
USE WAREHOUSE <wh>;
SELECT value:ipv4_prefix::STRING AS cidr, value:expires::STRING AS expires
FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())));

CREATE DATABASE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN;
CREATE SCHEMA IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG;
CREATE NETWORK RULE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE
  TYPE = IPV4 MODE = POSTGRES_INGRESS
  VALUE_LIST = ('<cidr-1>', '<cidr-2>', '<user-ip>/32');
CREATE NETWORK POLICY IF NOT EXISTS POSTGIS_PLAYGROUND_PG_POLICY
  ALLOWED_NETWORK_RULE_LIST = ('POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE');
DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE;   -- ALTER if the list differs
```

## Phase 2 — Create the instance

```sql
USE ROLE ACCOUNTADMIN;
CREATE POSTGRES INSTANCE IF NOT EXISTS POSTGIS_PLAYGROUND_PG
  COMPUTE_FAMILY = 'BURST_S' STORAGE_SIZE_GB = 10
  AUTHENTICATION_AUTHORITY = POSTGRES POSTGRES_VERSION = 18
  NETWORK_POLICY = 'POSTGIS_PLAYGROUND_PG_POLICY';
```

The result's `access_roles` holds the `snowflake_admin` and `application` passwords **once**. Tell the user to
save both in their password manager now; keep them only in memory for Phases 4–5. Record `host`.
If the instance already existed (no passwords in the result), ask the user for the passwords; if they do not
have them, ask before `ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG RESET ACCESS FOR 'application'`.
Poll `SHOW POSTGRES INSTANCES LIKE 'POSTGIS_PLAYGROUND_PG';` until `state` is `READY` (a few minutes).

## Phase 3 — Egress, secret, integration, grants

```sql
USE ROLE ACCOUNTADMIN;
CREATE NETWORK RULE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE TYPE = HOST_PORT MODE = EGRESS
  VALUE_LIST = ('<host>:5432');
CREATE NETWORK RULE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE TYPE = HOST_PORT MODE = EGRESS
  VALUE_LIST = ('nominatim.openstreetmap.org:443', 'overpass-api.de:443',
                'overpass.private.coffee:443', 'overpass.kumi.systems:443',
                'tiles.openfreemap.org:443');   -- basemap, proxied by the app
CREATE SECRET IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS TYPE = PASSWORD
  USERNAME = 'application' PASSWORD = '<application password>';
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS POSTGIS_PLAYGROUND_EAI
  ALLOWED_NETWORK_RULES = (POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE,
                           POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE)
  ENABLED = TRUE;
DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE;   -- exactly '<host>:5432'; else ALTER ... SET VALUE_LIST
DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE;  -- includes tiles.openfreemap.org:443; else ALTER with all five
```

If the secret already existed: `ALTER SECRET POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS SET PASSWORD = '<application password>';`

**Grants to the deploy role** — required unless the deploy role is ACCOUNTADMIN (the same as section 7 of
`snowflake/setup.sql`; all idempotent):

```sql
USE ROLE ACCOUNTADMIN;
GRANT USAGE ON INTEGRATION POSTGIS_PLAYGROUND_EAI TO ROLE <deploy_role>;
GRANT USAGE ON DATABASE POSTGIS_PLAYGROUND_ADMIN TO ROLE <deploy_role>;
GRANT USAGE ON SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG TO ROLE <deploy_role>;
GRANT READ, USAGE ON SECRET POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS TO ROLE <deploy_role>;
-- the apps database: skip these three if the deploy role owns it (e.g. USER$)
GRANT USAGE ON DATABASE <APPS_DATABASE> TO ROLE <deploy_role>;
GRANT USAGE, CREATE APPLICATION SERVICE, CREATE ARTIFACT REPOSITORY, CREATE STAGE
  ON SCHEMA <APPS_DATABASE>.PUBLIC TO ROLE <deploy_role>;
GRANT USAGE ON WAREHOUSE <WAREHOUSE> TO ROLE <deploy_role>;
```

`ALLOWED_AUTHENTICATION_SECRETS` on the integration is not needed: the app reads the secret through the
`secrets:` mount, which needs only the grants above.

Explain in one sentence: ingress (Phase 1) lets traffic *into* Postgres; egress (this phase) lets the app *out*.

## Phase 4 — Prepare the database (from the user's machine)

```bash
npm install            # Windows PowerShell: npm.cmd install
PGHOST=<host> PG_ADMIN_PASSWORD='<snowflake_admin password>' PG_APP_PASSWORD='<application password>' node scripts/postgres-setup.mjs
```

PowerShell: `$env:PGHOST='<host>'; $env:PG_ADMIN_PASSWORD='<pw>'; $env:PG_APP_PASSWORD='<pw>'; node scripts/postgres-setup.mjs; Remove-Item Env:PG_ADMIN_PASSWORD, Env:PG_APP_PASSWORD`

It creates database `postgis_playground`, installs `postgis`, `pgrouting`, `h3`, `h3_postgis` (with `postgis_raster`),
grants CONNECT + CREATE to `application`, then logs in **as `application`** exactly as the app will. It is idempotent.

**Gate: do not go on to Phase 5 or 6 until the output ends with `Ready to deploy`.** A deployed app cannot
fix a wrong password or a missing database; deploying anyway only moves the same error into the app logs,
where it is slower to find. If the script fails, fix the cause and run it again:
- Timeout → the user's IP is not in `PG_INGRESS_RULE`, or a VPN changed it.
- `authentication failed ... snowflake_admin` → wrong admin password (wrong instance?). Ask the user; with
  their consent, `RESET ACCESS FOR 'snowflake_admin'`.
- `authentication failed ... application` → wrong application password. With consent, `RESET ACCESS FOR
  'application'`, then `ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = ...` with the new one.
- The `application` password that passed here is the one that must be in `PG_APP_CREDENTIALS`. If you are not
  sure the secret holds it, `ALTER SECRET` it now.
- Only the check, without the admin password: leave out `PG_ADMIN_PASSWORD`.

The local `node_modules/` is not uploaded on deploy (`ignore:` in `app.yml`); no need to delete it.

## Phase 5 — Fill in app.yml

Edit **only** the `<...>` placeholders:
- `database`: ask — `USER$` (personal database; fine for trying it) or a shared apps database.
- `query_warehouse`: the warehouse from Phase 0.
- `PGHOST`: the instance host.
- `OSM_USER_AGENT`: ask the user, and explain it in one or two sentences first — most users do not know the term:
  "The app names itself to OpenStreetMap's free geocoding and map-data servers (Lesson 2), as their usage
  policy requires, with a contact so the operators can reach you instead of blocking the app. It is sent only
  to those servers and is not shown anywhere." Offer the two forms and let the user pick:
  - with an email: `PostGIS-Playground/1.0 (<user's email>)`
  - without one: `PostGIS-Playground/1.0 (+https://github.com/BlueAppWorks/postgis-playground-on-snowflake)`

Leave everything else unchanged. In particular do not rename the secret mount `PG`, do not add `PORT`,
`HOSTNAME`, `PGUSER` or `PGPASSWORD`, and do not change `install` / `build` / `run`.

**Gate: the preflight, as the deploy role.** Run it through the CLI connection that will deploy:

```bash
snow sql -f snowflake/preflight.sql -D apps_db=<APPS_DATABASE> -D apps_schema=PUBLIC -D warehouse=<WAREHOUSE>
```

Deploy only when `EAI_CHECK`, `SECRET_CHECK`, `OWNER_CHECK` and `BIND_CHECK` all start with `OK`, and Phase 4
ended with `Ready to deploy` (if an admin did Part A, ask the user to confirm the admin saw it — the deployer
does not need the Postgres passwords). Otherwise fix what the check names (grants → Phase 3 as ACCOUNTADMIN, or the
admin request in Phase 0.2; `WRONG ROLE` → Phase 0.3) and run it again. Also run the value checks in
`docs/00-before-you-start.md` §0.6 (hosts and rules).

## Phase 6 — Deploy and verify

```bash
snow app deploy          # 5–10 minutes the first time; wait for it to finish and print the URL
snow app open --print-only
```

- Run plain `snow app deploy` and let it finish. If it was interrupted, run it again — not `--promote-only`,
  which would promote the previous package while a build is still running.
- Never `DROP APPLICATION SERVICE` or `ALTER ... UPGRADE` by hand to "refresh"; redeploy instead.
- App logs: `snow app events`, or `CALL SYSTEM$GET_APPLICATION_SERVICE_LOGS('<db>.<schema>.POSTGIS_PLAYGROUND');`
  The app logs `Postgres not reachable: <reason>` there.

Verify with the user in the browser: the top-right chip shows **`● Empty database`** (yellow = connected).
A red chip names the cause (database not set up, wrong password, host not allowed, no route); the app log
has the full error.
The map should show a light-gray street basemap. A plain beige map means `tiles.openfreemap.org:443` is not
in `OSM_EGRESS_RULE` (see the runtime table).
Then **Quick start** — it runs Lesson 0 and loads the sample region; the chip turns green.

### Deploy errors

| Error | Cause → fix |
|---|---|
| `Your project definition is missing ...` / asks for `snowflake.yml` | CLI < 3.26 → Phase 0.4 |
| `Invalid secret name 'pg'` | someone renamed the mount → restore `name: PG` |
| `Environment variable 'PORT' is reserved` | remove `PORT` / `HOSTNAME` from `environment_variables` |
| `Secret ... does not exist or not authorized. Your primary role X` | grants for role X (Phase 3) |
| `Object does not exist, or operation cannot be performed` on a redeploy | the app is owned by another role → deploy with the owner role (Phase 0.3); the preflight shows `WRONG ROLE` |
| `Network rule ... does not exist or not authorized` while creating the integration | an unqualified name resolved in another schema → use `POSTGIS_PLAYGROUND_ADMIN.CONFIG.<rule>` |
| `UnicodeDecodeError: 'cp932'` from `snow sql -f` | a non-ASCII character in the SQL file (Windows reads it in the system encoding) → keep SQL files ASCII |
| `CIDR '0.0.0.0/0' overlaps ...` | do not use `0.0.0.0/0` |
| `No active warehouse selected` | `USE WAREHOUSE <wh>;` |

### Runtime errors (app logs / status chip)

| Error | Cause → fix |
|---|---|
| `getaddrinfo ENOTFOUND <host>` | `PG_EGRESS_RULE` names another host → `ALTER NETWORK RULE` (Phase 3). No redeploy needed; if it persists, `ALTER APPLICATION SERVICE <app> SUSPEND;` then `RESUME;` |
| timeout / `ETIMEDOUT` | App Runtime CIDRs missing from `PG_INGRESS_RULE` — re-run the egress-range query, `ALTER` the rule |
| `password authentication failed for user "application"` | `ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = ...` |
| `PGHOST is not set` | `environment_variables` missing in `app.yml` |
| `sh: next: not found`, exit 127 | `run` / `next.config.ts` were changed → restore them from Git |
| `ENOENT ... sql/` or `data/seed/` | the `postbuild` script was removed from `package.json` → restore |
| `must be owner of extension` (Lessons 8, 10) | Phase 4 was not run as `snowflake_admin` |
| `database "postgis_playground" does not exist` | Phase 4 was skipped → run `scripts/postgres-setup.mjs` |
| Basemap without labels, or no basemap, while `OSM_EGRESS_RULE` is right | a leftover file overrides the proxy (e.g. `src/app/api/basemap/[z]/`) → `git status`, remove files not in the repository, redeploy |
| Map has no basemap; log `Basemap not reachable` | `tiles.openfreemap.org:443` missing from `OSM_EGRESS_RULE` → `ALTER` it (Phase 3). The app already proxies the basemap; do not add a tile proxy or change `controller.ts` |

## Finish

Tell the user: the URL; how to suspend the instance when not studying
(`ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG SUSPEND;`); that the egress IP ranges expire (update the ingress
rule with `ALTER NETWORK RULE` when they do); and that the `postgis-playground-region` skill switches the sample
map to their own city.
