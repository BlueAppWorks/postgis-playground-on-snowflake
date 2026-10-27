// Minimal (E)WKB → GeoJSON decoder.
// node-postgres returns PostGIS geometry/geography values as hex-encoded EWKB. Decoding them here
// keeps lesson SQL clean: a query only has to return a geometry column to appear on the map.

export type Position = number[];
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

class Reader {
  pos = 0;
  constructor(private buf: Buffer) {}
  byte() {
    return this.buf.readUInt8(this.pos++);
  }
  uint32(le: boolean) {
    const v = le ? this.buf.readUInt32LE(this.pos) : this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  double(le: boolean) {
    const v = le ? this.buf.readDoubleLE(this.pos) : this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }
}

function readGeometry(r: Reader): Geometry | null {
  const le = r.byte() === 1;
  let type = r.uint32(le);
  let dims = 2;
  if (type & 0x20000000) r.uint32(le); // SRID (EWKB)
  if (type & 0x80000000) dims++; // Z (EWKB)
  if (type & 0x40000000) dims++; // M (EWKB)
  type &= 0x0fffffff;
  if (type >= 1000) {
    // ISO WKB: 1001 = Point Z, 2001 = Point M, 3001 = Point ZM
    dims = 2 + (Math.floor(type / 1000) === 3 ? 2 : 1);
    type %= 1000;
  }
  const point = (): Position => {
    const c = [];
    for (let i = 0; i < dims; i++) c.push(r.double(le));
    return c.slice(0, 2); // the map only needs x, y
  };
  const points = (): Position[] => {
    const n = r.uint32(le);
    const out: Position[] = [];
    for (let i = 0; i < n; i++) out.push(point());
    return out;
  };
  const rings = (): Position[][] => {
    const n = r.uint32(le);
    const out: Position[][] = [];
    for (let i = 0; i < n; i++) out.push(points());
    return out;
  };
  const children = (): (Geometry | null)[] => {
    const n = r.uint32(le);
    const out = [];
    for (let i = 0; i < n; i++) out.push(readGeometry(r));
    return out;
  };

  switch (type) {
    case 1: {
      const c = point();
      return Number.isNaN(c[0]) ? null : { type: "Point", coordinates: c }; // POINT EMPTY is NaN NaN
    }
    case 2:
      return { type: "LineString", coordinates: points() };
    case 3:
      return { type: "Polygon", coordinates: rings() };
    case 4:
      return { type: "MultiPoint", coordinates: children().flatMap((g) => (g?.type === "Point" ? [g.coordinates] : [])) };
    case 5:
      return { type: "MultiLineString", coordinates: children().flatMap((g) => (g?.type === "LineString" ? [g.coordinates] : [])) };
    case 6:
      return { type: "MultiPolygon", coordinates: children().flatMap((g) => (g?.type === "Polygon" ? [g.coordinates] : [])) };
    case 7:
      return { type: "GeometryCollection", geometries: children().filter((g): g is Geometry => g !== null) };
    default:
      throw new Error(`Unsupported WKB geometry type ${type}`);
  }
}

export function ewkbToGeoJSON(hex: string): Geometry | null {
  try {
    return readGeometry(new Reader(Buffer.from(hex, "hex")));
  } catch {
    return null;
  }
}

// Short text for result tables, e.g. "LineString (42 pts)".
export function summarizeGeometry(hex: string): string {
  const g = ewkbToGeoJSON(hex);
  if (!g) return "EMPTY";
  if (g.type === "Point") return `Point (${g.coordinates.map((c) => c.toFixed(5)).join(" ")})`;
  const count = JSON.stringify(g).match(/\[-?\d/g)?.length ?? 0;
  return `${g.type} (${count} pts)`;
}
