# 2. External access: let the app reach Postgres and OpenStreetMap

An App Runtime app runs inside Snowflake with **no outbound network access by default**. That is a good
default — but this app must talk to two kinds of hosts:

| Host | Port | Why |
|---|---|---|
| your Postgres instance (`<host>`) | 5432 | every lesson |
| `nominatim.openstreetmap.org` | 443 | Lesson 2: turn place names into coordinates |
| `overpass-api.de` (+ two mirrors) | 443 | Lesson 2: download streets, parks and shops |

You grant this with three Snowflake objects:

```
NETWORK RULE (EGRESS, HOST_PORT)  ─┐
NETWORK RULE (EGRESS, HOST_PORT)  ─┼─▶  EXTERNAL ACCESS INTEGRATION  ─▶  app.yml: external_access_integrations
                                   │
SECRET (TYPE = PASSWORD)  ─────────────────────────────────────────────▶  app.yml: secrets  →  /secrets/pg/...
```

> **Ingress vs egress.** In [part 1](01-snowflake-postgres.md) you allowed traffic *into* Postgres
> (`POSTGRES_INGRESS`). Here you allow traffic *out of* the app (`EGRESS`). A connection from the app to
> Postgres needs both: the app may leave through the EAI, and Postgres lets it in through its network policy.

The statements are sections 4–6 of [`snowflake/setup.sql`](../snowflake/setup.sql).

## 2.1 Egress network rules

```sql
USE ROLE ACCOUNTADMIN;
USE SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG;

CREATE NETWORK RULE IF NOT EXISTS PG_EGRESS_RULE
  TYPE = HOST_PORT
  MODE = EGRESS
  VALUE_LIST = ('<host>:5432');

CREATE NETWORK RULE IF NOT EXISTS OSM_EGRESS_RULE
  TYPE = HOST_PORT
  MODE = EGRESS
  VALUE_LIST = ('nominatim.openstreetmap.org:443',
                'overpass-api.de:443',
                'overpass.private.coffee:443',
                'overpass.kumi.systems:443');
```

- `HOST_PORT` rules name hosts, not IPs — right for services whose IPs change.
- Use the exact Postgres host from part 1. A wildcard such as `*.postgres.snowflake.app:5432` also works
  but allows every Postgres instance, not just yours.
- The two extra Overpass hosts are public mirrors the app falls back to when the main server is busy
  (it often is). Leave them out if your organization prefers one host.
- If you only want to use the offline Menlo Park sample, `OSM_EGRESS_RULE` is optional.

## 2.2 The password as a secret

```sql
CREATE SECRET IF NOT EXISTS PG_APP_CREDENTIALS
  TYPE = PASSWORD
  USERNAME = 'application'
  PASSWORD = '<application password from part 1>';
```

App Runtime mounts a secret as files, never as an environment variable. With the mount name `pg` in
`app.yml`, the app reads:

```
/secrets/pg/username
/secrets/pg/password
```

([`src/server/db.ts`](../src/server/db.ts) reads the password each time it opens a connection, so a
rotated secret is picked up without redeploying.) The password never appears in `app.yml`, in the code, or in Git.

## 2.3 The external access integration

```sql
CREATE EXTERNAL ACCESS INTEGRATION IF NOT EXISTS POSTGIS_PLAYGROUND_EAI
  ALLOWED_NETWORK_RULES = (POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_EGRESS_RULE,
                           POSTGIS_PLAYGROUND_ADMIN.CONFIG.OSM_EGRESS_RULE)
  ENABLED = TRUE;
```

Password secrets do not need to be listed in the integration (only OAuth secrets do).

If you deploy with a role other than ACCOUNTADMIN, give it access:

```sql
GRANT USAGE ON INTEGRATION POSTGIS_PLAYGROUND_EAI TO ROLE <deploy_role>;
GRANT USAGE ON DATABASE POSTGIS_PLAYGROUND_ADMIN TO ROLE <deploy_role>;
GRANT USAGE ON SCHEMA POSTGIS_PLAYGROUND_ADMIN.CONFIG TO ROLE <deploy_role>;
GRANT READ, USAGE ON SECRET POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS TO ROLE <deploy_role>;
```

## 2.4 Wire it into `app.yml`

```yaml
external_access_integrations:
  - POSTGIS_PLAYGROUND_EAI

secrets:
  - name: pg                                                   # → /secrets/pg/
    secret: POSTGIS_PLAYGROUND_ADMIN.CONFIG.PG_APP_CREDENTIALS

environment_variables:
  - name: PGHOST
    value: "<host>"
  - name: PGDATABASE
    value: "postgis_playground"
  - name: OSM_USER_AGENT
    value: "PostGIS-Playground/1.0 (you@example.com)"         # identify yourself to OpenStreetMap
```

Next: [3. Deploy](03-deploy.md).

---

## How do I know it works?

After deploying, the top-right corner of the app shows the connection state:

| Shown | Meaning |
|---|---|
| `● Empty database` (yellow) | Connected. Run Lesson 0 or press **Quick start**. |
| `● 5 places · 174 POI · …` (green) | Connected, with data. |
| `● Postgres not reachable` (red) | Hover for the error; see below. |

| Error | Cause |
|---|---|
| timeout / `ETIMEDOUT` / `ECONNREFUSED` | Either the EAI does not allow `<host>:5432` (egress), or the Postgres network policy does not include App Runtime's IP ranges (ingress). Check both — the ranges can change; re-run `SYSTEM$GET_SNOWFLAKE_EGRESS_IP_RANGES()`. |
| `password authentication failed for user "application"` | The secret's password is wrong or was reset. `ALTER SECRET PG_APP_CREDENTIALS SET PASSWORD = '...';` |
| `PGHOST is not set` | `environment_variables` missing in `app.yml`. |
| Lesson 2 says Nominatim / Overpass failed | `OSM_EGRESS_RULE` missing from the EAI, or the public Overpass servers are busy. Use **"Use the Menlo Park sample instead"**, or try again in a few minutes. The SQL Trace shows each HTTP call and its status. |
| The map has no background | The browser could not load the basemap from `tiles.openfreemap.org` (e.g. blocked by a policy). The app switches to drawing roads and parks from PostGIS tiles automatically; set `BASEMAP_STYLE_URL=none` to do that from the start. |
