-- Lesson 8 — Lines and routes

-- name: tour
-- ST_MakeLine as an aggregate: connect the points in the ORDER BY order.
SELECT 'my tour' AS label,
       round(ST_Length(ST_MakeLine(p.geom ORDER BY array_position(:order::int[], p.id))::geography)) AS meters,
       ST_MakeLine(p.geom ORDER BY array_position(:order::int[], p.id)) AS geom
FROM geo.places p
WHERE p.id = ANY(:order::int[]);

-- name: pgrouting_check
-- pgRouting is installed once by the database admin (snowflake/postgres_setup.sql).
SELECT extname, extversion FROM pg_extension WHERE extname = 'pgrouting';

-- name: build_graph
-- Turn streets into a graph. An OSM way can cross other ways in the middle,
-- so cut every way at nodes it shares with another way: each piece is an edge.
DROP TABLE IF EXISTS geo.road_edges, geo.road_nodes;

CREATE TABLE geo.road_edges AS
WITH v AS (
  SELECT r.id AS way_id, n.node_id, n.ord::int AS ord, cardinality(r.nodes) AS n_nodes
  FROM geo.roads r, unnest(r.nodes) WITH ORDINALITY AS n(node_id, ord)
), shared AS (
  SELECT node_id FROM v GROUP BY node_id HAVING count(*) > 1
), cuts AS (
  SELECT v.way_id, v.node_id, v.ord FROM v
  WHERE v.ord = 1 OR v.ord = v.n_nodes OR v.node_id IN (SELECT node_id FROM shared)
), segs AS (
  SELECT way_id, node_id AS source, ord AS from_ord,
         lead(node_id) OVER w AS target, lead(ord) OVER w AS to_ord
  FROM cuts WINDOW w AS (PARTITION BY way_id ORDER BY ord)
)
SELECT row_number() OVER () AS id, s.way_id, s.source, s.target,
       ST_MakeLine(ARRAY(
         SELECT ST_PointN(r.geom, i) FROM generate_series(s.from_ord, s.to_ord) AS i ORDER BY i
       )) AS geom
FROM segs s
JOIN geo.roads r ON r.id = s.way_id
WHERE s.target IS NOT NULL;

-- cost = length in meters (walking the street in either direction)
ALTER TABLE geo.road_edges ADD COLUMN cost float8;
UPDATE geo.road_edges SET cost = ST_Length(geom::geography);

CREATE TABLE geo.road_nodes AS
SELECT DISTINCT ON (node_id) node_id AS id, geom
FROM (SELECT source AS node_id, ST_StartPoint(geom) AS geom FROM geo.road_edges
      UNION ALL
      SELECT target, ST_EndPoint(geom) FROM geo.road_edges) t;
CREATE INDEX ON geo.road_nodes USING GIST (geom);
ANALYZE geo.road_edges;
ANALYZE geo.road_nodes;

-- name: graph_nodes
SELECT id, geom FROM geo.road_nodes;

-- name: graph_size
SELECT (SELECT count(*) FROM geo.road_edges) AS edges, (SELECT count(*) FROM geo.road_nodes) AS nodes;

-- name: route
-- pgr_dijkstra finds the shortest path between two graph nodes.
-- Start and end are the graph nodes nearest to the two places (KNN from Lesson 6).
WITH a AS (SELECT name, geom FROM geo.places WHERE id = :place_a::int),
b AS (SELECT name, geom FROM geo.places WHERE id = :place_b::int),
s AS (SELECT n.id FROM geo.road_nodes n, a ORDER BY n.geom <-> a.geom LIMIT 1),
t AS (SELECT n.id FROM geo.road_nodes n, b ORDER BY n.geom <-> b.geom LIMIT 1),
path AS (
  SELECT * FROM pgr_dijkstra(
    'SELECT id, source, target, cost, cost AS reverse_cost FROM geo.road_edges',
    (SELECT id FROM s), (SELECT id FROM t), false)
),
line AS (
  -- edges are stored in one direction; flip the ones we walk backwards, then join them
  SELECT ST_MakeLine(CASE WHEN e.source = p.node THEN e.geom ELSE ST_Reverse(e.geom) END ORDER BY p.seq) AS g,
         sum(e.cost) AS meters
  FROM path p JOIN geo.road_edges e ON e.id = p.edge
),
saved AS (
  INSERT INTO geo.routes (label, meters, geom)
  SELECT a.name || ' → ' || b.name, round(line.meters), line.g
  FROM line, a, b WHERE line.g IS NOT NULL
  RETURNING label, meters, geom
)
SELECT 'route' AS role, saved.label || ': ' || saved.meters || ' m by road' AS label, saved.meters, saved.geom AS geom
FROM saved
UNION ALL
SELECT 'straight line', 'straight line: ' || round(ST_Distance(a.geom::geography, b.geom::geography)) || ' m',
       round(ST_Distance(a.geom::geography, b.geom::geography)), ST_MakeLine(a.geom, b.geom)
FROM a, b
UNION ALL
-- If the two places are not connected by the downloaded streets, say so.
SELECT 'no route', 'no route found: the places are not connected in the street graph', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM saved);

-- name: last_route
SELECT label, meters, geom FROM geo.routes ORDER BY id DESC LIMIT 1;

-- name: walker
-- ST_LineInterpolatePoint(line, fraction): the point at 0% … 100% along the line.
SELECT 'walking: ' || round(meters * :fraction::float8) || ' / ' || meters || ' m' AS label,
       ST_LineInterpolatePoint(geom, :fraction::float8) AS geom
FROM geo.routes
ORDER BY id DESC
LIMIT 1;

-- name: isochrone
-- pgr_drivingDistance: every node reachable within a cost budget (here 80 m per minute of walking).
-- A concave hull around those nodes is the "walkable in N minutes" area.
WITH a AS (SELECT geom FROM geo.places WHERE id = :place_id::int),
s AS (SELECT n.id FROM geo.road_nodes n, a ORDER BY n.geom <-> a.geom LIMIT 1),
reach AS (
  SELECT node FROM pgr_drivingDistance(
    'SELECT id, source, target, cost, cost AS reverse_cost FROM geo.road_edges',
    (SELECT id FROM s), :minutes::float8 * 80, false)
)
SELECT 'isochrone' AS role,
       'walkable in ' || :minutes::int || ' min (by road)' AS label,
       ST_ConcaveHull(ST_Collect(n.geom), 0.3) AS geom
FROM reach r JOIN geo.road_nodes n ON n.id = r.node
UNION ALL
SELECT 'circle', 'circle of ' || (:minutes::int * 80) || ' m', ST_Buffer(a.geom::geography, :minutes::float8 * 80)::geometry
FROM a;
