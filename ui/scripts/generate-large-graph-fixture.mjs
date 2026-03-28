#!/usr/bin/env node
// Copyright GraphCaster. All Rights Reserved.
/**
 * Writes a valid GraphDocument JSON (linear chain) to stdout for local canvas perf tests.
 * Usage: node scripts/generate-large-graph-fixture.mjs [totalNodes]
 * Default totalNodes=500 (1 start + middle tasks + 1 exit). Min 3.
 * Example: node scripts/generate-large-graph-fixture.mjs 800 > /tmp/big.json
 */

const argvN = process.argv[2] != null ? Number.parseInt(String(process.argv[2]), 10) : 500;
const total = Number.isFinite(argvN) ? Math.max(3, argvN) : 500;
const taskCount = total - 2;

const nodes = [
  {
    id: "s0",
    type: "start",
    position: { x: 0, y: 0 },
    data: {},
  },
];

const edges = [];

for (let i = 0; i < taskCount; i++) {
  const id = `t${i}`;
  nodes.push({
    id,
    type: "task",
    position: { x: 100 + i * 120, y: 0 },
    data: { title: `task ${i}` },
  });
}

nodes.push({
  id: "x0",
  type: "exit",
  position: { x: 100 + taskCount * 120, y: 0 },
  data: {},
});

let edgeSeq = 0;
for (let i = 0; i < nodes.length - 1; i++) {
  const a = nodes[i].id;
  const b = nodes[i + 1].id;
  edges.push({
    id: `e${edgeSeq++}`,
    source: a,
    sourceHandle: "out_default",
    target: b,
    targetHandle: "in_default",
    condition: null,
  });
}

const doc = {
  schemaVersion: 1,
  meta: {
    schemaVersion: 1,
    graphId: "00000000-0000-4000-8000-000000000001",
    title: `large linear fixture (${total} nodes)`,
    author: "generate-large-graph-fixture",
  },
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes,
  edges,
};

process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
