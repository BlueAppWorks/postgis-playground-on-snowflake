# 0. Before you start

An App Runtime app that talks to Snowflake Postgres needs a handful of Snowflake objects that exist
**before** the first `snow app deploy`. None of them is hard, but they depend on each other, and a wrong
value in one shows up later as a vague "not reachable". This page is the checklist: what to have, what to
create in which order, what to write down, and how to check it before you deploy.

Parts [1](01-snowflake-postgres.md) and [2](02-external-access.md) explain each statement;
[`snowflake/setup.sql`](../snowflake/setup.sql) has them all in one file.

## 0.1 What you need

| | Requirement | Check |
|---|---|---|
| Account | A paid Snowflake account in a region with Snowflake Postgres and App Runtime (not a trial) | `SHOW POSTGRES INSTANCES;` runs without error |
| Admin role | `ACCOUNTADMIN`, for the one-time setup (Part A below). Not yours? Ask your admin — see 0.3 | `SELECT CURRENT_AVAILABLE_ROLES();` |
| Deploy role | The role your Snowflake CLI connection uses. It **owns the app**, so always deploy with the same role | `snow sql -q "SELECT CURRENT_ROLE()"` |
| Warehouse | Any warehouse (App Runtime requires one, even though this app queries Postgres) | `SHOW WAREHOUSES;` |
| Apps database | Where the app is created: your personal `USER$` database, or a shared one | `SHOW SCHEMAS IN DATABASE <db>;` |
| Snowflake CLI | **3.26 or later** (reads `app.yml` version 2) | `snow --version`; `snow app deploy --help` lists `--target` |
| Node.js | 22 or later, with npm (for the one-time Postgres setup script) | `node --version` |
| Your public IP | For the one-time Postgres setup from your machine | <https://checkip.amazonaws.com> |

**Windows:** PowerShell may refuse to run `npm` ("running scripts is disabled on this system").
Use `npm.cmd` instead of `npm`, or allow local scripts once with
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**Older CLI:** upgrade it (`pip install --upgrade snowflake-cli`, or the installer from the
[releases page](https://github.com/snowflakedb/snowflake-cli/releases)). If you cannot, see
[3. Deploy → Older Snowflake CLI](03-deploy.md#older-snowflake-cli).

## 0.2 The objects and how they connect

```
                 ┌──────────── who may connect IN ────────────┐
                 │ NETWORK RULE  PG_INGRESS_RULE              │
                 │   (IPV4, POSTGRES_INGRESS:                 │
                 │    App Runtime egress CIDRs + your IP)     │
                 │        ▼                                   │
                 │ NETWORK POLICY  POSTGIS_PLAYGROUND_PG_POLICY│
                 └────────┬───────────────────────────────────┘
                          ▼
                 POSTGRES INSTANCE  POSTGIS_PLAYGROUND_PG  ──▶ host, snowflake_admin / application passwords
                          ▲
                          │ 5432
┌──────────── where the app may connect OUT ────────────┐
│ NETWORK RULE  PG_EGRESS_RULE   (HOST_PORT: <host>:5432)│
│ NETWORK RULE  OSM_EGRESS_RULE  (OSM APIs, basemap)     │
│        ▼                                               │
│ EXTERNAL ACCESS INTEGRATION  POSTGIS_PLAYGROUND_EAI    │──▶ app.yml external_access_integrations
└────────────────────────────────────────────────────────┘
  SECRET  PG_APP_CREDENTIALS  (PASSWORD: application / …)  ──▶ app.yml secrets (mounted at /secrets/PG/)
```

A connection from the app to Postgres needs **both** directions: the EAI lets it out, the network policy lets it in.

## 0.3 Order of work: two parts, two roles

The setup is split by role. **Part A** (steps 1–6) creates account-level objects and needs `ACCOUNTADMIN`,
once. **Part B** (step 7) is the deploy, done every time by the deploy role — the role that will own the app.
They can be the same person or two people.

- If you deploy as ACCOUNTADMIN too (fine on a personal account), skip step 6.
- If you deploy with another role (better: e.g. `SYSADMIN` or a dedicated `APP_PUBLISHER`), step 6 is required.
- Pick the deploy role before the first deploy and keep it: a redeploy needs ownership of the app, so a
  different role fails with `Object does not exist, or operation cannot be performed`.

**No ACCOUNTADMIN?** Send your admin this request (fill in the `<...>`):

> Please do Part A of https://github.com/BlueAppWorks/postgis-playground-on-snowflake (docs/00-before-you-start.md,
> steps 1–6, or `snowflake/setup.sql` sections 1–7) for:
> deploy role `<your CLI role>`, apps database `<database>`, warehouse `<warehouse>`.
> Please send me the Postgres host when done. I do not need the Postgres passwords.

The admin keeps both passwords and runs step 4 themselves. With Cortex Code, the admin can open the repository
and ask: "Do Part A of the postgis-playground-setup skill for deploy role `<role>`."

| Step | What | Where | Guide |
|---|---|---|---|
| 1 | Look up App Runtime's egress CIDRs | Snowsight (needs a warehouse) | [1.1](01-snowflake-postgres.md#11-why-a-network-policy-comes-first) |
| 2 | Ingress rule + network policy | Snowsight | 1.1 |
| 3 | **A new, dedicated** Postgres instance — copy the host and both passwords (shown once) | Snowsight | [1.2](01-snowflake-postgres.md#12-create-the-instance) |
| 4 | Database + extensions inside Postgres, and a check of the `application` login — **go on only when it prints `Ready to deploy`** | your machine: `node scripts/postgres-setup.mjs` | [1.3](01-snowflake-postgres.md#13-prepare-the-database-in-postgres) |
| 5 | Egress rules, secret, integration | Snowsight | [2](02-external-access.md) |
| 6 | Grants for the deploy role (skip if it is ACCOUNTADMIN) | Snowsight | [2.3](02-external-access.md#23-the-external-access-integration) |
| 7 | **Part B:** fill in `app.yml`, run the preflight (0.6) as the deploy role, `snow app deploy` | your machine | [3](03-deploy.md) |

Use a **dedicated** instance for this app. Changing the network policy or resetting the passwords of an
instance that another app uses breaks that app.

## 0.4 Write these down

| Value | From | Used in |
|---|---|---|
| Postgres `host` | `CREATE POSTGRES INSTANCE` result, or `SHOW POSTGRES INSTANCES` | `PG_EGRESS_RULE`, `app.yml` `PGHOST`, the setup script |
| `snowflake_admin` password | `CREATE POSTGRES INSTANCE` result (once) | the setup script only — keep it in a password manager |
| `application` password | `CREATE POSTGRES INSTANCE` result (once) | `CREATE SECRET` only — never in `app.yml` or any file |
| Egress CIDRs + expiry | `SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES()` | `PG_INGRESS_RULE`; update it before they expire |
| Deploy role, apps database, warehouse | 0.1 | grants, `app.yml` |

## 0.5 Re-running a step

Every statement uses `IF NOT EXISTS`, so it is safe to run again — but it also **keeps the old values**.
If you recreated the instance (new host) or reset a password, update the existing objects explicitly:

```sql
ALTER NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE  SET VALUE_LIST = ('<new-host>:5432');
ALTER NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE SET VALUE_LIST = ('<cidr-1>', '<cidr-2>', '<your-ip>/32');
ALTER SECRET POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS SET PASSWORD = '<new application password>';
```

Never `CREATE OR REPLACE` the network policy while it is attached to the instance — that detaches it and
blocks every connection.

## 0.6 Check before you deploy

First, as the **deploy role**, through the same CLI connection that deploys:

```bash
snow sql -f snowflake/preflight.sql -D apps_db=<APPS_DATABASE> -D apps_schema=PUBLIC -D warehouse=<WAREHOUSE>
```

It switches secondary roles off (the app runs with the deploy role's own grants only) and prints four checks.
Deploy when all four start with `OK`:

| Check | Not OK means |
|---|---|
| `EAI_CHECK` | the deploy role has no USAGE on `POSTGIS_PLAYGROUND_EAI` (step 6) |
| `SECRET_CHECK` | no USAGE on `POSTGIS_PLAYGROUND_ADMIN` / `.CONFIG`, or no READ, USAGE on the secret (step 6) |
| `OWNER_CHECK` | `WRONG ROLE`: the app exists and another role owns it — deploy with that role |
| `BIND_CHECK` | the account has not given `BIND SERVICE ENDPOINT` to `PUBLIC`; an admin grants it to the deploy role |

Then, as ACCOUNTADMIN, compare the values with the table in 0.4. Five minutes here saves an hour of redeploying.

```sql
SHOW POSTGRES INSTANCES LIKE 'POSTGIS_PLAYGROUND_PG';                       -- state READY, note "host"
DESCRIBE POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG;                          -- network_policy = POSTGIS_PLAYGROUND_PG_POLICY
DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE;    -- today's egress CIDRs
DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE;     -- exactly <host>:5432
DESCRIBE NETWORK RULE POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE;    -- includes tiles.openfreemap.org:443
DESCRIBE INTEGRATION POSTGIS_PLAYGROUND_EAI;                              -- both egress rules, enabled
SHOW SECRETS LIKE 'PG_APP_CREDENTIALS' IN SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG;
SHOW GRANTS TO ROLE <deploy_role>;                                        -- USAGE on the EAI, READ on the secret
```

| Mismatch | What happens after deploy |
|---|---|
| `PG_EGRESS_RULE` has a different host | `getaddrinfo ENOTFOUND <host>` — the app may not even look the host up |
| `PG_INGRESS_RULE` lacks the current CIDRs | connection timeout |
| Secret holds an old password | `password authentication failed for user "application"` |
| Deploy role lacks grants | `Secret ... does not exist or not authorized` during deploy |
| `OSM_EGRESS_RULE` lacks `tiles.openfreemap.org` | no basemap (the map falls back to PostGIS tiles); log `Basemap not reachable` |
| `scripts/postgres-setup.mjs` not run | `database "postgis_playground" does not exist` |

Next: [1. Prepare Snowflake Postgres](01-snowflake-postgres.md).
