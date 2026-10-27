// One-time Postgres setup, as the snowflake_admin role (same as snowflake/postgres_setup.sql, without psql).
// Usage:
//   PGHOST=<host> PG_ADMIN_PASSWORD=<snowflake_admin password> node scripts/postgres-setup.mjs
// Your public IP must be allowed by the instance's network policy (docs/01-snowflake-postgres.md).
import pg from "pg";

const host = process.env.PGHOST;
const password = process.env.PG_ADMIN_PASSWORD;
const database = process.env.PGDATABASE ?? "postgis_playground";
const appRole = process.env.PG_APP_ROLE ?? "application";
if (!host || !password) {
  console.error("Set PGHOST and PG_ADMIN_PASSWORD (the snowflake_admin password).");
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(database) || !/^[a-z_][a-z0-9_]*$/.test(appRole)) {
  console.error("PGDATABASE and PG_APP_ROLE must be simple lowercase identifiers.");
  process.exit(1);
}

const connect = async (db) => {
  const c = new pg.Client({ host, port: 5432, user: "snowflake_admin", password, database: db, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
};

const step = (msg) => console.log(`✓ ${msg}`);

let c = await connect("postgres").catch((e) => {
  console.error(`Cannot connect to ${host}:5432 — ${e.message}`);
  console.error("If this times out, add your IP to the Postgres network rule (POSTGRES_INGRESS).");
  process.exit(1);
});
const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
if (exists.rowCount) step(`database ${database} already exists`);
else {
  await c.query(`CREATE DATABASE ${database}`);
  step(`created database ${database}`);
}
await c.end();

c = await connect(database);
for (const ext of ["postgis", "pgrouting", "h3", "h3_postgis"]) {
  await c.query(`CREATE EXTENSION IF NOT EXISTS ${ext} CASCADE`);
}
await c.query(`GRANT CONNECT, CREATE ON DATABASE ${database} TO ${appRole}`);
step(`extensions installed, CONNECT and CREATE granted to ${appRole}`);
const r = await c.query("SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','pgrouting','h3','h3_postgis','postgis_raster') ORDER BY 1");
for (const row of r.rows) console.log(`  ${row.extname} ${row.extversion}`);
await c.end();
console.log(`\nDone. The app connects to database "${database}" as "${appRole}".`);
