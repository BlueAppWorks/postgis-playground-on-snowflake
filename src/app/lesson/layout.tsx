import { Shell } from "@/components/Shell";
import { getRegion } from "@/server/region";

// Read at request time: on App Runtime these come from app.yml environment_variables.
export const dynamic = "force-dynamic";

const DEFAULT_BASEMAP = "https://tiles.openfreemap.org/styles/positron";

// The layout (map, tabs, SQL Trace) stays mounted while you switch lessons.
export default function LessonLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell
      basemap={process.env.BASEMAP_STYLE_URL ?? DEFAULT_BASEMAP}
      allowConsole={process.env.ALLOW_SQL_CONSOLE !== "false"}
      region={getRegion()}
    >
      {children}
    </Shell>
  );
}
