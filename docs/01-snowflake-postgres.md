# 1. Prepare Snowflake Postgres

In this part you create a Postgres instance in Snowflake, decide who may connect to it, and prepare a
database with the extensions the lessons use. It takes about 15 minutes, most of it waiting for the instance.

You need: a paid Snowflake account, the ACCOUNTADMIN role (or a role with `CREATE POSTGRES INSTANCE`,
`CREATE NETWORK POLICY` and `CREATE INTEGRATION`), and `psql` (any recent PostgreSQL client).

All Snowflake statements are in [`snowflake/setup.sql`](../snowflake/setup.sql) — this page explains them.
Run them in a Snowsight SQL worksheet.

---

## 1.1 Why a network policy comes first

A Snowflake Postgres instance is a real Postgres server with its own hostname on the internet.
**It accepts no connections at all until a network policy allows them.** The policy lists IP ranges
in network rules with the special mode `POSTGRES_INGRESS` (ordinary `INGRESS` rules are ignored by Postgres instances).

Two kinds of clients need to connect:

| Client | Its IP address |
|---|---|
| The app on App Runtime | Snowflake's outbound IP ranges for containers |
| You, with `psql`, for the one-time setup (and local development) | Your public IP |

Look up Snowflake's outbound ranges:

```sql
SELECT value:ipv4_prefix::STRING AS cidr, value:expires::STRING AS expires
FROM TABLE(FLATTEN(INPUT => PARSE_JSON(SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES())));
```

You get a few CIDR blocks such as `153.45.4.0/24` with an expiry date. Find your own IP at
<https://checkip.amazonaws.com>.

```sql
USE ROLE ACCOUNTADMIN;
CREATE DATABASE IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN;
CREATE SCHEMA IF NOT EXISTS POSTGIS_PLAYGROUND_ADMIN.CONFIG;
USE SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG;

CREATE NETWORK RULE IF NOT EXISTS PG_INGRESS_RULE
  TYPE = IPV4
  MODE = POSTGRES_INGRESS
  VALUE_LIST = ('153.45.4.0/24', '153.45.78.0/24', '203.0.113.7/32');  -- egress ranges + your IP

CREATE NETWORK POLICY IF NOT EXISTS POSTGIS_PLAYGROUND_PG_POLICY
  ALLOWED_NETWORK_RULE_LIST = ('POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_INGRESS_RULE');
```

> **Avoid `0.0.0.0/0`.** It works, but it exposes your database login to the whole internet.
> Snowflake explicitly recommends against it for Postgres instances.

> **The ranges expire.** When `expires` approaches, update the rule *in place* with
> `ALTER NETWORK RULE PG_INGRESS_RULE SET VALUE_LIST = (...)`. Do not `CREATE OR REPLACE` the
> policy while it is attached — that detaches it and blocks every connection.

## 1.2 Create the instance

Create a **new instance just for this app**, even if the account already has one. Reusing another app's instance
means changing its network policy or resetting its passwords, which breaks that app.

```sql
CREATE POSTGRES INSTANCE IF NOT EXISTS POSTGIS_PLAYGROUND_PG
  COMPUTE_FAMILY = 'BURST_S'          -- smallest size; fine for learning
  STORAGE_SIZE_GB = 10
  AUTHENTICATION_AUTHORITY = POSTGRES -- log in with Postgres passwords
  POSTGRES_VERSION = 18
  NETWORK_POLICY = 'POSTGIS_PLAYGROUND_PG_POLICY';
```

The result has one row with:

| Column | What it is |
|---|---|
| `host` | e.g. `abc123xyz.your-account.us-west-2.aws.postgres.snowflake.app` — you need it three more times |
| `access_roles` | user names and passwords for **`snowflake_admin`** and **`application`** |

**Copy both passwords now. They are shown only once** and cannot be retrieved later
(you could only reset them).

- `snowflake_admin` — the administrator. You use it once, below, to install extensions.
- `application` — a normal login role. **The app uses this one.** It can create its own tables
  but cannot change server settings or other users' data.

Wait until the instance is ready:

```sql
SHOW POSTGRES INSTANCES LIKE 'POSTGIS_PLAYGROUND_PG';   -- state = READY
```

## 1.3 Prepare the database (in Postgres)

Connect as the admin. TLS is required:

```bash
psql "host=<host> port=5432 dbname=postgres user=snowflake_admin sslmode=require"
```

If the connection hangs or is refused, your IP is not in `PG_INGRESS_RULE` — see Troubleshooting.

A new instance has only the `postgres` database; this step creates `postgis_playground`.
Run it from your own machine. Avoid doing it in a Snowflake stored procedure: that needs its own
external access to the instance, and the admin password passed as an argument stays in the query history.

No psql? From the project folder, after `npm install`, the same setup runs with Node
(on Windows PowerShell, use `npm.cmd install` if `npm` is blocked by the execution policy):

```bash
PGHOST=<host> PG_ADMIN_PASSWORD='<snowflake_admin password>' PG_APP_PASSWORD='<application password>' node scripts/postgres-setup.mjs
```

After the setup it logs in as `application`, the way the app will. **Deploy only after it prints
`Ready to deploy`.** If it stops at a connection or password error, a deployed app would stop at the same
error, so fix it here (see Troubleshooting). The `application` password that passed is the one to store in
the Snowflake secret in part 2.

With psql, run [`snowflake/postgres_setup.sql`](../snowflake/postgres_setup.sql):

```sql
CREATE DATABASE postgis_playground;
\c postgis_playground

CREATE EXTENSION IF NOT EXISTS postgis;               -- all lessons
CREATE EXTENSION IF NOT EXISTS pgrouting;             -- Lesson 8 (routing)
CREATE EXTENSION IF NOT EXISTS h3;                    -- Lesson 10 (H3 hexagons)
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;    -- also installs postgis_raster

GRANT CONNECT, CREATE ON DATABASE postgis_playground TO application;
```

Why the admin does this: creating extensions needs administrator rights, and the app should not have them.
`GRANT CREATE ON DATABASE` lets the `application` role create its own schema (`geo`) — Lesson 0 does that
from inside the app, so you can watch it happen.

Check:

```sql
SELECT extname, extversion FROM pg_extension ORDER BY extname;
```

You should see `postgis 3.6.x`, `pgrouting 3.8.x`, `h3 4.5.x`, `h3_postgis`, `postgis_raster`.
(Versions depend on your instance; check what is available with
`SELECT name, default_version FROM pg_available_extensions WHERE name ~ 'postgis|pgrouting|h3';`.)

Optional: confirm the app's login works and is *not* an admin:

```bash
psql "host=<host> port=5432 dbname=postgis_playground user=application sslmode=require" \
     -c "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;"
```

## 1.4 What you have now

| Object | Value you will need |
|---|---|
| Postgres host | `<host>` |
| Database | `postgis_playground` |
| App login | `application` / its password |
| Network policy | `POSTGIS_PLAYGROUND_PG_POLICY` (App Runtime ranges + your IP) |

Next: [2. External access](02-external-access.md).

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `psql` hangs, then times out | No network policy, or your IP is not in it. `DESCRIBE POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG;` shows the attached policy. Add your IP with `ALTER NETWORK RULE`. |
| `Snowflake authentication failed ... user: snowflake_admin` | Wrong admin password — for example an instance created earlier by someone else. Use your own instance (1.2). |
| `password authentication failed` | Wrong role or password. Passwords are per role (`snowflake_admin` vs `application`). Reset with `ALTER POSTGRES INSTANCE ... RESET ACCESS FOR 'application'` (this issues a new password — update the Snowflake secret afterwards). |
| `required extension "postgis_raster" is not installed` | Use `CREATE EXTENSION h3_postgis CASCADE;`. |
| `database "postgis_playground" does not exist` (app log or status chip) | This step was not run. Run `scripts/postgres-setup.mjs` (or `postgres_setup.sql`) as `snowflake_admin`. |
| `must be owner of extension ...` when the app runs Lesson 8 or 10 | The extension was not created by the admin. Run `postgres_setup.sql` as `snowflake_admin`. |
| The instance is `SUSPENDED` | `ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG RESUME;` — suspend it again when you stop studying to save credits. |
