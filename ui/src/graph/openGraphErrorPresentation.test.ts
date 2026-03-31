// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import type { TFunction } from "i18next";

import {
  presentationForInspectorJsonSyntaxError,
  presentationForInspectorSimple,
  presentationForJsonSyntaxError,
  presentationForParseError,
  presentationForReadFailure,
  presentationForSaveEmptyName,
  presentationForSaveWriteFailed,
  presentationForWorkspaceDuplicateGraphId,
  presentationForWorkspaceWriteFailed,
} from "./openGraphErrorPresentation";

function mockT(): TFunction {
  const fn = ((key: string, opts?: Record<string, string | number>) => {
    if (key === "app.errors.openModal.title") {
      return "TITLE";
    }
    if (key === "app.errors.openModal.titleWithFile") {
      return `TITLE:${opts?.fileName ?? ""}`;
    }
    if (key === "app.errors.openModal.nodes_not_array") {
      return "nodes_not_array_msg";
    }
    if (key === "app.errors.openModal.invalid_json") {
      return "invalid_json_msg";
    }
    if (key === "app.errors.openModal.json_invalid_prefix") {
      return "JSON_PREFIX";
    }
    if (key === "app.errors.openModal.read_failed") {
      return "read_failed_msg";
    }
    if (key === "app.errors.openModal.invalid_node_id") {
      return `bad_node:${opts?.index ?? ""}`;
    }
    if (key === "app.errors.inspectorModal.title") {
      return "INSP_TITLE";
    }
    if (key === "app.inspector.dataParseError") {
      return "DATA_PARSE";
    }
    if (key === "app.inspector.invalidDataJson") {
      return "INVALID_OBJ";
    }
    if (key === "app.errors.saveError.title") {
      return "SAVE_TITLE";
    }
    if (key === "app.saveModal.emptyName") {
      return "EMPTY_NAME";
    }
    if (key === "app.saveModal.writeFailed") {
      return "WRITE_FAIL";
    }
    if (key === "app.workspace.duplicateGraphId") {
      return `DUP:${opts?.file ?? ""}`;
    }
    if (key === "app.workspace.writeFailed") {
      return "WS_WRITE";
    }
    return key;
  }) as TFunction;
  return fn;
}

describe("presentationForParseError", () => {
  it("uses default title without fileName", () => {
    const p = presentationForParseError(mockT(), { kind: "nodes_not_array" });
    expect(p.title).toBe("TITLE");
    expect(p.message).toBe("nodes_not_array_msg");
    expect(p.copyText).toContain("nodes_not_array_msg");
  });

  it("uses titleWithFile when fileName is set", () => {
    const p = presentationForParseError(mockT(), { kind: "nodes_not_array" }, { fileName: "x.json" });
    expect(p.title).toBe("TITLE:x.json");
    expect(p.copyText.startsWith("x.json\n\n")).toBe(true);
  });

  it("passes index for invalid_node", () => {
    const p = presentationForParseError(mockT(), {
      kind: "invalid_node",
      index: 3,
      reason: "id",
    });
    expect(p.message).toBe("bad_node:3");
  });

  it("handles invalid_json kind", () => {
    const p = presentationForParseError(mockT(), { kind: "invalid_json" });
    expect(p.message).toBe("invalid_json_msg");
  });
});

describe("presentationForJsonSyntaxError", () => {
  it("includes syntax message", () => {
    const p = presentationForJsonSyntaxError(mockT(), new SyntaxError("bad token"));
    expect(p.message).toBe("JSON_PREFIX bad token");
    expect(p.copyText).toBe("JSON_PREFIX bad token");
  });

  it("prefixes copyText with fileName when set", () => {
    const p = presentationForJsonSyntaxError(mockT(), new SyntaxError("e"), { fileName: "a.json" });
    expect(p.title).toBe("TITLE:a.json");
    expect(p.copyText).toBe("a.json\n\nJSON_PREFIX e");
  });
});

describe("presentationForReadFailure", () => {
  it("shows read_failed message", () => {
    const p = presentationForReadFailure(mockT());
    expect(p.title).toBe("TITLE");
    expect(p.message).toBe("read_failed_msg");
    expect(p.copyText).toBe("read_failed_msg");
  });

  it("uses titleWithFile and prefixes copyText when fileName set", () => {
    const p = presentationForReadFailure(mockT(), { fileName: "b.json" });
    expect(p.title).toBe("TITLE:b.json");
    expect(p.copyText).toBe("b.json\n\nread_failed_msg");
  });
});

describe("presentationForInspectorSimple", () => {
  it("uses inspector title and message key", () => {
    const p = presentationForInspectorSimple(mockT(), "app.inspector.invalidDataJson");
    expect(p.title).toBe("INSP_TITLE");
    expect(p.message).toBe("INVALID_OBJ");
    expect(p.copyText).toBe("INVALID_OBJ");
  });
});

describe("presentationForInspectorJsonSyntaxError", () => {
  it("includes engine message in copyText", () => {
    const p = presentationForInspectorJsonSyntaxError(mockT(), new SyntaxError("x"));
    expect(p.title).toBe("INSP_TITLE");
    expect(p.message).toBe("DATA_PARSE");
    expect(p.copyText).toContain("x");
  });
});

describe("presentationForSaveEmptyName", () => {
  it("uses save empty message", () => {
    const p = presentationForSaveEmptyName(mockT());
    expect(p.title).toBe("SAVE_TITLE");
    expect(p.message).toBe("EMPTY_NAME");
  });
});

describe("presentationForSaveWriteFailed", () => {
  it("appends error text to copy", () => {
    const p = presentationForSaveWriteFailed(mockT(), new Error("disk"));
    expect(p.title).toBe("SAVE_TITLE");
    expect(p.message).toBe("WRITE_FAIL");
    expect(p.copyText).toContain("disk");
  });
});

describe("presentationForWorkspaceDuplicateGraphId", () => {
  it("interpolates conflicting file", () => {
    const p = presentationForWorkspaceDuplicateGraphId(mockT(), "other.json");
    expect(p.title).toBe("SAVE_TITLE");
    expect(p.message).toBe("DUP:other.json");
  });
});

describe("presentationForWorkspaceWriteFailed", () => {
  it("uses workspace write message", () => {
    const p = presentationForWorkspaceWriteFailed(mockT());
    expect(p.title).toBe("SAVE_TITLE");
    expect(p.message).toBe("WS_WRITE");
    expect(p.copyText).toBe("WS_WRITE");
  });

  it("appends error to copyText when err provided", () => {
    const p = presentationForWorkspaceWriteFailed(mockT(), new Error("eacces"));
    expect(p.message).toBe("WS_WRITE");
    expect(p.copyText).toContain("eacces");
  });
});
