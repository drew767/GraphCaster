// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import type { TFunction } from "i18next";

import {
  presentationForJsonSyntaxError,
  presentationForParseError,
  presentationForReadFailure,
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
    if (key === "app.errors.openModal.json_invalid_prefix") {
      return "JSON_PREFIX";
    }
    if (key === "app.errors.openModal.read_failed") {
      return "read_failed_msg";
    }
    if (key === "app.errors.openModal.invalid_node_id") {
      return `bad_node:${opts?.index ?? ""}`;
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
