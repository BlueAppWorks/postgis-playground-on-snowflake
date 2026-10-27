# 3. Deploy with Snowflake App Runtime

App Runtime takes this folder, builds it inside Snowflake, and serves it at a stable HTTPS URL. There is
no Dockerfile, no image registry, and no compute pool to manage — `app.yml` describes everything.

## 3.1 Prerequisites

- Parts [1](01-snowflake-postgres.md) and [2](02-external-access.md) are done.
- Snowflake CLI with App Runtime support. Check with `snow helpers check-version`; if the command is
  unknown or `snow app deploy` asks for a `snowflake.yml`, upgrade the CLI.
  (Cortex Code CLI / Desktop includes everything needed.)
- A warehouse name for `query_warehouse` (App Runtime requires one; this app's own queries go to Postgres).
- A database to deploy into. Your personal database (`USER$`) works for trying it out; to share the app
  with other roles, an administrator sets up a shared database once — see
  [Getting started with App Runtime](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/getting-started).

## 3.2 Fill in `app.yml`

Replace the `<...>` values:

| Field | Example | Notes |
|---|---|---|
| `database` | `SNOWFLAKE_APPS` or `USER$` | where the Application Service is created |
| `query_warehouse` | `COMPUTE_WH` | required by App Runtime |
| `PGHOST` | `abc123xyz.your-account.us-west-2.aws.postgres.snowflake.app` | the instance `host` |
| `OSM_USER_AGENT` | `PostGIS-Playground/1.0 (you@example.com)` | OpenStreetMap asks clients to identify themselves |

Everything else is already set: the integration, the secret mount, and the build/run commands
(`npm ci` → `npm run build` → `npm start`, which listens on the `HOSTNAME` and `PORT` App Runtime provides).

## 3.3 Deploy

From this folder:

```bash
snow app deploy
```

This uploads the source (minus everything in `ignore:`), runs `npm ci` and `npm run build` in a Snowflake
build job, and creates or updates the Application Service. The first deploy takes a few minutes; it ends
by printing the app's URL. Open it:

```bash
snow app open
```

With **Cortex Code**, open this folder and ask: *"Deploy this app with snow app deploy."*
The [`AGENTS.md`](../AGENTS.md) file tells the agent what must be filled in first.

If a phase fails, retry just that phase: `snow app deploy --upload-only`, `--build-only`, or `--promote-only`.
Logs: `snow app events`.

## 3.4 First run

1. The top bar shows `● Empty database` — the app reached Postgres.
2. Go through **Lesson 0** (creates the `geo` schema and tables) and **Lesson 2** (your places + OpenStreetMap data),
   or press **Quick start** to do both with the Menlo Park sample in one click.
3. Lessons 3–13 now work on your data. Press **Reset** at any time to drop everything and start over.

## 3.5 Share it

```sql
GRANT USAGE ON DATABASE <APPS_DATABASE> TO ROLE <learners>;
GRANT USAGE ON SCHEMA <APPS_DATABASE>.PUBLIC TO ROLE <learners>;
GRANT USAGE ON APPLICATION SERVICE <APPS_DATABASE>.PUBLIC.POSTGIS_PLAYGROUND TO ROLE <learners>;
```

Everyone who opens the app shares the same Postgres database, so one learner's **Reset** affects all.
For a workshop, give each learner their own deployment (their own `USER$` database and Postgres database),
or set `ALLOW_SQL_CONSOLE=false` to remove the free-form SQL editor.

## 3.6 Develop locally

```bash
cp .env.example .env.local     # PGHOST, PGDATABASE, PGUSER=application, PGPASSWORD
npm install
npm run dev                    # http://localhost:3000
```

Your IP must be in `PG_INGRESS_RULE` (part 1). Locally the app reads `PGUSER` / `PGPASSWORD` from the
environment instead of `/secrets/pg/`.

Check every lesson against a running app:

```bash
node scripts/smoke.mjs http://localhost:3000             # uses the offline sample
node scripts/smoke.mjs http://localhost:3000 --with-apis # also calls Nominatim and Overpass once
```

## 3.7 Costs and cleanup

- App Runtime suspends the app after an hour without traffic (`auto_suspend_secs: 3600`).
- The Postgres instance is billed while it runs: `ALTER POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG SUSPEND;`
- Remove everything:

```bash
snow app teardown
```

```sql
DROP POSTGRES INSTANCE POSTGIS_PLAYGROUND_PG;
DROP INTEGRATION POSTGIS_PLAYGROUND_EAI;
DROP NETWORK POLICY POSTGIS_PLAYGROUND_PG_POLICY;
DROP DATABASE POSTGIS_PLAYGROUND_ADMIN;   -- network rules and the secret
```

## Security notes

- The app connects as `application`, which cannot create extensions, change settings or read other databases.
- Values from the browser are always sent as bind parameters. The one exception, the spatial predicate in
  Lesson 7 (a function name), is chosen from a fixed list on the server.
- The "Try it" editor runs any SQL the viewer types, as `application`, with a 30-second timeout.
  That is the point of a playground — but on a shared deployment, set `ALLOW_SQL_CONSOLE=false`.
- The connection to Postgres is encrypted (TLS). The server certificate is issued by a Snowflake CA rather than
  a public one, so by default it is not verified (like `sslmode=require`). To verify it, set `PGSSL_CA` to the
  CA certificate (PEM text or a file path).
