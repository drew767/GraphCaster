// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import type { GraphDocumentJson } from "./types";
import {
  clearHistory,
  createEmptyHistory,
  documentJsonSignature,
  redoDocument,
  snapshotBeforeChange,
  undoDocument,
} from "./documentHistory";

const doc = (n: number): GraphDocumentJson =>
  ({
    schemaVersion: 1,
    nodes: [],
    edges: [],
    meta: { title: `v${n}` },
  }) as GraphDocumentJson;

describe("documentHistory", () => {
  it("undo restores previous document", () => {
    let h = createEmptyHistory(10);
    const a = doc(1);
    const b = doc(2);
    h = snapshotBeforeChange(h, a);
    const current = b;
    const u = undoDocument(h, current);
    expect(u).not.toBeNull();
    expect(u!.nextHistory.past.length).toBe(0);
    expect(u!.document.meta?.title).toBe("v1");
  });

  it("redo restores after undo", () => {
    let h = createEmptyHistory(10);
    h = snapshotBeforeChange(h, doc(1));
    const mid = doc(2);
    const u = undoDocument(h, mid);
    expect(u).not.toBeNull();
    h = u!.nextHistory;
    const r = redoDocument(h, u!.document);
    expect(r).not.toBeNull();
    expect(r!.document.meta?.title).toBe("v2");
    expect(r!.nextHistory.future.length).toBe(0);
  });

  it("clearHistory empties stacks", () => {
    let h = createEmptyHistory(10);
    h = snapshotBeforeChange(h, doc(1));
    h = clearHistory(h);
    expect(h.past.length).toBe(0);
    expect(h.future.length).toBe(0);
  });

  it("past is trimmed to maxDepth", () => {
    let h = createEmptyHistory(3);
    for (let i = 0; i < 5; i++) {
      h = snapshotBeforeChange(h, doc(i));
    }
    expect(h.past.length).toBe(3);
    expect(h.past[0]?.meta?.title).toBe("v2");
    expect(h.past[2]?.meta?.title).toBe("v4");
  });

  it("new snapshot clears future", () => {
    let h = createEmptyHistory(10);
    h = snapshotBeforeChange(h, doc(1));
    const u = undoDocument(h, doc(2));
    expect(u).not.toBeNull();
    h = u!.nextHistory;
    expect(h.future.length).toBe(1);
    h = snapshotBeforeChange(h, u!.document);
    expect(h.future.length).toBe(0);
  });

  it("duplicate consecutive snapshot is not pushed", () => {
    let h = createEmptyHistory(10);
    const a = doc(1);
    h = snapshotBeforeChange(h, a);
    h = snapshotBeforeChange(h, a);
    expect(h.past.length).toBe(1);
  });

  it("documentJsonSignature matches for equal content", () => {
    expect(documentJsonSignature(doc(1))).toBe(documentJsonSignature(doc(1)));
  });
});
