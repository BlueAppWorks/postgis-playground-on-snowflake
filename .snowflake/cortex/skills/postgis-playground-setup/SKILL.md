---
name: postgis-playground-setup
description: Set up and deploy the PostGIS Playground learning app on Snowflake App Runtime — creates or reuses a Snowflake Postgres instance, configures its network policy (POSTGRES_INGRESS), installs PostGIS/pgRouting/H3, creates the egress network rules, password secret and external access integration, fills in app.yml, and runs snow app deploy. Use when the user asks to "deploy this app", "set up PostGIS Playground", "build the GIS learning app", "create the Postgres instance for this app", or hits connection errors between the app and Postgres.
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
anything**, then report progress after each phase. Explain each phase in one or two plain sentences —
many users are new to Postgres networking.

Reference: `docs/01-snowflake-postgres.md`, `docs/02-external-access.md`, `docs/03-deploy.md`, `snowflake/setup.sql`.

## Ground rules

- **Never print passwords back** in chat, never write them to files in the repo (`app.yml`, `.env*`, SQL files).
  Pass them only through environment variables of a single command, or directly into `CREATE SECRET`.
- Never use `0.0.0.0/0` in a network rule. Never `CREATE OR REPLACE` a network policy that is attached to an
  instance (it detaches it and blocks all connections) — use `ALTER NETWORK RULE ... SET VALUE_LIST`.
- Use `IF NOT EXISTS` so re-running a phase is safe.
- Ask before anything that costs money or affects others: creating an instance, resetting passwords
  (`RESET ACCESS` breaks other apps using that instance), deploying.

## Phase 0 — Check the environment

1. Active Snowflake connection and role: `SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE();`
   The role needs CREATE POSTGRES INSTANCE, CREATE INTEGRATION, CREATE NETWORK POLICY (ACCOUNTADMIN has them).
   If there is no warehouse, ask which one to use (`SHOW WAREHOUSES;`) — it is also needed for `app.yml`.
2. Snowflake CLI with App Runtime support: run `snow helpers check-version`. If it is unknown, or
   `snow app deploy --help` does not mention App Runtime / `app.yml`, ask the user to upgrade the CLI.
3. Node.js 22+: `node --version`. Then `npm install` in the project folder (needed for the setup script).
4. The user's public IP (for the one-time Postgres setup from this machine): `curl -s https://checkip.amazonaws.com`.

## Phase 1 — Choose the Postgres instance

Ask: **create a new instance** (recommended, ~5 minutes, smallest size `BURST_S`) or **reuse an existing one**?
`SHOW POSTGRES INSTANCES;` lists existing ones.

- New: you will get the `snowflake_admin` and `application` passwords from the CREATE result.
- Existing: the user must provide both passwords. If they do not have them, `ALTER POSTGRES INSTANCE <name> RESET ACCESS FOR 'application'`
  issues a new one — **warn that any other app using that role will break**, and ask first.

## Phase 2 — Who may connect to Postgres (ingress)

Postgres instances accept no connections until a network policy allows them. Two sources must be allowed:
App Runtime (Snowflake's container egress ranges) and this machine (for Phase 4).

```sql
SELECT value:ipv4_prefix::STRING AS cidr, value:expires::STRING AS expires
FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())));
```

```sql
CREATE DATABASE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN;
CREATE SCHEMA IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG;
CREATE NETWORK RULE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE
  TYPE = IPV4 MODE = POSTGRES_INGRESS
  VALUE_LIST = ('<cidr-1>', '<cidr-2>', '<user-ip>/32');
CREATE NETWORK POLICY IF NOT EXISTS POSTGIS_PLAYGROUND_PG_POLICY
  ALLOWED_NETWORK_RULE_LIST = ('POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE');
```

**Reusing an instance that already has a policy** (`DESCRIBE POSTGRES INSTANCE <name>` → `network_policy`):
do not replace it. `DESCRIBE NETWORK POLICY <policy>` → find its rule(s) → `DESCRIBE NETWORK RULE <rule>` →
`ALTER NETWORK RULE <rule> SET VALUE_LIST = (<existing values>, <missing CIDRs>)`.
If the existing rule already contains `0.0.0.0/0`, tell the user it is open to the internet and suggest narrowing it, but do not change it without consent.

## Phase 3 — Create the instance (new instance only)

```sql
CREATE POSTGRES INSTANCE IF NOT EXISTS POSTGIS_PLAYGROUND_PG
  COMPUTE_FAMILY = 'BURST_S' STORAGE_SIZE_GB = 10
  AUTHENTICATION_AUTHORITY = POSTGRES POSTGRES_VERSION = 18
  NETWORK_POLICY = 'POSTGIS_PLAYGROUND_PG_POLICY';
```

The result's `access_roles` holds the two passwords **and is shown only once**. Tell the user to save both
in their password manager now. Keep them only in memory for Phases 4 and 5. Record `host`.
Poll `SHOW POSTGRES INSTANCES LIKE 'POSTGIS_PLAYGROUND_PG';` until `state` is `READY`.
For an existing instance that is `SUSPENDED`: `ALTER POSTGRES INSTANCE <name> RESUME;`

## Phase 4 — Prepare the database (inside Postgres)

Run from the project folder (no psql needed):

```bash
PGHOST=<host> PG_ADMIN_PASSWORD='<snowflake_admin password>' node scripts/postgres-setup.mjs
```

It creates database `postgis_playground`, installs `postgis`, `pgrouting`, `h3`, `h3_postgis` (with `postgis_raster`),
and grants CONNECT + CREATE to `application`. It is idempotent.
- Timeout → this machine's IP is not in the ingress rule (Phase 2), or a VPN changed the IP.
- `password authentication failed` → wrong admin password.

## Phase 5 — Egress, secret, integration

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
```

If the secret already exists with an old password: `ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = '...';`
If the user deploys with a non-ACCOUNTADMIN role, grant USAGE on the integration, database and schema, and READ, USAGE on the secret
(see `snowflake/setup.sql`).

Explain the difference in one sentence: ingress (Phase 2) lets traffic *into* Postgres; egress (this phase) lets the app *out*.

## Phase 6 — Fill in app.yml

Edit only the placeholders:
- `database`: ask — `USER$` (personal database; fine for trying it, cannot be shared) or a shared apps database.
- `query_warehouse`: the warehouse from Phase 0.
- `PGHOST`: the instance host.
- `OSM_USER_AGENT`: `PostGIS-Playground/1.0 (<user's email or URL>)` — ask the user.

Do not touch `secrets` / `external_access_integrations` unless the object names were changed.

## Phase 7 — Deploy and verify

```bash
snow app deploy
snow app open --print-only
```

First deploy takes a few minutes. On failure: `snow app events`, then retry the failed phase with
`--upload-only`, `--build-only` or `--promote-only`.

Verify with the user in the browser: the top-right chip shows **`● Empty database`** (yellow = connected).
Then press **Quick start** — it runs Lesson 0 and loads the sample region; the chip turns green.

| Chip / error | Fix |
|---|---|
| `Postgres not reachable` + timeout | Egress rule host is wrong (Phase 5) **or** App Runtime CIDRs missing from the ingress rule (Phase 2). Re-run the egress-range query — the ranges change. |
| `password authentication failed` | `ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = ...` |
| `PGHOST is not set` | `environment_variables` missing in `app.yml` |
| `must be owner of extension` (Lessons 8, 10) | Phase 4 was not run as `snowflake_admin` |
| Map has no background | Basemap blocked by the browser's network; the app falls back to PostGIS tiles automatically |

## Finish

Tell the user: the URL, how to suspend the instance when not studying
(`ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG SUSPEND;`), that the egress IP ranges expire (update the ingress rule
with `ALTER NETWORK RULE` when they do), and that the `postgis-playground-region` skill can switch the sample map to
their own city.
