// Stub for dagre — replace with real package when added to package.json
class Graph {
  _nodes: Map<string, { width: number; height: number; label: string; x: number; y: number }> = new Map();
  _edges: Array<{ v: string; w: string }> = [];
  _graph: Record<string, unknown> = {};
  setDefaultEdgeLabel(_fn: () => unknown) {}
  setGraph(opts: Record<string, unknown>) { this._graph = opts; }
  setNode(id: string, data: { width: number; height: number; label: string }) {
    this._nodes.set(id, { ...data, x: 0, y: 0 });
  }
  setEdge(v: string, w: string) { this._edges.push({ v, w }); }
  hasNode(id: string) { return this._nodes.has(id); }
  node(id: string) { return this._nodes.get(id); }
  nodes() { return Array.from(this._nodes.keys()); }
  edges() { return this._edges; }
}

const graphlib = { Graph };

function layout(g: InstanceType<typeof Graph>) {
  const isLR = (g._graph as { rankdir?: string }).rankdir === "LR";
  // Topological sort based on edges to assign positions
  const nodeIds = Array.from(g._nodes.keys());
  const inDegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const e of g._edges) {
    inDegree.set(e.w, (inDegree.get(e.w) ?? 0) + 1);
  }
  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const e of g._edges) {
      if (e.v === cur) {
        const deg = (inDegree.get(e.w) ?? 1) - 1;
        inDegree.set(e.w, deg);
        if (deg === 0) queue.push(e.w);
      }
    }
  }
  // Assign positions based on topo order
  order.forEach((id, i) => {
    const node = g._nodes.get(id)!;
    node.x = isLR ? i * 300 : 0;
    node.y = isLR ? 0 : i * 300;
  });
  // Any nodes not in order (disconnected) get last position
  let last = order.length;
  for (const id of nodeIds) {
    if (!order.includes(id)) {
      const node = g._nodes.get(id)!;
      node.x = isLR ? last * 300 : 0;
      node.y = isLR ? 0 : last * 300;
      last++;
    }
  }
}

const dagre = { graphlib, layout };
export default dagre;
