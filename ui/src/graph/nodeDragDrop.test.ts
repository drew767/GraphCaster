// Copyright Aura. All Rights Reserved.

import { describe, it, expect } from "vitest";
import {
  GC_DRAG_NODE_MIME_TYPE,
  encodeNodeDragData,
  decodeNodeDragData,
  isGcNodeDragEvent,
  type NodeDragPayload,
} from "./nodeDragDrop";

describe("nodeDragDrop", () => {
  describe("encodeNodeDragData / decodeNodeDragData", () => {
    it("encodes and decodes primitive node type", () => {
      const payload: NodeDragPayload = { kind: "primitive", nodeType: "task" };
      const encoded = encodeNodeDragData(payload);
      const decoded = decodeNodeDragData(encoded);
      expect(decoded).toEqual(payload);
    });

    it("encodes and decodes graph_ref type", () => {
      const payload: NodeDragPayload = { kind: "graph_ref", targetGraphId: "abc-123" };
      const encoded = encodeNodeDragData(payload);
      const decoded = decodeNodeDragData(encoded);
      expect(decoded).toEqual(payload);
    });

    it("encodes and decodes task_cursor_agent type", () => {
      const payload: NodeDragPayload = { kind: "task_cursor_agent" };
      const encoded = encodeNodeDragData(payload);
      const decoded = decodeNodeDragData(encoded);
      expect(decoded).toEqual(payload);
    });

    it("encodes and decodes template pick", () => {
      const payload: NodeDragPayload = { kind: "template", templateId: "tpl_http_task" };
      const encoded = encodeNodeDragData(payload);
      const decoded = decodeNodeDragData(encoded);
      expect(decoded).toEqual(payload);
    });

    it("returns null for invalid JSON", () => {
      expect(decodeNodeDragData("not json")).toBeNull();
    });

    it("returns null for missing kind", () => {
      expect(decodeNodeDragData(JSON.stringify({ foo: "bar" }))).toBeNull();
    });
  });

  describe("isGcNodeDragEvent", () => {
    it("returns true when dataTransfer has GC mime type", () => {
      const mockEvent = {
        dataTransfer: {
          types: ["text/plain", GC_DRAG_NODE_MIME_TYPE],
        },
      } as unknown as React.DragEvent;
      expect(isGcNodeDragEvent(mockEvent)).toBe(true);
    });

    it("returns false when dataTransfer lacks GC mime type", () => {
      const mockEvent = {
        dataTransfer: {
          types: ["text/plain", "Files"],
        },
      } as unknown as React.DragEvent;
      expect(isGcNodeDragEvent(mockEvent)).toBe(false);
    });

    it("returns false when dataTransfer is null", () => {
      const mockEvent = { dataTransfer: null } as unknown as React.DragEvent;
      expect(isGcNodeDragEvent(mockEvent)).toBe(false);
    });
  });

  describe("GC_DRAG_NODE_MIME_TYPE", () => {
    it("is a lowercase string suitable for dataTransfer", () => {
      expect(GC_DRAG_NODE_MIME_TYPE).toMatch(/^[a-z0-9/\-_]+$/);
    });
  });
});
