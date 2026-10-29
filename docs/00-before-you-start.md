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
| Admin role | `ACCOUNTADMIN` (or a role with `CREATE POSTGRES INSTANCE`, `CREATE NETWORK POLICY`, `CREATE INTEGRATION`) for the one-time setup | `SELECT CURRENT_ROLE();` |
| Deploy role | The role your Snowflake CLI connection uses. It may differ from the role you use in Snowsight | `snow sql -q "SELECT CURRENT_ROLE()"` |
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

## 0.3 Order of work

| Step | What | Where | Guide |
|---|---|---|---|
| 1 | Look up App Runtime's egress CIDRs | Snowsight (needs a warehouse) | [1.1](01-snowflake-postgres.md#11-why-a-network-policy-comes-first) |
| 2 | Ingress rule + network policy | Snowsight | 1.1 |
| 3 | **A new, dedicated** Postgres instance — copy the host and both passwords (shown once) | Snowsight | [1.2](01-snowflake-postgres.md#12-create-the-instance) |
| 4 | Database + extensions inside Postgres, and a check of the `application` login — **go on only when it prints `Ready to deploy`** | your machine: `node scripts/postgres-setup.mjs` | [1.3](01-snowflake-postgres.md#13-prepare-the-database-in-postgres) |
| 5 | Egress rules, secret, integration | Snowsight | [2](02-external-access.md) |
| 6 | Grants for the deploy role (skip if it is ACCOUNTADMIN) | Snowsight | [2.3](02-external-access.md#23-the-external-access-integration) |
| 7 | Fill in `app.yml`, `snow app deploy` | your machine | [3](03-deploy.md) |

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

Run these and compare with the table in 0.4. Five minutes here saves an hour of redeploying.

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
