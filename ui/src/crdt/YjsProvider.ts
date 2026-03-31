// Copyright GraphCaster. All Rights Reserved.

import * as Y from "yjs";

/** Yjs shapes for a graph document (Phase 5 prep; host sync not wired yet). */
export function createGraphYDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap("nodes");
  doc.getArray("edges");
  doc.getMap("meta");
  return doc;
}
