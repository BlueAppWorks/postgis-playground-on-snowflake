import type { Control, Lesson } from "./types";

// Reusable controls
const placeA: Control = { type: "select", name: "place_a", label: "From", optionsQuery: "places_options", valueType: "int", defaultIndex: 0 };
const placeB: Control = { type: "select", name: "place_b", label: "To", optionsQuery: "places_options", valueType: "int", defaultIndex: 1 };
const place: Control = { type: "select", name: "place_id", label: "Place", optionsQuery: "places_options", valueType: "int", defaultIndex: 0 };
// Busiest place first: buffers and isochrones look best where there are points of interest.
const busyPlace: Control = { ...place, optionsQuery: "busy_places_options" };
const click: Control = { type: "mapClick", name: "click", label: "Point on the map" };
const category: Control = { type: "select", name: "category", label: "Category", optionsQuery: "category_options", valueType: "text", default: "cafe" };

export const LESSONS: Lesson[] = [
  {
    id: 0,
    slug: "setup",
    title: "Set up the lab",
    level: "basic",
    summary: "Turn an empty Postgres database into a spatial database — with nothing but SQL.",
    sqlFile: "00_setup.sql",
    steps: [
      {
        id: "0.1",
        title: "Install PostGIS",
        goal: "PostGIS is a Postgres extension. One statement adds hundreds of spatial types and functions.",
        blocks: [{ sql: "extension" }, { sql: "version" }],
        explain:
          "CREATE EXTENSION loaded PostGIS into this database. GEOS (the geometry engine) does the actual math for intersections, buffers and unions; PostGIS exposes it as SQL functions.",
      },
      {
        id: "0.2",
        title: "Create tables with geometry columns",
        goal: "Spatial data lives in ordinary tables. A geometry column is typed with a shape and a coordinate system (SRID).",
        blocks: [{ sql: "schema" }, { sql: "geometry_columns" }],
        explain:
          "geometry(Point, 4326) only accepts points in SRID 4326. The GiST indexes at the end are spatial indexes — Lesson 4 shows why they matter. The geometry_columns view is PostGIS's catalog of every spatial column.",
      },
      {
        id: "0.3",
        title: "Coordinate systems (SRID)",
        goal: "Every coordinate means something only together with its coordinate system.",
        blocks: [{ sql: "srs" }],
        explain:
          "4326 is longitude/latitude in degrees — what GPS and GeoJSON use. 3857 is Web Mercator in meters — what web maps draw. 32610 is UTM zone 10N, a local meter grid for California. Lessons 3 and 11 come back to why this matters.",
      },
    ],
  },
  {
    id: 1,
    slug: "points",
    title: "Your first point",
    level: "basic",
    summary: "Create points from numbers and from map clicks, and learn the one mistake everybody makes.",
    sqlFile: "01_points.sql",
    steps: [
      {
        id: "1.1",
        title: "A point from two numbers",
        goal: "Insert {anchor} as a point and draw it.",
        blocks: [
          { sql: "office" },
          { sql: "office_select", render: { layer: "{anchor}", color: "#2a78d6", animate: "drop", fit: "data", radius: 9 } },
        ],
        explain:
          "ST_MakePoint(x, y) built a point and ST_SetSRID tagged it as WGS 84 degrees. Note the order: x is longitude (east–west) and comes first.",
      },
      {
        id: "1.2",
        title: "Click to create points",
        goal: "Click anywhere on the map. The INSERT statement is generated from the coordinates you clicked.",
        controls: [click],
        autoRun: true,
        blocks: [
          { sql: "click_insert" },
          { sql: "all_points", render: { layer: "My points", color: "#eb6834", animate: "drop", fit: "none" } },
        ],
        explain:
          "Your click became ST_MakePoint(lng, lat) with bind parameters. Click a few more times — every point is a row in geo.my_points.",
      },
      {
        id: "1.3",
        title: "One point, four formats",
        goal: "The same point can be written as text, JSON or binary. Pick a point and compare.",
        controls: [{ type: "select", name: "point_id", label: "Point", optionsQuery: "my_points_options", valueType: "int", defaultIndex: 0 }],
        autoRun: true,
        blocks: [{ sql: "formats", render: { layer: "Selected point", color: "#6250d6", animate: "drop", fit: "none", radius: 10 } }],
        explain:
          "WKT is for humans, GeoJSON is for the web, EWKB is what is stored on disk (the 0101000020E6100000 prefix encodes 'point with SRID 4326'). This app receives EWKB and converts it to GeoJSON for the map.",
      },
      {
        id: "1.4",
        title: "The lat/lng swap",
        goal: "Swap the arguments on purpose: ST_MakePoint(lat, lng). Where does the point land?",
        controls: [click],
        blocks: [
          { sql: "swapped", render: { layer: "Swapped point", color: "#e34948", animate: "drop", fit: "world", radius: 10 } },
          { sql: "swapped_geography", mayError: true },
        ],
        explain:
          "With swapped arguments, your latitude became a longitude and vice versa. For most of the Americas and Asia the 'latitude' is now beyond ±90° — not a place on Earth. geometry happily stores it; geography refuses it. If the point is valid it lands somewhere unexpected. Either way: x = longitude, always.",
      },
    ],
  },
  {
    id: 2,
    slug: "neighborhood",
    title: "Bring in your neighborhood",
    level: "basic",
    summary: "Geocode places you know, download the streets and parks around them, and check data quality.",
    sqlFile: "02_neighborhood.sql",
    steps: [
      {
        id: "2.1",
        title: "Your places",
        goal: "Enter up to five places near you (landmarks, not your home address). They are geocoded with OpenStreetMap Nominatim.",
        controls: [{ type: "textList", name: "places", label: "Places", max: 5 }],
        action: "geocode",
        altAction: { label: "Use the {region} sample instead", action: "seed" },
        runLabel: "Geocode and insert",
        blocks: [{ sql: "places", render: { layer: "My places", color: "#2a78d6", animate: "drop", fit: "data", radius: 9 } }],
        explain:
          "Each name went to Nominatim, which answered with a GeoJSON point. ST_GeomFromGeoJSON turned it into a geometry in an INSERT — see the SQL Trace. Responses are cached in geo.geo_cache.",
      },
      {
        id: "2.2",
        title: "How big is my area?",
        goal: "Aggregate all places into one bounding box.",
        blocks: [{ sql: "extent", render: { layer: "Bounding box", color: "#52514e", dashed: true, animate: "fade", fit: "data" } }],
        explain: "ST_Extent is an aggregate like SUM, but for boxes. ST_Expand added a margin. Width and height are measured in meters with geography.",
      },
      {
        id: "2.3",
        title: "Download streets, parks and places",
        goal: "Fetch OpenStreetMap data around your places with the Overpass API and load it with SQL.",
        controls: [
          {
            type: "select",
            name: "radius",
            label: "Radius",
            options: [
              { label: "500 m", value: "500" },
              { label: "1 km", value: "1000" },
              { label: "1.5 km", value: "1500" },
            ],
            default: "1000",
          },
        ],
        action: "osmImport",
        runLabel: "Download and import",
        blocks: [
          { sql: "common:import_area", render: { layer: "Download area", color: "#52514e", dashed: true, animate: "fade", fit: "data" } },
          { sql: "roads", render: { layer: "Roads", color: "#898781", animate: "grow", fit: "none" }, hideTable: true },
          { sql: "areas", render: { layer: "Parks & areas", colorBy: "category", animate: "fade", fit: "none", opacity: 0.45 }, hideTable: true },
          { sql: "poi", render: { layer: "Points of interest", colorBy: "category", animate: "drop", fit: "none", radius: 4 }, hideTable: true },
          { sql: "counts" },
        ],
        explain:
          "SQL computed the download area (buffers around your places, merged), the app sent it to Overpass, and three INSERT … SELECT statements turned the raw JSON into points, polygons and lines — open them in the SQL Trace.",
      },
      {
        id: "2.4",
        title: "Check data quality",
        goal: "Count geometry types and look for invalid polygons. A deliberately broken 'bow-tie' polygon is added so there is always one to find.",
        blocks: [
          { sql: "bowtie" },
          { sql: "geometry_types" },
          { sql: "invalid", render: { layer: "Invalid polygons", color: "#e34948", animate: "fade", fit: "none", opacity: 0.6 } },
        ],
        explain:
          "A polygon whose edges cross itself is invalid: its area is ambiguous and many functions give wrong answers for it. ST_IsValidReason tells you where the problem is.",
      },
      {
        id: "2.5",
        title: "Fix it",
        goal: "Repair invalid shapes with ST_MakeValid.",
        blocks: [{ sql: "make_valid", render: { layer: "Repaired polygons", color: "#1baf7a", animate: "fade", fit: "none", opacity: 0.6 } }],
        explain: "The bow-tie became two valid triangles (a MultiPolygon). Repairing data once, at import time, saves surprises in every later query.",
      },
    ],
  },
  {
    id: 3,
    slug: "distance",
    title: "How far is it?",
    level: "basic",
    summary: "Distances in degrees versus meters, every pair of places, and a flight across the globe.",
    sqlFile: "03_distance.sql",
    steps: [
      {
        id: "3.1",
        title: "Distance on geometry",
        goal: "Measure between two of your places with ST_Distance.",
        controls: [placeA, placeB],
        autoRun: true,
        blocks: [{ sql: "distance_degrees", render: { layer: "Distance (degrees)", color: "#eb6834", animate: "grow", fit: "data" } }],
        explain:
          "The result is in the units of the coordinate system — degrees for SRID 4326. A degree is not a fixed distance, so this number is not very useful.",
      },
      {
        id: "3.2",
        title: "Distance on geography",
        goal: "Cast to geography to measure in meters on the Earth's surface.",
        controls: [placeA, placeB],
        autoRun: true,
        blocks: [{ sql: "distance_meters", render: { layer: "Distance (meters)", color: "#1baf7a", animate: "grow", fit: "data" } }],
        explain: "geography computes on a spheroid and always answers in meters. Use it whenever you need real-world distances, lengths or areas.",
      },
      {
        id: "3.3",
        title: "Distance matrix",
        goal: "The distance between every pair of places, with one self join.",
        blocks: [{ sql: "matrix", render: { layer: "All pairs", color: "#2a78d6", widthBy: "meters", animate: "grow", fit: "data" } }],
        explain: "Thicker lines are shorter distances. a.id < b.id keeps each pair once.",
      },
      {
        id: "3.4",
        title: "Go global",
        goal: "From your first place to another city: a straight line on a flat map versus the great circle.",
        controls: [
          {
            type: "select",
            name: "dest",
            label: "Destination",
            options: [
              { label: "Tokyo", value: "tokyo", params: { dest_lng: 139.7671, dest_lat: 35.6812 } },
              { label: "London", value: "london", params: { dest_lng: -0.1276, dest_lat: 51.5072 } },
              { label: "São Paulo", value: "sao_paulo", params: { dest_lng: -46.6333, dest_lat: -23.5505 } },
              { label: "Bengaluru", value: "bengaluru", params: { dest_lng: 77.5946, dest_lat: 12.9716 } },
              { label: "Sydney", value: "sydney", params: { dest_lng: 151.2093, dest_lat: -33.8688 } },
            ],
            default: "tokyo",
          },
        ],
        autoRun: true,
        blocks: [{ sql: "global", render: { layer: "Flat line vs great circle", colorBy: "kind", palette: { "geometry: straight on a flat map": "#e34948", "geography: great circle": "#1baf7a" }, animate: "grow", fit: "world" } }],
        explain:
          "On a sphere the shortest path is a great circle — the curved line. The 'straight' line on a flat map is longer. ST_Segmentize on geography adds points along the great circle so it can be drawn.",
      },
    ],
  },
  {
    id: 4,
    slug: "index",
    title: "Make it fast: spatial indexes",
    level: "intermediate",
    summary: "Compare execution plans with and without a GiST index, and see how the index filters by boxes.",
    sqlFile: "04_index.sql",
    steps: [
      {
        id: "4.1",
        title: "50,000 points",
        goal: "Create a table of random points around your places — no index yet.",
        blocks: [{ sql: "sample_points" }, { sql: "sample_points_show", render: { layer: "50,000 sample points", color: "#b5b3ab", radius: 1.5, animate: "fade", fit: "data", labels: false }, hideTable: true }],
        explain: "generate_series made 50,000 rows; random() scattered them inside the bounding box of your places.",
      },
      {
        id: "4.2",
        title: "Search without an index",
        goal: "Click the map: find points within 300 m using ST_Distance(...) < 300.",
        controls: [click],
        autoRun: true,
        blocks: [
          { sql: "slow_plan", plan: true },
          { sql: "slow_result", render: { layer: "Within 300 m (slow)", color: "#e34948", radius: 3, animate: "drop", fit: "none", labels: false }, hideTable: true },
        ],
        explain: "Seq Scan: Postgres computed the distance for all 50,000 rows to find a few dozen. Note the execution time.",
      },
      {
        id: "4.3",
        title: "Add a GiST index and use ST_DWithin",
        goal: "Create a spatial index, then ask the same question with ST_DWithin.",
        controls: [click],
        autoRun: true,
        blocks: [
          { sql: "create_index" },
          { sql: "fast_plan", plan: true },
          { sql: "fast_result", render: { layer: "Within 300 m (fast)", color: "#1baf7a", radius: 3, animate: "drop", fit: "none", labels: false }, hideTable: true },
        ],
        explain:
          "Same points, but an Index Scan (or Bitmap Index Scan) instead of a Seq Scan. ST_Distance(...) < x cannot use an index; ST_DWithin(...) can. Compare the execution times of 4.2 and 4.3.",
      },
      {
        id: "4.4",
        title: "How the index sees it",
        goal: "Draw the two stages of an indexed search.",
        controls: [click],
        autoRun: true,
        blocks: [
          {
            sql: "index_view",
            render: {
              layer: "Index: box, then exact check",
              colorBy: "role",
              palette: { box: "#52514e", circle: "#1baf7a", "candidate (dropped)": "#eda100", match: "#1baf7a" },
              radius: 3,
              animate: "fade",
              fit: "data",
              opacity: 0.25,
            },
          },
        ],
        explain:
          "The index stores bounding boxes. Step 1 finds every point inside the search box quickly. Step 2 checks the exact distance and drops the yellow points in the corners — that is 'Rows Removed by Index Recheck / Filter' in the plan.",
      },
    ],
  },
  {
    id: 5,
    slug: "buffers",
    title: "Within reach: buffers",
    level: "basic",
    summary: "Circles around places, bands along streets, and the area reachable from two places.",
    sqlFile: "05_buffers.sql",
    steps: [
      {
        id: "5.1",
        title: "Draw a circle",
        goal: "Move the slider — the buffer is recomputed by SQL every time.",
        controls: [busyPlace, { type: "slider", name: "radius", label: "Radius", min: 100, max: 1500, step: 50, default: 500, unit: "m" }],
        autoRun: true,
        blocks: [{ sql: "circle", render: { layer: "Buffer", color: "#2a78d6", animate: "none", fit: "data", opacity: 0.25 } }],
        explain: "ST_Buffer on geography takes meters. The result is a polygon approximating a circle.",
      },
      {
        id: "5.2",
        title: "What is inside?",
        goal: "Find points of interest within the radius and count them by category.",
        controls: [busyPlace, { type: "slider", name: "radius", label: "Radius", min: 100, max: 1500, step: 50, default: 500, unit: "m" }],
        autoRun: true,
        blocks: [
          { sql: "circle", render: { layer: "Buffer", color: "#2a78d6", animate: "none", fit: "data", opacity: 0.15 } },
          { sql: "inside", render: { layer: "POI inside", colorBy: "category", radius: 5, animate: "drop", fit: "none", labels: false } },
          { sql: "inside_summary" },
        ],
        explain: "ST_DWithin(a, b, r) is the indexed way to ask 'within r meters'. No need to build the circle first.",
      },
      {
        id: "5.3",
        title: "Buffer a street",
        goal: "Everything within a few meters of a street.",
        controls: [
          { type: "select", name: "road_name", label: "Street", optionsQuery: "road_options", valueType: "text", defaultIndex: 0 },
          { type: "slider", name: "width", label: "Width", min: 10, max: 200, step: 10, default: 60, unit: "m" },
        ],
        autoRun: true,
        blocks: [{ sql: "road_band", render: { layer: "Street band", colorBy: "role", palette: { band: "#2a78d6" }, radius: 5, animate: "fade", fit: "data", opacity: 0.3 } }],
        explain: "Buffers work on any shape. Here the street's segments were merged with ST_Union and widened into a band.",
      },
      {
        id: "5.4",
        title: "Reachable from both",
        goal: "Where can you walk to from two places? Intersect their buffers.",
        controls: [placeA, placeB, { type: "slider", name: "radius", label: "Radius", min: 200, max: 3000, step: 100, default: 1200, unit: "m" }],
        autoRun: true,
        blocks: [
          { sql: "union_all", render: { layer: "All buffers (union)", color: "#b5b3ab", animate: "fade", fit: "data", opacity: 0.15 } },
          { sql: "overlap", render: { layer: "A, B and both", colorBy: "role", palette: { A: "#2a78d6", B: "#eb6834", both: "#1baf7a" }, animate: "fade", fit: "none", opacity: 0.35 } },
        ],
        explain:
          "ST_Intersection returned only the overlap; ST_Union merged every buffer into one shape. Union, intersection and difference are the 'set operations' of GIS.",
      },
    ],
  },
  {
    id: 6,
    slug: "nearest",
    title: "What's nearest?",
    level: "basic",
    summary: "K-nearest-neighbour search, LATERAL joins, and Voronoi diagrams.",
    sqlFile: "06_nearest.sql",
    steps: [
      {
        id: "6.1",
        title: "Five nearest",
        goal: "Click the map and choose a category: the five nearest places, ranked.",
        controls: [click, category],
        autoRun: true,
        blocks: [{ sql: "knn", render: { layer: "5 nearest", color: "#6250d6", animate: "grow", fit: "data" } }],
        explain: "ORDER BY geom <-> point LIMIT 5 is a KNN search: the GiST index walks outward from the point, so it stays fast on millions of rows.",
      },
      {
        id: "6.2",
        title: "Nearest park for each place",
        goal: "Run a nearest-neighbour search once per place with a LATERAL join.",
        blocks: [
          { sql: "nearest_park_areas", render: { layer: "Nearest parks", color: "#1baf7a", animate: "fade", fit: "none", opacity: 0.5 }, hideTable: true },
          { sql: "nearest_park", render: { layer: "Place → park", color: "#1baf7a", animate: "grow", fit: "data" } },
        ],
        explain: "CROSS JOIN LATERAL lets the inner query use pl.geom from the outer row. ST_ShortestLine draws the shortest connection to the park's edge, not its center.",
      },
      {
        id: "6.3",
        title: "Degrees can lie",
        goal: "Rank the nearest places by geometry distance (degrees) and by geography distance (meters).",
        controls: [click],
        autoRun: true,
        blocks: [{ sql: "degrees_vs_meters", render: { layer: "Rank: degrees vs meters", colorBy: "role", palette: { "same rank": "#1baf7a", "different rank": "#e34948" }, radius: 6, animate: "drop", fit: "data" } }],
        explain:
          "Away from the equator, a degree of longitude is shorter than a degree of latitude, so 'nearest in degrees' is not always 'nearest in meters'. geography <-> gives the true order. Red points changed rank.",
      },
      {
        id: "6.4",
        title: "Voronoi: who serves this area?",
        goal: "Split the area into cells, one per point: every location belongs to its nearest point.",
        controls: [{ ...category, default: "restaurant" }],
        autoRun: true,
        blocks: [
          { sql: "voronoi", render: { layer: "Voronoi cells", colorBy: "cell", animate: "fade", fit: "data", opacity: 0.3, labels: false }, hideTable: true },
          { sql: "voronoi_points", render: { layer: "Cell centers", color: "#0b0b0b", radius: 4, animate: "drop", fit: "none", labels: false }, hideTable: true },
        ],
        explain: "ST_VoronoiPolygons is used for service areas: which station, store or hospital is closest to any location.",
      },
    ],
  },
  {
    id: 7,
    slug: "polygons",
    title: "Shapes and areas: polygons",
    level: "basic",
    summary: "Area, point-in-polygon, spatial predicates on a shape you draw, and spatial joins.",
    sqlFile: "07_polygons.sql",
    steps: [
      {
        id: "7.1",
        title: "How big is each park?",
        goal: "Measure polygon areas in square meters.",
        blocks: [{ sql: "park_areas", render: { layer: "Parks by area", fillBy: "m2", animate: "fade", fit: "data", opacity: 0.7 } }],
        explain: "ST_Area(geom::geography) returns m². Darker parks are bigger.",
      },
      {
        id: "7.2",
        title: "Where am I?",
        goal: "Click the map: which areas contain that point?",
        controls: [click],
        autoRun: true,
        blocks: [
          { sql: "where_am_i", render: { layer: "Containing area", color: "#eb6834", animate: "fade", fit: "none", opacity: 0.6 } },
          { sql: "places_in_areas" },
        ],
        explain: "ST_Contains(polygon, point) is the point-in-polygon test. The second query runs it for all your places with a LEFT JOIN.",
      },
      {
        id: "7.3",
        title: "Draw a shape, ask a question",
        goal: "Draw a polygon on the map, then switch between spatial predicates.",
        controls: [
          { type: "drawPolygon", name: "drawn_wkt", label: "Your polygon" },
          {
            type: "select",
            name: "predicate",
            label: "Predicate",
            identifier: true,
            options: [
              { label: "ST_Intersects — touches or overlaps", value: "ST_Intersects" },
              { label: "ST_Contains — completely inside my shape", value: "ST_Contains" },
              { label: "ST_Within — my shape is inside it", value: "ST_Within" },
              { label: "ST_Crosses — goes in and out", value: "ST_Crosses" },
            ],
            default: "ST_Intersects",
          },
        ],
        autoRun: true,
        blocks: [
          { sql: "drawn", render: { layer: "Your polygon", color: "#52514e", dashed: true, animate: "none", fit: "none", opacity: 0.1 } },
          { sql: "predicate", render: { layer: "Matches", colorBy: "role", palette: { area: "#1baf7a", road: "#eb6834", poi: "#6250d6" }, radius: 5, animate: "fade", fit: "none", labels: false } },
        ],
        explain:
          "Predicates return true/false and are used in WHERE and JOIN. Roads crossing your edge match ST_Crosses; roads entirely inside match ST_Contains; a big park around your shape matches ST_Within.",
      },
      {
        id: "7.4",
        title: "Spatial join",
        goal: "Count points of interest within 150 m of each park.",
        blocks: [{ sql: "spatial_join", render: { layer: "Parks by nearby POI", fillBy: "poi_nearby", animate: "fade", fit: "data", opacity: 0.7 } }],
        explain: "A spatial join is a normal JOIN whose ON clause is spatial. GROUP BY then works as usual.",
      },
    ],
  },
  {
    id: 8,
    slug: "routes",
    title: "Lines and routes",
    level: "advanced",
    summary: "Build a street graph with SQL, route along it with pgRouting, walk the route, and draw a walking isochrone.",
    sqlFile: "08_routes.sql",
    steps: [
      {
        id: "8.1",
        title: "Connect the dots",
        goal: "Put your places in a visiting order and connect them.",
        controls: [{ type: "placeOrder", name: "order", label: "Visiting order" }],
        autoRun: true,
        blocks: [{ sql: "tour", render: { layer: "My tour", color: "#eb6834", animate: "grow", fit: "data" } }],
        explain: "ST_MakeLine is also an aggregate: it connects points in the ORDER BY order. The length is measured as geography.",
      },
      {
        id: "8.2",
        title: "Streets as a graph",
        goal: "Cut streets where they meet and store them as edges and nodes.",
        blocks: [
          { sql: "pgrouting_check" },
          { sql: "build_graph" },
          { sql: "graph_size" },
          { sql: "graph_nodes", render: { layer: "Graph nodes", color: "#52514e", radius: 2, animate: "fade", fit: "data", labels: false }, hideTable: true },
        ],
        explain:
          "Routing needs a graph: edges (street pieces between intersections) with a source node, a target node and a cost. The OSM node ids shared between ways are the intersections.",
      },
      {
        id: "8.3",
        title: "Shortest route",
        goal: "Find the shortest path along streets with pgr_dijkstra.",
        controls: [placeA, placeB],
        autoRun: true,
        blocks: [{ sql: "route", render: { layer: "Route vs straight line", colorBy: "role", palette: { route: "#eb6834", "straight line": "#b5b3ab" }, animate: "grow", fit: "data" } }],
        explain: "Dijkstra's algorithm explored the graph from the start node. The route is longer than the straight line — streets are not straight. The route is saved for the next step.",
      },
      {
        id: "8.4",
        title: "Walk the route",
        goal: "Press Play: a marker walks along the route, one SQL query per frame.",
        blocks: [
          { sql: "last_route", render: { layer: "Route", color: "#eb6834", animate: "none", fit: "data" } },
          { sql: "walker", render: { layer: "Walker", color: "#0b0b0b", radius: 8, animate: "none", fit: "none" } },
        ],
        animate: { param: "fraction", frames: 40, intervalMs: 150, block: "walker" },
        runLabel: "▶ Play",
        explain: "ST_LineInterpolatePoint(line, fraction) returns the point at that fraction of the length. Watch the SQL Trace fill with one query per frame.",
      },
      {
        id: "8.5",
        title: "10-minute walk",
        goal: "Which streets can you reach in N minutes? Compare with a simple circle.",
        controls: [busyPlace, { type: "slider", name: "minutes", label: "Minutes", min: 2, max: 20, step: 1, default: 10, unit: "min" }],
        autoRun: true,
        blocks: [{ sql: "isochrone", render: { layer: "Isochrone vs circle", colorBy: "role", palette: { isochrone: "#1baf7a", circle: "#b5b3ab" }, animate: "fade", fit: "data", opacity: 0.3 } }],
        explain: "pgr_drivingDistance returned every node within the walking budget; ST_ConcaveHull wrapped them. The circle overestimates where the street network does not go.",
      },
    ],
  },
  {
    id: 9,
    slug: "summarize",
    title: "Summarize space",
    level: "intermediate",
    summary: "Centroids, hulls, clustering and simplification.",
    sqlFile: "09_summarize.sql",
    steps: [
      {
        id: "9.1",
        title: "The center of your life",
        goal: "The centroid of all your places.",
        blocks: [{ sql: "centroid", render: { layer: "Centroid", colorBy: "role", palette: { center: "#e34948", spoke: "#b5b3ab" }, radius: 9, animate: "grow", fit: "data" } }],
        explain: "ST_Collect gathered the points into one MultiPoint; ST_Centroid found its center of mass.",
      },
      {
        id: "9.2",
        title: "The shape of your neighborhood",
        goal: "Wrap all points of interest with a convex and a concave hull. Move the slider.",
        controls: [{ type: "slider", name: "ratio", label: "Concave ratio", min: 0.05, max: 1, step: 0.05, default: 0.3 }],
        autoRun: true,
        blocks: [
          { sql: "hull_points", render: { layer: "POI", color: "#52514e", radius: 2, animate: "none", fit: "none", labels: false }, hideTable: true },
          { sql: "hulls", render: { layer: "Hulls", colorBy: "role", palette: { "convex hull": "#b5b3ab", "concave hull": "#2a78d6" }, animate: "none", fit: "data", opacity: 0.25 } },
        ],
        explain: "The convex hull never has dents. The concave hull follows the points more closely as the ratio gets smaller.",
      },
      {
        id: "9.3",
        title: "Find clusters",
        goal: "Group nearby points with DBSCAN. Move the sliders.",
        controls: [
          { type: "slider", name: "eps", label: "Distance (eps)", min: 50, max: 600, step: 25, default: 200, unit: "m" },
          { type: "slider", name: "minpoints", label: "Min points", min: 2, max: 10, step: 1, default: 3 },
        ],
        autoRun: true,
        blocks: [
          { sql: "dbscan_hulls", render: { layer: "Cluster hulls", colorBy: "cluster", animate: "none", fit: "data", opacity: 0.25 } },
          { sql: "dbscan", render: { layer: "Clustered POI", colorBy: "cluster", radius: 4, animate: "none", fit: "none", labels: false }, hideTable: true },
        ],
        explain: "ST_ClusterDBSCAN is a window function: each row gets a cluster number, or NULL (gray) when it is noise. Try-it: replace it with ST_ClusterKMeans(geom, 5) OVER ().",
      },
      {
        id: "9.4",
        title: "Simplify shapes",
        goal: "Merge all parks and remove detail. Watch the vertex count.",
        controls: [{ type: "slider", name: "tolerance", label: "Tolerance", min: 0, max: 60, step: 2, default: 10, unit: "m" }],
        autoRun: true,
        blocks: [{ sql: "simplify", render: { layer: "Simplified parks", colorBy: "role", palette: { original: "#b5b3ab", simplified: "#1baf7a" }, animate: "none", fit: "data", opacity: 0.35 } }],
        explain: "ST_Simplify (Douglas–Peucker) drops vertices that change the shape by less than the tolerance. Fewer vertices = smaller, faster maps — Lesson 12 uses this.",
      },
    ],
  },
  {
    id: 10,
    slug: "grids",
    title: "Grids and heatmaps",
    level: "intermediate",
    summary: "Square grids, hexagon heatmaps and the H3 global index.",
    sqlFile: "10_grids.sql",
    steps: [
      {
        id: "10.1",
        title: "A square grid",
        goal: "Cover the area with equal squares.",
        controls: [{ type: "slider", name: "size", label: "Cell size", min: 100, max: 800, step: 50, default: 300, unit: "m" }],
        autoRun: true,
        blocks: [{ sql: "square_grid", render: { layer: "Square grid", color: "#52514e", animate: "none", fit: "data", opacity: 0.05 }, hideTable: true }],
        explain: "ST_SquareGrid generates cells over a bounding box. The grid is built in Web Mercator meters (3857).",
      },
      {
        id: "10.2",
        title: "Hexagon heatmap",
        goal: "Count points of interest per hexagon.",
        controls: [{ type: "slider", name: "size", label: "Cell size", min: 100, max: 800, step: 50, default: 250, unit: "m" }],
        autoRun: true,
        blocks: [{ sql: "hex_counts", render: { layer: "Hexagon heatmap", fillBy: "poi_count", animate: "none", fit: "data", opacity: 0.75, labels: false } }],
        explain: "Hexagons have equal distances to all neighbours, which makes heatmaps look less blocky than squares.",
      },
      {
        id: "10.3",
        title: "H3 cells",
        goal: "The same heatmap with H3. Change the resolution.",
        controls: [{ type: "slider", name: "resolution", label: "Resolution", min: 6, max: 11, step: 1, default: 9 }],
        autoRun: true,
        blocks: [
          { sql: "h3_setup" },
          { sql: "h3_counts", render: { layer: "H3 heatmap", fillBy: "poi_count", animate: "none", fit: "data", opacity: 0.75, labels: false } },
        ],
        explain: "Unlike a grid built from your bounding box, H3 cell ids are global and stable — the same id means the same hexagon anywhere, which makes joining datasets easy. Snowflake has H3 functions too (Lesson 13).",
      },
      {
        id: "10.4",
        title: "Compare the hot spots",
        goal: "The five busiest cells by each method.",
        controls: [
          { type: "slider", name: "size", label: "Hexagon size", min: 100, max: 800, step: 50, default: 250, unit: "m" },
          { type: "slider", name: "resolution", label: "H3 resolution", min: 6, max: 11, step: 1, default: 9 },
        ],
        autoRun: true,
        blocks: [{ sql: "compare", render: { layer: "Top cells", colorBy: "role", palette: { "hexagon grid": "#eb6834", H3: "#2a78d6" }, animate: "fade", fit: "data", opacity: 0.4 } }],
        explain: "Both methods should find the same hot spots; the cell shapes and boundaries differ.",
      },
    ],
  },
  {
    id: 11,
    slug: "projections",
    title: "Projections: why maps lie",
    level: "intermediate",
    summary: "Measure the same park four ways, compare squares at different latitudes, and see Mercator stretch.",
    sqlFile: "11_projections.sql",
    steps: [
      {
        id: "11.1",
        title: "One park, four areas",
        goal: "Measure a park in degrees, Web Mercator, UTM and geography.",
        controls: [{ type: "select", name: "area_id", label: "Park", optionsQuery: "park_options", valueType: "int", defaultIndex: 0 }],
        autoRun: true,
        blocks: [{ sql: "utm_function" }, { sql: "area_compare", render: { layer: "Measured park", color: "#1baf7a", animate: "fade", fit: "data", opacity: 0.5 } }],
        explain: "UTM and geography agree closely. Web Mercator is too large by about 1/cos²(latitude) — around 60% too big in California. Never measure in 3857.",
      },
      {
        id: "11.2",
        title: "A degree is not a distance",
        goal: "Draw a 0.1° square and a real 10 km square in different cities.",
        controls: [
          {
            type: "select",
            name: "city",
            label: "City",
            options: [
              { label: "Singapore (1°N)", value: "singapore", params: { city_lng: 103.8198, city_lat: 1.3521 } },
              { label: "{region}", value: "home", params: { city_lng: "$anchor_lng", city_lat: "$anchor_lat" } },
              { label: "Oslo (60°N)", value: "oslo", params: { city_lng: 10.7522, city_lat: 59.9139 } },
              { label: "Reykjavík (64°N)", value: "reykjavik", params: { city_lng: -21.9426, city_lat: 64.1466 } },
              { label: "Longyearbyen (78°N)", value: "longyearbyen", params: { city_lng: 15.6356, city_lat: 78.2232 } },
            ],
            default: "home",
          },
        ],
        autoRun: true,
        blocks: [{ sql: "utm_function" }, { sql: "squares", render: { layer: "0.1° vs 10 km", colorBy: "role", palette: { degrees: "#e34948", meters: "#1baf7a" }, animate: "fade", fit: "data", opacity: 0.25 } }],
        explain: "Lines of longitude meet at the poles, so 0.1° of longitude shrinks as you go north. The 'square' in degrees gets thinner and smaller.",
      },
      {
        id: "11.3",
        title: "Mercator stretches",
        goal: "The same 500 km circle at 0°, 30°, 60° and 75° latitude.",
        controls: [{ type: "slider", name: "lng", label: "Longitude", min: -170, max: 170, step: 10, default: -120, unit: "°" }],
        autoRun: true,
        blocks: [{ sql: "world_circles", render: { layer: "500 km circles", color: "#2a78d6", animate: "fade", fit: "world", opacity: 0.3 } }],
        explain: "All four circles are the same size on Earth. Web Mercator keeps angles (shapes look right locally) but inflates sizes toward the poles — Greenland looks as big as Africa.",
      },
    ],
  },
  {
    id: 12,
    slug: "tiles",
    title: "Draw the map itself with SQL",
    level: "advanced",
    summary: "Vector tiles: tile coordinates, building a tile with ST_AsMVT, and switching the map to PostGIS-served tiles.",
    sqlFile: "12_tiles.sql",
    steps: [
      {
        id: "12.1",
        title: "The tile grid",
        goal: "Show the tiles in view. Pan and zoom the map — the query re-runs.",
        controls: [{ type: "mapView", name: "view" }],
        rerunOnMapMove: true,
        blocks: [{ sql: "tile_grid", render: { layer: "Tiles in view", color: "#6250d6", dashed: true, animate: "none", fit: "none", opacity: 0.02 }, hideTable: true }],
        explain: "At zoom z the world is 2^z × 2^z tiles. The map requests only the tiles it shows.",
      },
      {
        id: "12.2",
        title: "Build one tile",
        goal: "Click a spot on the map to build the vector tile covering it.",
        controls: [{ type: "mapClickTile", name: "tile", label: "Tile" }],
        autoRun: true,
        blocks: [{ sql: "one_tile", render: { layer: "Selected tile", color: "#eb6834", animate: "fade", fit: "none", opacity: 0.15 } }],
        explain: "One tile holds every road, area and point inside it, clipped and encoded as compact binary — usually a few kilobytes.",
      },
      {
        id: "12.3",
        title: "Switch to PostGIS tiles",
        goal: "Draw roads, parks and points from /api/tiles/{z}/{x}/{y} — every tile is one SQL query.",
        controls: [{ type: "mapClickTile", name: "tile", label: "Preview tile" }],
        enableTiles: true,
        runLabel: "Switch the map to PostGIS tiles",
        blocks: [{ sql: "one_tile" }],
        explain: "The map now asks the app for tiles as you pan; the app runs the tile query from sql/common.sql for each. This is how many production map servers work.",
      },
      {
        id: "12.4",
        title: "Less detail when zoomed out",
        goal: "Zoom in and out: how many vertices does a tile really need?",
        controls: [{ type: "mapZoom", name: "zoom" }],
        rerunOnMapMove: true,
        blocks: [{ sql: "simplify_by_zoom" }],
        explain: "When zoomed out, a pixel covers many meters, so the tile endpoint simplifies by one pixel (Lesson 9's ST_Simplify). Fewer vertices, smaller tiles, same picture.",
      },
    ],
  },
  {
    id: 13,
    slug: "snowflake",
    title: "(Bonus) Take it to Snowflake",
    level: "advanced",
    summary: "Prepare data for Snowflake and ask the same spatial question with Snowflake's GEOGRAPHY functions.",
    sqlFile: "13_snowflake.sql",
    steps: [
      {
        id: "13.1",
        title: "Prepare a portable table",
        goal: "Store the points as WKT text with a primary key — easy to mirror to Snowflake.",
        blocks: [{ sql: "export_table" }, { sql: "export_preview" }],
        explain:
          "Snowflake Postgres can mirror tables into Snowflake (Data Mirroring) or write Iceberg tables with pg_lake. A text WKT column converts cleanly to Snowflake's GEOGRAPHY with TO_GEOGRAPHY. See docs/04-snowflake-bonus.md.",
        snowflakeSql: `-- In Snowflake, after geo.poi_export is mirrored (adjust the names):
CREATE OR REPLACE TABLE POI AS
SELECT ID, NAME, CATEGORY, TO_GEOGRAPHY(WKT) AS GEOG
FROM MIRROR_DB.GEO.POI_EXPORT;`,
      },
      {
        id: "13.2",
        title: "Same question, two engines",
        goal: "How many points of interest are within 500 m of each place — in PostGIS, and the same SQL in Snowflake.",
        blocks: [
          { sql: "same_question" },
          { sql: "same_question_map", render: { layer: "500 m around my places", color: "#2a78d6", animate: "fade", fit: "data", opacity: 0.25 } },
        ],
        explain:
          "The Snowflake version is almost identical: ST_DWITHIN on GEOGRAPHY works in meters, like PostGIS geography. Snowflake also has H3_POINT_TO_CELL, so Lesson 10's heatmap carries over.",
        snowflakeSql: `-- In Snowflake (PLACES mirrored the same way as POI):
SELECT pl.NAME AS PLACE, COUNT(p.ID) AS POI_WITHIN_500M
FROM PLACES pl
LEFT JOIN POI p ON ST_DWITHIN(pl.GEOG, p.GEOG, 500)
GROUP BY pl.NAME
ORDER BY pl.NAME;

-- H3 heatmap, as in Lesson 10
SELECT H3_POINT_TO_CELL_STRING(GEOG, 9) AS CELL, COUNT(*) AS POI_COUNT
FROM POI GROUP BY CELL ORDER BY POI_COUNT DESC;`,
      },
    ],
  },
];

export function getLesson(id: number): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function getStep(lessonId: number, stepId: string) {
  return getLesson(lessonId)?.steps.find((s) => s.id === stepId);
}
