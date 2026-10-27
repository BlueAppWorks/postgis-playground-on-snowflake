// Shared by the server (validation, execution) and the browser (rendering the lesson UI).

export type Level = "basic" | "intermediate" | "advanced";

// The sample region (config/region.json → data/seed/sample.json).
// Lesson text may contain {region} and {anchor}; they are replaced with these names.
export type Region = { name: string; anchor: { name: string; lng: number; lat: number } };

export type SelectOption = {
  label: string;
  value: string;
  // Extra parameters set when this option is chosen (e.g. a city sets :city_lng and :city_lat).
  params?: Record<string, number | string>;
};

export type Control =
  | { type: "slider"; name: string; label: string; min: number; max: number; step: number; default: number; unit?: string }
  | {
      type: "select";
      name: string;
      label: string;
      options?: SelectOption[];
      // Name of a block in sql/common.sql returning (value, label) rows.
      optionsQuery?: string;
      valueType?: "int" | "text";
      // When true the value is substituted into {{name}} in the SQL. Only static options are allowed.
      identifier?: boolean;
      default?: string;
      defaultIndex?: number;
    }
  // Sets :<name>_lng and :<name>_lat
  | { type: "mapClick"; name: string; label: string }
  // Sets :z, :x, :y of the clicked tile at the current zoom
  | { type: "mapClickTile"; name: string; label: string }
  // Sets :<name> to a POLYGON WKT drawn on the map
  | { type: "drawPolygon"; name: string; label: string }
  // Sets :<name> to an int[] of place ids in the chosen order
  | { type: "placeOrder"; name: string; label: string }
  // Rows of (name, kind) for geocoding — used by the "geocode" action
  | { type: "textList"; name: string; label: string; max: number }
  // Sets :z, :x_min, :x_max, :y_min, :y_max for the tiles in view
  | { type: "mapView"; name: string }
  // Sets :z to the current map zoom
  | { type: "mapZoom"; name: string };

export type Render = {
  layer: string; // name shown in the layer panel
  color?: string;
  colorBy?: string; // categorical column
  palette?: Record<string, string>;
  fillBy?: string; // numeric column → sequential color
  widthBy?: string; // numeric column → line width (larger value = thinner line)
  animate?: "drop" | "grow" | "fade" | "none";
  fit?: "data" | "world" | "none";
  opacity?: number;
  radius?: number;
  dashed?: boolean;
  labels?: boolean; // show the "label" column on the map (default true)
};

export type Block = {
  sql: string; // block name in this lesson's SQL file, or "common:<name>"
  render?: Render;
  plan?: boolean; // the block is an EXPLAIN; show it as a plan
  mayError?: boolean; // an error is part of the lesson
  hideTable?: boolean;
};

export type Step = {
  id: string;
  title: string;
  goal: string;
  controls?: Control[];
  blocks: Block[];
  explain: string; // "What just happened"
  // Server-side work done before the blocks run
  action?: "geocode" | "osmImport" | "seed";
  altAction?: { label: string; action: "seed" };
  autoRun?: boolean; // re-run when a slider or select changes
  rerunOnMapMove?: boolean;
  animate?: { param: string; frames: number; intervalMs: number; block: string };
  enableTiles?: boolean; // switch map layers to /api/tiles after running
  snowflakeSql?: string; // shown for copy; runs in Snowflake, not in this app
  runLabel?: string;
};

export type Lesson = {
  id: number;
  slug: string;
  title: string;
  level: Level;
  summary: string;
  sqlFile: string;
  steps: Step[];
};

export type TraceEntry = {
  kind: "sql" | "http";
  label: string;
  sql: string;
  params?: string[];
  rows?: number;
  ms: number;
  error?: string;
  at: string;
};

export type FeatureCollection = { type: "FeatureCollection"; features: { type: "Feature"; geometry: unknown; properties: Record<string, unknown> }[] };

export type BlockResult = {
  name: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  features?: FeatureCollection | null;
  plan?: string[];
  executionMs?: number;
  error?: string;
  expectedError?: boolean;
};

export type RunResponse = {
  ok: boolean;
  results: BlockResult[];
  params: Record<string, unknown>;
  trace: TraceEntry[];
  messages: string[];
  error?: string;
};
