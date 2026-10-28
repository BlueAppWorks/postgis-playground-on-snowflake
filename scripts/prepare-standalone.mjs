// `next build` with output: "standalone" writes a self-contained server to .next/standalone/,
// but leaves out static assets and the files this app reads from disk at runtime.
// Copy them in so `node .next/standalone/server.js` serves everything. Runs after `npm run build`.
import { cpSync, existsSync } from "node:fs";

const out = ".next/standalone";
if (!existsSync(`${out}/server.js`)) {
  console.error(`${out}/server.js not found — is output: "standalone" set in next.config.ts?`);
  process.exit(1);
}
for (const [from, to] of [
  [".next/static", `${out}/.next/static`], // JS/CSS bundles
  ["public", `${out}/public`], // MapLibre worker
  ["sql", `${out}/sql`], // lesson SQL, read by src/server/sqlfiles.ts
  ["data/seed", `${out}/data/seed`], // offline sample, read by src/server/region.ts
]) {
  cpSync(from, to, { recursive: true, force: true });
}
console.log(`standalone server ready: node ${out}/server.js`);
