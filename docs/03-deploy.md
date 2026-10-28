# 3. Deploy with Snowflake App Runtime

App Runtime takes this folder, builds it inside Snowflake, and serves it at a stable HTTPS URL. There is
no Dockerfile, no image registry, and no compute pool to manage — `app.yml` describes everything.

## 3.1 Prerequisites

- Parts [1](01-snowflake-postgres.md) and [2](02-external-access.md) are done, and the checks in
  [0.6](00-before-you-start.md#06-check-before-you-deploy) pass.
- **Snowflake CLI 3.26 or later.** `snow app deploy --help` must list a `--target` option; that is the version
  that reads deployment settings from `app.yml` (version 2). An older CLI fails with
  `Your project definition is missing ...` or asks for a `snowflake.yml` — upgrade it, or see
  [Older Snowflake CLI](#older-snowflake-cli).
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

Everything else is already set — leave it as it is:

| Setting | Why it is like that |
|---|---|
| `secrets: - name: PG` | mount names must be upper case; the app reads `/secrets/PG/` |
| no `PGPASSWORD`, `PORT` or `HOSTNAME` in `environment_variables` | the password comes from the secret; `PORT` / `HOSTNAME` are reserved and set by App Runtime |
| `install: npm ci --include=dev` | the build needs TypeScript, which is a dev dependency |
| `build: npm run build`, then `rm -rf node_modules` | `next build` writes a self-contained server (`output: "standalone"`); `postbuild` ([`scripts/prepare-standalone.mjs`](../scripts/prepare-standalone.mjs)) copies static files, `sql/` and `data/seed/` next to it |
| `run: node .next/standalone/server.js` | App Runtime keeps the build output but not `node_modules`, so `next start` would fail with `next: not found` |

## 3.3 Deploy

From this folder:

```bash
snow app deploy
```

This uploads the source (minus everything in `ignore:`), runs the install and build commands in a Snowflake
build job, and creates or updates the Application Service. The first deploy takes 5–10 minutes; **let it run
to the end** — it ends by printing the app's URL. Open it:

```bash
snow app open
```

With **Cortex Code**, open this folder and ask: *"Deploy this app with snow app deploy."*
The [`AGENTS.md`](../AGENTS.md) file tells the agent what must be filled in first.

If the command is interrupted, run `snow app deploy` again rather than `--promote-only`: promoting while a build
is still running deploys the *previous* package, which looks as if your fix had no effect.
Do not drop the Application Service to "start clean"; the next deploy updates it in place.

Logs of the running app (startup errors, `Postgres not reachable: ...`):

```bash
snow app events
```

or in SQL: `CALL SYSTEM$GET_APPLICATION_SERVICE_LOGS('<APPS_DATABASE>.PUBLIC.POSTGIS_PLAYGROUND');`

### Deploy errors

| Error | Fix |
|---|---|
| `Your project definition is missing ...` / asks for `snowflake.yml` | CLI older than 3.26 — upgrade, or [Older Snowflake CLI](#older-snowflake-cli) |
| `Invalid secret name 'pg' in app.yaml` | the mount name must be upper case: `name: PG` |
| `Environment variable 'PORT' is reserved` | remove `PORT` / `HOSTNAME` from `environment_variables` |
| `Secret '...' does not exist or not authorized. Your primary role X ...` | grant role X access ([2.3](02-external-access.md#23-the-external-access-integration)) |
| App log: `sh: next: not found`, exit status 127 | `run` must be `node .next/standalone/server.js` and `next.config.ts` must keep `output: "standalone"` |
| App log: `ENOENT ... sql/...` or `data/seed/sample.json`; lessons do not load | the `postbuild` step did not run — keep `"postbuild"` in `package.json` |
| App log: `getaddrinfo ENOTFOUND <host>` | `PG_EGRESS_RULE` names another host ([2.1](02-external-access.md#21-egress-network-rules)) |
| Upload takes very long | a local `node_modules/` is being uploaded — only with `snowflake.yml`; use its `artifacts` list as shipped |

### Older Snowflake CLI

Snowflake CLI before 3.26 reads the deployment target from `snowflake.yml` instead of `app.yml`.
Upgrading is the better fix (`pip install --upgrade snowflake-cli`, or the installer from the
[releases page](https://github.com/snowflakedb/snowflake-cli/releases)). If you cannot upgrade:

```bash
cp snowflake.yml.legacy-cli snowflake.yml   # then fill in the same <...> values as in app.yml
snow app deploy
```

`app.yml` stays as it is — the build job still reads `install` / `build` / `run`, `secrets` and
`environment_variables` from it. `snowflake.yml` is git-ignored; delete it after upgrading the CLI.

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
environment instead of `/secrets/PG/`.

To run the same server App Runtime runs: `npm run build && npm start` (listens on `PORT`, default 3000).

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
