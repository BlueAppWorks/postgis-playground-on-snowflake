// One-time Postgres setup, as the snowflake_admin role (same as snowflake/postgres_setup.sql, without psql),
// then a check that the app's own login works — the same check the app makes after deploy.
// Usage:
//   PGHOST=<host> PG_ADMIN_PASSWORD=<snowflake_admin password> PG_APP_PASSWORD=<application password> node scripts/postgres-setup.mjs
// Either password can be left out: admin only = setup without the check; app only = the check alone.
// Deploy only after it prints "Ready to deploy". Your public IP must be allowed by the instance's network policy
// (docs/01-snowflake-postgres.md).
import pg from "pg";

const host = process.env.PGHOST;
const adminPassword = process.env.PG_ADMIN_PASSWORD;
const appPassword = process.env.PG_APP_PASSWORD;
const database = process.env.PGDATABASE ?? "postgis_playground";
const appRole = process.env.PG_APP_ROLE ?? "application";
const EXTENSIONS = ["postgis", "pgrouting", "h3", "h3_postgis"];
if (!host || (!adminPassword && !appPassword)) {
  console.error("Set PGHOST and PG_ADMIN_PASSWORD (snowflake_admin) and/or PG_APP_PASSWORD (application).");
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(database) || !/^[a-z_][a-z0-9_]*$/.test(appRole)) {
  console.error("PGDATABASE and PG_APP_ROLE must be simple lowercase identifiers.");
  process.exit(1);
}

const connect = async (user, password, db) => {
  const c = new pg.Client({ host, port: 5432, user, password, database: db, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
  } catch (e) {
    console.error(`✗ Cannot connect to ${host}:5432 as ${user} (database ${db}) — ${e.message}`);
    if (/timeout|ETIMEDOUT/i.test(e.message)) console.error("  Your IP is not in the Postgres network rule (PG_INGRESS_RULE), or a VPN changed it.");
    else if (/authentication failed/i.test(e.message)) console.error(`  Wrong password for ${user}. Do not deploy until this works.`);
    else if (e.code === "3D000") console.error("  The database does not exist yet: run this script with PG_ADMIN_PASSWORD first.");
    process.exit(1);
  }
  return c;
};

const step = (msg) => console.log(`✓ ${msg}`);

if (adminPassword) {
  let c = await connect("snowflake_admin", adminPassword, "postgres");
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (exists.rowCount) step(`database ${database} already exists`);
  else {
    await c.query(`CREATE DATABASE ${database}`);
    step(`created database ${database}`);
  }
  await c.end();

  c = await connect("snowflake_admin", adminPassword, database);
  for (const ext of EXTENSIONS) {
    await c.query(`CREATE EXTENSION IF NOT EXISTS ${ext} CASCADE`);
  }
  await c.query(`GRANT CONNECT, CREATE ON DATABASE ${database} TO ${appRole}`);
  step(`extensions installed, CONNECT and CREATE granted to ${appRole}`);
  const r = await c.query("SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','pgrouting','h3','h3_postgis','postgis_raster') ORDER BY 1");
  for (const row of r.rows) console.log(`  ${row.extname} ${row.extversion}`);
  await c.end();
}

if (!appPassword) {
  console.log(`\nSetup done. Before deploying, check the app's login (the password that goes into the secret):`);
  console.log(`  PGHOST=${host} PG_APP_PASSWORD='<application password>' node scripts/postgres-setup.mjs`);
  process.exit(0);
}

// The app's view: log in as application, see the extensions, may create its schema (Lesson 0).
const c = await connect(appRole, appPassword, database);
const ext = (await c.query("SELECT extname FROM pg_extension")).rows.map((row) => row.extname);
const missing = EXTENSIONS.filter((e) => !ext.includes(e));
const { can_create } = (await c.query("SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create")).rows[0];
await c.end();
if (missing.length || !can_create) {
  if (missing.length) console.error(`✗ Missing extensions: ${missing.join(", ")} — run this script with PG_ADMIN_PASSWORD.`);
  if (!can_create) console.error(`✗ ${appRole} may not create schemas in ${database} — run this script with PG_ADMIN_PASSWORD.`);
  process.exit(1);
}
step(`${appRole} logs in to ${database}, sees ${EXTENSIONS.join(", ")}, and may create its schema`);
console.log(`\nReady to deploy. Put this same ${appRole} password into the PG_APP_CREDENTIALS secret.`);
