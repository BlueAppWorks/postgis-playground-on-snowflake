// Display-only: show the SQL with the current parameter values written in as literals,
// so the SQL card changes as the learner moves a slider. Execution always uses bind parameters.

const NAMED = /(?<![:\w]):([a-zA-Z_]\w*)/g;

export function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `'{${v.join(",")}}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function previewSql(sql: string, values: Record<string, unknown>): string {
  return sql
    .replace(/\{\{(\w+)\}\}/g, (m, name: string) => (values[name] !== undefined ? String(values[name]) : m))
    .replace(NAMED, (m, name: string) => (name in values ? literal(values[name]) : m));
}

// For the SQL Trace: replace $1, $2 ... with the (preview) parameter values.
export function inlineDollarParams(sql: string, params: string[] = []): string {
  return sql.replace(/\$(\d+)\b/g, (m, i: string) => {
    const v = params[Number(i) - 1];
    if (v === undefined) return m;
    return /^-?\d+(\.\d+)?$/.test(v) ? v : `'${v.replace(/'/g, "''")}'`;
  });
}
