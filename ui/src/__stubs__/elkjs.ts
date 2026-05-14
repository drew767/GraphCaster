// Stub for elkjs — replace with real package when added to package.json
class ELK {
  async layout(graph: { id: string; children?: Array<{ id: string; width?: number; height?: number }> }) {
    let x = 0;
    const children = (graph.children ?? []).map((n) => ({ ...n, x: x++ * 300, y: 0, children: [] }));
    return { ...graph, children };
  }
}
export default ELK;
