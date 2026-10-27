import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

// A SQL file holds several named blocks:
//   -- name: block_name
//   SELECT ...;
// The text shown in the app is exactly the text that is executed.

const SQL_DIR = path.join(process.cwd(), "sql");
const cache = new Map<string, Map<string, string>>();

function parse(file: string): Map<string, string> {
  const hit = cache.get(file);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const text = readFileSync(path.join(SQL_DIR, file), "utf8").replace(/\r\n/g, "\n");
  const blocks = new Map<string, string>();
  let name: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (name) blocks.set(name, lines.join("\n").trim().replace(/;\s*$/, ""));
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^--\s*name:\s*(\w+)\s*$/);
    if (m) {
      flush();
      name = m[1];
      lines = [];
    } else if (name) {
      lines.push(line);
    }
  }
  flush();
  cache.set(file, blocks);
  return blocks;
}

// ref is "block" (in the lesson's file) or "common:block".
export function getSql(lessonFile: string, ref: string): string {
  const [file, name] = ref.startsWith("common:") ? ["common.sql", ref.slice(7)] : [`lessons/${lessonFile}`, ref];
  const sql = parse(file).get(name);
  if (!sql) throw new Error(`SQL block "${name}" not found in sql/${file}`);
  return sql;
}

export function getCommon(name: string): string {
  return getSql("", `common:${name}`);
}
