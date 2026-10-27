# Notes for coding agents (Cortex Code, etc.)

This is a Next.js 16 app for **Snowflake App Runtime**. Deploy with `snow app deploy` from this folder.

Two project skills cover the common requests — use them:
- `.snowflake/cortex/skills/postgis-playground-setup/SKILL.md` — Postgres instance, network policy, EAI, secret, `app.yml`, deploy
- `.snowflake/cortex/skills/postgis-playground-region/SKILL.md` — switch the sample region (`config/region.json` → `npm run seed:build`)

## Before deploying

`app.yml` contains `<...>` placeholders that must be replaced — ask the user for them, do not guess:

- `database`, `query_warehouse`
- `PGHOST` — the Snowflake Postgres instance host (`SHOW POSTGRES INSTANCES` shows it)
- `OSM_USER_AGENT` — a contact (email or URL) for OpenStreetMap's usage policy

These Snowflake objects must already exist (created by `snowflake/setup.sql`, explained in `docs/01-*.md` and `docs/02-*.md`):

- External access integration `POSTGIS_PLAYGROUND_EAI` (egress to the Postgres host:5432 and the OpenStreetMap APIs)
- Password secret `POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS` (Postgres role `application`)
- The Postgres instance's network policy must allow Snowflake's egress IP ranges (`SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES()`)

Never write the Postgres password into `app.yml`, source files, or `.env*` files that are committed.

## Checks

- `npm run typecheck` and `npm run build` must pass.
- With a running app: `node scripts/smoke.mjs <url>` runs every lesson step.

## Conventions

- Lesson SQL lives only in `sql/lessons/*.sql` as `-- name: <block>` sections; the UI shows exactly that text.
  Parameters are `:name` placeholders (always cast, e.g. `:radius::float8`) and are bound, never interpolated.
- Lesson text, controls and drawing options are in `src/lessons/index.ts`.
- A query result is drawn on the map when it has a geometry column; the `label` column becomes the map label.
- Nothing region-specific is hard-coded: lesson text uses `{region}` / `{anchor}`, SQL uses `:anchor_name`, `:anchor_lng`,
  `:anchor_lat`, and the map center comes from `data/seed/sample.json`.
- Keep the lessons usable by a GIS beginner: one idea per step, and the "explain" text says what just happened.
