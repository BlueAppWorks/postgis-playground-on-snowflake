# Notes for coding agents (Cortex Code, etc.)

This is a Next.js 16 app for **Snowflake App Runtime**, already set up for it: `app.yml` version 2, a standalone
Next.js build (`output: "standalone"`, `postbuild` copies `sql/`, `data/seed/`, static files), and the Postgres
password mounted from a secret at `/secrets/PG/`. Deploy with `snow app deploy` from this folder.
**Do not restructure the build, the manifest or `src/server/*` to get a deploy working** — deploy failures so far
were always missing or stale Snowflake objects; `docs/03-deploy.md` → "Deploy errors" maps each error to its fix.

Two project skills cover the common requests — use them:
- `.snowflake/cortex/skills/postgis-playground-setup/SKILL.md` — Postgres instance, network policy, EAI, secret, `app.yml`, deploy
- `.snowflake/cortex/skills/postgis-playground-region/SKILL.md` — switch the sample region (`config/region.json` → `npm run seed:build`)

## Before deploying

`app.yml` contains `<...>` placeholders that must be replaced — ask the user for them, do not guess:

- `database`, `query_warehouse`
- `PGHOST` — the Snowflake Postgres instance host (`SHOW POSTGRES INSTANCES` shows it)
- `OSM_USER_AGENT` — how the app names itself to OpenStreetMap's free servers (their usage policy asks for an app
  name and a contact). Explain this to the user, then offer `PostGIS-Playground/1.0 (<email>)` or, without an email,
  `PostGIS-Playground/1.0 (+https://github.com/BlueAppWorks/postgis-playground-on-snowflake)`

These Snowflake objects must already exist (created by `snowflake/setup.sql`, explained in `docs/00-*.md` to `docs/02-*.md`):

- External access integration `POSTGIS_PLAYGROUND_EAI` (egress to the Postgres host:5432, the OpenStreetMap APIs,
  and `tiles.openfreemap.org` — the app proxies the basemap at `/api/basemap`, so browsers never fetch it directly)
- Password secret `POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS` (Postgres role `application`)
- The Postgres instance's network policy must allow Snowflake's egress IP ranges (`SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES()`)

Run the checks in `docs/00-before-you-start.md` §0.6 before the first deploy, and deploy only after
`scripts/postgres-setup.mjs` prints `Ready to deploy` and `snowflake/preflight.sql` (run as the deploy role) shows
only `OK`.

Roles: the one-time setup needs ACCOUNTADMIN; the deploy role (the CLI connection's role) owns the app and must be
the same on every deploy. Never grant anything to `PUBLIC`, and never write `CREATE APPLICATION SERVICE` by hand —
fix the cause and run `snow app deploy` again.

Updating an existing deployment after `git pull`: existing network rules keep their old values
(`IF NOT EXISTS`) — follow "Already deployed?" in the setup skill before redeploying. Also run `git status`:
files left from an earlier attempt are deployed too and can override the new code; only `app.yml` should differ.

Never write the Postgres password into `app.yml` (no `PGUSER` / `PGPASSWORD` environment variables), source files,
or `.env*` files that are committed. Snowflake CLI older than 3.26: use `snowflake.yml.legacy-cli`, do not edit `app.yml`.

## Checks

- `npm run typecheck` and `npm run build` must pass; `npm start` then runs the same standalone server as App Runtime.
- With a running app: `node scripts/smoke.mjs <url>` runs every lesson step.

## Conventions

- Lesson SQL lives only in `sql/lessons/*.sql` as `-- name: <block>` sections; the UI shows exactly that text.
  Parameters are `:name` placeholders (always cast, e.g. `:radius::float8`) and are bound, never interpolated.
- Lesson text, controls and drawing options are in `src/lessons/index.ts`.
- A query result is drawn on the map when it has a geometry column; the `label` column becomes the map label.
- Nothing region-specific is hard-coded: lesson text uses `{region}` / `{anchor}`, SQL uses `:anchor_name`, `:anchor_lng`,
  `:anchor_lat`, and the map center comes from `data/seed/sample.json`.
- Keep the lessons usable by a GIS beginner: one idea per step, and the "explain" text says what just happened.
