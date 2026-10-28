---
name: postgis-playground-setup
description: Set up and deploy the PostGIS Playground learning app (postgis-playground-on-snowflake) on Snowflake App Runtime — creates a dedicated Snowflake Postgres instance, its network policy (POSTGRES_INGRESS), PostGIS/pgRouting/H3, the egress network rules, password secret and external access integration, fills in app.yml, and runs snow app deploy. Use when the user asks to "deploy this app", "deploy PostGIS Playground", "clone and deploy postgis-playground-on-snowflake", "set up the GIS learning app", or hits errors between the app and Postgres. Use this instead of the generic snowflake-apps skill for this repository.
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
- Postgres setup runs **from the user's machine** (Phase 4). Stored procedures, notebooks and Snowflake-side
  Python cannot reach the instance — do not try them.

## Phase 0 — Check the environment

1. Open the cloned folder itself as the workspace (the one containing `app.yml`). If it is not, `cd` into it
   for every command.
2. Snowflake role for setup: `SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE();` — the setup needs ACCOUNTADMIN or
   CREATE POSTGRES INSTANCE / CREATE NETWORK POLICY / CREATE INTEGRATION. Many statements below
   (e.g. `SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES()`) need a warehouse: `USE WAREHOUSE <wh>;` (ask which; `SHOW WAREHOUSES;`).
3. **Deploy role** — the role of the Snowflake CLI connection, which can differ from the SQL tool's role:
   `snow sql -q "SELECT CURRENT_ROLE()"`. Note it for Phase 5.
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
USE SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG;
CREATE NETWORK RULE IF NOT EXISTS PG_EGRESS_RULE TYPE = HOST_PORT MODE = EGRESS
  VALUE_LIST = ('<host>:5432');
CREATE NETWORK RULE IF NOT EXISTS OSM_EGRESS_RULE TYPE = HOST_PORT MODE = EGRESS
  VALUE_LIST = ('nominatim.openstreetmap.org:443', 'overpass-api.de:443',
                'overpass.private.coffee:443', 'overpass.kumi.systems:443');
CREATE SECRET IF NOT EXISTS PG_APP_CREDENTIALS TYPE = PASSWORD
  USERNAME = 'application' PASSWORD = '<application password>';
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS POSTGIS_PLAYGROUND_EAI
  ALLOWED_NETWORK_RULES = (POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE,
                           POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE)
  ENABLED = TRUE;
DESCRIBE NETWORK RULE PG_EGRESS_RULE;   -- must be exactly '<host>:5432'; if not:
-- ALTER NETWORK RULE PG_EGRESS_RULE SET VALUE_LIST = ('<host>:5432');
```

If the secret already existed: `ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = '<application password>';`

If the deploy role (Phase 0.3) is not ACCOUNTADMIN, run section 7 of `snowflake/setup.sql` for it
(USAGE on the EAI, database and schema; READ, USAGE on the secret; USAGE + CREATE APPLICATION SERVICE /
ARTIFACT REPOSITORY / STAGE on the apps schema; USAGE on the warehouse).

Explain in one sentence: ingress (Phase 1) lets traffic *into* Postgres; egress (this phase) lets the app *out*.

## Phase 4 — Prepare the database (from the user's machine)

```bash
npm install            # Windows PowerShell: npm.cmd install
PGHOST=<host> PG_ADMIN_PASSWORD='<snowflake_admin password>' node scripts/postgres-setup.mjs
```

PowerShell: `$env:PGHOST='<host>'; $env:PG_ADMIN_PASSWORD='<pw>'; node scripts/postgres-setup.mjs; Remove-Item Env:PG_ADMIN_PASSWORD`

It creates database `postgis_playground`, installs `postgis`, `pgrouting`, `h3`, `h3_postgis` (with `postgis_raster`),
and grants CONNECT + CREATE to `application`. It is idempotent.
- Timeout → the user's IP is not in `PG_INGRESS_RULE`, or a VPN changed it.
- `authentication failed ... snowflake_admin` → wrong admin password (wrong instance?).

The local `node_modules/` is not uploaded on deploy (`ignore:` in `app.yml`); no need to delete it.

## Phase 5 — Fill in app.yml

Edit **only** the `<...>` placeholders:
- `database`: ask — `USER$` (personal database; fine for trying it) or a shared apps database.
- `query_warehouse`: the warehouse from Phase 0.
- `PGHOST`: the instance host.
- `OSM_USER_AGENT`: `PostGIS-Playground/1.0 (<user's email or URL>)` — ask the user.

Leave everything else unchanged. In particular do not rename the secret mount `PG`, do not add `PORT`,
`HOSTNAME`, `PGUSER` or `PGPASSWORD`, and do not change `install` / `build` / `run`.

Before deploying, run the checks in `docs/00-before-you-start.md` §0.6 and fix any mismatch.

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
Then **Quick start** — it runs Lesson 0 and loads the sample region; the chip turns green.

### Deploy errors

| Error | Cause → fix |
|---|---|
| `Your project definition is missing ...` / asks for `snowflake.yml` | CLI < 3.26 → Phase 0.4 |
| `Invalid secret name 'pg'` | someone renamed the mount → restore `name: PG` |
| `Environment variable 'PORT' is reserved` | remove `PORT` / `HOSTNAME` from `environment_variables` |
| `Secret ... does not exist or not authorized. Your primary role X` | grants for role X (Phase 3) |
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
| Map has no background | basemap blocked by the browser's network; the app falls back to PostGIS tiles |

## Finish

Tell the user: the URL; how to suspend the instance when not studying
(`ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG SUSPEND;`); that the egress IP ranges expire (update the ingress
rule with `ALTER NETWORK RULE` when they do); and that the `postgis-playground-region` skill switches the sample
map to their own city.
